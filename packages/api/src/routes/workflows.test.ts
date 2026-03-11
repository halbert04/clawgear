import { describe, expect, it, mock } from 'bun:test';
import { Hono } from 'hono';
import { workflowRoutes, workflowRunRoutes } from './workflows.js';

const COMPANY_ID = '550e8400-e29b-41d4-a716-446655440001';
const WORKFLOW_ID = '550e8400-e29b-41d4-a716-446655440002';
const RUN_ID = '550e8400-e29b-41d4-a716-446655440003';
const AGENT_ID = '550e8400-e29b-41d4-a716-446655440004';

function makeWorkflowRow(overrides: Record<string, unknown> = {}) {
  return {
    id: WORKFLOW_ID,
    companyId: COMPANY_ID,
    name: 'Test Workflow',
    description: null,
    definition: {
      steps: [
        {
          name: 'step-1',
          mode: 'sequential',
          agentId: AGENT_ID,
          prompt: 'do stuff',
        },
      ],
    },
    isActive: true,
    createdByAgentId: null,
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
    ...overrides,
  };
}

function makeRunRow(overrides: Record<string, unknown> = {}) {
  return {
    id: RUN_ID,
    companyId: COMPANY_ID,
    workflowId: WORKFLOW_ID,
    status: 'running',
    inputVars: {},
    outputVars: {},
    currentStepIndex: 0,
    totalSteps: 1,
    startedAt: new Date('2026-01-01'),
    finishedAt: null,
    createdAt: new Date('2026-01-01'),
    ...overrides,
  };
}

function makeStepRunRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'step-run-1',
    workflowRunId: RUN_ID,
    stepIndex: 0,
    stepName: 'step-1',
    status: 'running',
    agentId: AGENT_ID,
    inputVars: {},
    outputVars: {},
    logs: [],
    error: null,
    startedAt: new Date('2026-01-01'),
    finishedAt: null,
    createdAt: new Date('2026-01-01'),
    ...overrides,
  };
}

function createMockDbForWorkflows(workflowRow = makeWorkflowRow(), runRow = makeRunRow()) {
  // Insert chain: insert(table).values(v).returning()
  const insertReturning = mock(() => Promise.resolve([workflowRow]));
  const insertValues = mock(() => ({ returning: insertReturning }));
  const insertFn = mock(() => ({ values: insertValues }));

  // Select chain: select().from(table).where(cond).orderBy(col).limit(n).offset(m)
  const selectOffset = mock(() => Promise.resolve([workflowRow]));
  const selectLimit = mock(() => ({ offset: selectOffset }));
  const selectOrderBy = mock(() => ({ limit: selectLimit }));
  const selectWhere = mock(() => {
    // For detail queries (without orderBy)
    const result = Promise.resolve([workflowRow]) as unknown as Promise<(typeof workflowRow)[]> & {
      orderBy: typeof selectOrderBy;
      limit: typeof selectLimit;
    };
    result.orderBy = selectOrderBy;
    result.limit = selectLimit;
    return result;
  });
  const selectFrom = mock(() => ({ where: selectWhere }));

  // Count query: select({ total: count() }).from(table).where(cond)
  const countSelectWhere = mock(() => Promise.resolve([{ total: 1 }]));
  const countSelectFrom = mock(() => ({ where: countSelectWhere }));

  // Update chain: update(table).set(v).where(cond).returning()
  const updateReturning = mock(() => Promise.resolve([{ ...workflowRow, updatedAt: new Date() }]));
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
  };

  return {
    db,
    workflowRow,
    runRow,
    insertReturning,
    updateReturning,
    selectWhere,
  };
}

function createMockDbForRuns(runRow = makeRunRow(), stepRunRow = makeStepRunRow()) {
  // Select chain for runs
  const selectOffset = mock(() => Promise.resolve([runRow]));
  const selectLimit = mock(() => ({ offset: selectOffset }));
  const selectOrderBy = mock(() => ({ limit: selectLimit }));
  const selectWhere = mock(() => {
    const result = Promise.resolve([runRow]) as unknown as Promise<(typeof runRow)[]> & {
      orderBy: typeof selectOrderBy;
      limit: typeof selectLimit;
    };
    result.orderBy = selectOrderBy;
    result.limit = selectLimit;
    return result;
  });
  const selectFrom = mock(() => ({ where: selectWhere, orderBy: selectOrderBy }));

  // Count query
  const countSelectWhere = mock(() => Promise.resolve([{ total: 1 }]));
  const countSelectFrom = mock(() => ({ where: countSelectWhere }));

  const db = {
    select: mock((...args: unknown[]) => {
      if (args.length > 0) return { from: countSelectFrom };
      return { from: selectFrom };
    }),
  };

  return {
    db,
    runRow,
    stepRunRow,
    selectWhere,
  };
}

function createMockDbForRunDetail(runRow = makeRunRow(), stepRunRow = makeStepRunRow()) {
  // Select for run detail
  const selectWhere = mock((_condition: unknown) => {
    // If it's for workflow_step_runs (checking by table reference would be complex, use promise behavior)
    return Promise.resolve([runRow]);
  });
  const selectFrom = mock(() => ({
    where: selectWhere,
    orderBy: mock(() => Promise.resolve([stepRunRow])),
  }));

  const db = {
    select: mock(() => ({ from: selectFrom })),
  };

  return {
    db,
    runRow,
    stepRunRow,
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
      limit: typeof selectLimit;
    };
    result.orderBy = selectOrderBy;
    result.limit = selectLimit;
    return result;
  });
  const emptySelectFrom = mock(() => ({ where: emptySelectWhere, orderBy: selectOrderBy }));

  const countSelectWhere = mock(() => Promise.resolve([{ total: 0 }]));
  const countSelectFrom = mock(() => ({ where: countSelectWhere }));

  const updateReturning = mock(() => Promise.resolve([]));
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
  };

  return { db };
}

function createMockWorkflowEngine() {
  return {
    execute: mock(() => Promise.resolve({ runId: RUN_ID })),
    cancelRun: mock(() => Promise.resolve()),
  };
}

function makeWorkflowUrl(path = '') {
  return `/api/companies/${COMPANY_ID}/workflows${path}`;
}

function makeRunUrl(path = '') {
  return `/api/companies/${COMPANY_ID}/workflow-runs${path}`;
}

describe('workflowRoutes', () => {
  it('exports a workflowRoutes function', () => {
    expect(typeof workflowRoutes).toBe('function');
  });

  it('creates a Hono app with routes', () => {
    const { db } = createMockDbForWorkflows();
    const workflowEngine = createMockWorkflowEngine();
    const app = workflowRoutes({ db, workflowEngine } as never);
    expect(app).toBeDefined();
  });

  it('GET / returns paginated workflow list', async () => {
    const { db } = createMockDbForWorkflows();
    const workflowEngine = createMockWorkflowEngine();

    const outerApp = new Hono();
    outerApp.route(
      '/api/companies/:companyId/workflows',
      workflowRoutes({ db, workflowEngine } as never),
    );

    const res = await outerApp.request(makeWorkflowUrl());
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
    const { db } = createMockDbForWorkflows();
    const workflowEngine = createMockWorkflowEngine();

    const outerApp = new Hono();
    outerApp.route(
      '/api/companies/:companyId/workflows',
      workflowRoutes({ db, workflowEngine } as never),
    );

    const res = await outerApp.request(makeWorkflowUrl('?limit=10&offset=5'));
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.limit).toBe(10);
    expect(body.offset).toBe(5);
  });

  it('POST / creates workflow', async () => {
    const { db } = createMockDbForWorkflows();
    const workflowEngine = createMockWorkflowEngine();

    const outerApp = new Hono();
    outerApp.route(
      '/api/companies/:companyId/workflows',
      workflowRoutes({ db, workflowEngine } as never),
    );

    const res = await outerApp.request(makeWorkflowUrl(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Test Workflow',
        definition: {
          steps: [
            {
              name: 'step-1',
              mode: 'sequential',
              agentId: AGENT_ID,
              prompt: 'do stuff',
            },
          ],
        },
        isActive: true,
      }),
    });

    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.name).toBe('Test Workflow');
    expect(body.isActive).toBe(true);
    expect(body.definition).toHaveProperty('steps');
  });

  it('GET /:id returns workflow detail', async () => {
    const { db } = createMockDbForWorkflows();
    const workflowEngine = createMockWorkflowEngine();

    const outerApp = new Hono();
    outerApp.route(
      '/api/companies/:companyId/workflows',
      workflowRoutes({ db, workflowEngine } as never),
    );

    const res = await outerApp.request(makeWorkflowUrl(`/${WORKFLOW_ID}`));
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.id).toBe(WORKFLOW_ID);
    expect(body.name).toBe('Test Workflow');
    expect(body.companyId).toBe(COMPANY_ID);
  });

  it('GET /:id returns 404 for unknown workflow', async () => {
    const { db } = createMockDbNotFound();
    const workflowEngine = createMockWorkflowEngine();

    const outerApp = new Hono();
    outerApp.route(
      '/api/companies/:companyId/workflows',
      workflowRoutes({ db, workflowEngine } as never),
    );

    const res = await outerApp.request(makeWorkflowUrl('/unknown-id'));
    expect(res.status).toBe(404);
  });

  it('PATCH /:id updates workflow', async () => {
    const workflowRow = makeWorkflowRow();
    const { db, updateReturning } = createMockDbForWorkflows(workflowRow);
    updateReturning.mockReturnValue(
      Promise.resolve([{ ...workflowRow, name: 'Updated Workflow', updatedAt: new Date() }]),
    );
    const workflowEngine = createMockWorkflowEngine();

    const outerApp = new Hono();
    outerApp.route(
      '/api/companies/:companyId/workflows',
      workflowRoutes({ db, workflowEngine } as never),
    );

    const res = await outerApp.request(makeWorkflowUrl(`/${WORKFLOW_ID}`), {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Updated Workflow' }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.name).toBe('Updated Workflow');
  });

  it('PATCH /:id returns 404 for unknown workflow', async () => {
    const { db } = createMockDbNotFound();
    const workflowEngine = createMockWorkflowEngine();

    const outerApp = new Hono();
    outerApp.route(
      '/api/companies/:companyId/workflows',
      workflowRoutes({ db, workflowEngine } as never),
    );

    const res = await outerApp.request(makeWorkflowUrl(`/${WORKFLOW_ID}`), {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Updated' }),
    });

    expect(res.status).toBe(404);
  });

  it('POST /:id/execute executes workflow', async () => {
    const { db } = createMockDbForWorkflows();
    const workflowEngine = createMockWorkflowEngine();

    const outerApp = new Hono();
    outerApp.route(
      '/api/companies/:companyId/workflows',
      workflowRoutes({ db, workflowEngine } as never),
    );

    const res = await outerApp.request(makeWorkflowUrl(`/${WORKFLOW_ID}/execute`), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ inputVars: { foo: 'bar' } }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.runId).toBe(RUN_ID);
    expect(workflowEngine.execute).toHaveBeenCalledWith(COMPANY_ID, WORKFLOW_ID, { foo: 'bar' });
  });

  it('POST /:id/execute returns 404 for unknown workflow', async () => {
    const { db } = createMockDbNotFound();
    const workflowEngine = createMockWorkflowEngine();

    const outerApp = new Hono();
    outerApp.route(
      '/api/companies/:companyId/workflows',
      workflowRoutes({ db, workflowEngine } as never),
    );

    const res = await outerApp.request(makeWorkflowUrl(`/${WORKFLOW_ID}/execute`), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ inputVars: {} }),
    });

    expect(res.status).toBe(404);
  });

  it('POST /:id/execute returns 400 when workflowEngine not available', async () => {
    const { db } = createMockDbForWorkflows();

    const outerApp = new Hono();
    outerApp.route('/api/companies/:companyId/workflows', workflowRoutes({ db } as never));

    const res = await outerApp.request(makeWorkflowUrl(`/${WORKFLOW_ID}/execute`), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ inputVars: {} }),
    });

    expect(res.status).toBe(400);
  });

  it('GET /:id/runs returns paginated runs for workflow', async () => {
    const workflowRow = makeWorkflowRow();
    const runRow = makeRunRow();
    const { db } = createMockDbForRuns(runRow);

    // Override to handle both workflow check and runs list
    let callCount = 0;
    (db as any).select = mock(() => {
      callCount++;
      if (callCount === 1) {
        // First call: check workflow exists
        return {
          from: mock(() => ({
            where: mock(() => Promise.resolve([workflowRow])),
          })),
        };
      }
      if (callCount === 2) {
        // Second call: get runs
        return {
          from: mock(() => ({
            where: mock(() => ({
              orderBy: mock(() => ({
                limit: mock(() => ({
                  offset: mock(() => Promise.resolve([runRow])),
                })),
              })),
            })),
          })),
        };
      }
      // Third call: count
      return {
        from: mock(() => ({
          where: mock(() => Promise.resolve([{ total: 1 }])),
        })),
      };
    });

    const workflowEngine = createMockWorkflowEngine();

    const outerApp = new Hono();
    outerApp.route(
      '/api/companies/:companyId/workflows',
      workflowRoutes({ db, workflowEngine } as never),
    );

    const res = await outerApp.request(makeWorkflowUrl(`/${WORKFLOW_ID}/runs`));
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body).toHaveProperty('data');
    expect(body).toHaveProperty('total');
    expect(body.data).toBeArray();
  });

  it('GET /:id/runs returns 404 for unknown workflow', async () => {
    const { db } = createMockDbNotFound();
    const workflowEngine = createMockWorkflowEngine();

    const outerApp = new Hono();
    outerApp.route(
      '/api/companies/:companyId/workflows',
      workflowRoutes({ db, workflowEngine } as never),
    );

    const res = await outerApp.request(makeWorkflowUrl(`/${WORKFLOW_ID}/runs`));
    expect(res.status).toBe(404);
  });
});

describe('workflowRunRoutes', () => {
  it('exports a workflowRunRoutes function', () => {
    expect(typeof workflowRunRoutes).toBe('function');
  });

  it('creates a Hono app with routes', () => {
    const { db } = createMockDbForRunDetail();
    const workflowEngine = createMockWorkflowEngine();
    const app = workflowRunRoutes({ db, workflowEngine } as never);
    expect(app).toBeDefined();
  });

  it('GET /:id returns run with steps', async () => {
    const runRow = makeRunRow();
    const stepRunRow = makeStepRunRow();

    // Create a more sophisticated mock for this test
    let callCount = 0;
    const db = {
      select: mock(() => ({
        from: mock(() => ({
          where: mock(() => {
            callCount++;
            if (callCount === 1) {
              // First call: get run
              return Promise.resolve([runRow]);
            }
            // Second call: get steps (with orderBy)
            return {
              orderBy: mock(() => Promise.resolve([stepRunRow])),
            };
          }),
        })),
      })),
    };

    const workflowEngine = createMockWorkflowEngine();

    const outerApp = new Hono();
    outerApp.route(
      '/api/companies/:companyId/workflow-runs',
      workflowRunRoutes({ db, workflowEngine } as never),
    );

    const res = await outerApp.request(makeRunUrl(`/${RUN_ID}`));
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.id).toBe(RUN_ID);
    expect(body.status).toBe('running');
    expect(body).toHaveProperty('steps');
    expect(body.steps).toBeArray();
  });

  it('GET /:id returns 404 for unknown run', async () => {
    const { db } = createMockDbNotFound();
    const workflowEngine = createMockWorkflowEngine();

    const outerApp = new Hono();
    outerApp.route(
      '/api/companies/:companyId/workflow-runs',
      workflowRunRoutes({ db, workflowEngine } as never),
    );

    const res = await outerApp.request(makeRunUrl('/unknown-id'));
    expect(res.status).toBe(404);
  });

  it('POST /:id/cancel cancels a running workflow', async () => {
    const runRow = makeRunRow({ status: 'running' });

    const db = {
      select: mock(() => ({
        from: mock(() => ({
          where: mock(() => Promise.resolve([runRow])),
        })),
      })),
    };

    const workflowEngine = createMockWorkflowEngine();

    const outerApp = new Hono();
    outerApp.route(
      '/api/companies/:companyId/workflow-runs',
      workflowRunRoutes({ db, workflowEngine } as never),
    );

    const res = await outerApp.request(makeRunUrl(`/${RUN_ID}/cancel`), {
      method: 'POST',
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(workflowEngine.cancelRun).toHaveBeenCalledWith(RUN_ID);
  });

  it('POST /:id/cancel returns 404 for unknown run', async () => {
    const { db } = createMockDbNotFound();
    const workflowEngine = createMockWorkflowEngine();

    const outerApp = new Hono();
    outerApp.route(
      '/api/companies/:companyId/workflow-runs',
      workflowRunRoutes({ db, workflowEngine } as never),
    );

    const res = await outerApp.request(makeRunUrl(`/${RUN_ID}/cancel`), {
      method: 'POST',
    });

    expect(res.status).toBe(404);
  });

  it('POST /:id/cancel returns 400 when workflowEngine not available', async () => {
    const runRow = makeRunRow();

    const db = {
      select: mock(() => ({
        from: mock(() => ({
          where: mock(() => Promise.resolve([runRow])),
        })),
      })),
    };

    const outerApp = new Hono();
    outerApp.route('/api/companies/:companyId/workflow-runs', workflowRunRoutes({ db } as never));

    const res = await outerApp.request(makeRunUrl(`/${RUN_ID}/cancel`), {
      method: 'POST',
    });

    expect(res.status).toBe(400);
  });
});
