import type { Database } from '@clawgear/db';
import { facts, lessonsLearned } from '@clawgear/db/pg';
import type { EventBus, SystemEvent } from '@clawgear/shared/interfaces';
import { and, desc, eq, lt, sql } from 'drizzle-orm';

export interface MemoryConsolidatorConfig {
  db: Database;
  eventBus: EventBus;
  archiveThresholdDays?: number;
  minRetrievalsToKeep?: number;
  minConfidenceToKeep?: number;
}

export interface ConsolidationResult {
  lessonsMerged: number;
  factsValidated: number;
  lessonsArchived: number;
  factsInvalidated: number;
}

export class MemoryConsolidator {
  private db: Database;
  private eventBus: EventBus;
  private archiveThresholdDays: number;
  private minRetrievalsToKeep: number;
  private minConfidenceToKeep: number;

  constructor(config: MemoryConsolidatorConfig) {
    this.db = config.db;
    this.eventBus = config.eventBus;
    this.archiveThresholdDays = config.archiveThresholdDays ?? 90;
    this.minRetrievalsToKeep = config.minRetrievalsToKeep ?? 1;
    this.minConfidenceToKeep = config.minConfidenceToKeep ?? 0.3;
  }

  /**
   * Run a full consolidation cycle.
   */
  async consolidate(companyId: string): Promise<ConsolidationResult> {
    const lessonsMerged = await this.mergeDuplicateLessons(companyId);
    const factsValidated = await this.validateFacts(companyId);
    const lessonsArchived = await this.archiveStale(companyId);
    const factsInvalidated = await this.invalidateStaleFacts(companyId);

    // Update utility scores
    await this.updateUtilityScores(companyId);

    this.emit('evolution.memory_consolidated', companyId, {
      lessonsMerged,
      factsValidated,
      lessonsArchived,
    });

    return { lessonsMerged, factsValidated, lessonsArchived, factsInvalidated };
  }

  /**
   * Merge duplicate lessons with similar content.
   * Uses exact task type + approach match to find duplicates,
   * keeps the one with highest confidence.
   */
  async mergeDuplicateLessons(companyId: string): Promise<number> {
    // Find groups of lessons with the same taskType + approach
    const groups = await this.db
      .select({
        taskType: lessonsLearned.taskType,
        approach: lessonsLearned.approach,
        count: sql<number>`count(*)`,
      })
      .from(lessonsLearned)
      .where(eq(lessonsLearned.companyId, companyId))
      .groupBy(lessonsLearned.taskType, lessonsLearned.approach)
      .having(sql`count(*) > 1`);

    let merged = 0;

    for (const group of groups) {
      // Get all lessons in this group ordered by confidence desc
      const lessons = await this.db
        .select()
        .from(lessonsLearned)
        .where(
          and(
            eq(lessonsLearned.companyId, companyId),
            eq(lessonsLearned.taskType, group.taskType),
            eq(lessonsLearned.approach, group.approach),
          ),
        )
        .orderBy(desc(lessonsLearned.confidence), desc(lessonsLearned.timesRetrieved));

      if (lessons.length <= 1) continue;

      // Keep the highest-confidence lesson, boost its retrieval count
      const keeper = lessons[0]!;
      const duplicateIds = lessons.slice(1).map((l) => l.id);
      const totalRetrievals = lessons.reduce((sum, l) => sum + l.timesRetrieved, 0);

      // Update keeper with combined retrieval count
      await this.db
        .update(lessonsLearned)
        .set({ timesRetrieved: totalRetrievals })
        .where(eq(lessonsLearned.id, keeper.id));

      // Delete duplicates
      for (const id of duplicateIds) {
        await this.db.delete(lessonsLearned).where(eq(lessonsLearned.id, id));
        merged++;
      }
    }

    return merged;
  }

  /**
   * Validate facts by checking for contradictions.
   * Returns the number of facts checked.
   */
  async validateFacts(companyId: string): Promise<number> {
    // Find facts with the same subject+predicate but different objects
    // (potential contradictions)
    const contradictions = await this.db
      .select({
        subject: facts.subject,
        predicate: facts.predicate,
        count: sql<number>`count(DISTINCT ${facts.object})`,
      })
      .from(facts)
      .where(and(eq(facts.companyId, companyId), sql`${facts.invalidatedAt} IS NULL`))
      .groupBy(facts.subject, facts.predicate)
      .having(sql`count(DISTINCT ${facts.object}) > 1`);

    let validated = 0;

    for (const contradiction of contradictions) {
      // Get all versions of this fact
      const versions = await this.db
        .select()
        .from(facts)
        .where(
          and(
            eq(facts.companyId, companyId),
            eq(facts.subject, contradiction.subject),
            eq(facts.predicate, contradiction.predicate),
            sql`${facts.invalidatedAt} IS NULL`,
          ),
        )
        .orderBy(desc(facts.confidence), desc(facts.createdAt));

      if (versions.length <= 1) continue;

      // Keep the highest confidence, most recent fact; invalidate older ones
      const toInvalidate = versions.slice(1);
      for (const fact of toInvalidate) {
        await this.db.update(facts).set({ invalidatedAt: new Date() }).where(eq(facts.id, fact.id));
        validated++;
      }
    }

    return validated;
  }

  /**
   * Archive low-confidence, low-retrieval lessons older than threshold.
   */
  async archiveStale(companyId: string): Promise<number> {
    const cutoffDate = new Date(Date.now() - this.archiveThresholdDays * 24 * 60 * 60 * 1000);

    // Delete lessons that are old, low confidence, and rarely retrieved
    const stale = await this.db
      .select({ id: lessonsLearned.id })
      .from(lessonsLearned)
      .where(
        and(
          eq(lessonsLearned.companyId, companyId),
          lt(lessonsLearned.createdAt, cutoffDate),
          lt(lessonsLearned.confidence, this.minConfidenceToKeep),
          lt(lessonsLearned.timesRetrieved, this.minRetrievalsToKeep),
        ),
      );

    for (const lesson of stale) {
      await this.db.delete(lessonsLearned).where(eq(lessonsLearned.id, lesson.id));
    }

    return stale.length;
  }

  /**
   * Invalidate facts that are very old and low confidence.
   */
  async invalidateStaleFacts(companyId: string): Promise<number> {
    const cutoffDate = new Date(Date.now() - this.archiveThresholdDays * 24 * 60 * 60 * 1000);

    const result = await this.db
      .update(facts)
      .set({ invalidatedAt: new Date() })
      .where(
        and(
          eq(facts.companyId, companyId),
          sql`${facts.invalidatedAt} IS NULL`,
          lt(facts.createdAt, cutoffDate),
          lt(facts.confidence, this.minConfidenceToKeep),
        ),
      )
      .returning({ id: facts.id });

    return result.length;
  }

  /**
   * Update utility scores: lessons that are retrieved more often
   * and associated with success get higher confidence.
   */
  async updateUtilityScores(companyId: string): Promise<void> {
    // Boost confidence of frequently-retrieved successful lessons
    await this.db
      .update(lessonsLearned)
      .set({
        confidence: sql`LEAST(1.0, ${lessonsLearned.confidence} + 0.01 * ${lessonsLearned.timesRetrieved})`,
      })
      .where(
        and(
          eq(lessonsLearned.companyId, companyId),
          eq(lessonsLearned.outcome, 'success'),
          sql`${lessonsLearned.timesRetrieved} > 0`,
          lt(lessonsLearned.confidence, 1.0),
        ),
      );

    // Decrease confidence of unretrieved failure lessons
    await this.db
      .update(lessonsLearned)
      .set({
        confidence: sql`GREATEST(0.0, ${lessonsLearned.confidence} - 0.05)`,
      })
      .where(
        and(
          eq(lessonsLearned.companyId, companyId),
          eq(lessonsLearned.outcome, 'failure'),
          eq(lessonsLearned.timesRetrieved, 0),
          sql`${lessonsLearned.confidence} > 0`,
        ),
      );
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
