import { heartbeatRuns } from '@clawgear/db/pg';
import type { HeartbeatEngine } from '@clawgear/kernel';
import { paginationSchema } from '@clawgear/shared/validators';
import { and, desc, eq, sql } from 'drizzle-orm';
import { Hono } from 'hono';
import type { AppDeps } from '../app.js';
import { badRequest, notFound } from '../lib/errors.js';
import { serializeRow, serializeRows } from '../lib/serialize.js';

export function heartbeatRoutes(deps: AppDeps & { heartbeatEngine: HeartbeatEngine }) {
  const { db, heartbeatEngine } = deps;
  const app = new Hono();

  // POST /api/companies/:companyId/agents/:agentId/heartbeat - manual trigger
  app.post('/', async (c) => {
    const agentId = c.req.param('agentId')!;

    if (!agentId) throw badRequest('agentId is required');

    try {
      const result = await heartbeatEngine.executeHeartbeat(agentId, 'manual');
      return c.json(result, 201);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (message.includes('not found')) throw notFound('Agent', agentId);
      if (message.includes('already has a running')) {
        return c.json({ error: 'Conflict', message }, 409);
      }
      if (message.includes('budget exhausted')) {
        return c.json({ error: 'Budget Exhausted', message }, 402);
      }
      throw err;
    }
  });

  // GET /api/companies/:companyId/agents/:agentId/heartbeats - list runs
  app.get('/', async (c) => {
    const companyId = c.req.param('companyId')!;
    const agentId = c.req.param('agentId')!;
    const { limit, offset } = paginationSchema.parse(c.req.query());

    const conditions = [eq(heartbeatRuns.companyId, companyId), eq(heartbeatRuns.agentId, agentId)];

    const rows = await db
      .select()
      .from(heartbeatRuns)
      .where(and(...conditions))
      .orderBy(desc(heartbeatRuns.createdAt))
      .limit(limit)
      .offset(offset);

    const [countResult] = await db
      .select({ count: sql<number>`count(*)` })
      .from(heartbeatRuns)
      .where(and(...conditions));

    return c.json({
      data: serializeRows(rows),
      total: Number(countResult!.count),
      limit,
      offset,
    });
  });

  // GET /api/companies/:companyId/agents/:agentId/heartbeats/:id - get single run
  app.get('/:id', async (c) => {
    const companyId = c.req.param('companyId')!;
    const id = c.req.param('id');
    const [run] = await db
      .select()
      .from(heartbeatRuns)
      .where(and(eq(heartbeatRuns.id, id), eq(heartbeatRuns.companyId, companyId)));
    if (!run) throw notFound('HeartbeatRun', id);
    return c.json(serializeRow(run));
  });

  return app;
}
