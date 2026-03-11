import { workflowRuns, workflowStepRuns, workflows } from '@clawgear/db/pg';
import {
  createWorkflowSchema,
  executeWorkflowSchema,
  paginationSchema,
  updateWorkflowSchema,
} from '@clawgear/shared/validators';
import { and, count, desc, eq } from 'drizzle-orm';
import { Hono } from 'hono';
import type { AppDeps } from '../app.js';
import { badRequest, notFound } from '../lib/errors.js';
import { serializeRow, serializeRows } from '../lib/serialize.js';

export function workflowRoutes(deps: AppDeps) {
  const { db, workflowEngine } = deps;
  const app = new Hono();

  // GET / - List workflows (paginated, filter by companyId)
  app.get('/', async (c) => {
    const companyId = c.req.param('companyId')!;
    const query = c.req.query();
    const { limit, offset } = paginationSchema.parse(query);

    const [data, countRows] = await Promise.all([
      db
        .select()
        .from(workflows)
        .where(eq(workflows.companyId, companyId))
        .orderBy(desc(workflows.createdAt))
        .limit(limit)
        .offset(offset),
      db.select({ total: count() }).from(workflows).where(eq(workflows.companyId, companyId)),
    ]);

    return c.json({
      data: serializeRows(data),
      total: countRows[0]?.total ?? 0,
      limit,
      offset,
    });
  });

  // POST / - Create workflow
  app.post('/', async (c) => {
    const companyId = c.req.param('companyId')!;
    const body = await c.req.json();
    const validated = createWorkflowSchema.parse(body);

    const [workflow] = await db
      .insert(workflows)
      .values({
        companyId,
        name: validated.name,
        description: validated.description,
        definition: validated.definition,
        isActive: validated.isActive ?? true,
        createdByAgentId: validated.createdByAgentId,
      })
      .returning();

    return c.json(serializeRow(workflow!), 201);
  });

  // GET /:id - Get workflow detail
  app.get('/:id', async (c) => {
    const companyId = c.req.param('companyId')!;
    const id = c.req.param('id')!;

    const [workflow] = await db
      .select()
      .from(workflows)
      .where(and(eq(workflows.id, id), eq(workflows.companyId, companyId)));

    if (!workflow) {
      throw notFound('Workflow', id);
    }

    return c.json(serializeRow(workflow));
  });

  // PATCH /:id - Update workflow
  app.patch('/:id', async (c) => {
    const companyId = c.req.param('companyId')!;
    const id = c.req.param('id')!;
    const body = await c.req.json();
    const validated = updateWorkflowSchema.parse(body);

    const [workflow] = await db
      .update(workflows)
      .set({
        ...validated,
        updatedAt: new Date(),
      })
      .where(and(eq(workflows.id, id), eq(workflows.companyId, companyId)))
      .returning();

    if (!workflow) {
      throw notFound('Workflow', id);
    }

    return c.json(serializeRow(workflow));
  });

  // POST /:id/execute - Execute workflow
  app.post('/:id/execute', async (c) => {
    const companyId = c.req.param('companyId')!;
    const id = c.req.param('id')!;
    const body = await c.req.json();
    const validated = executeWorkflowSchema.parse(body);

    if (!workflowEngine) {
      throw badRequest('Workflow engine not available');
    }

    // Verify workflow exists and belongs to company
    const [workflow] = await db
      .select()
      .from(workflows)
      .where(and(eq(workflows.id, id), eq(workflows.companyId, companyId)));

    if (!workflow) {
      throw notFound('Workflow', id);
    }

    const result = await workflowEngine.execute(companyId, id, validated.inputVars ?? {});

    return c.json(result);
  });

  // GET /:id/runs - List runs for workflow
  app.get('/:id/runs', async (c) => {
    const companyId = c.req.param('companyId')!;
    const workflowId = c.req.param('id')!;
    const query = c.req.query();
    const { limit, offset } = paginationSchema.parse(query);

    // Verify workflow exists and belongs to company
    const [workflow] = await db
      .select()
      .from(workflows)
      .where(and(eq(workflows.id, workflowId), eq(workflows.companyId, companyId)));

    if (!workflow) {
      throw notFound('Workflow', workflowId);
    }

    const [data, runCountRows] = await Promise.all([
      db
        .select()
        .from(workflowRuns)
        .where(and(eq(workflowRuns.workflowId, workflowId), eq(workflowRuns.companyId, companyId)))
        .orderBy(desc(workflowRuns.createdAt))
        .limit(limit)
        .offset(offset),
      db
        .select({ total: count() })
        .from(workflowRuns)
        .where(and(eq(workflowRuns.workflowId, workflowId), eq(workflowRuns.companyId, companyId))),
    ]);

    return c.json({
      data: serializeRows(data),
      total: runCountRows[0]?.total ?? 0,
      limit,
      offset,
    });
  });

  return app;
}

export function workflowRunRoutes(deps: AppDeps) {
  const { db, workflowEngine } = deps;
  const app = new Hono();

  // GET /:id - Get run with steps
  app.get('/:id', async (c) => {
    const companyId = c.req.param('companyId')!;
    const id = c.req.param('id')!;

    const [run] = await db
      .select()
      .from(workflowRuns)
      .where(and(eq(workflowRuns.id, id), eq(workflowRuns.companyId, companyId)));

    if (!run) {
      throw notFound('WorkflowRun', id);
    }

    const steps = await db
      .select()
      .from(workflowStepRuns)
      .where(eq(workflowStepRuns.workflowRunId, id))
      .orderBy(workflowStepRuns.stepIndex);

    return c.json({
      ...serializeRow(run),
      steps: serializeRows(steps),
    });
  });

  // POST /:id/cancel - Cancel a running workflow
  app.post('/:id/cancel', async (c) => {
    const companyId = c.req.param('companyId')!;
    const id = c.req.param('id')!;

    if (!workflowEngine) {
      throw badRequest('Workflow engine not available');
    }

    // Verify run exists and belongs to company
    const [run] = await db
      .select()
      .from(workflowRuns)
      .where(and(eq(workflowRuns.id, id), eq(workflowRuns.companyId, companyId)));

    if (!run) {
      throw notFound('WorkflowRun', id);
    }

    await workflowEngine.cancelRun(id);

    return c.json({ success: true });
  });

  return app;
}
