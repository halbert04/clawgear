import { InProcessEventBus } from '@clawgear/kernel';
import { describe, expect, mock, test } from 'bun:test';
import { Hono } from 'hono';
import { errorHandler } from '../middleware/error-handler.js';
import { approvalRoutes } from './approvals.js';

const COMPANY_ID = '550e8400-e29b-41d4-a716-446655440001';
const AGENT_ID = '550e8400-e29b-41d4-a716-446655440002';
const APPROVAL_ID = '550e8400-e29b-41d4-a716-446655440020';

function createApprovalPayload(overrides: Record<string, unknown> = {}) {
  return {
    type: 'hire_agent',
    requestedByAgentId: AGENT_ID,
    payload: { reason: 'Need more help' },
    ...overrides,
  };
}

function createMockDb(opts: { approvalStatus?: string } = {}) {
  const { approvalStatus = 'pending' } = opts;

  const approvalRow = {
    id: APPROVAL_ID,
    companyId: COMPANY_ID,
    type: 'hire_agent',
    status: approvalStatus,
    requestedByAgentId: AGENT_ID,
    payload: { reason: 'Need more help' },
    decidedByUserId: null,
    decidedByAgentId: null,
    decisionNote: null,
    decidedAt: null,
    createdAt: new Date('2026-01-01'),
  };

  const decidedRow = {
    ...approvalRow,
    status: 'approved',
    decidedByUserId: 'user-1',
    decisionNote: 'Looks good',
    decidedAt: new Date('2026-01-02'),
  };

  const insertReturning = mock(() => [approvalRow]);
  const insertValues = mock(() => ({ returning: insertReturning }));
  const insertFn = mock(() => ({ values: insertValues }));

  const updateReturning = mock(() => [decidedRow]);
  const updateWhere = mock(() => ({ returning: updateReturning }));
  const updateSet = mock(() => ({ where: updateWhere }));
  const updateFn = mock(() => ({ set: updateSet }));

  const selectLimit = mock(() => ({ offset: mock(() => [approvalRow]) }));
  const selectWhere = mock(() => {
    const result = [approvalRow] as unknown[];
    (result as unknown as Record<string, unknown>).limit = selectLimit;
    return result;
  });
  const selectFrom = mock(() => ({
    where: selectWhere,
    limit: selectLimit,
  }));

  const db = {
    insert: insertFn,
    update: updateFn,
    select: mock((...args: unknown[]) => {
      // Aggregation query (count)
      if (args.length > 0) {
        return {
          from: mock(() => ({
            where: mock(() => [{ count: 1 }]),
          })),
        };
      }
      return { from: selectFrom };
    }),
    execute: mock(() => Promise.resolve([{ '?column?': 1 }])),
  };

  return { db, approvalRow, decidedRow };
}

function buildApp(db: unknown, eventBus: InProcessEventBus) {
  const wrapper = new Hono();
  wrapper.onError(errorHandler);
  wrapper.route('/api/companies/:companyId/approvals', approvalRoutes({ db: db as never, eventBus }));
  return wrapper;
}

describe('Approval Routes', () => {
  test('POST / creates an approval request', async () => {
    const { db } = createMockDb();
    const eventBus = new InProcessEventBus();
    const emitSpy = mock(() => {});
    eventBus.emit = emitSpy;
    const app = buildApp(db, eventBus);

    const res = await app.request(`/api/companies/${COMPANY_ID}/approvals`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(createApprovalPayload()),
    });

    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.type).toBe('hire_agent');
    expect(body.status).toBe('pending');
    expect(emitSpy).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'approval.requested' }),
    );
  });

  test('GET / lists pending approvals', async () => {
    const { db } = createMockDb();
    const eventBus = new InProcessEventBus();
    const app = buildApp(db, eventBus);

    const res = await app.request(`/api/companies/${COMPANY_ID}/approvals`);

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data).toBeArray();
    expect(body.total).toBe(1);
    expect(body.limit).toBe(20);
    expect(body.offset).toBe(0);
  });

  test('GET /:id returns approval detail', async () => {
    const { db } = createMockDb();
    const eventBus = new InProcessEventBus();
    const app = buildApp(db, eventBus);

    const res = await app.request(`/api/companies/${COMPANY_ID}/approvals/${APPROVAL_ID}`);

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.id).toBe(APPROVAL_ID);
    expect(body.type).toBe('hire_agent');
  });

  test('POST /:id/decide approves a pending approval', async () => {
    const { db } = createMockDb({ approvalStatus: 'pending' });
    const eventBus = new InProcessEventBus();
    const emitSpy = mock(() => {});
    eventBus.emit = emitSpy;
    const app = buildApp(db, eventBus);

    const res = await app.request(`/api/companies/${COMPANY_ID}/approvals/${APPROVAL_ID}/decide`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        status: 'approved',
        decidedByUserId: 'user-1',
        decisionNote: 'Looks good',
      }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe('approved');
    expect(emitSpy).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'approval.decided' }),
    );
  });

  test('POST /:id/decide returns 409 for already decided approval', async () => {
    const { db } = createMockDb({ approvalStatus: 'approved' });
    const eventBus = new InProcessEventBus();
    const app = buildApp(db, eventBus);

    const res = await app.request(`/api/companies/${COMPANY_ID}/approvals/${APPROVAL_ID}/decide`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        status: 'rejected',
        decisionNote: 'Changed my mind',
      }),
    });

    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error).toContain('already approved');
  });

  test('POST /:id/decide returns 404 for missing approval', async () => {
    const { db } = createMockDb();
    // Override select to return empty for the detail query
    db.select = mock((...args: unknown[]) => {
      if (args.length > 0) {
        return {
          from: mock(() => ({
            where: mock(() => [{ count: 0 }]),
          })),
        };
      }
      return {
        from: mock(() => ({
          where: mock(() => []),
          limit: mock(() => ({ offset: mock(() => []) })),
        })),
      };
    });
    const eventBus = new InProcessEventBus();
    const app = buildApp(db, eventBus);

    const res = await app.request(`/api/companies/${COMPANY_ID}/approvals/550e8400-e29b-41d4-a716-446655440099/decide`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        status: 'approved',
      }),
    });

    expect(res.status).toBe(404);
  });

  test('POST / returns 400 on invalid data', async () => {
    const { db } = createMockDb();
    const eventBus = new InProcessEventBus();
    const app = buildApp(db, eventBus);

    const res = await app.request(`/api/companies/${COMPANY_ID}/approvals`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'invalid_type' }), // invalid approval type
    });

    expect(res.status).toBe(400);
  });
});
