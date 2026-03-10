import { describe, expect, mock, test } from 'bun:test';
import type { EventBus, SystemEvent } from '@clawgear/shared/interfaces';
import { PromptOptimizer } from './prompt-optimizer.js';

function createMockEventBus(): EventBus & { emittedEvents: SystemEvent[] } {
  const emittedEvents: SystemEvent[] = [];
  return {
    emittedEvents,
    emit: mock((event: SystemEvent) => {
      emittedEvents.push(event);
    }),
    on: mock(() => ({ unsubscribe: mock(() => {}) })),
    once: mock(() => ({ unsubscribe: mock(() => {}) })),
  };
}

const COMPANY_ID = '550e8400-e29b-41d4-a716-446655440001';
const VERSION_ID = '770e8400-e29b-41d4-a716-446655440003';

function createMockDb(
  options: {
    evalCount?: number;
    maxVersion?: number;
    activeVersion?: Record<string, unknown> | null;
    abVersion?: Record<string, unknown> | null;
    version?: Record<string, unknown> | null;
  } = {},
) {
  const evalCount = options.evalCount ?? 0;
  const maxVersion = options.maxVersion ?? 0;

  let selectCount = 0;

  return {
    select: mock((..._args: unknown[]) => ({
      from: mock((_table: unknown) => ({
        where: mock((..._w: unknown[]) => {
          selectCount++;
          if (selectCount === 1) return [{ count: evalCount }];
          if (selectCount === 2) return [{ maxVersion }];
          if (options.version) return [options.version];
          if (options.activeVersion) return [options.activeVersion];
          return [];
        }),
        orderBy: mock(() => ({
          limit: mock(() => {
            if (options.abVersion) return [options.abVersion];
            return [];
          }),
        })),
        limit: mock(() => {
          if (options.abVersion) return [options.abVersion];
          if (options.activeVersion) return [options.activeVersion];
          return [];
        }),
      })),
    })),
    insert: mock((_table: unknown) => ({
      values: mock((vals: Record<string, unknown>) => ({
        returning: mock(() => [{ id: VERSION_ID, ...vals }]),
      })),
    })),
    update: mock((_table: unknown) => ({
      set: mock((_vals: Record<string, unknown>) => ({
        where: mock(() => ({
          returning: mock(() => []),
        })),
      })),
    })),
  };
}

describe('PromptOptimizer', () => {
  test('hasEnoughData returns false with insufficient examples', async () => {
    const db = createMockDb({ evalCount: 50 });
    const eventBus = createMockEventBus();
    const optimizer = new PromptOptimizer({
      db: db as never,
      eventBus,
      minExamplesForOptimization: 100,
    });

    const result = await optimizer.hasEnoughData(COMPANY_ID, 'engineer');
    expect(result).toBe(false);
  });

  test('hasEnoughData returns true with sufficient examples', async () => {
    const db = createMockDb({ evalCount: 150 });
    const eventBus = createMockEventBus();
    const optimizer = new PromptOptimizer({
      db: db as never,
      eventBus,
      minExamplesForOptimization: 100,
    });

    const result = await optimizer.hasEnoughData(COMPANY_ID, 'engineer');
    expect(result).toBe(true);
  });

  test('createOptimizedVersion inserts new version with A/B testing', async () => {
    // Custom mock: createOptimizedVersion only does one select (for maxVersion)
    const db = {
      select: mock((..._args: unknown[]) => ({
        from: mock((_table: unknown) => ({
          where: mock((..._w: unknown[]) => [{ maxVersion: 3 }]),
        })),
      })),
      insert: mock((_table: unknown) => ({
        values: mock((vals: Record<string, unknown>) => ({
          returning: mock(() => [{ id: VERSION_ID, ...vals }]),
        })),
      })),
    };
    const eventBus = createMockEventBus();
    const optimizer = new PromptOptimizer({
      db: db as never,
      eventBus,
      abTrafficPercent: 10,
    });

    const result = await optimizer.createOptimizedVersion(
      COMPANY_ID,
      'engineer',
      'heartbeat',
      'Optimized prompt content...',
    );

    expect(result.versionId).toBe(VERSION_ID);
    expect(result.version).toBe(4);
    expect(db.insert).toHaveBeenCalled();
    expect(eventBus.emittedEvents.length).toBe(1);
    expect(eventBus.emittedEvents[0]!.type).toBe('evolution.prompt_optimized');
  });

  test('recordResult does not rollback when score is good', async () => {
    const db = createMockDb({
      version: {
        id: VERSION_ID,
        companyId: COMPANY_ID,
        agentRole: 'engineer',
        promptType: 'heartbeat',
        version: 4,
        evaluationScore: 0.8,
        isAbTesting: true,
        sampleCount: 15,
      },
    });
    const eventBus = createMockEventBus();
    const optimizer = new PromptOptimizer({
      db: db as never,
      eventBus,
      regressionThreshold: 0.05,
    });

    const result = await optimizer.recordResult(VERSION_ID, 0.85);
    expect(result.rolledBack).toBe(false);
  });

  test('promoteVersion activates and stops A/B testing', async () => {
    const db = createMockDb({
      version: {
        id: VERSION_ID,
        companyId: COMPANY_ID,
        agentRole: 'engineer',
        promptType: 'heartbeat',
      },
    });
    const eventBus = createMockEventBus();
    const optimizer = new PromptOptimizer({ db: db as never, eventBus });

    await optimizer.promoteVersion(VERSION_ID);
    expect(db.update).toHaveBeenCalled();
  });

  test('rollbackVersion stops A/B testing and emits event', async () => {
    const db = createMockDb({
      version: {
        id: VERSION_ID,
        companyId: COMPANY_ID,
        agentRole: 'engineer',
        promptType: 'heartbeat',
        version: 4,
        evaluationScore: 0.5,
      },
    });
    const eventBus = createMockEventBus();
    const optimizer = new PromptOptimizer({ db: db as never, eventBus });

    await optimizer.rollbackVersion(VERSION_ID);
    expect(eventBus.emittedEvents.length).toBe(1);
    expect(eventBus.emittedEvents[0]!.type).toBe('evolution.prompt_rollback');
  });
});
