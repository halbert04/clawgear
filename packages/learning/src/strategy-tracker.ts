import type { Database } from '@clawgear/db';
import { strategyPatterns } from '@clawgear/db/pg';
import type { StrategyPatternType } from '@clawgear/shared/constants';
import type { EventBus, SystemEvent } from '@clawgear/shared/interfaces';
import { and, desc, eq, sql } from 'drizzle-orm';

export interface StrategyTrackerConfig {
  db: Database;
  eventBus: EventBus;
}

export interface RecordPatternInput {
  companyId: string;
  agentId: string;
  patternType: StrategyPatternType;
  description: string;
  succeeded: boolean;
  contextJson: Record<string, unknown>;
}

export class StrategyTracker {
  private db: Database;
  private eventBus: EventBus;

  constructor(config: StrategyTrackerConfig) {
    this.db = config.db;
    this.eventBus = config.eventBus;
  }

  /**
   * Record the outcome of a strategy pattern usage.
   * If pattern description matches an existing one, update counts.
   * Otherwise, create a new pattern record.
   */
  async recordPattern(input: RecordPatternInput): Promise<{ patternId: string }> {
    // Try to find an existing matching pattern
    const [existing] = await this.db
      .select()
      .from(strategyPatterns)
      .where(
        and(
          eq(strategyPatterns.companyId, input.companyId),
          eq(strategyPatterns.agentId, input.agentId),
          eq(strategyPatterns.patternType, input.patternType),
          eq(strategyPatterns.description, input.description),
        ),
      );

    if (existing) {
      const newSuccess = existing.successCount + (input.succeeded ? 1 : 0);
      const newFailure = existing.failureCount + (input.succeeded ? 0 : 1);
      const total = newSuccess + newFailure;
      const confidence = total > 0 ? newSuccess / total : 0.5;

      await this.db
        .update(strategyPatterns)
        .set({
          successCount: newSuccess,
          failureCount: newFailure,
          confidence,
          contextJson: input.contextJson,
          updatedAt: new Date(),
        })
        .where(eq(strategyPatterns.id, existing.id));

      this.emit('evolution.strategy_reinforced', input.companyId, {
        patternId: existing.id,
        agentId: input.agentId,
        patternType: input.patternType,
        confidence,
      });

      return { patternId: existing.id };
    }

    // Create new pattern
    const [pattern] = await this.db
      .insert(strategyPatterns)
      .values({
        companyId: input.companyId,
        agentId: input.agentId,
        patternType: input.patternType,
        description: input.description,
        successCount: input.succeeded ? 1 : 0,
        failureCount: input.succeeded ? 0 : 1,
        confidence: input.succeeded ? 1.0 : 0.0,
        contextJson: input.contextJson,
      })
      .returning();

    return { patternId: pattern!.id };
  }

  /**
   * Get the most effective patterns for a given type.
   */
  async getEffectivePatterns(companyId: string, patternType: StrategyPatternType, limit = 10) {
    return this.db
      .select()
      .from(strategyPatterns)
      .where(
        and(
          eq(strategyPatterns.companyId, companyId),
          eq(strategyPatterns.patternType, patternType),
          sql`${strategyPatterns.successCount} + ${strategyPatterns.failureCount} >= 3`,
        ),
      )
      .orderBy(desc(strategyPatterns.confidence))
      .limit(limit);
  }

  /**
   * Get all patterns for a specific agent.
   */
  async getAgentPatterns(companyId: string, agentId: string) {
    return this.db
      .select()
      .from(strategyPatterns)
      .where(and(eq(strategyPatterns.companyId, companyId), eq(strategyPatterns.agentId, agentId)))
      .orderBy(desc(strategyPatterns.confidence));
  }

  /**
   * Strategic reflection: identify patterns with low confidence
   * that may need reevaluation.
   */
  async findWeakPatterns(companyId: string, confidenceThreshold = 0.4) {
    return this.db
      .select()
      .from(strategyPatterns)
      .where(
        and(
          eq(strategyPatterns.companyId, companyId),
          sql`${strategyPatterns.confidence} < ${confidenceThreshold}`,
          sql`${strategyPatterns.successCount} + ${strategyPatterns.failureCount} >= 5`,
        ),
      )
      .orderBy(strategyPatterns.confidence);
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
