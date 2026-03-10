import type { Database } from '@clawgear/db';
import { facts, lessonsLearned, sharedEmbeddings } from '@clawgear/db/pg';
import { and, eq, isNull, sql } from 'drizzle-orm';
import type { EmbeddingClient } from './embedding-client.js';

export interface SearchResult {
  id: string;
  content: string;
  contentType: 'lesson' | 'fact' | 'document' | 'code';
  score: number;
  metadata: Record<string, unknown>;
}

export interface HybridSearchConfig {
  db: Database;
  embeddingClient: EmbeddingClient;
  rrfK?: number;
}

export class HybridSearch {
  private db: Database;
  private embeddingClient: EmbeddingClient;
  private rrfK: number;

  constructor(config: HybridSearchConfig) {
    this.db = config.db;
    this.embeddingClient = config.embeddingClient;
    this.rrfK = config.rrfK ?? 60;
  }

  async search(
    companyId: string,
    query: string,
    options: { limit?: number; contentType?: string } = {},
  ): Promise<SearchResult[]> {
    const limit = options.limit ?? 10;

    // Get embedding for query
    const queryEmbedding = await this.embeddingClient.embed(query);

    // Full-text search on lessons
    const ftsResults = await this.searchFullText(companyId, query, limit * 2, options.contentType);

    // Vector search (if embedding available)
    let vectorResults: SearchResult[] = [];
    if (queryEmbedding) {
      vectorResults = await this.searchVector(
        companyId,
        queryEmbedding,
        limit * 2,
        options.contentType,
      );
    }

    // RRF fusion
    return this.rrfFuse(ftsResults, vectorResults, limit);
  }

  private async searchFullText(
    companyId: string,
    query: string,
    limit: number,
    contentType?: string,
  ): Promise<SearchResult[]> {
    const lessons = await this.db
      .select()
      .from(lessonsLearned)
      .where(
        and(
          eq(lessonsLearned.companyId, companyId),
          sql`(
            ${lessonsLearned.lesson} ILIKE ${`%${query}%`}
            OR ${lessonsLearned.approach} ILIKE ${`%${query}%`}
            OR ${lessonsLearned.whatWorked} ILIKE ${`%${query}%`}
            OR ${lessonsLearned.whatFailed} ILIKE ${`%${query}%`}
          )`,
        ),
      )
      .limit(limit);

    const results: SearchResult[] = lessons.map((l, i) => ({
      id: l.id,
      content: l.lesson,
      contentType: 'lesson' as const,
      score: 1 / (this.rrfK + i),
      metadata: {
        taskType: l.taskType,
        approach: l.approach,
        outcome: l.outcome,
        whatWorked: l.whatWorked,
        whatFailed: l.whatFailed,
      },
    }));

    // Also search facts
    if (!contentType || contentType === 'fact') {
      const factResults = await this.db
        .select()
        .from(facts)
        .where(
          and(
            eq(facts.companyId, companyId),
            isNull(facts.invalidatedAt),
            sql`(
              ${facts.subject} ILIKE ${`%${query}%`}
              OR ${facts.predicate} ILIKE ${`%${query}%`}
              OR ${facts.object} ILIKE ${`%${query}%`}
            )`,
          ),
        )
        .limit(limit);

      for (const [i, f] of factResults.entries()) {
        results.push({
          id: f.id,
          content: `${f.subject} ${f.predicate} ${f.object}`,
          contentType: 'fact',
          score: 1 / (this.rrfK + i),
          metadata: {
            factType: f.factType,
            subject: f.subject,
            predicate: f.predicate,
            object: f.object,
            confidence: f.confidence,
          },
        });
      }
    }

    return results;
  }

  private async searchVector(
    companyId: string,
    queryEmbedding: number[],
    limit: number,
    contentType?: string,
  ): Promise<SearchResult[]> {
    const embeddingStr = `[${queryEmbedding.join(',')}]`;

    const conditions = [eq(sharedEmbeddings.companyId, companyId)];
    if (contentType) {
      conditions.push(eq(sharedEmbeddings.contentType, contentType));
    }

    const results = await this.db
      .select({
        id: sharedEmbeddings.id,
        content: sharedEmbeddings.content,
        contentType: sharedEmbeddings.contentType,
        metadata: sharedEmbeddings.metadata,
        distance: sql<number>`embedding <=> ${embeddingStr}::vector`,
      })
      .from(sharedEmbeddings)
      .where(and(...conditions, sql`${sharedEmbeddings.embedding} IS NOT NULL`))
      .orderBy(sql`embedding <=> ${embeddingStr}::vector`)
      .limit(limit);

    return results.map((r, i) => ({
      id: r.id,
      content: r.content,
      contentType: r.contentType as SearchResult['contentType'],
      score: 1 / (this.rrfK + i),
      metadata: (r.metadata as Record<string, unknown>) ?? {},
    }));
  }

  private rrfFuse(
    ftsResults: SearchResult[],
    vectorResults: SearchResult[],
    limit: number,
  ): SearchResult[] {
    const scoreMap = new Map<string, { result: SearchResult; score: number }>();

    for (const [rank, result] of ftsResults.entries()) {
      const existing = scoreMap.get(result.id);
      const ftsScore = 1 / (this.rrfK + rank);
      if (existing) {
        existing.score += ftsScore;
      } else {
        scoreMap.set(result.id, { result, score: ftsScore });
      }
    }

    for (const [rank, result] of vectorResults.entries()) {
      const existing = scoreMap.get(result.id);
      const vecScore = 1 / (this.rrfK + rank);
      if (existing) {
        existing.score += vecScore;
      } else {
        scoreMap.set(result.id, { result, score: vecScore });
      }
    }

    return [...scoreMap.values()]
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .map(({ result, score }) => ({ ...result, score }));
  }
}
