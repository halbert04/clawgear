import { facts, lessonsLearned } from '@clawgear/db/pg';
import { paginationSchema } from '@clawgear/shared/validators';
import { and, desc, eq, isNull, sql } from 'drizzle-orm';
import { Hono } from 'hono';
import type { AppDeps } from '../app.js';
// Memory search returns pre-formatted results

export function memoryRoutes(deps: AppDeps) {
  const { db } = deps;
  const app = new Hono();

  // GET /api/companies/:companyId/memory/search?q=&type=
  app.get('/search', async (c) => {
    const companyId = c.req.param('companyId')!;
    const query = c.req.query('q') ?? '';
    const contentType = c.req.query('type');
    const { limit } = paginationSchema.parse(c.req.query());

    if (!query) {
      return c.json({ data: [], total: 0 });
    }

    const results: Record<string, unknown>[] = [];

    // Search lessons
    if (!contentType || contentType === 'lesson') {
      const lessons = await db
        .select()
        .from(lessonsLearned)
        .where(
          and(
            eq(lessonsLearned.companyId, companyId),
            sql`(
              ${lessonsLearned.lesson} ILIKE ${`%${query}%`}
              OR ${lessonsLearned.approach} ILIKE ${`%${query}%`}
            )`,
          ),
        )
        .orderBy(desc(lessonsLearned.createdAt))
        .limit(limit);

      for (const l of lessons) {
        results.push({
          id: l.id,
          type: 'lesson',
          content: l.lesson,
          metadata: {
            taskType: l.taskType,
            approach: l.approach,
            outcome: l.outcome,
            confidence: l.confidence,
          },
          createdAt: l.createdAt,
        });
      }
    }

    // Search facts
    if (!contentType || contentType === 'fact') {
      const factResults = await db
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
        .orderBy(desc(facts.createdAt))
        .limit(limit);

      for (const f of factResults) {
        results.push({
          id: f.id,
          type: 'fact',
          content: `${f.subject} ${f.predicate} ${f.object}`,
          metadata: {
            factType: f.factType,
            subject: f.subject,
            predicate: f.predicate,
            object: f.object,
            confidence: f.confidence,
          },
          createdAt: f.createdAt,
        });
      }
    }

    return c.json({ data: results, total: results.length });
  });

  return app;
}
