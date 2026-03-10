import { agentConfigRevisions, agents } from '@clawgear/db/pg';
import type { InProcessEventBus } from '@clawgear/kernel';
import type { SystemEvent } from '@clawgear/shared/interfaces';
import {
  createAgentSchema,
  paginationSchema,
  updateAgentSchema,
} from '@clawgear/shared/validators';
import { and, eq, sql } from 'drizzle-orm';
import { Hono } from 'hono';
import type { AppDeps } from '../app.js';
import { badRequest, notFound } from '../lib/errors.js';
import { serializeRow, serializeRows } from '../lib/serialize.js';

type AgentRow = typeof agents.$inferSelect;

interface AgentTreeNode extends Record<string, unknown> {
  children: AgentTreeNode[];
}

function buildTree(rows: AgentRow[]): AgentTreeNode[] {
  const serialized = serializeRows(rows) as AgentTreeNode[];
  const map = new Map<string, AgentTreeNode>();
  for (const row of serialized) {
    row.children = [];
    map.set(row.id as string, row);
  }
  const roots: AgentTreeNode[] = [];
  for (const row of serialized) {
    const parentId = row.reportsTo as string | null;
    if (parentId && map.has(parentId)) {
      map.get(parentId)!.children.push(row);
    } else {
      roots.push(row);
    }
  }
  return roots;
}

export function agentRoutes(deps: AppDeps) {
  const { db, eventBus } = deps;
  const app = new Hono();

  // POST /api/companies/:companyId/agents
  app.post('/', async (c) => {
    const companyId = c.req.param('companyId')!;
    const body = createAgentSchema.parse(await c.req.json());
    const [agent] = await db
      .insert(agents)
      .values({
        companyId,
        name: body.name,
        title: body.title ?? null,
        role: body.role,
        icon: body.icon ?? null,
        reportsTo: body.reportsTo ?? null,
        capabilities: body.capabilities,
        permissions: body.permissions,
        adapterType: body.adapterType,
        adapterConfig: body.adapterConfig,
        modelTier: body.modelTier,
        modelOverride: body.modelOverride ?? null,
        budgetMonthlyCents: BigInt(body.budgetMonthlyCents),
        systemPrompt: body.systemPrompt ?? null,
      })
      .returning();

    emitAgentEvent(eventBus, 'agent.created', companyId, agent!);
    return c.json(serializeRow(agent!), 201);
  });

  // GET /api/companies/:companyId/agents
  app.get('/', async (c) => {
    const companyId = c.req.param('companyId')!;
    const { limit, offset } = paginationSchema.parse(c.req.query());
    const includeTree = c.req.query('tree') === 'true';

    if (includeTree) {
      // Fetch all agents for company to build org tree
      const allRows = await db.select().from(agents).where(eq(agents.companyId, companyId));
      return c.json({
        data: serializeRows(allRows),
        tree: buildTree(allRows),
        total: allRows.length,
      });
    }

    const rows = await db
      .select()
      .from(agents)
      .where(eq(agents.companyId, companyId))
      .limit(limit)
      .offset(offset);
    const [countResult] = await db
      .select({ count: sql<number>`count(*)` })
      .from(agents)
      .where(eq(agents.companyId, companyId));
    return c.json({
      data: serializeRows(rows),
      total: Number(countResult!.count),
      limit,
      offset,
    });
  });

  // GET /api/companies/:companyId/agents/:id
  app.get('/:id', async (c) => {
    const companyId = c.req.param('companyId')!;
    const id = c.req.param('id');
    const [agent] = await db
      .select()
      .from(agents)
      .where(and(eq(agents.id, id), eq(agents.companyId, companyId)));
    if (!agent) throw notFound('Agent', id);
    return c.json(serializeRow(agent));
  });

  // PATCH /api/companies/:companyId/agents/:id
  app.patch('/:id', async (c) => {
    const companyId = c.req.param('companyId')!;
    const id = c.req.param('id');
    const body = updateAgentSchema.parse(await c.req.json());

    // Fetch current agent for config revision tracking
    const [existing] = await db
      .select()
      .from(agents)
      .where(and(eq(agents.id, id), eq(agents.companyId, companyId)));
    if (!existing) throw notFound('Agent', id);

    const values: Record<string, unknown> = {};
    if (body.name !== undefined) values.name = body.name;
    if (body.title !== undefined) values.title = body.title;
    if (body.role !== undefined) values.role = body.role;
    if (body.icon !== undefined) values.icon = body.icon;
    if (body.status !== undefined) values.status = body.status;
    if (body.reportsTo !== undefined) values.reportsTo = body.reportsTo;
    if (body.capabilities !== undefined) values.capabilities = body.capabilities;
    if (body.permissions !== undefined) values.permissions = body.permissions;
    if (body.adapterType !== undefined) values.adapterType = body.adapterType;
    if (body.adapterConfig !== undefined) values.adapterConfig = body.adapterConfig;
    if (body.modelTier !== undefined) values.modelTier = body.modelTier;
    if (body.modelOverride !== undefined) values.modelOverride = body.modelOverride;
    if (body.budgetMonthlyCents !== undefined)
      values.budgetMonthlyCents = BigInt(body.budgetMonthlyCents);
    if (body.systemPrompt !== undefined) values.systemPrompt = body.systemPrompt;

    if (Object.keys(values).length === 0) {
      return c.json(serializeRow(existing));
    }

    values.updatedAt = new Date();
    const [updated] = await db
      .update(agents)
      .set(values)
      .where(and(eq(agents.id, id), eq(agents.companyId, companyId)))
      .returning();
    if (!updated) throw notFound('Agent', id);

    // Track config revision
    const changedKeys = Object.keys(values).filter((k) => k !== 'updatedAt');
    const beforeConfig: Record<string, unknown> = {};
    const afterConfig: Record<string, unknown> = {};
    for (const key of changedKeys) {
      beforeConfig[key] = (existing as Record<string, unknown>)[key];
      afterConfig[key] = (updated as Record<string, unknown>)[key];
    }

    await db.insert(agentConfigRevisions).values({
      companyId,
      agentId: id,
      beforeConfig,
      afterConfig,
      changedKeys,
      source: 'patch',
    });

    emitAgentEvent(eventBus, 'agent.status_changed', companyId, updated);
    return c.json(serializeRow(updated));
  });

  // POST /api/companies/:companyId/agents/:id/pause
  app.post('/:id/pause', async (c) => {
    const companyId = c.req.param('companyId')!;
    const id = c.req.param('id');

    const [existing] = await db
      .select()
      .from(agents)
      .where(and(eq(agents.id, id), eq(agents.companyId, companyId)));
    if (!existing) throw notFound('Agent', id);

    if (existing.status === 'terminated') {
      throw badRequest('Cannot pause a terminated agent');
    }
    if (existing.status === 'paused') {
      throw badRequest('Agent is already paused');
    }

    const previousStatus = existing.status;
    const [updated] = await db
      .update(agents)
      .set({ status: 'paused', updatedAt: new Date() })
      .where(and(eq(agents.id, id), eq(agents.companyId, companyId)))
      .returning();

    emitAgentEvent(eventBus, 'agent.paused', companyId, updated!, { previousStatus });
    emitAgentEvent(eventBus, 'agent.status_changed', companyId, updated!, {
      previousStatus,
      newStatus: 'paused',
    });
    return c.json(serializeRow(updated!));
  });

  // POST /api/companies/:companyId/agents/:id/resume
  app.post('/:id/resume', async (c) => {
    const companyId = c.req.param('companyId')!;
    const id = c.req.param('id');

    const [existing] = await db
      .select()
      .from(agents)
      .where(and(eq(agents.id, id), eq(agents.companyId, companyId)));
    if (!existing) throw notFound('Agent', id);

    if (existing.status === 'terminated') {
      throw badRequest('Cannot resume a terminated agent');
    }
    if (existing.status !== 'paused') {
      throw badRequest('Agent is not paused');
    }

    const previousStatus = existing.status;
    const [updated] = await db
      .update(agents)
      .set({ status: 'idle', updatedAt: new Date() })
      .where(and(eq(agents.id, id), eq(agents.companyId, companyId)))
      .returning();

    emitAgentEvent(eventBus, 'agent.resumed', companyId, updated!, { previousStatus });
    emitAgentEvent(eventBus, 'agent.status_changed', companyId, updated!, {
      previousStatus,
      newStatus: 'idle',
    });
    return c.json(serializeRow(updated!));
  });

  // POST /api/companies/:companyId/agents/:id/terminate
  app.post('/:id/terminate', async (c) => {
    const companyId = c.req.param('companyId')!;
    const id = c.req.param('id');

    const [existing] = await db
      .select()
      .from(agents)
      .where(and(eq(agents.id, id), eq(agents.companyId, companyId)));
    if (!existing) throw notFound('Agent', id);

    if (existing.status === 'terminated') {
      throw badRequest('Agent is already terminated');
    }

    const previousStatus = existing.status;
    const [updated] = await db
      .update(agents)
      .set({ status: 'terminated', updatedAt: new Date() })
      .where(and(eq(agents.id, id), eq(agents.companyId, companyId)))
      .returning();

    emitAgentEvent(eventBus, 'agent.terminated', companyId, updated!, { previousStatus });
    emitAgentEvent(eventBus, 'agent.status_changed', companyId, updated!, {
      previousStatus,
      newStatus: 'terminated',
    });
    return c.json(serializeRow(updated!));
  });

  return app;
}

function emitAgentEvent(
  eventBus: InProcessEventBus,
  type: string,
  companyId: string,
  agent: typeof agents.$inferSelect,
  extra?: Record<string, unknown>,
) {
  const event: SystemEvent = {
    type,
    companyId,
    timestamp: new Date(),
    payload: {
      agentId: agent.id,
      name: agent.name,
      status: agent.status,
      ...extra,
    },
  };
  eventBus.emit(event);
}
