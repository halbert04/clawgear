import { channelBindings } from '@clawgear/db/pg';
import {
  createChannelBindingSchema,
  paginationSchema,
  updateChannelBindingSchema,
} from '@clawgear/shared/validators';
import { and, eq, sql } from 'drizzle-orm';
import { Hono } from 'hono';
import type { AppDeps } from '../app.js';
import { notFound } from '../lib/errors.js';
import { serializeRow, serializeRows } from '../lib/serialize.js';

export function channelBindingRoutes(deps: AppDeps) {
  const { db } = deps;
  const app = new Hono();

  // POST / — Create a channel binding
  app.post('/', async (c) => {
    const companyId = c.req.param('companyId')!;
    const body = createChannelBindingSchema.parse(await c.req.json());

    const [binding] = await db
      .insert(channelBindings)
      .values({
        companyId,
        channelName: body.channelName,
        agentId: body.agentId,
        externalChannelId: body.externalChannelId ?? null,
        bindingType: body.bindingType,
        priority: body.priority,
        config: body.config,
      })
      .returning();

    return c.json(serializeRow(binding!), 201);
  });

  // GET / — List channel bindings
  app.get('/', async (c) => {
    const companyId = c.req.param('companyId')!;
    const { limit, offset } = paginationSchema.parse(c.req.query());
    const channelName = c.req.query('channelName');
    const agentId = c.req.query('agentId');

    const conditions = [eq(channelBindings.companyId, companyId)];
    if (channelName) conditions.push(eq(channelBindings.channelName, channelName));
    if (agentId) conditions.push(eq(channelBindings.agentId, agentId));

    const rows = await db
      .select()
      .from(channelBindings)
      .where(and(...conditions))
      .limit(limit)
      .offset(offset);

    const [countResult] = await db
      .select({ count: sql<number>`count(*)` })
      .from(channelBindings)
      .where(and(...conditions));

    return c.json({
      data: serializeRows(rows),
      total: Number(countResult!.count),
      limit,
      offset,
    });
  });

  // GET /:id — Get channel binding detail
  app.get('/:id', async (c) => {
    const companyId = c.req.param('companyId')!;
    const id = c.req.param('id');

    const [binding] = await db
      .select()
      .from(channelBindings)
      .where(and(eq(channelBindings.id, id), eq(channelBindings.companyId, companyId)));

    if (!binding) throw notFound('ChannelBinding', id);
    return c.json(serializeRow(binding));
  });

  // PATCH /:id — Update channel binding
  app.patch('/:id', async (c) => {
    const companyId = c.req.param('companyId')!;
    const id = c.req.param('id');
    const body = updateChannelBindingSchema.parse(await c.req.json());

    const values: Record<string, unknown> = { updatedAt: new Date() };
    if (body.agentId !== undefined) values.agentId = body.agentId;
    if (body.externalChannelId !== undefined) values.externalChannelId = body.externalChannelId;
    if (body.bindingType !== undefined) values.bindingType = body.bindingType;
    if (body.priority !== undefined) values.priority = body.priority;
    if (body.config !== undefined) values.config = body.config;
    if (body.isActive !== undefined) values.isActive = body.isActive;

    const [updated] = await db
      .update(channelBindings)
      .set(values)
      .where(and(eq(channelBindings.id, id), eq(channelBindings.companyId, companyId)))
      .returning();

    if (!updated) throw notFound('ChannelBinding', id);
    return c.json(serializeRow(updated));
  });

  // DELETE /:id — Delete channel binding
  app.delete('/:id', async (c) => {
    const companyId = c.req.param('companyId')!;
    const id = c.req.param('id');

    const [deleted] = await db
      .delete(channelBindings)
      .where(and(eq(channelBindings.id, id), eq(channelBindings.companyId, companyId)))
      .returning();

    if (!deleted) throw notFound('ChannelBinding', id);
    return c.json({ deleted: true, id });
  });

  return app;
}
