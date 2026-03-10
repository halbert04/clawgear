import { facts } from '@clawgear/db/pg';
import { paginationSchema } from '@clawgear/shared/validators';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { Hono } from 'hono';
import { z } from 'zod';
import type { AppDeps } from '../app.js';
import { notFound } from '../lib/errors.js';
import { serializeRow, serializeRows } from '../lib/serialize.js';

const createFactSchema = z.object({
  agentId: z.string().uuid(),
  factType: z.enum(['decision', 'entity', 'relationship', 'observation']),
  subject: z.string().min(1).max(500),
  predicate: z.string().min(1).max(500),
  object: z.string().min(1).max(2000),
  confidence: z.number().min(0).max(1).default(0.8),
  sourceRunId: z.string().uuid().nullable().optional(),
  sourceIssueId: z.string().uuid().nullable().optional(),
});

export function factRoutes(deps: AppDeps) {
  const { db } = deps;
  const app = new Hono();

  // POST /api/companies/:companyId/facts
  app.post('/', async (c) => {
    const companyId = c.req.param('companyId')!;
    const body = createFactSchema.parse(await c.req.json());

    const [fact] = await db
      .insert(facts)
      .values({
        companyId,
        agentId: body.agentId,
        factType: body.factType,
        subject: body.subject,
        predicate: body.predicate,
        object: body.object,
        confidence: body.confidence,
        sourceRunId: body.sourceRunId ?? null,
        sourceIssueId: body.sourceIssueId ?? null,
      })
      .returning();

    return c.json(serializeRow(fact!), 201);
  });

  // GET /api/companies/:companyId/facts
  app.get('/', async (c) => {
    const companyId = c.req.param('companyId')!;
    const { limit, offset } = paginationSchema.parse(c.req.query());
    const factType = c.req.query('factType');
    const subject = c.req.query('subject');

    const conditions = [eq(facts.companyId, companyId), isNull(facts.invalidatedAt)];
    if (factType) conditions.push(eq(facts.factType, factType));
    if (subject) conditions.push(eq(facts.subject, subject));

    const rows = await db
      .select()
      .from(facts)
      .where(and(...conditions))
      .limit(limit)
      .offset(offset);

    const [countResult] = await db
      .select({ count: sql<number>`count(*)` })
      .from(facts)
      .where(and(...conditions));

    return c.json({
      data: serializeRows(rows),
      total: Number(countResult!.count),
      limit,
      offset,
    });
  });

  // GET /api/companies/:companyId/facts/:id
  app.get('/:id', async (c) => {
    const companyId = c.req.param('companyId')!;
    const id = c.req.param('id');
    const [fact] = await db
      .select()
      .from(facts)
      .where(and(eq(facts.id, id), eq(facts.companyId, companyId)));
    if (!fact) throw notFound('Fact', id);
    return c.json(serializeRow(fact));
  });

  // DELETE /api/companies/:companyId/facts/:id (invalidate)
  app.delete('/:id', async (c) => {
    const companyId = c.req.param('companyId')!;
    const id = c.req.param('id');
    const [updated] = await db
      .update(facts)
      .set({ invalidatedAt: new Date() })
      .where(and(eq(facts.id, id), eq(facts.companyId, companyId)))
      .returning();
    if (!updated) throw notFound('Fact', id);
    return c.json(serializeRow(updated));
  });

  return app;
}
