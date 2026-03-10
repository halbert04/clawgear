import type { Database } from '@clawgear/db';
import { agentCompetence } from '@clawgear/db/pg';
import type { AutonomyLevel, QualityTrend } from '@clawgear/shared/constants';
import { and, eq, sql } from 'drizzle-orm';

export interface CompetenceUpdateInput {
  companyId: string;
  agentId: string;
  taskType: string;
  succeeded: boolean;
  costCents: number;
  durationMs: number;
  qualityScore: number;
}

export interface CompetenceTrackerConfig {
  db: Database;
  graduationThreshold?: number;
  semiAutoThreshold?: number;
}

export class CompetenceTracker {
  private db: Database;
  private graduationThreshold: number;
  private semiAutoThreshold: number;

  constructor(config: CompetenceTrackerConfig) {
    this.db = config.db;
    this.graduationThreshold = config.graduationThreshold ?? 10;
    this.semiAutoThreshold = config.semiAutoThreshold ?? 5;
  }

  async update(input: CompetenceUpdateInput): Promise<void> {
    // Upsert competence record
    const [existing] = await this.db
      .select()
      .from(agentCompetence)
      .where(
        and(
          eq(agentCompetence.companyId, input.companyId),
          eq(agentCompetence.agentId, input.agentId),
          eq(agentCompetence.taskType, input.taskType),
        ),
      );

    if (!existing) {
      await this.db.insert(agentCompetence).values({
        companyId: input.companyId,
        agentId: input.agentId,
        taskType: input.taskType,
        totalRuns: 1,
        successfulRuns: input.succeeded ? 1 : 0,
        failedRuns: input.succeeded ? 0 : 1,
        avgCostCents: input.costCents,
        avgDurationMs: input.durationMs,
        avgQualityScore: input.qualityScore,
        qualityTrend: 'stable',
        autonomyLevel: 'supervised',
        lastUsedAt: new Date(),
        updatedAt: new Date(),
      });
      return;
    }

    const newTotal = existing.totalRuns + 1;
    const newSuccessful = existing.successfulRuns + (input.succeeded ? 1 : 0);
    const newFailed = existing.failedRuns + (input.succeeded ? 0 : 1);

    // Running averages
    const newAvgCost = (existing.avgCostCents * existing.totalRuns + input.costCents) / newTotal;
    const newAvgDuration =
      (existing.avgDurationMs * existing.totalRuns + input.durationMs) / newTotal;
    const newAvgQuality =
      (existing.avgQualityScore * existing.totalRuns + input.qualityScore) / newTotal;

    // Quality trend (compare last 10 vs prev 10 using running average as proxy)
    const trend = this.calculateTrend(
      existing.avgQualityScore,
      newAvgQuality,
      existing.qualityTrend as QualityTrend,
    );

    // Autonomy graduation
    const autonomy = this.calculateAutonomy(
      newTotal,
      newSuccessful / newTotal,
      newAvgQuality,
      existing.autonomyLevel as AutonomyLevel,
    );

    await this.db
      .update(agentCompetence)
      .set({
        totalRuns: newTotal,
        successfulRuns: newSuccessful,
        failedRuns: newFailed,
        avgCostCents: newAvgCost,
        avgDurationMs: newAvgDuration,
        avgQualityScore: newAvgQuality,
        qualityTrend: trend,
        autonomyLevel: autonomy,
        lastUsedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(agentCompetence.id, existing.id));
  }

  private calculateTrend(
    prevAvg: number,
    newAvg: number,
    currentTrend: QualityTrend,
  ): QualityTrend {
    const delta = newAvg - prevAvg;
    if (delta > 0.05) return 'improving';
    if (delta < -0.05) return 'degrading';
    return currentTrend;
  }

  private calculateAutonomy(
    totalRuns: number,
    successRate: number,
    avgQuality: number,
    currentLevel: AutonomyLevel,
  ): AutonomyLevel {
    // Recover from degraded → supervised after demonstrating improvement
    if (currentLevel === 'degraded' && successRate >= 0.5 && avgQuality >= 0.3) {
      return 'supervised';
    }

    // Graduate from supervised → semi_auto after threshold runs with >70% success
    if (
      currentLevel === 'supervised' &&
      totalRuns >= this.semiAutoThreshold &&
      successRate >= 0.7 &&
      avgQuality >= 0.6
    ) {
      return 'semi_auto';
    }

    // Graduate from semi_auto → auto after more runs with >85% success
    if (
      currentLevel === 'semi_auto' &&
      totalRuns >= this.graduationThreshold &&
      successRate >= 0.85 &&
      avgQuality >= 0.75
    ) {
      return 'auto';
    }

    // Demote if quality drops
    if (currentLevel === 'auto' && (successRate < 0.7 || avgQuality < 0.5)) {
      return 'semi_auto';
    }
    if (currentLevel === 'semi_auto' && (successRate < 0.5 || avgQuality < 0.3)) {
      return 'supervised';
    }

    return currentLevel;
  }

  async getCompetence(companyId: string, agentId: string) {
    return this.db
      .select()
      .from(agentCompetence)
      .where(and(eq(agentCompetence.companyId, companyId), eq(agentCompetence.agentId, agentId)));
  }

  /**
   * Apply competence decay: agents that haven't used a task type recently
   * get downgraded. Returns the number of records decayed.
   */
  async applyDecay(decayAfterDays = 30): Promise<number> {
    const cutoff = new Date(Date.now() - decayAfterDays * 24 * 60 * 60 * 1000);

    // Find competence records where lastUsedAt is before cutoff
    // and the autonomy level is above supervised
    const staleRecords = await this.db
      .select()
      .from(agentCompetence)
      .where(
        and(
          sql`${agentCompetence.lastUsedAt} < ${cutoff}`,
          sql`${agentCompetence.autonomyLevel} IN ('semi_auto', 'auto')`,
        ),
      );

    let decayedCount = 0;
    for (const record of staleRecords) {
      const newLevel: AutonomyLevel = record.autonomyLevel === 'auto' ? 'semi_auto' : 'supervised';
      await this.db
        .update(agentCompetence)
        .set({ autonomyLevel: newLevel, updatedAt: new Date() })
        .where(eq(agentCompetence.id, record.id));
      decayedCount++;
    }

    return decayedCount;
  }

  /**
   * Get team competence summary across all agents for a company.
   */
  async getTeamCompetence(companyId: string) {
    return this.db
      .select({
        taskType: agentCompetence.taskType,
        totalAgents: sql<number>`count(DISTINCT ${agentCompetence.agentId})`,
        avgSuccessRate: sql<number>`avg(${agentCompetence.successfulRuns}::float / NULLIF(${agentCompetence.totalRuns}, 0))`,
        avgQuality: sql<number>`avg(${agentCompetence.avgQualityScore})`,
        totalRuns: sql<number>`sum(${agentCompetence.totalRuns})`,
      })
      .from(agentCompetence)
      .where(eq(agentCompetence.companyId, companyId))
      .groupBy(agentCompetence.taskType);
  }

  /**
   * Find the most competent agent for a given task type.
   */
  async findBestAgent(companyId: string, taskType: string, excludeAgentIds: string[] = []) {
    const conditions = [
      eq(agentCompetence.companyId, companyId),
      eq(agentCompetence.taskType, taskType),
      sql`${agentCompetence.autonomyLevel} != 'degraded'`,
    ];

    if (excludeAgentIds.length > 0) {
      conditions.push(sql`${agentCompetence.agentId} != ALL(${excludeAgentIds})`);
    }

    const [best] = await this.db
      .select()
      .from(agentCompetence)
      .where(and(...conditions))
      .orderBy(
        sql`${agentCompetence.avgQualityScore} DESC`,
        sql`${agentCompetence.successfulRuns}::float / NULLIF(${agentCompetence.totalRuns}, 0) DESC`,
      )
      .limit(1);

    return best ?? null;
  }
}
