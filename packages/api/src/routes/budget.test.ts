import { InProcessEventBus } from '@clawgear/kernel';
import { describe, expect, mock, test } from 'bun:test';
import { Hono } from 'hono';
import { errorHandler } from '../middleware/error-handler.js';
import { budgetRoutes } from './budget.js';

const COMPANY_ID = '550e8400-e29b-41d4-a716-446655440001';
const AGENT_ID = '550e8400-e29b-41d4-a716-446655440002';

function createCostEventPayload(overrides: Record<string, unknown> = {}) {
  return {
    agentId: AGENT_ID,
    provider: 'anthropic',
    model: 'claude-sonnet-4-20250514',
    inputTokens: 1000,
    outputTokens: 500,
    costCents: 10,
    ...overrides,
  };
}

function createMockDb(opts: {
  companyBudget?: bigint;
  companySpent?: bigint;
  agentBudget?: bigint;
  agentSpent?: bigint;
} = {}) {
  const {
    companyBudget = 10000n,
    companySpent = 0n,
    agentBudget = 5000n,
    agentSpent = 0n,
  } = opts;

  const costEventRow = {
    id: '550e8400-e29b-41d4-a716-446655440010',
    companyId: COMPANY_ID,
    agentId: AGENT_ID,
    issueId: null,
    projectId: null,
    goalId: null,
    provider: 'anthropic',
    model: 'claude-sonnet-4-20250514',
    inputTokens: 1000,
    outputTokens: 500,
    costCents: 10,
    billingCode: null,
    occurredAt: new Date('2026-01-01'),
  };

  let currentCompanySpent = companySpent;

  const companyRow = () => ({
    id: COMPANY_ID,
    name: 'Acme Corp',
    description: null,
    status: 'active',
    issuePrefix: 'ACME',
    issueCounter: 0,
    budgetMonthlyCents: companyBudget,
    spentMonthlyCents: currentCompanySpent,
    requireBoardApproval: true,
    missionGoalId: null,
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
  });

  const agentRow = {
    id: AGENT_ID,
    companyId: COMPANY_ID,
    name: 'Engineer Bot',
    title: null,
    role: 'engineer',
    icon: null,
    status: 'idle',
    reportsTo: null,
    capabilities: [],
    permissions: {},
    adapterType: 'claude_code',
    adapterConfig: {},
    modelTier: 'smart',
    modelOverride: null,
    budgetMonthlyCents: agentBudget,
    spentMonthlyCents: agentSpent,
    systemPrompt: null,
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
  };

  const insertReturning = mock(() => [costEventRow]);
  const insertValues = mock(() => ({ returning: insertReturning }));
  const insertFn = mock(() => ({ values: insertValues }));

  const updateReturning = mock(() => [agentRow]);
  const updateWhere = mock(() => ({ returning: updateReturning }));
  const updateSet = mock(() => ({ where: updateWhere }));
  const updateFn = mock(() => ({ set: updateSet }));

  const db = {
    insert: insertFn,
    update: updateFn,
    select: mock((...args: unknown[]) => {
      // Aggregation query (sum/count)
      if (args.length > 0) {
        return {
          from: mock(() => ({
            where: mock(() => [{ total: 100 }]),
          })),
        };
      }
      // Regular select
      return {
        from: mock((_table: unknown) => ({
          where: mock(() => {
            // Return company or agent based on context -- we just return both
            // The route code checks table identity; with mocks we return company first
            return [companyRow()];
          }),
          orderBy: mock(() => ({
            limit: mock(() => ({ offset: mock(() => [companyRow()]) })),
          })),
          limit: mock(() => ({ offset: mock(() => [companyRow()]) })),
        })),
      };
    }),
    execute: mock(() => Promise.resolve([{ '?column?': 1 }])),
  };

  return { db, costEventRow, companyRow, agentRow, setCompanySpent: (v: bigint) => { currentCompanySpent = v; } };
}

function buildApp(db: unknown, eventBus: InProcessEventBus) {
  const wrapper = new Hono();
  wrapper.onError(errorHandler);
  wrapper.route('/api/companies/:companyId/budget', budgetRoutes({ db: db as never, eventBus }));
  return wrapper;
}

describe('Budget Routes', () => {
  test('POST /cost-events ingests a cost event', async () => {
    const { db } = createMockDb();
    const eventBus = new InProcessEventBus();
    const emitSpy = mock(() => {});
    eventBus.emit = emitSpy;
    const app = buildApp(db, eventBus);

    const res = await app.request(`/api/companies/${COMPANY_ID}/budget/cost-events`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(createCostEventPayload()),
    });

    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.provider).toBe('anthropic');
    expect(body.costCents).toBe(10);
    expect(db.insert).toHaveBeenCalled();
  });

  test('POST /cost-events emits budget.warning at 80% threshold', async () => {
    const { db, setCompanySpent } = createMockDb({ companyBudget: 100n });
    // After increment the company will show 85 cents spent of 100 budget
    setCompanySpent(85n);

    const eventBus = new InProcessEventBus();
    const emitSpy = mock(() => {});
    eventBus.emit = emitSpy;
    const app = buildApp(db, eventBus);

    const res = await app.request(`/api/companies/${COMPANY_ID}/budget/cost-events`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(createCostEventPayload({ costCents: 5 })),
    });

    expect(res.status).toBe(201);
    expect(emitSpy).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'budget.warning' }),
    );
  });

  test('POST /cost-events emits budget.exceeded at 100% and auto-pauses agent', async () => {
    const { db, setCompanySpent } = createMockDb({ companyBudget: 100n });
    // After increment the company will show 100+ cents spent
    setCompanySpent(100n);

    const eventBus = new InProcessEventBus();
    const emitSpy = mock(() => {});
    eventBus.emit = emitSpy;
    const app = buildApp(db, eventBus);

    const res = await app.request(`/api/companies/${COMPANY_ID}/budget/cost-events`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(createCostEventPayload({ costCents: 10 })),
    });

    expect(res.status).toBe(201);
    expect(emitSpy).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'budget.exceeded' }),
    );
    // update called 3 times: agent spent increment, company spent increment, agent pause
    expect(db.update).toHaveBeenCalledTimes(3);
  });

  test('GET /summary returns company budget summary', async () => {
    const { db } = createMockDb({ companyBudget: 10000n, companySpent: 500n });
    const eventBus = new InProcessEventBus();
    const app = buildApp(db, eventBus);

    const res = await app.request(`/api/companies/${COMPANY_ID}/budget/summary`);

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.companyId).toBe(COMPANY_ID);
    expect(typeof body.budgetMonthlyCents).toBe('number');
    expect(typeof body.spentMonthlyCents).toBe('number');
    expect(typeof body.totalCostCents).toBe('number');
  });

  test('GET /agents/:agentId returns agent budget summary', async () => {
    const { db } = createMockDb({ agentBudget: 5000n, agentSpent: 200n });
    const eventBus = new InProcessEventBus();

    // Override select to return agent row
    const agentRow = {
      id: AGENT_ID,
      companyId: COMPANY_ID,
      name: 'Engineer Bot',
      budgetMonthlyCents: 5000n,
      spentMonthlyCents: 200n,
    };
    (db as Record<string, unknown>).select = mock((...args: unknown[]) => {
      if (args.length > 0) {
        return {
          from: mock(() => ({
            where: mock(() => [{ total: 50 }]),
          })),
        };
      }
      return {
        from: mock(() => ({
          where: mock(() => [agentRow]),
        })),
      };
    });

    const app = buildApp(db, eventBus);

    const res = await app.request(`/api/companies/${COMPANY_ID}/budget/agents/${AGENT_ID}`);

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.agentId).toBe(AGENT_ID);
    expect(typeof body.budgetMonthlyCents).toBe('number');
    expect(typeof body.totalCostCents).toBe('number');
  });

  test('POST /cost-events returns 400 on invalid data', async () => {
    const { db } = createMockDb();
    const eventBus = new InProcessEventBus();
    const app = buildApp(db, eventBus);

    const res = await app.request(`/api/companies/${COMPANY_ID}/budget/cost-events`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ provider: 'anthropic' }), // missing required fields
    });

    expect(res.status).toBe(400);
  });
});
