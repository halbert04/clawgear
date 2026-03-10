import { InProcessEventBus } from '@clawgear/kernel';
import { describe, expect, mock, test } from 'bun:test';
import { createApp } from '../app.js';

const COMPANY_ID = '550e8400-e29b-41d4-a716-446655440001';
const AGENT_ID = '660e8400-e29b-41d4-a716-446655440002';

function makeAgentRow(overrides: Record<string, unknown> = {}) {
  return {
    id: AGENT_ID,
    companyId: COMPANY_ID,
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
    ...overrides,
  };
}

function createMockDb(agentRow = makeAgentRow()) {
  // Insert chain: insert(table).values(v).returning()
  const insertReturning = mock(() => [agentRow]);
  const insertValues = mock(() => ({ returning: insertReturning }));
  const insertFn = mock(() => ({ values: insertValues }));

  // Select chain: select().from(table).where(cond) -> rows
  // Also needs: select().from(table).where(cond).limit(n).offset(m) for list
  const selectOffset = mock(() => [agentRow]);
  const selectLimit = mock(() => ({ offset: selectOffset }));
  const selectWhere = mock(() => {
    // Return array but also have limit for paginated queries
    const result = [agentRow] as unknown as ReturnType<typeof mock> & { limit: typeof selectLimit };
    result.limit = selectLimit;
    return result;
  });
  const selectFrom = mock(() => ({ where: selectWhere, limit: selectLimit }));

  // Count query: select({ count }).from(table).where(cond)
  const countSelectWhere = mock(() => [{ count: 1 }]);
  const countSelectFrom = mock(() => ({ where: countSelectWhere }));

  // Update chain: update(table).set(v).where(cond).returning()
  const updateReturning = mock(() => [{ ...agentRow, updatedAt: new Date() }]);
  const updateWhere = mock(() => ({ returning: updateReturning }));
  const updateSet = mock(() => ({ where: updateWhere }));
  const updateFn = mock(() => ({ set: updateSet }));

  const db = {
    insert: insertFn,
    select: mock((...args: unknown[]) => {
      if (args.length > 0) return { from: countSelectFrom };
      return { from: selectFrom };
    }),
    update: updateFn,
    execute: mock(() => Promise.resolve([{ '?column?': 1 }])),
  };

  return {
    db,
    agentRow,
    insertReturning,
    updateReturning,
    selectWhere,
  };
}

function createMockDbNotFound() {
  const insertReturning = mock(() => []);
  const insertValues = mock(() => ({ returning: insertReturning }));
  const insertFn = mock(() => ({ values: insertValues }));

  const emptySelectWhere = mock(() => {
    const result = [] as unknown as ReturnType<typeof mock> & { limit: ReturnType<typeof mock> };
    result.limit = mock(() => ({ offset: mock(() => []) }));
    return result;
  });
  const emptySelectFrom = mock(() => ({
    where: emptySelectWhere,
    limit: mock(() => ({ offset: mock(() => []) })),
  }));
  const countSelectWhere = mock(() => [{ count: 0 }]);
  const countSelectFrom = mock(() => ({ where: countSelectWhere }));

  const updateReturning = mock(() => []);
  const updateWhere = mock(() => ({ returning: updateReturning }));
  const updateSet = mock(() => ({ where: updateWhere }));
  const updateFn = mock(() => ({ set: updateSet }));

  const db = {
    insert: insertFn,
    select: mock((...args: unknown[]) => {
      if (args.length > 0) return { from: countSelectFrom };
      return { from: emptySelectFrom };
    }),
    update: updateFn,
    execute: mock(() => Promise.resolve([{ '?column?': 1 }])),
  };

  return { db };
}

function makeUrl(path = '') {
  return `/api/companies/${COMPANY_ID}/agents${path}`;
}

describe('Agent Routes', () => {
  test('POST creates an agent', async () => {
    const { db } = createMockDb();
    const eventBus = new InProcessEventBus();
    const emitSpy = mock(() => {});
    eventBus.emit = emitSpy;
    const app = createApp({ db: db as never, eventBus });

    const res = await app.request(makeUrl(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Alice',
        role: 'ceo',
        adapterType: 'claude_code',
      }),
    });

    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.name).toBe('Alice');
    expect(body.role).toBe('ceo');
    expect(typeof body.budgetMonthlyCents).toBe('number');
    expect(emitSpy).toHaveBeenCalledWith(expect.objectContaining({ type: 'agent.created' }));
  });

  test('POST returns 400 on invalid data', async () => {
    const { db } = createMockDb();
    const eventBus = new InProcessEventBus();
    const app = createApp({ db: db as never, eventBus });

    const res = await app.request(makeUrl(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: '' }),
    });

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('Validation Error');
  });

  test('GET / returns paginated list', async () => {
    const { db } = createMockDb();
    const eventBus = new InProcessEventBus();
    const app = createApp({ db: db as never, eventBus });

    const res = await app.request(makeUrl());

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data).toBeArray();
    expect(body.total).toBe(1);
    expect(body.limit).toBe(20);
    expect(body.offset).toBe(0);
  });

  test('GET /:id returns agent', async () => {
    const { db } = createMockDb();
    const eventBus = new InProcessEventBus();
    const app = createApp({ db: db as never, eventBus });

    const res = await app.request(makeUrl(`/${AGENT_ID}`));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.name).toBe('Alice');
    expect(body.companyId).toBe(COMPANY_ID);
  });

  test('GET /:id returns 404 for missing agent', async () => {
    const { db } = createMockDbNotFound();
    const eventBus = new InProcessEventBus();
    const app = createApp({ db: db as never, eventBus });

    const res = await app.request(makeUrl('/550e8400-e29b-41d4-a716-446655440099'));

    expect(res.status).toBe(404);
  });

  test('PATCH /:id updates agent', async () => {
    const agentRow = makeAgentRow();
    const { db, updateReturning } = createMockDb(agentRow);
    updateReturning.mockReturnValue([{ ...agentRow, name: 'Alice Updated', updatedAt: new Date() }]);
    const eventBus = new InProcessEventBus();
    const emitSpy = mock(() => {});
    eventBus.emit = emitSpy;
    const app = createApp({ db: db as never, eventBus });

    const res = await app.request(makeUrl(`/${AGENT_ID}`), {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Alice Updated' }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.name).toBe('Alice Updated');
    expect(emitSpy).toHaveBeenCalledWith(expect.objectContaining({ type: 'agent.status_changed' }));
    // Should also have inserted a config revision
    expect(db.insert).toHaveBeenCalledTimes(1); // config revision insert
  });

  test('PATCH /:id returns 404 for missing agent', async () => {
    const { db } = createMockDbNotFound();
    const eventBus = new InProcessEventBus();
    const app = createApp({ db: db as never, eventBus });

    const res = await app.request(makeUrl(`/${AGENT_ID}`), {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Nope' }),
    });

    expect(res.status).toBe(404);
  });

  test('POST /:id/pause pauses an idle agent', async () => {
    const agentRow = makeAgentRow({ status: 'idle' });
    const { db, updateReturning } = createMockDb(agentRow);
    updateReturning.mockReturnValue([{ ...agentRow, status: 'paused', updatedAt: new Date() }]);
    const eventBus = new InProcessEventBus();
    const emitSpy = mock(() => {});
    eventBus.emit = emitSpy;
    const app = createApp({ db: db as never, eventBus });

    const res = await app.request(makeUrl(`/${AGENT_ID}/pause`), {
      method: 'POST',
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe('paused');
    expect(emitSpy).toHaveBeenCalledWith(expect.objectContaining({ type: 'agent.paused' }));
    expect(emitSpy).toHaveBeenCalledWith(expect.objectContaining({ type: 'agent.status_changed' }));
  });

  test('POST /:id/pause returns 400 for terminated agent', async () => {
    const agentRow = makeAgentRow({ status: 'terminated' });
    const { db } = createMockDb(agentRow);
    const eventBus = new InProcessEventBus();
    const app = createApp({ db: db as never, eventBus });

    const res = await app.request(makeUrl(`/${AGENT_ID}/pause`), {
      method: 'POST',
    });

    expect(res.status).toBe(400);
  });

  test('POST /:id/pause returns 400 for already paused agent', async () => {
    const agentRow = makeAgentRow({ status: 'paused' });
    const { db } = createMockDb(agentRow);
    const eventBus = new InProcessEventBus();
    const app = createApp({ db: db as never, eventBus });

    const res = await app.request(makeUrl(`/${AGENT_ID}/pause`), {
      method: 'POST',
    });

    expect(res.status).toBe(400);
  });

  test('POST /:id/resume resumes a paused agent', async () => {
    const agentRow = makeAgentRow({ status: 'paused' });
    const { db, updateReturning } = createMockDb(agentRow);
    updateReturning.mockReturnValue([{ ...agentRow, status: 'idle', updatedAt: new Date() }]);
    const eventBus = new InProcessEventBus();
    const emitSpy = mock(() => {});
    eventBus.emit = emitSpy;
    const app = createApp({ db: db as never, eventBus });

    const res = await app.request(makeUrl(`/${AGENT_ID}/resume`), {
      method: 'POST',
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe('idle');
    expect(emitSpy).toHaveBeenCalledWith(expect.objectContaining({ type: 'agent.resumed' }));
    expect(emitSpy).toHaveBeenCalledWith(expect.objectContaining({ type: 'agent.status_changed' }));
  });

  test('POST /:id/resume returns 400 for terminated agent', async () => {
    const agentRow = makeAgentRow({ status: 'terminated' });
    const { db } = createMockDb(agentRow);
    const eventBus = new InProcessEventBus();
    const app = createApp({ db: db as never, eventBus });

    const res = await app.request(makeUrl(`/${AGENT_ID}/resume`), {
      method: 'POST',
    });

    expect(res.status).toBe(400);
  });

  test('POST /:id/resume returns 400 for non-paused agent', async () => {
    const agentRow = makeAgentRow({ status: 'idle' });
    const { db } = createMockDb(agentRow);
    const eventBus = new InProcessEventBus();
    const app = createApp({ db: db as never, eventBus });

    const res = await app.request(makeUrl(`/${AGENT_ID}/resume`), {
      method: 'POST',
    });

    expect(res.status).toBe(400);
  });

  test('POST /:id/terminate terminates an agent', async () => {
    const agentRow = makeAgentRow({ status: 'idle' });
    const { db, updateReturning } = createMockDb(agentRow);
    updateReturning.mockReturnValue([{ ...agentRow, status: 'terminated', updatedAt: new Date() }]);
    const eventBus = new InProcessEventBus();
    const emitSpy = mock(() => {});
    eventBus.emit = emitSpy;
    const app = createApp({ db: db as never, eventBus });

    const res = await app.request(makeUrl(`/${AGENT_ID}/terminate`), {
      method: 'POST',
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe('terminated');
    expect(emitSpy).toHaveBeenCalledWith(expect.objectContaining({ type: 'agent.terminated' }));
    expect(emitSpy).toHaveBeenCalledWith(expect.objectContaining({ type: 'agent.status_changed' }));
  });

  test('POST /:id/terminate returns 400 for already terminated agent', async () => {
    const agentRow = makeAgentRow({ status: 'terminated' });
    const { db } = createMockDb(agentRow);
    const eventBus = new InProcessEventBus();
    const app = createApp({ db: db as never, eventBus });

    const res = await app.request(makeUrl(`/${AGENT_ID}/terminate`), {
      method: 'POST',
    });

    expect(res.status).toBe(400);
  });

  test('POST /:id/pause returns 404 for missing agent', async () => {
    const { db } = createMockDbNotFound();
    const eventBus = new InProcessEventBus();
    const app = createApp({ db: db as never, eventBus });

    const res = await app.request(makeUrl(`/${AGENT_ID}/pause`), {
      method: 'POST',
    });

    expect(res.status).toBe(404);
  });

  test('POST /:id/resume returns 404 for missing agent', async () => {
    const { db } = createMockDbNotFound();
    const eventBus = new InProcessEventBus();
    const app = createApp({ db: db as never, eventBus });

    const res = await app.request(makeUrl(`/${AGENT_ID}/resume`), {
      method: 'POST',
    });

    expect(res.status).toBe(404);
  });

  test('POST /:id/terminate returns 404 for missing agent', async () => {
    const { db } = createMockDbNotFound();
    const eventBus = new InProcessEventBus();
    const app = createApp({ db: db as never, eventBus });

    const res = await app.request(makeUrl(`/${AGENT_ID}/terminate`), {
      method: 'POST',
    });

    expect(res.status).toBe(404);
  });
});
