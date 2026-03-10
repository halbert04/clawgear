import { agents, heartbeatRuns } from '@clawgear/db/pg';
import type { InProcessEventBus } from '@clawgear/kernel';
import type { SystemEvent } from '@clawgear/shared/interfaces';
import type { HandConfig } from '@clawgear/shared/types';
import { activateHandSchema, paginationSchema } from '@clawgear/shared/validators';
import { and, desc, eq, sql } from 'drizzle-orm';
import { Hono } from 'hono';
import type { AppDeps } from '../app.js';
import { badRequest, notFound } from '../lib/errors.js';
import { serializeRow, serializeRows } from '../lib/serialize.js';

export function handRoutes(deps: AppDeps) {
  const { db, eventBus, heartbeatEngine, handScheduler } = deps;
  const app = new Hono();

  // GET /api/companies/:companyId/hands -- list hand agents
  app.get('/', async (c) => {
    const companyId = c.req.param('companyId')!;
    const { limit, offset } = paginationSchema.parse(c.req.query());

    const rows = await db
      .select()
      .from(agents)
      .where(and(eq(agents.companyId, companyId), eq(agents.adapterType, 'hand')))
      .limit(limit)
      .offset(offset);

    const [countResult] = await db
      .select({ count: sql<number>`count(*)` })
      .from(agents)
      .where(and(eq(agents.companyId, companyId), eq(agents.adapterType, 'hand')));

    // Enrich with schedule info
    const data = serializeRows(rows).map((row) => {
      const nextRunAt = handScheduler?.getNextRunTime(row.id as string) ?? null;
      return { ...row, nextRunAt };
    });

    return c.json({
      data,
      total: Number(countResult!.count),
      limit,
      offset,
    });
  });

  // POST /api/companies/:companyId/hands -- create/activate hand from template or config
  app.post('/', async (c) => {
    const companyId = c.req.param('companyId')!;
    const body = activateHandSchema.parse(await c.req.json());

    // Build hand config
    let handConfig: HandConfig;
    try {
      const { loadHandTemplate } = await import('@clawgear/runtime');
      const handsDir = new URL('../../../../hands', import.meta.url).pathname;
      const template = await loadHandTemplate(body.name, handsDir);
      handConfig = {
        ...template.config,
        ...body.overrides,
        ownerAgentId: body.ownerAgentId ?? template.config.ownerAgentId,
      };
    } catch {
      throw badRequest(`Hand template not found: ${body.name}`);
    }

    // Create agent with adapter_type = 'hand'
    const [agent] = await db
      .insert(agents)
      .values({
        companyId,
        name: handConfig.name,
        title: `${handConfig.name} hand`,
        role: 'analyst',
        status: 'idle',
        adapterType: 'hand',
        adapterConfig: { handConfig },
        modelTier: 'smart',
        budgetMonthlyCents: BigInt(0),
        systemPrompt: handConfig.description,
      })
      .returning();

    // Emit activation event
    emitHandEvent(eventBus, 'hand.activated', companyId, {
      agentId: agent!.id,
      handName: handConfig.name,
      schedule: handConfig.schedule,
    });

    return c.json(serializeRow(agent!), 201);
  });

  // GET /api/companies/:companyId/hands/:id -- hand detail + schedule info
  app.get('/:id', async (c) => {
    const companyId = c.req.param('companyId')!;
    const id = c.req.param('id');

    const [agent] = await db
      .select()
      .from(agents)
      .where(
        and(eq(agents.id, id), eq(agents.companyId, companyId), eq(agents.adapterType, 'hand')),
      );
    if (!agent) throw notFound('Hand', id);

    const nextRunAt = handScheduler?.getNextRunTime(id) ?? null;
    const config = agent.adapterConfig as Record<string, unknown>;
    const handConfig = (config?.handConfig ?? config) as HandConfig | undefined;

    return c.json({
      ...serializeRow(agent),
      nextRunAt,
      schedule: handConfig?.schedule ?? null,
      outputMode: handConfig?.outputMode ?? null,
      requiresApproval: handConfig?.requiresApproval ?? false,
    });
  });

  // POST /api/companies/:companyId/hands/:id/activate -- set status to idle
  app.post('/:id/activate', async (c) => {
    const companyId = c.req.param('companyId')!;
    const id = c.req.param('id');

    const [agent] = await db
      .select()
      .from(agents)
      .where(
        and(eq(agents.id, id), eq(agents.companyId, companyId), eq(agents.adapterType, 'hand')),
      );
    if (!agent) throw notFound('Hand', id);

    if (agent.status === 'terminated') {
      throw badRequest('Cannot activate a terminated hand');
    }

    const [updated] = await db
      .update(agents)
      .set({ status: 'idle', updatedAt: new Date() })
      .where(and(eq(agents.id, id), eq(agents.companyId, companyId)))
      .returning();

    const config = agent.adapterConfig as Record<string, unknown>;
    const handConfig = (config?.handConfig ?? config) as HandConfig | undefined;

    emitHandEvent(eventBus, 'hand.activated', companyId, {
      agentId: id,
      handName: handConfig?.name ?? agent.name,
      schedule: handConfig?.schedule ?? '',
    });

    return c.json(serializeRow(updated!));
  });

  // POST /api/companies/:companyId/hands/:id/deactivate -- set status to paused
  app.post('/:id/deactivate', async (c) => {
    const companyId = c.req.param('companyId')!;
    const id = c.req.param('id');

    const [agent] = await db
      .select()
      .from(agents)
      .where(
        and(eq(agents.id, id), eq(agents.companyId, companyId), eq(agents.adapterType, 'hand')),
      );
    if (!agent) throw notFound('Hand', id);

    const [updated] = await db
      .update(agents)
      .set({ status: 'paused', updatedAt: new Date() })
      .where(and(eq(agents.id, id), eq(agents.companyId, companyId)))
      .returning();

    const config = agent.adapterConfig as Record<string, unknown>;
    const handConfig = (config?.handConfig ?? config) as HandConfig | undefined;

    emitHandEvent(eventBus, 'hand.deactivated', companyId, {
      agentId: id,
      handName: handConfig?.name ?? agent.name,
    });

    return c.json(serializeRow(updated!));
  });

  // POST /api/companies/:companyId/hands/:id/trigger -- manual trigger
  app.post('/:id/trigger', async (c) => {
    const companyId = c.req.param('companyId')!;
    const id = c.req.param('id');

    const [agent] = await db
      .select()
      .from(agents)
      .where(
        and(eq(agents.id, id), eq(agents.companyId, companyId), eq(agents.adapterType, 'hand')),
      );
    if (!agent) throw notFound('Hand', id);

    if (agent.status === 'terminated') {
      throw badRequest('Cannot trigger a terminated hand');
    }
    if (agent.status === 'paused') {
      throw badRequest('Cannot trigger a paused hand. Activate it first.');
    }

    if (!heartbeatEngine) {
      throw badRequest('Heartbeat engine not available');
    }

    const result = await heartbeatEngine.executeHeartbeat(id, 'manual');
    return c.json(result);
  });

  // GET /api/companies/:companyId/hands/:id/runs -- list heartbeat runs for this hand
  app.get('/:id/runs', async (c) => {
    const companyId = c.req.param('companyId')!;
    const id = c.req.param('id');
    const { limit, offset } = paginationSchema.parse(c.req.query());

    const rows = await db
      .select()
      .from(heartbeatRuns)
      .where(and(eq(heartbeatRuns.companyId, companyId), eq(heartbeatRuns.agentId, id)))
      .orderBy(desc(heartbeatRuns.createdAt))
      .limit(limit)
      .offset(offset);

    const [countResult] = await db
      .select({ count: sql<number>`count(*)` })
      .from(heartbeatRuns)
      .where(and(eq(heartbeatRuns.companyId, companyId), eq(heartbeatRuns.agentId, id)));

    return c.json({
      data: serializeRows(rows),
      total: Number(countResult!.count),
      limit,
      offset,
    });
  });

  return app;
}

function emitHandEvent(
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
