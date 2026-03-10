import type { Database } from '@clawgear/db';
import { promptVersions, qualityEvaluations } from '@clawgear/db/pg';
import type { EventBus, SystemEvent } from '@clawgear/shared/interfaces';
import { and, desc, eq, sql } from 'drizzle-orm';

export interface TrainingExample {
  runId: string;
  agentRole: string;
  promptContent: string;
  output: string;
  qualityScore: number;
}

export interface PromptOptimizerConfig {
  db: Database;
  eventBus: EventBus;
  minExamplesForOptimization?: number;
  topKExemplars?: number;
  abTrafficPercent?: number;
  regressionThreshold?: number;
}

export class PromptOptimizer {
  private db: Database;
  private eventBus: EventBus;
  private minExamples: number;
  private topK: number;
  private abTrafficPercent: number;
  private regressionThreshold: number;

  constructor(config: PromptOptimizerConfig) {
    this.db = config.db;
    this.eventBus = config.eventBus;
    this.minExamples = config.minExamplesForOptimization ?? 100;
    this.topK = config.topKExemplars ?? 10;
    this.abTrafficPercent = config.abTrafficPercent ?? 10;
    this.regressionThreshold = config.regressionThreshold ?? 0.05;
  }

  /**
   * Collect training examples from quality evaluations.
   * Returns (input, output, score) triples for a given agent role.
   */
  async collectTrainingData(
    companyId: string,
    agentRole: string,
    limit = 200,
  ): Promise<TrainingExample[]> {
    const evaluations = await this.db
      .select({
        runId: qualityEvaluations.runId,
        overallScore: qualityEvaluations.overallScore,
        feedback: qualityEvaluations.feedback,
      })
      .from(qualityEvaluations)
      .where(
        and(
          eq(qualityEvaluations.companyId, companyId),
          sql`${qualityEvaluations.agentId} IN (
            SELECT id FROM agents WHERE company_id = ${companyId} AND role = ${agentRole}
          )`,
        ),
      )
      .orderBy(desc(qualityEvaluations.createdAt))
      .limit(limit);

    return evaluations.map((e) => ({
      runId: e.runId,
      agentRole,
      promptContent: '',
      output: e.feedback ?? '',
      qualityScore: e.overallScore,
    }));
  }

  /**
   * Check if we have enough data to attempt prompt optimization.
   */
  async hasEnoughData(companyId: string, agentRole: string): Promise<boolean> {
    const [result] = await this.db
      .select({ count: sql<number>`count(*)` })
      .from(qualityEvaluations)
      .where(
        and(
          eq(qualityEvaluations.companyId, companyId),
          sql`${qualityEvaluations.agentId} IN (
            SELECT id FROM agents WHERE company_id = ${companyId} AND role = ${agentRole}
          )`,
        ),
      );

    return (result?.count ?? 0) >= this.minExamples;
  }

  /**
   * Select top-K exemplars by quality score for few-shot prompting.
   */
  async selectExemplars(companyId: string, agentRole: string): Promise<TrainingExample[]> {
    const topExamples = await this.db
      .select({
        runId: qualityEvaluations.runId,
        overallScore: qualityEvaluations.overallScore,
        feedback: qualityEvaluations.feedback,
      })
      .from(qualityEvaluations)
      .where(
        and(
          eq(qualityEvaluations.companyId, companyId),
          eq(qualityEvaluations.passed, true),
          sql`${qualityEvaluations.agentId} IN (
            SELECT id FROM agents WHERE company_id = ${companyId} AND role = ${agentRole}
          )`,
        ),
      )
      .orderBy(desc(qualityEvaluations.overallScore))
      .limit(this.topK);

    return topExamples.map((e) => ({
      runId: e.runId,
      agentRole,
      promptContent: '',
      output: e.feedback ?? '',
      qualityScore: e.overallScore,
    }));
  }

  /**
   * Create a new prompt version for A/B testing.
   */
  async createOptimizedVersion(
    companyId: string,
    agentRole: string,
    promptType: 'heartbeat' | 'system' | 'skill',
    optimizedContent: string,
    parentVersionId?: string,
  ): Promise<{ versionId: string; version: number }> {
    // Get next version number
    const [latest] = await this.db
      .select({ maxVersion: sql<number>`COALESCE(MAX(${promptVersions.version}), 0)` })
      .from(promptVersions)
      .where(
        and(
          eq(promptVersions.companyId, companyId),
          eq(promptVersions.agentRole, agentRole),
          eq(promptVersions.promptType, promptType),
        ),
      );

    const nextVersion = (latest?.maxVersion ?? 0) + 1;

    const [version] = await this.db
      .insert(promptVersions)
      .values({
        companyId,
        agentRole,
        promptType,
        version: nextVersion,
        content: optimizedContent,
        isActive: false,
        isAbTesting: true,
        abTrafficPercent: this.abTrafficPercent,
        sampleCount: 0,
        parentVersionId: parentVersionId ?? null,
      })
      .returning();

    this.emit('evolution.prompt_optimized', companyId, {
      promptVersionId: version!.id,
      agentRole,
      version: nextVersion,
      evaluationScore: 0,
    });

    return { versionId: version!.id, version: nextVersion };
  }

  /**
   * Resolve which prompt version to use for a given request.
   * Implements A/B traffic splitting.
   */
  async resolvePromptVersion(
    companyId: string,
    agentRole: string,
    promptType: 'heartbeat' | 'system' | 'skill',
  ): Promise<{ versionId: string; content: string; isExperiment: boolean }> {
    // Check for A/B testing version
    const [abVersion] = await this.db
      .select()
      .from(promptVersions)
      .where(
        and(
          eq(promptVersions.companyId, companyId),
          eq(promptVersions.agentRole, agentRole),
          eq(promptVersions.promptType, promptType),
          eq(promptVersions.isAbTesting, true),
        ),
      )
      .limit(1);

    if (abVersion) {
      // Roll dice for traffic split
      const roll = Math.random() * 100;
      if (roll < abVersion.abTrafficPercent) {
        // Increment sample count
        await this.db
          .update(promptVersions)
          .set({ sampleCount: sql`${promptVersions.sampleCount} + 1` })
          .where(eq(promptVersions.id, abVersion.id));

        return {
          versionId: abVersion.id,
          content: abVersion.content,
          isExperiment: true,
        };
      }
    }

    // Use active version
    const [activeVersion] = await this.db
      .select()
      .from(promptVersions)
      .where(
        and(
          eq(promptVersions.companyId, companyId),
          eq(promptVersions.agentRole, agentRole),
          eq(promptVersions.promptType, promptType),
          eq(promptVersions.isActive, true),
        ),
      )
      .limit(1);

    if (activeVersion) {
      return {
        versionId: activeVersion.id,
        content: activeVersion.content,
        isExperiment: false,
      };
    }

    // No version found
    return { versionId: '', content: '', isExperiment: false };
  }

  /**
   * Record quality score for a prompt version and check for auto-rollback.
   */
  async recordResult(versionId: string, qualityScore: number): Promise<{ rolledBack: boolean }> {
    // Update evaluation score as running average
    const [version] = await this.db
      .select()
      .from(promptVersions)
      .where(eq(promptVersions.id, versionId));

    if (!version) return { rolledBack: false };

    const currentScore = version.evaluationScore ?? 0;
    const sampleCount = version.sampleCount || 1;
    const newScore = (currentScore * (sampleCount - 1) + qualityScore) / sampleCount;

    await this.db
      .update(promptVersions)
      .set({ evaluationScore: newScore })
      .where(eq(promptVersions.id, versionId));

    // Check for auto-rollback on A/B test versions
    if (version.isAbTesting && sampleCount >= 20) {
      // Get the active version's score for comparison
      const [activeVersion] = await this.db
        .select()
        .from(promptVersions)
        .where(
          and(
            eq(promptVersions.companyId, version.companyId),
            eq(promptVersions.agentRole, version.agentRole),
            eq(promptVersions.promptType, version.promptType),
            eq(promptVersions.isActive, true),
          ),
        );

      if (activeVersion?.evaluationScore) {
        const regression = activeVersion.evaluationScore - newScore;
        if (regression > this.regressionThreshold) {
          await this.rollbackVersion(versionId);
          return { rolledBack: true };
        }
      }
    }

    return { rolledBack: false };
  }

  /**
   * Promote an A/B test version to active.
   */
  async promoteVersion(versionId: string): Promise<void> {
    const [version] = await this.db
      .select()
      .from(promptVersions)
      .where(eq(promptVersions.id, versionId));

    if (!version) throw new Error(`Version not found: ${versionId}`);

    // Deactivate current active version
    await this.db
      .update(promptVersions)
      .set({ isActive: false })
      .where(
        and(
          eq(promptVersions.companyId, version.companyId),
          eq(promptVersions.agentRole, version.agentRole),
          eq(promptVersions.promptType, version.promptType),
          eq(promptVersions.isActive, true),
        ),
      );

    // Activate the new version
    await this.db
      .update(promptVersions)
      .set({ isActive: true, isAbTesting: false, abTrafficPercent: 0 })
      .where(eq(promptVersions.id, versionId));
  }

  /**
   * Roll back an A/B test version (stop testing).
   */
  async rollbackVersion(versionId: string): Promise<void> {
    const [version] = await this.db
      .select()
      .from(promptVersions)
      .where(eq(promptVersions.id, versionId));

    if (!version) return;

    await this.db
      .update(promptVersions)
      .set({ isAbTesting: false, abTrafficPercent: 0 })
      .where(eq(promptVersions.id, versionId));

    this.emit('evolution.prompt_rollback', version.companyId, {
      promptVersionId: versionId,
      agentRole: version.agentRole,
      version: version.version,
      evaluationScore: version.evaluationScore,
    });
  }

  /**
   * Get all prompt versions for a company/role/type.
   */
  async getVersions(companyId: string, agentRole: string, promptType: string) {
    return this.db
      .select()
      .from(promptVersions)
      .where(
        and(
          eq(promptVersions.companyId, companyId),
          eq(promptVersions.agentRole, agentRole),
          eq(promptVersions.promptType, promptType),
        ),
      )
      .orderBy(desc(promptVersions.version));
  }

  private emit(type: string, companyId: string, payload: Record<string, unknown>): void {
    const event: SystemEvent = {
      type,
      companyId,
      timestamp: new Date(),
      payload,
    };
    this.eventBus.emit(event);
  }
}
