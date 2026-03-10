import { describe, expect, mock, test } from 'bun:test';
import { InProcessEventBus } from '@clawgear/kernel';
import { Hono } from 'hono';
import { errorHandler } from '../middleware/error-handler.js';
import { activityRoutes } from './activity.js';

const COMPANY_ID = '550e8400-e29b-41d4-a716-446655440001';
const AGENT_ID = '550e8400-e29b-41d4-a716-446655440002';
const ACTIVITY_ID = '550e8400-e29b-41d4-a716-446655440030';

function createActivityPayload(overrides: Record<string, unknown> = {}) {
  return {
    actorType: 'agent',
    actorId: AGENT_ID,
    action: 'issue.created',
    entityType: 'issue',
    entityId: '550e8400-e29b-41d4-a716-446655440040',
    details: { title: 'Fix the bug' },
    ...overrides,
  };
}

function createMockDb() {
  const activityRow = {
    id: ACTIVITY_ID,
    companyId: COMPANY_ID,
    actorType: 'agent',
    actorId: AGENT_ID,
    action: 'issue.created',
    entityType: 'issue',
    entityId: '550e8400-e29b-41d4-a716-446655440040',
    agentId: null,
    runId: null,
    details: { title: 'Fix the bug' },
    createdAt: new Date('2026-01-01'),
  };

  const activityRow2 = {
    ...activityRow,
    id: '550e8400-e29b-41d4-a716-446655440031',
    action: 'issue.updated',
    createdAt: new Date('2026-01-02'),
  };

  const insertReturning = mock(() => [activityRow]);
  const insertValues = mock(() => ({ returning: insertReturning }));
  const insertFn = mock(() => ({ values: insertValues }));

  const db = {
    insert: insertFn,
    select: mock((...args: unknown[]) => {
      // Aggregation query (count)
      if (args.length > 0) {
        return {
          from: mock(() => ({
            where: mock(() => [{ count: 2 }]),
          })),
        };
      }
      return {
        from: mock(() => ({
          where: mock(() => ({
            orderBy: mock(() => ({
              limit: mock(() => ({
                offset: mock(() => [activityRow, activityRow2]),
              })),
            })),
          })),
          limit: mock(() => ({
            offset: mock(() => [activityRow, activityRow2]),
          })),
        })),
      };
    }),
    update: mock(() => ({
      set: mock(() => ({ where: mock(() => ({ returning: mock(() => []) })) })),
    })),
    execute: mock(() => Promise.resolve([{ '?column?': 1 }])),
  };

  return { db, activityRow, activityRow2 };
}

function buildApp(db: unknown, eventBus: InProcessEventBus) {
  const wrapper = new Hono();
  wrapper.onError(errorHandler);
  wrapper.route(
    '/api/companies/:companyId/activity',
    activityRoutes({ db: db as never, eventBus }),
  );
  return wrapper;
}

describe('Activity Routes', () => {
  test('POST / logs an activity entry', async () => {
    const { db } = createMockDb();
    const eventBus = new InProcessEventBus();
    const emitSpy = mock(() => {});
    eventBus.emit = emitSpy;
    const app = buildApp(db, eventBus);

    const res = await app.request(`/api/companies/${COMPANY_ID}/activity`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(createActivityPayload()),
    });

    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.actorType).toBe('agent');
    expect(body.action).toBe('issue.created');
    expect(body.entityType).toBe('issue');
    expect(db.insert).toHaveBeenCalled();
    expect(emitSpy).toHaveBeenCalledWith(expect.objectContaining({ type: 'activity.logged' }));
  });

  test('GET / returns paginated activity feed', async () => {
    const { db } = createMockDb();
    const eventBus = new InProcessEventBus();
    const app = buildApp(db, eventBus);

    const res = await app.request(`/api/companies/${COMPANY_ID}/activity`);

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data).toBeArray();
    expect(body.total).toBe(2);
    expect(body.limit).toBe(20);
    expect(body.offset).toBe(0);
  });

  test('GET / respects pagination params', async () => {
    const { db } = createMockDb();
    const eventBus = new InProcessEventBus();
    const app = buildApp(db, eventBus);

    const res = await app.request(`/api/companies/${COMPANY_ID}/activity?limit=5&offset=10`);

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.limit).toBe(5);
    expect(body.offset).toBe(10);
  });

  test('POST / returns 400 on invalid data', async () => {
    const { db } = createMockDb();
    const eventBus = new InProcessEventBus();
    const app = buildApp(db, eventBus);

    const res = await app.request(`/api/companies/${COMPANY_ID}/activity`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'something' }), // missing required fields
    });

    expect(res.status).toBe(400);
  });

  test('POST / accepts system actor type', async () => {
    const { db } = createMockDb();
    const eventBus = new InProcessEventBus();
    const emitSpy = mock(() => {});
    eventBus.emit = emitSpy;
    const app = buildApp(db, eventBus);

    const res = await app.request(`/api/companies/${COMPANY_ID}/activity`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(createActivityPayload({ actorType: 'system', actorId: 'event-bus' })),
    });

    expect(res.status).toBe(201);
  });
});
