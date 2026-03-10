import { companies, projects } from '@clawgear/db/pg';
import type { InProcessEventBus } from '@clawgear/kernel';
import type { SystemEvent } from '@clawgear/shared/interfaces';
import { createProjectSchema, paginationSchema } from '@clawgear/shared/validators';
import { eq, and, sql } from 'drizzle-orm';
import { Hono } from 'hono';
import type { AppDeps } from '../app.js';
import { notFound } from '../lib/errors.js';
import { serializeRow, serializeRows } from '../lib/serialize.js';

export function projectRoutes(deps: AppDeps) {
  const { db, eventBus } = deps;
  const app = new Hono();

  // POST /api/companies/:companyId/projects
  app.post('/', async (c) => {
    const companyId = c.req.param('companyId')!;
    const [company] = await db.select().from(companies).where(eq(companies.id, companyId));
    if (!company) throw notFound('Company', companyId);

    const body = createProjectSchema.parse(await c.req.json());
    const [project] = await db
      .insert(projects)
      .values({
        companyId,
        goalId: body.goalId ?? null,
        leadAgentId: body.leadAgentId ?? null,
        name: body.name,
        description: body.description ?? null,
        targetDate: body.targetDate ?? null,
        color: body.color ?? null,
      })
      .returning();

    emitProjectEvent(eventBus, 'project.created', companyId, project!);
    return c.json(serializeRow(project!), 201);
  });

  // GET /api/companies/:companyId/projects
  app.get('/', async (c) => {
    const companyId = c.req.param('companyId')!;
    const { limit, offset } = paginationSchema.parse(c.req.query());
    const rows = await db
      .select()
      .from(projects)
      .where(eq(projects.companyId, companyId))
      .limit(limit)
      .offset(offset);
    const [countResult] = await db
      .select({ count: sql<number>`count(*)` })
      .from(projects)
      .where(eq(projects.companyId, companyId));
    return c.json({
      data: serializeRows(rows),
      total: Number(countResult!.count),
      limit,
      offset,
    });
  });

  // GET /api/companies/:companyId/projects/:id
  app.get('/:id', async (c) => {
    const companyId = c.req.param('companyId')!;
    const id = c.req.param('id');
    const [project] = await db
      .select()
      .from(projects)
      .where(and(eq(projects.id, id), eq(projects.companyId, companyId)));
    if (!project) throw notFound('Project', id);
    return c.json(serializeRow(project));
  });

  // PATCH /api/companies/:companyId/projects/:id
  app.patch('/:id', async (c) => {
    const companyId = c.req.param('companyId')!;
    const id = c.req.param('id');
    const body = createProjectSchema.partial().parse(await c.req.json());

    const values: Record<string, unknown> = {};
    if (body.name !== undefined) values.name = body.name;
    if (body.description !== undefined) values.description = body.description;
    if (body.goalId !== undefined) values.goalId = body.goalId;
    if (body.leadAgentId !== undefined) values.leadAgentId = body.leadAgentId;
    if (body.targetDate !== undefined) values.targetDate = body.targetDate;
    if (body.color !== undefined) values.color = body.color;

    if (Object.keys(values).length === 0) {
      const [existing] = await db
        .select()
        .from(projects)
        .where(and(eq(projects.id, id), eq(projects.companyId, companyId)));
      if (!existing) throw notFound('Project', id);
      return c.json(serializeRow(existing));
    }

    values.updatedAt = new Date();
    const [updated] = await db
      .update(projects)
      .set(values)
      .where(and(eq(projects.id, id), eq(projects.companyId, companyId)))
      .returning();
    if (!updated) throw notFound('Project', id);

    emitProjectEvent(eventBus, 'project.updated', companyId, updated);
    return c.json(serializeRow(updated));
  });

  return app;
}

function emitProjectEvent(
  eventBus: InProcessEventBus,
  type: string,
  companyId: string,
  project: typeof projects.$inferSelect,
) {
  const event: SystemEvent = {
    type,
    companyId,
    timestamp: new Date(),
    payload: { projectId: project.id, name: project.name },
  };
  eventBus.emit(event);
}
