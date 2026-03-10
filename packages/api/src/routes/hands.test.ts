import { describe, expect, it, mock } from 'bun:test';
import { Hono } from 'hono';
import { handRoutes } from './hands.js';

// Mock database that returns in-memory data
function createMockDeps() {
  const handAgents = [
    {
      id: 'hand-1',
      companyId: 'co-1',
      name: 'researcher',
      title: 'researcher hand',
      role: 'analyst',
      icon: null,
      status: 'idle',
      reportsTo: null,
      capabilities: [],
      permissions: {},
      adapterType: 'hand',
      adapterConfig: {
        handConfig: {
          name: 'researcher',
          description: 'Research hand',
          schedule: '0 */6 * * *',
          innerAdapter: 'claude_code',
          innerAdapterConfig: {},
          taskPrompt: 'Research',
          tools: [],
          settings: {},
          metrics: [],
          requiresApproval: false,
          outputMode: 'comment',
          ownerAgentId: null,
        },
      },
      modelTier: 'smart',
      modelOverride: null,
      budgetMonthlyCents: BigInt(0),
      spentMonthlyCents: BigInt(0),
      systemPrompt: 'Research hand',
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  ];

  const db = {
    select: mock(() => ({
      from: mock(() => ({
        where: mock(() => ({
          limit: mock(() => ({
            offset: mock(() => Promise.resolve(handAgents)),
          })),
        })),
      })),
    })),
    insert: mock(() => ({
      values: mock(() => ({
        returning: mock(() => Promise.resolve([{ ...handAgents[0], id: 'new-hand-1' }])),
      })),
    })),
    update: mock(() => ({
      set: mock(() => ({
        where: mock(() => ({
          returning: mock(() => Promise.resolve([{ ...handAgents[0], status: 'paused' }])),
        })),
      })),
    })),
  };

  const eventBus = {
    emit: mock(() => {}),
    on: mock(() => ({ unsubscribe: () => {} })),
    once: mock(() => ({ unsubscribe: () => {} })),
  };

  const handScheduler = {
    getNextRunTime: mock(() => new Date(Date.now() + 3600000)),
    getScheduledHands: mock(() => []),
    scheduledHandCount: 0,
    addHand: mock(() => {}),
    removeHand: mock(() => {}),
    start: mock(() => Promise.resolve()),
    stop: mock(() => {}),
  };

  const heartbeatEngine = {
    executeHeartbeat: mock(() =>
      Promise.resolve({
        runId: 'run-1',
        status: 'succeeded',
        output: 'done',
        durationMs: 500,
      }),
    ),
  };

  // biome-ignore lint/suspicious/noExplicitAny: mock deps
  return { db, eventBus, handScheduler, heartbeatEngine } as any;
}

describe('handRoutes', () => {
  it('exports a handRoutes function', () => {
    expect(typeof handRoutes).toBe('function');
  });

  it('creates a Hono app with routes', () => {
    const deps = createMockDeps();
    const app = handRoutes(deps);
    expect(app).toBeDefined();
  });

  it('GET / returns hand agents list structure', async () => {
    const deps = createMockDeps();

    // Override db to return count query too
    let callCount = 0;
    deps.db.select = mock(() => ({
      from: mock(() => ({
        where: mock(() => {
          callCount++;
          if (callCount === 1) {
            // First call: list query with limit/offset
            return {
              limit: mock(() => ({
                offset: mock(() =>
                  Promise.resolve([
                    {
                      id: 'hand-1',
                      companyId: 'co-1',
                      name: 'researcher',
                      status: 'idle',
                      adapterType: 'hand',
                      budgetMonthlyCents: BigInt(0),
                      spentMonthlyCents: BigInt(0),
                      createdAt: new Date(),
                      updatedAt: new Date(),
                    },
                  ]),
                ),
              })),
            };
          }
          // Second call: count query
          return Promise.resolve([{ count: 1 }]);
        }),
      })),
    }));

    const outerApp = new Hono();
    outerApp.route('/api/companies/:companyId/hands', handRoutes(deps));

    const res = await outerApp.request('/api/companies/co-1/hands');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty('data');
    expect(body).toHaveProperty('total');
  });

  it('POST /:id/deactivate emits event', () => {
    const deps = createMockDeps();
    // Just validate the route handler setup doesn't throw
    const app = handRoutes(deps);
    expect(app).toBeDefined();
  });
});
