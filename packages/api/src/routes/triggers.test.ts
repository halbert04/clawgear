import { describe, expect, it, mock } from 'bun:test';
import { Hono } from 'hono';
import { triggerRoutes } from './triggers.js';

const COMPANY_ID = 'comp-1';
const TRIGGER_ID = 'trigger-1';

function makeTriggerRow(overrides: Record<string, unknown> = {}) {
  return {
    id: TRIGGER_ID,
    companyId: COMPANY_ID,
    name: 'Test Trigger',
    description: null,
    patternType: 'event_match',
    patternConfig: { eventType: 'issue.created' },
    actionType: 'wake_agent',
    actionConfig: { agentId: 'agent-1' },
    isActive: true,
    fireCount: 0,
    maxFireCount: null,
    lastFiredAt: null,
    cooldownMs: 10000,
    createdByAgentId: null,
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
    ...overrides,
  };
}

function createMockDb(triggerRow = makeTriggerRow()) {
  // Insert chain: insert(table).values(v).returning()
  const insertReturning = mock(() => Promise.resolve([triggerRow]));
  const insertValues = mock(() => ({ returning: insertReturning }));
  const insertFn = mock(() => ({ values: insertValues }));

  // Select chain: select().from(table).where(cond).orderBy(col).limit(n).offset(m)
  const selectOffset = mock(() => Promise.resolve([triggerRow]));
  const selectLimit = mock(() => ({ offset: selectOffset }));
  const selectOrderBy = mock(() => ({ limit: selectLimit }));
  const selectWhere = mock(() => {
    // For detail queries (without orderBy)
    const result = Promise.resolve([triggerRow]) as unknown as Promise<(typeof triggerRow)[]> & {
      orderBy: typeof selectOrderBy;
    };
    result.orderBy = selectOrderBy;
    return result;
  });
  const selectFrom = mock(() => ({ where: selectWhere }));

  // Count query: select({ count: sql }).from(table).where(cond)
  const countSelectWhere = mock(() => Promise.resolve([{ count: 1 }]));
  const countSelectFrom = mock(() => ({ where: countSelectWhere }));

  // Update chain: update(table).set(v).where(cond).returning()
  const updateReturning = mock(() => Promise.resolve([{ ...triggerRow, updatedAt: new Date() }]));
  const updateWhere = mock(() => ({ returning: updateReturning }));
  const updateSet = mock(() => ({ where: updateWhere }));
  const updateFn = mock(() => ({ set: updateSet }));

  // Delete chain: delete(table).where(cond).returning()
  const deleteReturning = mock(() => Promise.resolve([triggerRow]));
  const deleteWhere = mock(() => ({ returning: deleteReturning }));
  const deleteFn = mock(() => ({ where: deleteWhere }));

  const db = {
    insert: insertFn,
    select: mock((...args: unknown[]) => {
      if (args.length > 0) return { from: countSelectFrom };
      return { from: selectFrom };
    }),
    update: updateFn,
    delete: deleteFn,
  };

  return {
    db,
    triggerRow,
    insertReturning,
    updateReturning,
    deleteReturning,
    selectWhere,
  };
}

function createMockDbNotFound() {
  const insertReturning = mock(() => Promise.resolve([]));
  const insertValues = mock(() => ({ returning: insertReturning }));
  const insertFn = mock(() => ({ values: insertValues }));

  const selectOffset = mock(() => Promise.resolve([]));
  const selectLimit = mock(() => ({ offset: selectOffset }));
  const selectOrderBy = mock(() => ({ limit: selectLimit }));
  const emptySelectWhere = mock(() => {
    const result = Promise.resolve([]) as unknown as Promise<never[]> & {
      orderBy: typeof selectOrderBy;
    };
    result.orderBy = selectOrderBy;
    return result;
  });
  const emptySelectFrom = mock(() => ({ where: emptySelectWhere }));

  const countSelectWhere = mock(() => Promise.resolve([{ count: 0 }]));
  const countSelectFrom = mock(() => ({ where: countSelectWhere }));

  const updateReturning = mock(() => Promise.resolve([]));
  const updateWhere = mock(() => ({ returning: updateReturning }));
  const updateSet = mock(() => ({ where: updateWhere }));
  const updateFn = mock(() => ({ set: updateSet }));

  const deleteReturning = mock(() => Promise.resolve([]));
  const deleteWhere = mock(() => ({ returning: deleteReturning }));
  const deleteFn = mock(() => ({ where: deleteWhere }));

  const db = {
    insert: insertFn,
    select: mock((...args: unknown[]) => {
      if (args.length > 0) return { from: countSelectFrom };
      return { from: emptySelectFrom };
    }),
    update: updateFn,
    delete: deleteFn,
  };

  return { db };
}

function createMockTriggerEngine() {
  return {
    addTrigger: mock(() => Promise.resolve()),
    removeTrigger: mock(() => Promise.resolve()),
    checkTrigger: mock(() => Promise.resolve(false)),
    processTrigger: mock(() => Promise.resolve()),
  };
}

function makeUrl(path = '') {
  return `/api/companies/${COMPANY_ID}/triggers${path}`;
}

describe('triggerRoutes', () => {
  it('exports a triggerRoutes function', () => {
    expect(typeof triggerRoutes).toBe('function');
  });

  it('creates a Hono app with routes', () => {
    const { db } = createMockDb();
    const triggerEngine = createMockTriggerEngine();
    const app = triggerRoutes({ db, triggerEngine } as never);
    expect(app).toBeDefined();
  });

  it('GET / returns paginated trigger list', async () => {
    const { db } = createMockDb();
    const triggerEngine = createMockTriggerEngine();

    const outerApp = new Hono();
    outerApp.route(
      '/api/companies/:companyId/triggers',
      triggerRoutes({ db, triggerEngine } as never),
    );

    const res = await outerApp.request(makeUrl());
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body).toHaveProperty('data');
    expect(body).toHaveProperty('total');
    expect(body).toHaveProperty('limit');
    expect(body).toHaveProperty('offset');
    expect(body.data).toBeArray();
    expect(body.total).toBe(1);
    expect(body.limit).toBe(20);
    expect(body.offset).toBe(0);
  });

  it('GET / supports pagination params', async () => {
    const { db } = createMockDb();
    const triggerEngine = createMockTriggerEngine();

    const outerApp = new Hono();
    outerApp.route(
      '/api/companies/:companyId/triggers',
      triggerRoutes({ db, triggerEngine } as never),
    );

    const res = await outerApp.request(makeUrl('?limit=10&offset=5'));
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.limit).toBe(10);
    expect(body.offset).toBe(5);
  });

  it('POST / creates trigger', async () => {
    const { db } = createMockDb();
    const triggerEngine = createMockTriggerEngine();

    const outerApp = new Hono();
    outerApp.route(
      '/api/companies/:companyId/triggers',
      triggerRoutes({ db, triggerEngine } as never),
    );

    const res = await outerApp.request(makeUrl(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Test Trigger',
        patternType: 'event_match',
        patternConfig: { eventType: 'issue.created' },
        actionType: 'wake_agent',
        actionConfig: { agentId: 'agent-1' },
        isActive: true,
        cooldownMs: 10000,
      }),
    });

    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.name).toBe('Test Trigger');
    expect(body.patternType).toBe('event_match');
    expect(body.actionType).toBe('wake_agent');
    expect(body.isActive).toBe(true);
    expect(triggerEngine.addTrigger).toHaveBeenCalledTimes(1);
  });

  it('POST / creates inactive trigger without calling triggerEngine', async () => {
    const triggerRow = makeTriggerRow({ isActive: false });
    const { db } = createMockDb(triggerRow);
    const triggerEngine = createMockTriggerEngine();

    const outerApp = new Hono();
    outerApp.route(
      '/api/companies/:companyId/triggers',
      triggerRoutes({ db, triggerEngine } as never),
    );

    const res = await outerApp.request(makeUrl(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Test Trigger',
        patternType: 'event_match',
        patternConfig: { eventType: 'issue.created' },
        actionType: 'wake_agent',
        actionConfig: { agentId: 'agent-1' },
        isActive: false,
        cooldownMs: 10000,
      }),
    });

    expect(res.status).toBe(201);
    expect(triggerEngine.addTrigger).not.toHaveBeenCalled();
  });

  it('GET /:id returns trigger detail', async () => {
    const { db } = createMockDb();
    const triggerEngine = createMockTriggerEngine();

    const outerApp = new Hono();
    outerApp.route(
      '/api/companies/:companyId/triggers',
      triggerRoutes({ db, triggerEngine } as never),
    );

    const res = await outerApp.request(makeUrl(`/${TRIGGER_ID}`));
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.id).toBe(TRIGGER_ID);
    expect(body.name).toBe('Test Trigger');
    expect(body.companyId).toBe(COMPANY_ID);
  });

  it('GET /:id returns 404 for unknown trigger', async () => {
    const { db } = createMockDbNotFound();
    const triggerEngine = createMockTriggerEngine();

    const outerApp = new Hono();
    outerApp.route(
      '/api/companies/:companyId/triggers',
      triggerRoutes({ db, triggerEngine } as never),
    );

    const res = await outerApp.request(makeUrl('/unknown-id'));
    expect(res.status).toBe(404);
  });

  it('PATCH /:id updates trigger', async () => {
    const triggerRow = makeTriggerRow();
    const { db, updateReturning } = createMockDb(triggerRow);
    updateReturning.mockReturnValue(
      Promise.resolve([{ ...triggerRow, name: 'Updated Trigger', updatedAt: new Date() }]),
    );
    const triggerEngine = createMockTriggerEngine();

    const outerApp = new Hono();
    outerApp.route(
      '/api/companies/:companyId/triggers',
      triggerRoutes({ db, triggerEngine } as never),
    );

    const res = await outerApp.request(makeUrl(`/${TRIGGER_ID}`), {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Updated Trigger' }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.name).toBe('Updated Trigger');
  });

  it('PATCH /:id deactivating trigger removes it from engine', async () => {
    const triggerRow = makeTriggerRow({ isActive: true });
    const { db, updateReturning } = createMockDb(triggerRow);
    updateReturning.mockReturnValue(
      Promise.resolve([{ ...triggerRow, isActive: false, updatedAt: new Date() }]),
    );
    const triggerEngine = createMockTriggerEngine();

    const outerApp = new Hono();
    outerApp.route(
      '/api/companies/:companyId/triggers',
      triggerRoutes({ db, triggerEngine } as never),
    );

    const res = await outerApp.request(makeUrl(`/${TRIGGER_ID}`), {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ isActive: false }),
    });

    expect(res.status).toBe(200);
    expect(triggerEngine.removeTrigger).toHaveBeenCalledWith(TRIGGER_ID);
  });

  it('PATCH /:id returns 404 for unknown trigger', async () => {
    const { db } = createMockDbNotFound();
    const triggerEngine = createMockTriggerEngine();

    const outerApp = new Hono();
    outerApp.route(
      '/api/companies/:companyId/triggers',
      triggerRoutes({ db, triggerEngine } as never),
    );

    const res = await outerApp.request(makeUrl(`/${TRIGGER_ID}`), {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Updated' }),
    });

    expect(res.status).toBe(404);
  });

  it('POST /:id/activate activates trigger', async () => {
    const triggerRow = makeTriggerRow({ isActive: false });
    const { db, updateReturning } = createMockDb(triggerRow);
    updateReturning.mockReturnValue(
      Promise.resolve([{ ...triggerRow, isActive: true, updatedAt: new Date() }]),
    );
    const triggerEngine = createMockTriggerEngine();

    const outerApp = new Hono();
    outerApp.route(
      '/api/companies/:companyId/triggers',
      triggerRoutes({ db, triggerEngine } as never),
    );

    const res = await outerApp.request(makeUrl(`/${TRIGGER_ID}/activate`), {
      method: 'POST',
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.isActive).toBe(true);
    expect(triggerEngine.addTrigger).toHaveBeenCalledTimes(1);
  });

  it('POST /:id/activate returns 404 for unknown trigger', async () => {
    const { db } = createMockDbNotFound();
    const triggerEngine = createMockTriggerEngine();

    const outerApp = new Hono();
    outerApp.route(
      '/api/companies/:companyId/triggers',
      triggerRoutes({ db, triggerEngine } as never),
    );

    const res = await outerApp.request(makeUrl(`/${TRIGGER_ID}/activate`), {
      method: 'POST',
    });

    expect(res.status).toBe(404);
  });

  it('POST /:id/deactivate deactivates trigger', async () => {
    const triggerRow = makeTriggerRow({ isActive: true });
    const { db, updateReturning } = createMockDb(triggerRow);
    updateReturning.mockReturnValue(
      Promise.resolve([{ ...triggerRow, isActive: false, updatedAt: new Date() }]),
    );
    const triggerEngine = createMockTriggerEngine();

    const outerApp = new Hono();
    outerApp.route(
      '/api/companies/:companyId/triggers',
      triggerRoutes({ db, triggerEngine } as never),
    );

    const res = await outerApp.request(makeUrl(`/${TRIGGER_ID}/deactivate`), {
      method: 'POST',
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.isActive).toBe(false);
    expect(triggerEngine.removeTrigger).toHaveBeenCalledWith(TRIGGER_ID);
  });

  it('POST /:id/deactivate returns 404 for unknown trigger', async () => {
    const { db } = createMockDbNotFound();
    const triggerEngine = createMockTriggerEngine();

    const outerApp = new Hono();
    outerApp.route(
      '/api/companies/:companyId/triggers',
      triggerRoutes({ db, triggerEngine } as never),
    );

    const res = await outerApp.request(makeUrl(`/${TRIGGER_ID}/deactivate`), {
      method: 'POST',
    });

    expect(res.status).toBe(404);
  });

  it('DELETE /:id deletes trigger', async () => {
    const { db } = createMockDb();
    const triggerEngine = createMockTriggerEngine();

    const outerApp = new Hono();
    outerApp.route(
      '/api/companies/:companyId/triggers',
      triggerRoutes({ db, triggerEngine } as never),
    );

    const res = await outerApp.request(makeUrl(`/${TRIGGER_ID}`), {
      method: 'DELETE',
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.id).toBe(TRIGGER_ID);
    expect(triggerEngine.removeTrigger).toHaveBeenCalledWith(TRIGGER_ID);
  });

  it('DELETE /:id returns 404 for unknown trigger', async () => {
    const { db } = createMockDbNotFound();
    const triggerEngine = createMockTriggerEngine();

    const outerApp = new Hono();
    outerApp.route(
      '/api/companies/:companyId/triggers',
      triggerRoutes({ db, triggerEngine } as never),
    );

    const res = await outerApp.request(makeUrl(`/${TRIGGER_ID}`), {
      method: 'DELETE',
    });

    expect(res.status).toBe(404);
  });

  it('works without triggerEngine (optional dependency)', async () => {
    const { db } = createMockDb();

    const outerApp = new Hono();
    outerApp.route('/api/companies/:companyId/triggers', triggerRoutes({ db } as never));

    const res = await outerApp.request(makeUrl());
    expect(res.status).toBe(200);
  });
});
