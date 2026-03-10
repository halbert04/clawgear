import { describe, expect, mock, test } from 'bun:test';
import { InProcessEventBus } from '@clawgear/kernel';
import { Hono } from 'hono';
import { errorHandler } from '../middleware/error-handler.js';
import { projectRoutes } from './projects.js';

const COMPANY_ID = '550e8400-e29b-41d4-a716-446655440001';
const PROJECT_ID = '660e8400-e29b-41d4-a716-446655440002';

function makeProjectRow(overrides: Record<string, unknown> = {}) {
  return {
    id: PROJECT_ID,
    companyId: COMPANY_ID,
    goalId: null,
    leadAgentId: null,
    name: 'Project Alpha',
    description: null,
    status: 'active',
    targetDate: null,
    color: null,
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
    ...overrides,
  };
}

function makeCompanyRow() {
  return {
    id: COMPANY_ID,
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
}

function createApp(db: unknown) {
  const eventBus = new InProcessEventBus();
  const emitSpy = mock(() => {});
  eventBus.emit = emitSpy;

  const app = new Hono();
  app.onError(errorHandler);
  app.route('/api/companies/:companyId/projects', projectRoutes({ db: db as never, eventBus }));

  return { app, emitSpy };
}

describe('Project Routes', () => {
  test('POST creates a project', async () => {
    const projectRow = makeProjectRow();
    const companyRow = makeCompanyRow();

    const insertReturning = mock(() => [projectRow]);
    const insertValues = mock(() => ({ returning: insertReturning }));

    // select for company check returns company
    const db = {
      insert: mock(() => ({ values: insertValues })),
      select: mock(() => ({
        from: mock(() => ({
          where: mock(() => [companyRow]),
        })),
      })),
      update: mock(),
    };

    const { app, emitSpy } = createApp(db);

    const res = await app.request(`/api/companies/${COMPANY_ID}/projects`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Project Alpha' }),
    });

    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.name).toBe('Project Alpha');
    expect(body.companyId).toBe(COMPANY_ID);
    expect(emitSpy).toHaveBeenCalledWith(expect.objectContaining({ type: 'project.created' }));
  });

  test('POST returns 404 for missing company', async () => {
    const db = {
      insert: mock(),
      select: mock(() => ({
        from: mock(() => ({
          where: mock(() => []),
        })),
      })),
      update: mock(),
    };

    const { app } = createApp(db);

    const res = await app.request(`/api/companies/${COMPANY_ID}/projects`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Project Alpha' }),
    });

    expect(res.status).toBe(404);
  });

  test('POST returns 400 on invalid data', async () => {
    const companyRow = makeCompanyRow();
    const db = {
      insert: mock(),
      select: mock(() => ({
        from: mock(() => ({
          where: mock(() => [companyRow]),
        })),
      })),
      update: mock(),
    };

    const { app } = createApp(db);

    const res = await app.request(`/api/companies/${COMPANY_ID}/projects`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: '' }),
    });

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('Validation Error');
  });

  test('GET / returns paginated list', async () => {
    const projectRow = makeProjectRow();
    const selectOffset = mock(() => [projectRow]);
    const selectLimit = mock(() => ({ offset: selectOffset }));

    const db = {
      insert: mock(),
      select: mock((...args: unknown[]) => {
        if (args.length > 0) {
          return { from: mock(() => ({ where: mock(() => [{ count: 1 }]) })) };
        }
        return {
          from: mock(() => ({
            where: mock(() => ({
              limit: selectLimit,
            })),
          })),
        };
      }),
      update: mock(),
    };

    const { app } = createApp(db);

    const res = await app.request(`/api/companies/${COMPANY_ID}/projects`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data).toBeArray();
    expect(body.total).toBe(1);
    expect(body.limit).toBe(20);
    expect(body.offset).toBe(0);
  });

  test('GET /:id returns project', async () => {
    const projectRow = makeProjectRow();

    const db = {
      insert: mock(),
      select: mock(() => ({
        from: mock(() => ({
          where: mock(() => [projectRow]),
        })),
      })),
      update: mock(),
    };

    const { app } = createApp(db);

    const res = await app.request(`/api/companies/${COMPANY_ID}/projects/${PROJECT_ID}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.name).toBe('Project Alpha');
    expect(body.id).toBe(PROJECT_ID);
  });

  test('GET /:id returns 404 for missing project', async () => {
    const db = {
      insert: mock(),
      select: mock(() => ({
        from: mock(() => ({
          where: mock(() => []),
        })),
      })),
      update: mock(),
    };

    const { app } = createApp(db);

    const res = await app.request(`/api/companies/${COMPANY_ID}/projects/nonexistent-id`);
    expect(res.status).toBe(404);
  });

  test('PATCH /:id updates project', async () => {
    const updatedRow = makeProjectRow({ name: 'Updated Project', updatedAt: new Date() });

    const updateReturning = mock(() => [updatedRow]);
    const updateWhere = mock(() => ({ returning: updateReturning }));
    const updateSet = mock(() => ({ where: updateWhere }));

    const db = {
      insert: mock(),
      select: mock(),
      update: mock(() => ({ set: updateSet })),
    };

    const { app, emitSpy } = createApp(db);

    const res = await app.request(`/api/companies/${COMPANY_ID}/projects/${PROJECT_ID}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Updated Project' }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.name).toBe('Updated Project');
    expect(emitSpy).toHaveBeenCalledWith(expect.objectContaining({ type: 'project.updated' }));
  });

  test('PATCH /:id returns 404 for missing project', async () => {
    const updateReturning = mock(() => []);
    const updateWhere = mock(() => ({ returning: updateReturning }));
    const updateSet = mock(() => ({ where: updateWhere }));

    const db = {
      insert: mock(),
      select: mock(),
      update: mock(() => ({ set: updateSet })),
    };

    const { app } = createApp(db);

    const res = await app.request(`/api/companies/${COMPANY_ID}/projects/nonexistent-id`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Updated Project' }),
    });

    expect(res.status).toBe(404);
  });
});
