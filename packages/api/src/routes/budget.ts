import { agents, companies, costEvents } from '@clawgear/db/pg';
import type { InProcessEventBus } from '@clawgear/kernel';
import type { SystemEvent } from '@clawgear/shared/interfaces';
import { createCostEventSchema } from '@clawgear/shared/validators';
import { eq, sql } from 'drizzle-orm';
import { Hono } from 'hono';
import type { AppDeps } from '../app.js';
import { notFound } from '../lib/errors.js';
import { serializeRow } from '../lib/serialize.js';

export function budgetRoutes(deps: AppDeps) {
  const { db, eventBus } = deps;
  const app = new Hono();

  // POST /api/companies/:companyId/budget/cost-events
  app.post('/cost-events', async (c) => {
    const companyId = c.req.param('companyId')!;
    const body = createCostEventSchema.parse(await c.req.json());

    // Insert cost event
    const [event] = await db
      .insert(costEvents)
      .values({
        companyId,
        agentId: body.agentId,
        issueId: body.issueId ?? null,
        projectId: body.projectId ?? null,
        goalId: body.goalId ?? null,
        provider: body.provider,
        model: body.model,
        inputTokens: body.inputTokens,
        outputTokens: body.outputTokens,
        costCents: body.costCents,
        billingCode: body.billingCode ?? null,
      })
      .returning();

    // Atomically increment agent spent
    await db
      .update(agents)
      .set({
        spentMonthlyCents: sql`${agents.spentMonthlyCents} + ${body.costCents}`,
        updatedAt: new Date(),
      })
      .where(eq(agents.id, body.agentId));

    // Atomically increment company spent
    await db
      .update(companies)
      .set({
        spentMonthlyCents: sql`${companies.spentMonthlyCents} + ${body.costCents}`,
        updatedAt: new Date(),
      })
      .where(eq(companies.id, companyId));

    // Fetch updated company to check budget thresholds
    const [company] = await db.select().from(companies).where(eq(companies.id, companyId));
    if (company) {
      const budget = Number(company.budgetMonthlyCents);
      const spent = Number(company.spentMonthlyCents);

      if (budget > 0) {
        const ratio = spent / budget;

        if (ratio >= 1) {
          // Budget exceeded - emit event and auto-pause agent
          emitBudgetEvent(eventBus, 'budget.exceeded', companyId, {
            agentId: body.agentId,
            spent,
            budget,
          });

          await db
            .update(agents)
            .set({ status: 'paused', updatedAt: new Date() })
            .where(eq(agents.id, body.agentId));
        } else if (ratio >= 0.8) {
          // Budget warning
          emitBudgetEvent(eventBus, 'budget.warning', companyId, {
            agentId: body.agentId,
            spent,
            budget,
          });
        }
      }
    }

    return c.json(serializeRow(event!), 201);
  });

  // GET /api/companies/:companyId/budget/summary
  app.get('/summary', async (c) => {
    const companyId = c.req.param('companyId')!;
    const [company] = await db.select().from(companies).where(eq(companies.id, companyId));
    if (!company) throw notFound('Company', companyId);

    const [totalResult] = await db
      .select({ total: sql<number>`coalesce(sum(${costEvents.costCents}), 0)` })
      .from(costEvents)
      .where(eq(costEvents.companyId, companyId));

    return c.json({
      companyId,
      budgetMonthlyCents: Number(company.budgetMonthlyCents),
      spentMonthlyCents: Number(company.spentMonthlyCents),
      totalCostCents: Number(totalResult!.total),
    });
  });

  // GET /api/companies/:companyId/budget/agents/:agentId
  app.get('/agents/:agentId', async (c) => {
    const companyId = c.req.param('companyId')!;
    const agentId = c.req.param('agentId');

    const [agent] = await db.select().from(agents).where(eq(agents.id, agentId));
    if (!agent) throw notFound('Agent', agentId);

    const [totalResult] = await db
      .select({ total: sql<number>`coalesce(sum(${costEvents.costCents}), 0)` })
      .from(costEvents)
      .where(eq(costEvents.agentId, agentId));

    return c.json({
      companyId,
      agentId,
      budgetMonthlyCents: Number(agent.budgetMonthlyCents),
      spentMonthlyCents: Number(agent.spentMonthlyCents),
      totalCostCents: Number(totalResult!.total),
    });
  });

  return app;
}

function emitBudgetEvent(
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
