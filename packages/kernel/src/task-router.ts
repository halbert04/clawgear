import type { Database } from '@clawgear/db';
import { agentCompetence, agents } from '@clawgear/db/pg';
import { and, eq, sql } from 'drizzle-orm';

export interface TaskRouterConfig {
  db: Database;
}

export interface RouteResult {
  agentId: string;
  agentName: string;
  autonomyLevel: string;
  avgQualityScore: number;
  totalRuns: number;
  reason: string;
}

export class TaskRouter {
  private db: Database;

  constructor(config: TaskRouterConfig) {
    this.db = config.db;
  }

  /**
   * Find the best available agent for a task type.
   * Considers competence, availability (idle status), and autonomy level.
   */
  async routeTask(
    companyId: string,
    taskType: string,
    excludeAgentIds: string[] = [],
  ): Promise<RouteResult | null> {
    // Join competence with agents to check availability
    const candidates = await this.db
      .select({
        agentId: agentCompetence.agentId,
        agentName: agents.name,
        autonomyLevel: agentCompetence.autonomyLevel,
        avgQualityScore: agentCompetence.avgQualityScore,
        totalRuns: agentCompetence.totalRuns,
        successfulRuns: agentCompetence.successfulRuns,
        agentStatus: agents.status,
      })
      .from(agentCompetence)
      .innerJoin(agents, eq(agents.id, agentCompetence.agentId))
      .where(
        and(
          eq(agentCompetence.companyId, companyId),
          eq(agentCompetence.taskType, taskType),
          eq(agents.status, 'idle'),
          sql`${agentCompetence.autonomyLevel} != 'degraded'`,
          excludeAgentIds.length > 0
            ? sql`${agentCompetence.agentId} != ALL(${excludeAgentIds})`
            : sql`TRUE`,
        ),
      )
      .orderBy(
        sql`${agentCompetence.avgQualityScore} DESC`,
        sql`${agentCompetence.successfulRuns}::float / NULLIF(${agentCompetence.totalRuns}, 0) DESC`,
      )
      .limit(1);

    if (candidates.length === 0) {
      // Fall back: try any idle agent even without competence records
      return this.routeToAnyAvailable(companyId, excludeAgentIds);
    }

    const best = candidates[0]!;
    return {
      agentId: best.agentId,
      agentName: best.agentName,
      autonomyLevel: best.autonomyLevel,
      avgQualityScore: best.avgQualityScore,
      totalRuns: best.totalRuns,
      reason: `Best competence for ${taskType}: quality=${best.avgQualityScore.toFixed(2)}, runs=${best.totalRuns}`,
    };
  }

  /**
   * Get a ranked list of agents for a task type.
   */
  async rankAgents(companyId: string, taskType: string, limit = 5): Promise<RouteResult[]> {
    const candidates = await this.db
      .select({
        agentId: agentCompetence.agentId,
        agentName: agents.name,
        autonomyLevel: agentCompetence.autonomyLevel,
        avgQualityScore: agentCompetence.avgQualityScore,
        totalRuns: agentCompetence.totalRuns,
        successfulRuns: agentCompetence.successfulRuns,
      })
      .from(agentCompetence)
      .innerJoin(agents, eq(agents.id, agentCompetence.agentId))
      .where(
        and(
          eq(agentCompetence.companyId, companyId),
          eq(agentCompetence.taskType, taskType),
          sql`${agentCompetence.autonomyLevel} != 'degraded'`,
        ),
      )
      .orderBy(
        sql`${agentCompetence.avgQualityScore} DESC`,
        sql`${agentCompetence.successfulRuns}::float / NULLIF(${agentCompetence.totalRuns}, 0) DESC`,
      )
      .limit(limit);

    return candidates.map((c) => ({
      agentId: c.agentId,
      agentName: c.agentName,
      autonomyLevel: c.autonomyLevel,
      avgQualityScore: c.avgQualityScore,
      totalRuns: c.totalRuns,
      reason: `quality=${c.avgQualityScore.toFixed(2)}, success=${c.successfulRuns}/${c.totalRuns}`,
    }));
  }

  /**
   * Determine task complexity level based on historical data.
   * Used for curriculum learning: assigns simple tasks to new agents.
   */
  async getTaskComplexity(
    companyId: string,
    taskType: string,
  ): Promise<'simple' | 'moderate' | 'complex'> {
    const [stats] = await this.db
      .select({
        avgQuality: sql<number>`avg(${agentCompetence.avgQualityScore})`,
        avgDuration: sql<number>`avg(${agentCompetence.avgDurationMs})`,
        avgCost: sql<number>`avg(${agentCompetence.avgCostCents})`,
        totalRunsAcrossAgents: sql<number>`sum(${agentCompetence.totalRuns})`,
        avgSuccessRate: sql<number>`avg(${agentCompetence.successfulRuns}::float / NULLIF(${agentCompetence.totalRuns}, 0))`,
      })
      .from(agentCompetence)
      .where(and(eq(agentCompetence.companyId, companyId), eq(agentCompetence.taskType, taskType)));

    if (!stats || stats.totalRunsAcrossAgents === 0) return 'moderate';

    const successRate = stats.avgSuccessRate ?? 0;

    // High success rate + low cost = simple
    if (successRate > 0.85 && (stats.avgCost ?? 0) < 50) return 'simple';
    // Low success rate or high cost = complex
    if (successRate < 0.6 || (stats.avgCost ?? 0) > 200) return 'complex';
    return 'moderate';
  }

  /**
   * For curriculum learning: suggest appropriate task types for an agent
   * based on their current competence level.
   */
  async suggestTasksForAgent(companyId: string, agentId: string): Promise<string[]> {
    // Get the agent's current competence records
    const competences = await this.db
      .select()
      .from(agentCompetence)
      .where(and(eq(agentCompetence.companyId, companyId), eq(agentCompetence.agentId, agentId)));

    const masteredTypes = new Set(
      competences
        .filter(
          (c) =>
            c.autonomyLevel === 'auto' ||
            (c.autonomyLevel === 'semi_auto' && c.avgQualityScore >= 0.8),
        )
        .map((c) => c.taskType),
    );

    // Get all task types from the company
    const allTypes = await this.db
      .select({ taskType: agentCompetence.taskType })
      .from(agentCompetence)
      .where(eq(agentCompetence.companyId, companyId))
      .groupBy(agentCompetence.taskType);

    // Suggest task types the agent hasn't mastered yet,
    // sorted by simplicity (for curriculum learning)
    const suggestions: string[] = [];
    for (const { taskType } of allTypes) {
      if (!masteredTypes.has(taskType)) {
        suggestions.push(taskType);
      }
    }

    return suggestions;
  }

  private async routeToAnyAvailable(
    companyId: string,
    excludeAgentIds: string[],
  ): Promise<RouteResult | null> {
    const conditions = [eq(agents.companyId, companyId), eq(agents.status, 'idle')];

    if (excludeAgentIds.length > 0) {
      conditions.push(sql`${agents.id} != ALL(${excludeAgentIds})`);
    }

    const [agent] = await this.db
      .select({ id: agents.id, name: agents.name })
      .from(agents)
      .where(and(...conditions))
      .limit(1);

    if (!agent) return null;

    return {
      agentId: agent.id,
      agentName: agent.name,
      autonomyLevel: 'supervised',
      avgQualityScore: 0,
      totalRuns: 0,
      reason: 'No competence data; routed to available agent',
    };
  }
}
