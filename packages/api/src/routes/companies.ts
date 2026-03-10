import { companies } from '@clawgear/db/pg';
import type { InProcessEventBus } from '@clawgear/kernel';
import type { SystemEvent } from '@clawgear/shared/interfaces';
import { createCompanySchema, paginationSchema, updateCompanySchema } from '@clawgear/shared/validators';
import { eq, sql } from 'drizzle-orm';
import { Hono } from 'hono';
import type { AppDeps } from '../app.js';
import { notFound } from '../lib/errors.js';
import { serializeRow, serializeRows } from '../lib/serialize.js';

export function companyRoutes(deps: AppDeps) {
  const { db, eventBus } = deps;
  const app = new Hono();

  // POST /api/companies
  app.post('/', async (c) => {
    const body = createCompanySchema.parse(await c.req.json());
    const [company] = await db
      .insert(companies)
      .values({
        name: body.name,
        description: body.description ?? null,
        issuePrefix: body.issuePrefix,
        budgetMonthlyCents: BigInt(body.budgetMonthlyCents),
        requireBoardApproval: body.requireBoardApproval,
      })
      .returning();

    emitCompanyEvent(eventBus, 'company.created', company!);
    return c.json(serializeRow(company!), 201);
  });

  // GET /api/companies
  app.get('/', async (c) => {
    const { limit, offset } = paginationSchema.parse(c.req.query());
    const rows = await db.select().from(companies).limit(limit).offset(offset);
    const [countResult] = await db.select({ count: sql<number>`count(*)` }).from(companies);
    return c.json({
      data: serializeRows(rows),
      total: Number(countResult!.count),
      limit,
      offset,
    });
  });

  // GET /api/companies/:id
  app.get('/:id', async (c) => {
    const id = c.req.param('id');
    const [company] = await db.select().from(companies).where(eq(companies.id, id));
    if (!company) throw notFound('Company', id);
    return c.json(serializeRow(company));
  });

  // PATCH /api/companies/:id
  app.patch('/:id', async (c) => {
    const id = c.req.param('id');
    const body = updateCompanySchema.parse(await c.req.json());

    const values: Record<string, unknown> = {};
    if (body.name !== undefined) values.name = body.name;
    if (body.description !== undefined) values.description = body.description;
    if (body.status !== undefined) values.status = body.status;
    if (body.budgetMonthlyCents !== undefined) values.budgetMonthlyCents = BigInt(body.budgetMonthlyCents);
    if (body.requireBoardApproval !== undefined) values.requireBoardApproval = body.requireBoardApproval;

    if (Object.keys(values).length === 0) {
      const [existing] = await db.select().from(companies).where(eq(companies.id, id));
      if (!existing) throw notFound('Company', id);
      return c.json(serializeRow(existing));
    }

    values.updatedAt = new Date();
    const [updated] = await db.update(companies).set(values).where(eq(companies.id, id)).returning();
    if (!updated) throw notFound('Company', id);

    emitCompanyEvent(eventBus, 'company.updated', updated);
    return c.json(serializeRow(updated));
  });

  return app;
}

function emitCompanyEvent(
  eventBus: InProcessEventBus,
  type: string,
  company: typeof companies.$inferSelect,
) {
  const event: SystemEvent = {
    type,
    companyId: company.id,
    timestamp: new Date(),
    payload: { companyId: company.id, name: company.name },
  };
  eventBus.emit(event);
}
