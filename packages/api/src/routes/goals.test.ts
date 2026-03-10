import { InProcessEventBus } from '@clawgear/kernel';
import { describe, expect, mock, test } from 'bun:test';
import { Hono } from 'hono';
import { errorHandler } from '../middleware/error-handler.js';
import { goalRoutes } from './goals.js';

const COMPANY_ID = '550e8400-e29b-41d4-a716-446655440001';
const GOAL_ID = '660e8400-e29b-41d4-a716-446655440010';
const PARENT_GOAL_ID = '660e8400-e29b-41d4-a716-446655440020';
const ROOT_GOAL_ID = '660e8400-e29b-41d4-a716-446655440030';

function makeGoalRow(overrides: Record<string, unknown> = {}) {
  return {
    id: GOAL_ID,
    companyId: COMPANY_ID,
    parentId: null,
    level: 'team',
    status: 'active',
    ownerAgentId: null,
    title: 'Ship v2',
    description: null,
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
    ...overrides,
  };
}

/**
 * Build a mock DB tailored to goal routes.
 * `selectResults` controls what `select().from().where()` returns for
 * successive calls (shifts from the front each time).
 */
function createMockDb(selectResults?: unknown[][]) {
  const resultQueue = selectResults ? [...selectResults] : undefined;

  const goalRow = makeGoalRow();

  const insertReturning = mock(() => [goalRow]);
  const insertValues = mock(() => ({ returning: insertReturning }));
  const insertFn = mock(() => ({ values: insertValues }));

  const updateReturning = mock(() => [{ ...goalRow, title: 'Updated Goal', updatedAt: new Date() }]);
  const updateWhere = mock(() => ({ returning: updateReturning }));
  const updateSet = mock(() => ({ where: updateWhere }));
  const updateFn = mock(() => ({ set: updateSet }));

  const selectWhere = mock(() => {
    if (resultQueue && resultQueue.length > 0) return resultQueue.shift()!;
    return [goalRow];
  });
  const selectFrom = mock(() => ({ where: selectWhere }));

  const db = {
    insert: insertFn,
    select: mock(() => ({ from: selectFrom })),
    update: updateFn,
  };

  return { db, goalRow };
}

function createTestApp(db: unknown, eventBus: InProcessEventBus) {
  const app = new Hono();
  app.onError(errorHandler);
  app.route(
    `/api/companies/:companyId/goals`,
    goalRoutes({ db: db as never, eventBus }),
  );
  return app;
}

describe('Goal Routes', () => {
  test('POST creates a goal', async () => {
    const { db } = createMockDb();
    const eventBus = new InProcessEventBus();
    const emitSpy = mock(() => {});
    eventBus.emit = emitSpy;
    const app = createTestApp(db, eventBus);

    const res = await app.request(`/api/companies/${COMPANY_ID}/goals`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Ship v2', level: 'team' }),
    });

    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.title).toBe('Ship v2');
    expect(body.level).toBe('team');
    expect(emitSpy).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'goal.created' }),
    );
  });

  test('POST validates level relative to parent', async () => {
    // Parent is "team", child tries "company" which is shallower -> should fail
    const parentRow = makeGoalRow({ id: PARENT_GOAL_ID, level: 'team' });
    const { db } = createMockDb([[parentRow]]);
    const eventBus = new InProcessEventBus();
    const app = createTestApp(db, eventBus);

    const res = await app.request(`/api/companies/${COMPANY_ID}/goals`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: 'Bad child',
        level: 'company',
        parentId: PARENT_GOAL_ID,
      }),
    });

    expect(res.status).toBe(400);
  });

  test('GET lists goals for a company', async () => {
    const { db, goalRow } = createMockDb();
    const eventBus = new InProcessEventBus();
    const app = createTestApp(db, eventBus);

    const res = await app.request(`/api/companies/${COMPANY_ID}/goals`);

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data).toBeArray();
    expect(body.data.length).toBe(1);
    expect(body.data[0].title).toBe(goalRow.title);
  });

  test('GET lists goals filtered by parentId', async () => {
    const childRow = makeGoalRow({ parentId: PARENT_GOAL_ID });
    const { db } = createMockDb([[childRow]]);
    const eventBus = new InProcessEventBus();
    const app = createTestApp(db, eventBus);

    const res = await app.request(
      `/api/companies/${COMPANY_ID}/goals?parentId=${PARENT_GOAL_ID}`,
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data).toBeArray();
  });

  test('GET /:id returns a goal', async () => {
    const { db, goalRow } = createMockDb();
    const eventBus = new InProcessEventBus();
    const app = createTestApp(db, eventBus);

    const res = await app.request(
      `/api/companies/${COMPANY_ID}/goals/${goalRow.id}`,
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.title).toBe('Ship v2');
  });

  test('GET /:id returns 404 for missing goal', async () => {
    const { db } = createMockDb([[]]);
    const eventBus = new InProcessEventBus();
    const app = createTestApp(db, eventBus);

    const res = await app.request(
      `/api/companies/${COMPANY_ID}/goals/550e8400-e29b-41d4-a716-446655440099`,
    );

    expect(res.status).toBe(404);
  });

  test('PATCH /:id updates a goal', async () => {
    const { db } = createMockDb();
    const eventBus = new InProcessEventBus();
    const emitSpy = mock(() => {});
    eventBus.emit = emitSpy;
    const app = createTestApp(db, eventBus);

    const res = await app.request(
      `/api/companies/${COMPANY_ID}/goals/${GOAL_ID}`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: 'Updated Goal' }),
      },
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.title).toBe('Updated Goal');
    expect(emitSpy).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'goal.updated' }),
    );
  });

  test('PATCH /:id returns 404 for missing goal', async () => {
    // Override update to return empty (no rows matched)
    const { db } = createMockDb();
    const updateReturning = mock(() => []);
    const updateWhere = mock(() => ({ returning: updateReturning }));
    const updateSet = mock(() => ({ where: updateWhere }));
    db.update = mock(() => ({ set: updateSet }));
    const eventBus = new InProcessEventBus();
    const app = createTestApp(db, eventBus);

    const res = await app.request(
      `/api/companies/${COMPANY_ID}/goals/550e8400-e29b-41d4-a716-446655440099`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: 'Nope' }),
      },
    );

    expect(res.status).toBe(404);
  });

  test('GET /:id/ancestry returns parent chain from leaf to root', async () => {
    const leafRow = makeGoalRow({
      id: GOAL_ID,
      parentId: PARENT_GOAL_ID,
      level: 'agent',
      title: 'Leaf',
    });
    const midRow = makeGoalRow({
      id: PARENT_GOAL_ID,
      parentId: ROOT_GOAL_ID,
      level: 'team',
      title: 'Mid',
    });
    const rootRow = makeGoalRow({
      id: ROOT_GOAL_ID,
      parentId: null,
      level: 'company',
      title: 'Root',
    });

    // Call order: first select finds the leaf, second finds mid parent, third finds root
    const { db } = createMockDb([[leafRow], [midRow], [rootRow]]);
    const eventBus = new InProcessEventBus();
    const app = createTestApp(db, eventBus);

    const res = await app.request(
      `/api/companies/${COMPANY_ID}/goals/${GOAL_ID}/ancestry`,
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data).toBeArray();
    expect(body.data.length).toBe(3);
    expect(body.data[0].title).toBe('Leaf');
    expect(body.data[1].title).toBe('Mid');
    expect(body.data[2].title).toBe('Root');
  });

  test('GET /:id/ancestry returns 404 for missing goal', async () => {
    const { db } = createMockDb([[]]);
    const eventBus = new InProcessEventBus();
    const app = createTestApp(db, eventBus);

    const res = await app.request(
      `/api/companies/${COMPANY_ID}/goals/550e8400-e29b-41d4-a716-446655440099/ancestry`,
    );

    expect(res.status).toBe(404);
  });
});
