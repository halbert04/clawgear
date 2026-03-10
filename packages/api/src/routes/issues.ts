import { companies, issueComments, issues } from '@clawgear/db/pg';
import type { InProcessEventBus } from '@clawgear/kernel';
import type { SystemEvent } from '@clawgear/shared/interfaces';
import {
  createIssueCommentSchema,
  createIssueSchema,
  paginationSchema,
  updateIssueSchema,
} from '@clawgear/shared/validators';
import { and, eq, sql } from 'drizzle-orm';
import { Hono } from 'hono';
import type { AppDeps } from '../app.js';
import { badRequest, conflict, notFound } from '../lib/errors.js';
import { serializeRow, serializeRows } from '../lib/serialize.js';

// Valid status transitions (from -> set of allowed targets)
const STATUS_TRANSITIONS: Record<string, Set<string>> = {
  backlog: new Set(['todo', 'cancelled']),
  todo: new Set(['in_progress', 'cancelled']),
  in_progress: new Set(['in_review', 'cancelled']),
  in_review: new Set(['done', 'in_progress', 'cancelled']),
  done: new Set(['cancelled']),
  cancelled: new Set(['cancelled']),
};

export function issueRoutes(deps: AppDeps) {
  const { db, eventBus } = deps;
  const app = new Hono();

  // POST /api/companies/:companyId/issues
  app.post('/', async (c) => {
    const companyId = c.req.param('companyId')!;
    const body = createIssueSchema.parse(await c.req.json());

    // Atomically increment company issue counter
    const [counterResult] = await db
      .update(companies)
      .set({ issueCounter: sql`${companies.issueCounter} + 1` })
      .where(eq(companies.id, companyId))
      .returning({ issueCounter: companies.issueCounter, issuePrefix: companies.issuePrefix });

    if (!counterResult) throw notFound('Company', companyId);

    const issueNumber = counterResult.issueCounter;
    const identifier = `${counterResult.issuePrefix}-${issueNumber}`;

    const [issue] = await db
      .insert(issues)
      .values({
        companyId,
        projectId: body.projectId ?? null,
        goalId: body.goalId ?? null,
        parentId: body.parentId ?? null,
        issueNumber,
        identifier,
        title: body.title,
        description: body.description ?? null,
        priority: body.priority,
        assigneeAgentId: body.assigneeAgentId ?? null,
        requiredCapabilities: body.requiredCapabilities ?? null,
        billingCode: body.billingCode ?? null,
      })
      .returning();

    emitIssueEvent(eventBus, 'issue.created', companyId, issue!);
    if (body.assigneeAgentId) {
      emitIssueEvent(eventBus, 'issue.assigned', companyId, issue!);
    }
    return c.json(serializeRow(issue!), 201);
  });

  // GET /api/companies/:companyId/issues
  app.get('/', async (c) => {
    const companyId = c.req.param('companyId')!;
    const { limit, offset } = paginationSchema.parse(c.req.query());
    const status = c.req.query('status');
    const assigneeAgentId = c.req.query('assigneeAgentId');
    const projectId = c.req.query('projectId');

    const conditions = [eq(issues.companyId, companyId)];
    if (status) conditions.push(eq(issues.status, status));
    if (assigneeAgentId) conditions.push(eq(issues.assigneeAgentId, assigneeAgentId));
    if (projectId) conditions.push(eq(issues.projectId, projectId));

    const whereClause = and(...conditions);

    const rows = await db.select().from(issues).where(whereClause).limit(limit).offset(offset);
    const [countResult] = await db
      .select({ count: sql<number>`count(*)` })
      .from(issues)
      .where(whereClause);

    return c.json({
      data: serializeRows(rows),
      total: Number(countResult!.count),
      limit,
      offset,
    });
  });

  // GET /api/companies/:companyId/issues/:id
  app.get('/:id', async (c) => {
    const companyId = c.req.param('companyId')!;
    const id = c.req.param('id');
    const [issue] = await db
      .select()
      .from(issues)
      .where(and(eq(issues.id, id), eq(issues.companyId, companyId)));
    if (!issue) throw notFound('Issue', id);
    return c.json(serializeRow(issue));
  });

  // PATCH /api/companies/:companyId/issues/:id
  app.patch('/:id', async (c) => {
    const companyId = c.req.param('companyId')!;
    const id = c.req.param('id');
    const body = updateIssueSchema.parse(await c.req.json());

    // If status change requested, validate transition
    if (body.status !== undefined) {
      const [current] = await db
        .select()
        .from(issues)
        .where(and(eq(issues.id, id), eq(issues.companyId, companyId)));
      if (!current) throw notFound('Issue', id);

      const allowed = STATUS_TRANSITIONS[current.status];
      if (!allowed || !allowed.has(body.status)) {
        throw badRequest(`Invalid status transition: ${current.status} -> ${body.status}`);
      }
    }

    const values: Record<string, unknown> = {};
    if (body.title !== undefined) values.title = body.title;
    if (body.description !== undefined) values.description = body.description;
    if (body.status !== undefined) values.status = body.status;
    if (body.priority !== undefined) values.priority = body.priority;
    if (body.assigneeAgentId !== undefined) values.assigneeAgentId = body.assigneeAgentId;
    if (body.projectId !== undefined) values.projectId = body.projectId;
    if (body.goalId !== undefined) values.goalId = body.goalId;

    // Set timestamp fields based on status
    if (body.status === 'in_progress' && !values.startedAt) values.startedAt = new Date();
    if (body.status === 'done') values.completedAt = new Date();
    if (body.status === 'cancelled') values.cancelledAt = new Date();

    if (Object.keys(values).length === 0) {
      const [existing] = await db
        .select()
        .from(issues)
        .where(and(eq(issues.id, id), eq(issues.companyId, companyId)));
      if (!existing) throw notFound('Issue', id);
      return c.json(serializeRow(existing));
    }

    values.updatedAt = new Date();
    const [updated] = await db
      .update(issues)
      .set(values)
      .where(and(eq(issues.id, id), eq(issues.companyId, companyId)))
      .returning();
    if (!updated) throw notFound('Issue', id);

    if (body.status !== undefined) {
      emitIssueEvent(eventBus, 'issue.status_changed', companyId, updated);
    }
    if (body.assigneeAgentId !== undefined) {
      emitIssueEvent(eventBus, 'issue.assigned', companyId, updated);
    }
    return c.json(serializeRow(updated));
  });

  // POST /api/companies/:companyId/issues/:id/checkout
  app.post('/:id/checkout', async (c) => {
    const companyId = c.req.param('companyId')!;
    const id = c.req.param('id');
    const { agentId } = (await c.req.json()) as { agentId: string };

    if (!agentId) throw badRequest('agentId is required');

    // Atomic checkout: only succeeds if not already checked out
    const [checkedOut] = await db
      .update(issues)
      .set({
        assigneeAgentId: agentId,
        status: 'in_progress',
        executionLockedAt: new Date(),
        startedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(issues.id, id),
          eq(issues.companyId, companyId),
          sql`(${issues.assigneeAgentId} IS NULL OR ${issues.executionLockedAt} IS NULL)`,
        ),
      )
      .returning();

    if (!checkedOut) {
      // Check if the issue exists at all
      const [existing] = await db
        .select()
        .from(issues)
        .where(and(eq(issues.id, id), eq(issues.companyId, companyId)));
      if (!existing) throw notFound('Issue', id);
      throw conflict('Issue is already checked out');
    }

    emitIssueEvent(eventBus, 'issue.checked_out', companyId, checkedOut);
    return c.json(serializeRow(checkedOut));
  });

  // POST /api/companies/:companyId/issues/:id/release
  app.post('/:id/release', async (c) => {
    const companyId = c.req.param('companyId')!;
    const id = c.req.param('id');

    const [released] = await db
      .update(issues)
      .set({
        assigneeAgentId: null,
        executionLockedAt: null,
        status: 'todo',
        updatedAt: new Date(),
      })
      .where(and(eq(issues.id, id), eq(issues.companyId, companyId)))
      .returning();

    if (!released) throw notFound('Issue', id);

    emitIssueEvent(eventBus, 'issue.released', companyId, released);
    return c.json(serializeRow(released));
  });

  // POST /api/companies/:companyId/issues/:id/comments
  app.post('/:id/comments', async (c) => {
    const companyId = c.req.param('companyId')!;
    const id = c.req.param('id');

    // Verify issue exists
    const [issue] = await db
      .select()
      .from(issues)
      .where(and(eq(issues.id, id), eq(issues.companyId, companyId)));
    if (!issue) throw notFound('Issue', id);

    const body = createIssueCommentSchema.parse(await c.req.json());
    const [comment] = await db
      .insert(issueComments)
      .values({
        companyId,
        issueId: id,
        authorAgentId: body.authorAgentId ?? null,
        authorUserId: body.authorUserId ?? null,
        body: body.body,
      })
      .returning();

    return c.json(serializeRow(comment!), 201);
  });

  return app;
}

function emitIssueEvent(
  eventBus: InProcessEventBus,
  type: string,
  companyId: string,
  issue: typeof issues.$inferSelect,
) {
  const event: SystemEvent = {
    type,
    companyId,
    timestamp: new Date(),
    payload: {
      issueId: issue.id,
      identifier: issue.identifier,
      status: issue.status,
      assigneeAgentId: issue.assigneeAgentId,
    },
  };
  eventBus.emit(event);
}
