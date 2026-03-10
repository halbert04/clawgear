import { approvals } from '@clawgear/db/pg';
import type { InProcessEventBus } from '@clawgear/kernel';
import type { SystemEvent } from '@clawgear/shared/interfaces';
import {
  createApprovalSchema,
  decideApprovalSchema,
  paginationSchema,
} from '@clawgear/shared/validators';
import { and, eq, sql } from 'drizzle-orm';
import { Hono } from 'hono';
import type { AppDeps } from '../app.js';
import { conflict, notFound } from '../lib/errors.js';
import { serializeRow, serializeRows } from '../lib/serialize.js';

export function approvalRoutes(deps: AppDeps) {
  const { db, eventBus } = deps;
  const app = new Hono();

  // POST /api/companies/:companyId/approvals
  app.post('/', async (c) => {
    const companyId = c.req.param('companyId')!;
    const body = createApprovalSchema.parse(await c.req.json());

    const [approval] = await db
      .insert(approvals)
      .values({
        companyId,
        type: body.type,
        requestedByAgentId: body.requestedByAgentId,
        payload: body.payload,
      })
      .returning();

    emitApprovalEvent(eventBus, 'approval.requested', companyId, {
      approvalId: approval!.id,
      type: approval!.type,
      requestedByAgentId: approval!.requestedByAgentId,
    });

    return c.json(serializeRow(approval!), 201);
  });

  // GET /api/companies/:companyId/approvals
  app.get('/', async (c) => {
    const companyId = c.req.param('companyId')!;
    const { limit, offset } = paginationSchema.parse(c.req.query());
    const status = c.req.query('status') ?? 'pending';

    const rows = await db
      .select()
      .from(approvals)
      .where(and(eq(approvals.companyId, companyId), eq(approvals.status, status)))
      .limit(limit)
      .offset(offset);

    const [countResult] = await db
      .select({ count: sql<number>`count(*)` })
      .from(approvals)
      .where(and(eq(approvals.companyId, companyId), eq(approvals.status, status)));

    return c.json({
      data: serializeRows(rows),
      total: Number(countResult!.count),
      limit,
      offset,
    });
  });

  // GET /api/companies/:companyId/approvals/:id
  app.get('/:id', async (c) => {
    const companyId = c.req.param('companyId')!;
    const id = c.req.param('id');

    const [approval] = await db
      .select()
      .from(approvals)
      .where(and(eq(approvals.id, id), eq(approvals.companyId, companyId)));

    if (!approval) throw notFound('Approval', id);
    return c.json(serializeRow(approval));
  });

  // POST /api/companies/:companyId/approvals/:id/decide
  app.post('/:id/decide', async (c) => {
    const companyId = c.req.param('companyId')!;
    const id = c.req.param('id');
    const body = decideApprovalSchema.parse(await c.req.json());

    // Fetch existing approval
    const [existing] = await db
      .select()
      .from(approvals)
      .where(and(eq(approvals.id, id), eq(approvals.companyId, companyId)));

    if (!existing) throw notFound('Approval', id);
    if (existing.status !== 'pending') {
      throw conflict(`Approval ${id} is already ${existing.status}`);
    }

    const [updated] = await db
      .update(approvals)
      .set({
        status: body.status,
        decidedByUserId: body.decidedByUserId ?? null,
        decidedByAgentId: body.decidedByAgentId ?? null,
        decisionNote: body.decisionNote ?? null,
        decidedAt: new Date(),
      })
      .where(eq(approvals.id, id))
      .returning();

    emitApprovalEvent(eventBus, 'approval.decided', companyId, {
      approvalId: updated!.id,
      type: updated!.type,
      status: updated!.status,
      decidedByUserId: updated!.decidedByUserId,
      decidedByAgentId: updated!.decidedByAgentId,
    });

    return c.json(serializeRow(updated!));
  });

  return app;
}

function emitApprovalEvent(
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
