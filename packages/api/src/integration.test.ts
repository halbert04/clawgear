/**
 * Phase 1 Integration Test
 *
 * Exit criteria: All CRUD operations emit events to the event bus.
 * WebSocket bridge forwards events to clients. The full set of
 * orchestration routes are wired and functional.
 *
 * Note: Individual route tests verify detailed CRUD behavior with
 * per-route mocks. These integration tests verify cross-cutting
 * concerns: event emission, WebSocket bridging, and route wiring.
 */

import { describe, expect, mock, test } from 'bun:test';
import { InProcessEventBus } from '@clawgear/kernel';
import { createApp } from './app.js';
import { EventBridge } from './ws/event-bridge.js';

// ---------------------------------------------------------------------------
// Mock infrastructure
// ---------------------------------------------------------------------------

function createMockDb() {
  const companyRow = {
    id: '550e8400-e29b-41d4-a716-446655440001',
    name: 'Acme Corp',
    description: null,
    status: 'active',
    issuePrefix: 'ACME',
    issueCounter: 0,
    budgetMonthlyCents: 100000n,
    spentMonthlyCents: 0n,
    requireBoardApproval: true,
    missionGoalId: null,
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
  };

  const agentRow = {
    id: '660e8400-e29b-41d4-a716-446655440002',
    companyId: companyRow.id,
    name: 'Alice',
    title: 'CEO',
    role: 'ceo',
    icon: null,
    status: 'idle',
    reportsTo: null,
    capabilities: [],
    permissions: {},
    adapterType: 'claude_code',
    adapterConfig: {},
    modelTier: 'smart',
    modelOverride: null,
    budgetMonthlyCents: 0n,
    spentMonthlyCents: 0n,
    systemPrompt: null,
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
  };

  const goalRow = {
    id: '770e8400-e29b-41d4-a716-446655440003',
    companyId: companyRow.id,
    parentId: null,
    level: 'company',
    status: 'active',
    ownerAgentId: agentRow.id,
    title: 'Launch MVP',
    description: 'Ship the minimum viable product',
    targetDate: null,
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
  };

  const insertReturning = mock(() => [companyRow]);
  const insertValues = mock(() => ({ returning: insertReturning }));
  const insertFn = mock(() => ({ values: insertValues }));

  const selectLimit = mock(() => ({ offset: mock(() => [companyRow]) }));
  const selectWhere = mock(() => {
    const result = [companyRow] as unknown[];
    (result as unknown as Record<string, unknown>).limit = selectLimit;
    return result;
  });
  const selectFrom = mock(() => ({ where: selectWhere, limit: selectLimit }));
  const countSelectFrom = mock(() => ({ where: mock(() => [{ count: 1 }]) }));

  const updateReturning = mock(() => [{ ...companyRow, updatedAt: new Date() }]);
  const updateWhere = mock(() => ({ returning: updateReturning }));
  const updateSet = mock(() => ({ where: updateWhere }));

  const db = {
    insert: insertFn,
    select: mock((...args: unknown[]) => {
      if (args.length > 0) return { from: countSelectFrom };
      return { from: selectFrom };
    }),
    update: mock(() => ({ set: updateSet })),
    execute: mock(() => Promise.resolve([{ '?column?': 1 }])),
  };

  return {
    db,
    companyRow,
    agentRow,
    goalRow,
  };
}

// ---------------------------------------------------------------------------
// Integration tests
// ---------------------------------------------------------------------------

describe('Phase 1 Integration', () => {
  test('company creation emits company.created event', async () => {
    const { db } = createMockDb();
    const eventBus = new InProcessEventBus();
    const events: string[] = [];
    eventBus.on('*', (e) => events.push(e.type));

    const app = createApp({ db: db as never, eventBus });

    const res = await app.request('/api/companies', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Acme Corp', issuePrefix: 'ACME', budgetMonthlyCents: 100000 }),
    });
    expect(res.status).toBe(201);
    expect(events).toContain('company.created');
  });

  test('agent creation emits agent.created event', async () => {
    const { db, agentRow } = createMockDb();
    const eventBus = new InProcessEventBus();
    const events: string[] = [];
    eventBus.on('*', (e) => events.push(e.type));

    createMockDb(); // reset
    (db.insert as ReturnType<typeof mock>).mockReturnValue({
      values: mock(() => ({ returning: mock(() => [agentRow]) })),
    });

    const app = createApp({ db: db as never, eventBus });

    const res = await app.request(`/api/companies/${agentRow.companyId}/agents`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Alice', role: 'ceo', adapterType: 'claude_code' }),
    });
    expect(res.status).toBe(201);
    expect(events).toContain('agent.created');
  });

  test('goal creation emits goal.created event', async () => {
    const { db, goalRow } = createMockDb();
    const eventBus = new InProcessEventBus();
    const events: string[] = [];
    eventBus.on('*', (e) => events.push(e.type));

    (db.insert as ReturnType<typeof mock>).mockReturnValue({
      values: mock(() => ({ returning: mock(() => [goalRow]) })),
    });

    const app = createApp({ db: db as never, eventBus });

    const res = await app.request(`/api/companies/${goalRow.companyId}/goals`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Launch MVP', level: 'company' }),
    });
    expect(res.status).toBe(201);
    expect(events).toContain('goal.created');
  });

  test('all route groups are wired and respond', async () => {
    const { db } = createMockDb();
    const eventBus = new InProcessEventBus();
    const app = createApp({ db: db as never, eventBus });
    const cid = '550e8400-e29b-41d4-a716-446655440001';

    // Each route group should respond (200 or 201 or otherwise, but NOT 404 from missing route)
    const routes = [
      '/api',
      '/api/health',
      `/api/companies`,
      `/api/companies/${cid}/agents`,
      `/api/companies/${cid}/goals`,
      `/api/companies/${cid}/projects`,
      `/api/companies/${cid}/issues`,
      `/api/companies/${cid}/approvals`,
      `/api/companies/${cid}/activity`,
      `/api/companies/${cid}/quality/rubrics`,
      `/api/companies/${cid}/quality/evaluations`,
      `/api/companies/${cid}/budget/summary`,
    ];

    for (const route of routes) {
      const res = await app.request(route);
      // Should be a handled response (not "Not Found" from Hono's 404 handler)
      expect(res.status).not.toBe(404);
    }
  });

  test('WebSocket bridge forwards events to connected clients', () => {
    const eventBus = new InProcessEventBus();
    const bridge = new EventBridge(eventBus);
    const received: string[] = [];

    const mockWs = { send: mock((msg: string) => received.push(msg)) } as never;
    bridge.addClient(mockWs);

    // Emit various event types
    const eventTypes = [
      'company.created',
      'agent.created',
      'goal.created',
      'issue.created',
      'issue.assigned',
      'approval.requested',
      'budget.warning',
      'quality.gate_passed',
    ];

    for (const type of eventTypes) {
      eventBus.emit({
        type,
        companyId: 'c1',
        timestamp: new Date(),
        payload: { test: true },
      });
    }

    // All events should be forwarded
    expect(received.length).toBe(eventTypes.length);

    // Each message should be valid JSON with the correct type
    for (let i = 0; i < eventTypes.length; i++) {
      const parsed = JSON.parse(received[i]!);
      expect(parsed.type).toBe(eventTypes[i]);
      expect(parsed.companyId).toBe('c1');
      expect(parsed.payload.test).toBe(true);
    }
  });

  test('event bus supports wildcard and typed subscriptions', () => {
    const eventBus = new InProcessEventBus();
    const allEvents: string[] = [];
    const agentEvents: string[] = [];

    eventBus.on('*', (e) => allEvents.push(e.type));
    eventBus.on('agent.created', (e) => agentEvents.push(e.type));

    eventBus.emit({
      type: 'company.created',
      companyId: 'c1',
      timestamp: new Date(),
      payload: {},
    });

    eventBus.emit({
      type: 'agent.created',
      companyId: 'c1',
      timestamp: new Date(),
      payload: {},
    });

    expect(allEvents).toEqual(['company.created', 'agent.created']);
    expect(agentEvents).toEqual(['agent.created']);
  });
});
