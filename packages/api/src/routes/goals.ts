import { goals } from '@clawgear/db/pg';
import type { InProcessEventBus } from '@clawgear/kernel';
import type { SystemEvent } from '@clawgear/shared/interfaces';
import { createGoalSchema, updateGoalSchema } from '@clawgear/shared/validators';
import { and, eq } from 'drizzle-orm';
import { Hono } from 'hono';
import type { AppDeps } from '../app.js';
import { badRequest, notFound } from '../lib/errors.js';
import { serializeRow, serializeRows } from '../lib/serialize.js';

/**
 * Hierarchy ordering for goal level validation.
 * A child goal must be strictly deeper than its parent.
 */
const LEVEL_ORDER: Record<string, number> = {
  company: 0,
  team: 1,
  agent: 2,
  task: 3,
};

export function goalRoutes(deps: AppDeps) {
  const { db, eventBus } = deps;
  const app = new Hono();

  // POST /api/companies/:companyId/goals
  app.post('/', async (c) => {
    const companyId = c.req.param('companyId')!;
    const body = createGoalSchema.parse(await c.req.json());

    // Validate level relative to parent
    if (body.parentId) {
      const [parent] = await db
        .select()
        .from(goals)
        .where(and(eq(goals.id, body.parentId), eq(goals.companyId, companyId)));
      if (!parent) throw notFound('Goal', body.parentId);

      const parentOrder = LEVEL_ORDER[parent.level] ?? -1;
      const childOrder = LEVEL_ORDER[body.level] ?? -1;
      if (childOrder <= parentOrder) {
        throw badRequest(
          `Goal level '${body.level}' must be deeper than parent level '${parent.level}'`,
        );
      }
    }

    const [goal] = await db
      .insert(goals)
      .values({
        companyId,
        parentId: body.parentId ?? null,
        level: body.level,
        ownerAgentId: body.ownerAgentId ?? null,
        title: body.title,
        description: body.description ?? null,
      })
      .returning();

    emitGoalEvent(eventBus, 'goal.created', goal!);
    return c.json(serializeRow(goal!), 201);
  });

  // GET /api/companies/:companyId/goals
  app.get('/', async (c) => {
    const companyId = c.req.param('companyId')!;
    const parentId = c.req.query('parentId');

    const conditions = [eq(goals.companyId, companyId)];
    if (parentId !== undefined) {
      conditions.push(eq(goals.parentId, parentId));
    }

    const rows = await db
      .select()
      .from(goals)
      .where(and(...conditions));

    return c.json({ data: serializeRows(rows) });
  });

  // GET /api/companies/:companyId/goals/:id
  app.get('/:id', async (c) => {
    const companyId = c.req.param('companyId')!;
    const id = c.req.param('id');
    const [goal] = await db
      .select()
      .from(goals)
      .where(and(eq(goals.id, id), eq(goals.companyId, companyId)));
    if (!goal) throw notFound('Goal', id);
    return c.json(serializeRow(goal));
  });

  // PATCH /api/companies/:companyId/goals/:id
  app.patch('/:id', async (c) => {
    const companyId = c.req.param('companyId')!;
    const id = c.req.param('id');
    const body = updateGoalSchema.parse(await c.req.json());

    const values: Record<string, unknown> = {};
    if (body.status !== undefined) values.status = body.status;
    if (body.ownerAgentId !== undefined) values.ownerAgentId = body.ownerAgentId;
    if (body.title !== undefined) values.title = body.title;
    if (body.description !== undefined) values.description = body.description;

    if (Object.keys(values).length === 0) {
      const [existing] = await db
        .select()
        .from(goals)
        .where(and(eq(goals.id, id), eq(goals.companyId, companyId)));
      if (!existing) throw notFound('Goal', id);
      return c.json(serializeRow(existing));
    }

    values.updatedAt = new Date();
    const [updated] = await db
      .update(goals)
      .set(values)
      .where(and(eq(goals.id, id), eq(goals.companyId, companyId)))
      .returning();
    if (!updated) throw notFound('Goal', id);

    emitGoalEvent(eventBus, 'goal.updated', updated);
    return c.json(serializeRow(updated));
  });

  // GET /api/companies/:companyId/goals/:id/ancestry
  app.get('/:id/ancestry', async (c) => {
    const companyId = c.req.param('companyId')!;
    const id = c.req.param('id');

    const [goal] = await db
      .select()
      .from(goals)
      .where(and(eq(goals.id, id), eq(goals.companyId, companyId)));
    if (!goal) throw notFound('Goal', id);

    const chain: (typeof goal)[] = [goal];
    let current = goal;

    while (current.parentId) {
      const [parent] = await db
        .select()
        .from(goals)
        .where(and(eq(goals.id, current.parentId), eq(goals.companyId, companyId)));
      if (!parent) break;
      chain.push(parent);
      current = parent;
    }

    return c.json({ data: serializeRows(chain) });
  });

  return app;
}

function emitGoalEvent(eventBus: InProcessEventBus, type: string, goal: typeof goals.$inferSelect) {
  const event: SystemEvent = {
    type,
    companyId: goal.companyId,
    timestamp: new Date(),
    payload: { goalId: goal.id, title: goal.title, level: goal.level },
  };
  eventBus.emit(event);
}
