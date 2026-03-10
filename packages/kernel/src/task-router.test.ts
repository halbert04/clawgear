import { describe, expect, mock, test } from 'bun:test';
import { TaskRouter } from './task-router.js';

const COMPANY_ID = '550e8400-e29b-41d4-a716-446655440001';
const AGENT_ID = '660e8400-e29b-41d4-a716-446655440002';

function createMockDb(
  options: {
    candidates?: Record<string, unknown>[];
    fallbackAgent?: Record<string, unknown> | null;
    stats?: Record<string, unknown> | null;
    competences?: Record<string, unknown>[];
    allTypes?: { taskType: string }[];
  } = {},
) {
  const candidates = options.candidates ?? [];
  const fallbackAgent = options.fallbackAgent ?? null;

  return {
    select: mock((..._args: unknown[]) => ({
      from: mock((_table: unknown) => ({
        innerJoin: mock((..._j: unknown[]) => ({
          where: mock((..._w: unknown[]) => ({
            orderBy: mock((..._o: unknown[]) => ({
              limit: mock(() => candidates),
            })),
          })),
        })),
        where: mock((..._w: unknown[]) => {
          // For fallback routing
          if (fallbackAgent) return { limit: mock(() => [fallbackAgent]) };
          // For getTaskComplexity
          if (options.stats) return [options.stats];
          // For suggestTasksForAgent
          if (options.competences) return options.competences;
          return [];
        }),
        groupBy: mock(() => {
          if (options.allTypes) return options.allTypes;
          return [];
        }),
        orderBy: mock((..._o: unknown[]) => ({
          limit: mock(() => candidates),
        })),
      })),
    })),
  };
}

describe('TaskRouter', () => {
  test('routeTask returns best competent agent', async () => {
    const candidates = [
      {
        agentId: AGENT_ID,
        agentName: 'ReviewBot',
        autonomyLevel: 'auto',
        avgQualityScore: 0.95,
        totalRuns: 50,
        successfulRuns: 48,
        agentStatus: 'idle',
      },
    ];
    const db = createMockDb({ candidates });
    const router = new TaskRouter({ db: db as never });

    const result = await router.routeTask(COMPANY_ID, 'code_review');
    expect(result).not.toBeNull();
    expect(result!.agentId).toBe(AGENT_ID);
    expect(result!.agentName).toBe('ReviewBot');
    expect(result!.reason).toContain('Best competence');
  });

  test('routeTask falls back when no competence data', async () => {
    const db = createMockDb({
      candidates: [],
      fallbackAgent: { id: AGENT_ID, name: 'DefaultAgent' },
    });
    const router = new TaskRouter({ db: db as never });

    const result = await router.routeTask(COMPANY_ID, 'unknown_task');
    expect(result).not.toBeNull();
    expect(result!.reason).toContain('No competence data');
  });

  test('routeTask returns null when no agents available', async () => {
    // Override the select chain to return empty for fallback too
    const mockDb = {
      select: mock(() => ({
        from: mock(() => ({
          innerJoin: mock(() => ({
            where: mock(() => ({
              orderBy: mock(() => ({
                limit: mock(() => []),
              })),
            })),
          })),
          where: mock(() => ({
            limit: mock(() => []),
          })),
        })),
      })),
    };

    const router = new TaskRouter({ db: mockDb as never });
    const result = await router.routeTask(COMPANY_ID, 'code_review');
    expect(result).toBeNull();
  });

  test('rankAgents returns sorted list', async () => {
    const candidates = [
      {
        agentId: '1',
        agentName: 'TopBot',
        autonomyLevel: 'auto',
        avgQualityScore: 0.95,
        totalRuns: 50,
        successfulRuns: 48,
      },
      {
        agentId: '2',
        agentName: 'MidBot',
        autonomyLevel: 'semi_auto',
        avgQualityScore: 0.75,
        totalRuns: 20,
        successfulRuns: 16,
      },
    ];
    const db = createMockDb({ candidates });
    const router = new TaskRouter({ db: db as never });

    const results = await router.rankAgents(COMPANY_ID, 'code_review');
    expect(results.length).toBe(2);
    expect(results[0]!.agentId).toBe('1');
  });

  test('getTaskComplexity returns moderate for unknown tasks', async () => {
    const db = createMockDb({
      stats: {
        avgQuality: 0,
        avgDuration: 0,
        avgCost: 0,
        totalRunsAcrossAgents: 0,
        avgSuccessRate: 0,
      },
    });
    const router = new TaskRouter({ db: db as never });

    const complexity = await router.getTaskComplexity(COMPANY_ID, 'new_task');
    expect(complexity).toBe('moderate');
  });
});
