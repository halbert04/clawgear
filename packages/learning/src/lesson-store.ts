import type { Database } from '@clawgear/db';
import { lessonsLearned } from '@clawgear/db/pg';
import type { LessonOutcome } from '@clawgear/shared/constants';
import { and, desc, eq, sql } from 'drizzle-orm';

export interface StoreLessonInput {
  companyId: string;
  agentId: string;
  runId?: string;
  issueId?: string;
  taskType: string;
  approach: string;
  whatWorked: string | null;
  whatFailed: string | null;
  lesson: string;
  outcome: LessonOutcome;
  confidence: number;
  embedding?: number[] | null;
  embeddingModel?: string | null;
}

export interface LessonStoreConfig {
  db: Database;
}

export class LessonStore {
  private db: Database;

  constructor(config: LessonStoreConfig) {
    this.db = config.db;
  }

  async store(input: StoreLessonInput): Promise<{ id: string }> {
    const [lesson] = await this.db
      .insert(lessonsLearned)
      .values({
        companyId: input.companyId,
        agentId: input.agentId,
        runId: input.runId ?? null,
        issueId: input.issueId ?? null,
        taskType: input.taskType,
        approach: input.approach,
        whatWorked: input.whatWorked,
        whatFailed: input.whatFailed,
        lesson: input.lesson,
        outcome: input.outcome,
        confidence: input.confidence,
        embedding: input.embedding ?? undefined,
        embeddingModel: input.embeddingModel ?? null,
      })
      .returning({ id: lessonsLearned.id });

    return { id: lesson!.id };
  }

  async retrieveRelevant(
    companyId: string,
    taskType: string,
    queryEmbedding: number[] | null,
    limit = 5,
  ) {
    if (queryEmbedding) {
      const embeddingStr = `[${queryEmbedding.join(',')}]`;

      const results = await this.db
        .select()
        .from(lessonsLearned)
        .where(
          and(
            eq(lessonsLearned.companyId, companyId),
            sql`${lessonsLearned.embedding} IS NOT NULL`,
          ),
        )
        .orderBy(sql`embedding <=> ${embeddingStr}::vector`)
        .limit(limit);

      // Increment retrieval count
      if (results.length > 0) {
        const ids = results.map((r) => r.id);
        await this.db
          .update(lessonsLearned)
          .set({
            timesRetrieved: sql`${lessonsLearned.timesRetrieved} + 1`,
          })
          .where(sql`${lessonsLearned.id} = ANY(${ids})`);
      }

      return results;
    }

    // Fallback: filter by task type, ordered by recency
    const results = await this.db
      .select()
      .from(lessonsLearned)
      .where(and(eq(lessonsLearned.companyId, companyId), eq(lessonsLearned.taskType, taskType)))
      .orderBy(desc(lessonsLearned.createdAt))
      .limit(limit);

    if (results.length > 0) {
      const ids = results.map((r) => r.id);
      await this.db
        .update(lessonsLearned)
        .set({
          timesRetrieved: sql`${lessonsLearned.timesRetrieved} + 1`,
        })
        .where(sql`${lessonsLearned.id} = ANY(${ids})`);
    }

    return results;
  }

  async getByAgent(companyId: string, agentId: string, limit = 20) {
    return this.db
      .select()
      .from(lessonsLearned)
      .where(and(eq(lessonsLearned.companyId, companyId), eq(lessonsLearned.agentId, agentId)))
      .orderBy(desc(lessonsLearned.createdAt))
      .limit(limit);
  }
}
