import { activityLog } from '@clawgear/db/pg';
import type { InProcessEventBus } from '@clawgear/kernel';
import type { SystemEvent } from '@clawgear/shared/interfaces';
import { createActivityLogSchema, paginationSchema } from '@clawgear/shared/validators';
import { desc, eq, sql } from 'drizzle-orm';
import { Hono } from 'hono';
import type { AppDeps } from '../app.js';
import { serializeRow, serializeRows } from '../lib/serialize.js';

export function activityRoutes(deps: AppDeps) {
  const { db, eventBus } = deps;
  const app = new Hono();

  // GET /api/companies/:companyId/activity
  app.get('/', async (c) => {
    const companyId = c.req.param('companyId')!;
    const { limit, offset } = paginationSchema.parse(c.req.query());

    const rows = await db
      .select()
      .from(activityLog)
      .where(eq(activityLog.companyId, companyId))
      .orderBy(desc(activityLog.createdAt))
      .limit(limit)
      .offset(offset);

    const [countResult] = await db
      .select({ count: sql<number>`count(*)` })
      .from(activityLog)
      .where(eq(activityLog.companyId, companyId));

    return c.json({
      data: serializeRows(rows),
      total: Number(countResult!.count),
      limit,
      offset,
    });
  });

  // POST /api/companies/:companyId/activity
  app.post('/', async (c) => {
    const companyId = c.req.param('companyId')!;
    const body = createActivityLogSchema.parse(await c.req.json());

    const [entry] = await db
      .insert(activityLog)
      .values({
        companyId,
        actorType: body.actorType,
        actorId: body.actorId,
        action: body.action,
        entityType: body.entityType,
        entityId: body.entityId ?? null,
        agentId: body.agentId ?? null,
        runId: body.runId ?? null,
        details: body.details ?? null,
      })
      .returning();

    emitActivityEvent(eventBus, 'activity.logged', companyId, {
      activityId: entry!.id,
      actorType: entry!.actorType,
      action: entry!.action,
      entityType: entry!.entityType,
    });

    return c.json(serializeRow(entry!), 201);
  });

  return app;
}

function emitActivityEvent(
  eventBus: InProcessEventBus,
  type: string,
  companyId: string,
  payload: Record<string, unknown>,
) {
  const event: SystemEvent = {
    type,
    companyId,
    timestamp: new Date(),
    payload,
  };
  eventBus.emit(event);
}
