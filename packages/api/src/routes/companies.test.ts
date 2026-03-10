import { InProcessEventBus } from '@clawgear/kernel';
import { describe, expect, mock, test } from 'bun:test';
import { createApp } from '../app.js';

// Mock DB that tracks insert/select/update calls
function createMockDb() {
  const companyRow = {
    id: '550e8400-e29b-41d4-a716-446655440001',
    name: 'Acme Corp',
    description: null,
    status: 'active',
    issuePrefix: 'ACME',
    issueCounter: 0,
    budgetMonthlyCents: 0n,
    spentMonthlyCents: 0n,
    requireBoardApproval: true,
    missionGoalId: null,
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
  };

  const insertReturning = mock(() => [companyRow]);
  const insertValues = mock(() => ({ returning: insertReturning }));
  const insertFn = mock(() => ({ values: insertValues }));

  const selectLimit = mock(() => ({ offset: mock(() => [companyRow]) }));
  const selectWhere = mock(() => [companyRow]);
  const selectFrom = mock(() => ({ where: selectWhere, limit: selectLimit }));

  const updateReturning = mock(() => [{ ...companyRow, name: 'Updated Corp', updatedAt: new Date() }]);
  const updateWhere = mock(() => ({ returning: updateReturning }));
  const updateSet = mock(() => ({ where: updateWhere }));
  const updateFn = mock(() => ({ set: updateSet }));

  // count query
  const countSelectFrom = mock(() => [{ count: 1 }]);

  const db = {
    insert: insertFn,
    select: mock((...args: unknown[]) => {
      // If called with count column spec, return count
      if (args.length > 0) return { from: countSelectFrom };
      return { from: selectFrom };
    }),
    update: updateFn,
    execute: mock(() => Promise.resolve([{ '?column?': 1 }])),
  };

  return { db, companyRow };
}

describe('Company Routes', () => {
  test('POST /api/companies creates a company', async () => {
    const { db } = createMockDb();
    const eventBus = new InProcessEventBus();
    const emitSpy = mock(() => {});
    eventBus.emit = emitSpy;
    const app = createApp({ db: db as never, eventBus });

    const res = await app.request('/api/companies', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Acme Corp',
        issuePrefix: 'ACME',
        budgetMonthlyCents: 10000,
      }),
    });

    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.name).toBe('Acme Corp');
    expect(body.issuePrefix).toBe('ACME');
    expect(typeof body.budgetMonthlyCents).toBe('number');
    expect(emitSpy).toHaveBeenCalledWith(expect.objectContaining({ type: 'company.created' }));
  });

  test('POST /api/companies returns 400 on invalid data', async () => {
    const { db } = createMockDb();
    const eventBus = new InProcessEventBus();
    const app = createApp({ db: db as never, eventBus });

    const res = await app.request('/api/companies', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: '' }),
    });

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('Validation Error');
  });

  test('GET /api/companies returns paginated list', async () => {
    const { db } = createMockDb();
    const eventBus = new InProcessEventBus();
    const app = createApp({ db: db as never, eventBus });

    const res = await app.request('/api/companies');

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data).toBeArray();
    expect(body.total).toBe(1);
    expect(body.limit).toBe(20);
    expect(body.offset).toBe(0);
  });

  test('GET /api/companies/:id returns company', async () => {
    const { db, companyRow } = createMockDb();
    const eventBus = new InProcessEventBus();
    const app = createApp({ db: db as never, eventBus });

    const res = await app.request(`/api/companies/${companyRow.id}`);

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.name).toBe('Acme Corp');
  });

  test('GET /api/companies/:id returns 404 for missing company', async () => {
    const { db } = createMockDb();
    // Override select to return empty
    db.select = mock(() => ({
      from: mock(() => ({
        where: mock(() => []),
        limit: mock(() => ({ offset: mock(() => []) })),
      })),
    }));
    const eventBus = new InProcessEventBus();
    const app = createApp({ db: db as never, eventBus });

    const res = await app.request('/api/companies/550e8400-e29b-41d4-a716-446655440099');

    expect(res.status).toBe(404);
  });

  test('PATCH /api/companies/:id updates company', async () => {
    const { db } = createMockDb();
    const eventBus = new InProcessEventBus();
    const emitSpy = mock(() => {});
    eventBus.emit = emitSpy;
    const app = createApp({ db: db as never, eventBus });

    const res = await app.request('/api/companies/550e8400-e29b-41d4-a716-446655440001', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Updated Corp' }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.name).toBe('Updated Corp');
    expect(emitSpy).toHaveBeenCalledWith(expect.objectContaining({ type: 'company.updated' }));
  });
});
