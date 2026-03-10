import type { Database } from '@clawgear/db';
import { agentCompetence } from '@clawgear/db/pg';
import type { AutonomyLevel, QualityTrend } from '@clawgear/shared/constants';
import { and, eq } from 'drizzle-orm';

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
}
