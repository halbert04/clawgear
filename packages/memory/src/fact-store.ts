import type { Database } from '@clawgear/db';
import { facts } from '@clawgear/db/pg';
import { and, eq, isNull, sql } from 'drizzle-orm';
import type { EmbeddingClient } from './embedding-client.js';

export interface CreateFactInput {
  companyId: string;
  agentId: string;
  factType: 'decision' | 'entity' | 'relationship' | 'observation';
  subject: string;
  predicate: string;
  object: string;
  confidence?: number;
  sourceRunId?: string;
  sourceIssueId?: string;
}

export interface FactQuery {
  companyId: string;
  factType?: string;
  subject?: string;
  predicate?: string;
  object?: string;
  limit?: number;
}

export interface FactStoreConfig {
  db: Database;
  embeddingClient: EmbeddingClient;
}

export class FactStore {
  private db: Database;
  private embeddingClient: EmbeddingClient;

  constructor(config: FactStoreConfig) {
    this.db = config.db;
    this.embeddingClient = config.embeddingClient;
  }

  async store(input: CreateFactInput): Promise<{ id: string }> {
    // Generate embedding for the fact
    const factText = `${input.subject} ${input.predicate} ${input.object}`;
    const embedding = await this.embeddingClient.embed(factText);

    const [fact] = await this.db
      .insert(facts)
      .values({
        companyId: input.companyId,
        agentId: input.agentId,
        factType: input.factType,
        subject: input.subject,
        predicate: input.predicate,
        object: input.object,
        confidence: input.confidence ?? 0.8,
        sourceRunId: input.sourceRunId ?? null,
        sourceIssueId: input.sourceIssueId ?? null,
        embedding: embedding ?? undefined,
        embeddingModel: embedding ? this.embeddingClient.modelName : null,
      })
      .returning({ id: facts.id });

    return { id: fact!.id };
  }

  async query(filters: FactQuery) {
    const conditions = [eq(facts.companyId, filters.companyId), isNull(facts.invalidatedAt)];

    if (filters.factType) conditions.push(eq(facts.factType, filters.factType));
    if (filters.subject) conditions.push(eq(facts.subject, filters.subject));
    if (filters.predicate) conditions.push(eq(facts.predicate, filters.predicate));
    if (filters.object) conditions.push(eq(facts.object, filters.object));

    return this.db
      .select()
      .from(facts)
      .where(and(...conditions))
      .limit(filters.limit ?? 50);
  }

  async semanticSearch(companyId: string, query: string, limit = 10) {
    const embedding = await this.embeddingClient.embed(query);
    if (!embedding) {
      // Fallback to text search
      return this.db
        .select()
        .from(facts)
        .where(
          and(
            eq(facts.companyId, companyId),
            isNull(facts.invalidatedAt),
            sql`(
              ${facts.subject} ILIKE ${`%${query}%`}
              OR ${facts.object} ILIKE ${`%${query}%`}
            )`,
          ),
        )
        .limit(limit);
    }

    const embeddingStr = `[${embedding.join(',')}]`;
    return this.db
      .select()
      .from(facts)
      .where(
        and(
          eq(facts.companyId, companyId),
          isNull(facts.invalidatedAt),
          sql`${facts.embedding} IS NOT NULL`,
        ),
      )
      .orderBy(sql`embedding <=> ${embeddingStr}::vector`)
      .limit(limit);
  }

  async invalidate(factId: string): Promise<void> {
    await this.db.update(facts).set({ invalidatedAt: new Date() }).where(eq(facts.id, factId));
  }
}
