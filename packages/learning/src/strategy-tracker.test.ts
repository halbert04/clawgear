import { describe, expect, mock, test } from 'bun:test';
import type { EventBus, SystemEvent } from '@clawgear/shared/interfaces';
import { StrategyTracker } from './strategy-tracker.js';

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
const AGENT_ID = '660e8400-e29b-41d4-a716-446655440002';
const PATTERN_ID = '770e8400-e29b-41d4-a716-446655440003';

function createMockDb(
  options: {
    existingPattern?: Record<string, unknown> | null;
    patterns?: Record<string, unknown>[];
  } = {},
) {
  return {
    select: mock((..._args: unknown[]) => ({
      from: mock((_table: unknown) => ({
        where: mock((..._w: unknown[]) => {
          if (options.existingPattern) return [options.existingPattern];
          if (options.patterns) {
            return {
              orderBy: mock((..._o: unknown[]) => ({
                limit: mock(() => options.patterns),
              })),
            };
          }
          return [];
        }),
        orderBy: mock(() => {
          if (options.patterns) return options.patterns;
          return [];
        }),
      })),
    })),
    insert: mock((_table: unknown) => ({
      values: mock((vals: Record<string, unknown>) => ({
        returning: mock(() => [{ id: PATTERN_ID, ...vals }]),
      })),
    })),
    update: mock((_table: unknown) => ({
      set: mock((_vals: Record<string, unknown>) => ({
        where: mock(() => ({})),
      })),
    })),
  };
}

describe('StrategyTracker', () => {
  test('recordPattern creates new pattern when none exists', async () => {
    const db = createMockDb();
    const eventBus = createMockEventBus();
    const tracker = new StrategyTracker({ db: db as never, eventBus });

    const result = await tracker.recordPattern({
      companyId: COMPANY_ID,
      agentId: AGENT_ID,
      patternType: 'delegation',
      description: 'Delegate code review to most experienced agent',
      succeeded: true,
      contextJson: { taskType: 'code_review' },
    });

    expect(result.patternId).toBe(PATTERN_ID);
    expect(db.insert).toHaveBeenCalled();
  });

  test('recordPattern updates existing pattern counts', async () => {
    const db = createMockDb({
      existingPattern: {
        id: PATTERN_ID,
        companyId: COMPANY_ID,
        agentId: AGENT_ID,
        patternType: 'delegation',
        description: 'Delegate code review to most experienced agent',
        successCount: 3,
        failureCount: 1,
        confidence: 0.75,
      },
    });
    const eventBus = createMockEventBus();
    const tracker = new StrategyTracker({ db: db as never, eventBus });

    const result = await tracker.recordPattern({
      companyId: COMPANY_ID,
      agentId: AGENT_ID,
      patternType: 'delegation',
      description: 'Delegate code review to most experienced agent',
      succeeded: true,
      contextJson: {},
    });

    expect(result.patternId).toBe(PATTERN_ID);
    expect(db.update).toHaveBeenCalled();
    expect(eventBus.emittedEvents.length).toBe(1);
    expect(eventBus.emittedEvents[0]!.type).toBe('evolution.strategy_reinforced');
  });

  test('getEffectivePatterns returns patterns ordered by confidence', async () => {
    const patterns = [
      { id: '1', confidence: 0.9, description: 'Pattern A' },
      { id: '2', confidence: 0.7, description: 'Pattern B' },
    ];
    // getEffectivePatterns chains: select().from().where().orderBy().limit()
    const db = {
      select: mock((..._args: unknown[]) => ({
        from: mock((_table: unknown) => ({
          where: mock((..._w: unknown[]) => ({
            orderBy: mock((..._o: unknown[]) => ({
              limit: mock(() => patterns),
            })),
          })),
        })),
      })),
    };
    const eventBus = createMockEventBus();
    const tracker = new StrategyTracker({ db: db as never, eventBus });

    const result = await tracker.getEffectivePatterns(COMPANY_ID, 'delegation');
    expect(result.length).toBe(2);
  });

  test('getAgentPatterns returns patterns for a specific agent', async () => {
    const patterns = [{ id: '1', agentId: AGENT_ID, patternType: 'delegation' }];
    // getAgentPatterns chains: select().from().where().orderBy()
    const db = {
      select: mock((..._args: unknown[]) => ({
        from: mock((_table: unknown) => ({
          where: mock((..._w: unknown[]) => ({
            orderBy: mock((..._o: unknown[]) => patterns),
          })),
        })),
      })),
    };
    const eventBus = createMockEventBus();
    const tracker = new StrategyTracker({ db: db as never, eventBus });

    const result = await tracker.getAgentPatterns(COMPANY_ID, AGENT_ID);
    expect(result.length).toBe(1);
  });
});
