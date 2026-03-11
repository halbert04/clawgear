import { triggers } from '@clawgear/db/pg';
import {
  createTriggerSchema,
  paginationSchema,
  updateTriggerSchema,
} from '@clawgear/shared/validators';
import { and, desc, eq, sql } from 'drizzle-orm';
import { Hono } from 'hono';
import type { AppDeps } from '../app.js';
import { notFound } from '../lib/errors.js';
import { serializeRow, serializeRows } from '../lib/serialize.js';

function toTriggerRecord(row: typeof triggers.$inferSelect) {
  return {
    id: row.id,
    companyId: row.companyId,
    name: row.name,
    patternType: row.patternType,
    patternConfig: row.patternConfig as Record<string, unknown>,
    actionType: row.actionType,
    actionConfig: row.actionConfig as Record<string, unknown>,
    isActive: row.isActive,
    fireCount: row.fireCount,
    maxFireCount: row.maxFireCount,
    cooldownMs: row.cooldownMs,
  };
}

export function triggerRoutes(deps: AppDeps) {
  const { db, triggerEngine } = deps;
  const app = new Hono();

  // GET / — list triggers (paginated)
  app.get('/', async (c) => {
    const companyId = c.req.param('companyId')!;
    const { limit, offset } = paginationSchema.parse(c.req.query());

    const rows = await db
      .select()
      .from(triggers)
      .where(eq(triggers.companyId, companyId))
      .orderBy(desc(triggers.createdAt))
      .limit(limit)
      .offset(offset);

    const [countResult] = await db
      .select({ count: sql<number>`count(*)` })
      .from(triggers)
      .where(eq(triggers.companyId, companyId));

    return c.json({
      data: serializeRows(rows),
      total: Number(countResult!.count),
      limit,
      offset,
    });
  });

  // POST / — create trigger
  app.post('/', async (c) => {
    const companyId = c.req.param('companyId')!;
    const body = createTriggerSchema.parse(await c.req.json());

    const [record] = await db
      .insert(triggers)
      .values({
        companyId,
        name: body.name,
        description: body.description,
        patternType: body.patternType,
        patternConfig: body.patternConfig,
        actionType: body.actionType,
        actionConfig: body.actionConfig,
        isActive: body.isActive,
        maxFireCount: body.maxFireCount,
        cooldownMs: body.cooldownMs,
        createdByAgentId: body.createdByAgentId,
      })
      .returning();

    if (record!.isActive && triggerEngine) {
      await triggerEngine.addTrigger(toTriggerRecord(record!));
    }

    return c.json(serializeRow(record!), 201);
  });

  // GET /:id — trigger detail
  app.get('/:id', async (c) => {
    const companyId = c.req.param('companyId')!;
    const id = c.req.param('id')!;

    const [record] = await db
      .select()
      .from(triggers)
      .where(and(eq(triggers.id, id), eq(triggers.companyId, companyId)));

    if (!record) throw notFound('Trigger', id);
    return c.json(serializeRow(record));
  });

  // PATCH /:id — update trigger
  app.patch('/:id', async (c) => {
    const companyId = c.req.param('companyId')!;
    const id = c.req.param('id')!;
    const body = updateTriggerSchema.parse(await c.req.json());

    const [record] = await db
      .update(triggers)
      .set({ ...body, updatedAt: new Date() })
      .where(and(eq(triggers.id, id), eq(triggers.companyId, companyId)))
      .returning();

    if (!record) throw notFound('Trigger', id);

    if (triggerEngine) {
      if (record.isActive) {
        await triggerEngine.addTrigger(toTriggerRecord(record));
      } else {
        await triggerEngine.removeTrigger(id);
      }
    }

    return c.json(serializeRow(record));
  });

  // POST /:id/activate — enable trigger
  app.post('/:id/activate', async (c) => {
    const companyId = c.req.param('companyId')!;
    const id = c.req.param('id')!;

    const [record] = await db
      .update(triggers)
      .set({ isActive: true, updatedAt: new Date() })
      .where(and(eq(triggers.id, id), eq(triggers.companyId, companyId)))
      .returning();

    if (!record) throw notFound('Trigger', id);

    if (triggerEngine) {
      await triggerEngine.addTrigger(toTriggerRecord(record));
    }

    return c.json(serializeRow(record));
  });

  // POST /:id/deactivate — disable trigger
  app.post('/:id/deactivate', async (c) => {
    const companyId = c.req.param('companyId')!;
    const id = c.req.param('id')!;

    const [record] = await db
      .update(triggers)
      .set({ isActive: false, updatedAt: new Date() })
      .where(and(eq(triggers.id, id), eq(triggers.companyId, companyId)))
      .returning();

    if (!record) throw notFound('Trigger', id);

    if (triggerEngine) {
      await triggerEngine.removeTrigger(id);
    }

    return c.json(serializeRow(record));
  });

  // DELETE /:id — delete trigger
  app.delete('/:id', async (c) => {
    const companyId = c.req.param('companyId')!;
    const id = c.req.param('id')!;

    const [record] = await db
      .delete(triggers)
      .where(and(eq(triggers.id, id), eq(triggers.companyId, companyId)))
      .returning();

    if (!record) throw notFound('Trigger', id);

    if (triggerEngine) {
      await triggerEngine.removeTrigger(id);
    }

    return c.json(serializeRow(record));
  });

  return app;
}
