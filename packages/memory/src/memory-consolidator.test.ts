import { describe, expect, mock, test } from 'bun:test';
import type { EventBus, SystemEvent } from '@clawgear/shared/interfaces';
import { MemoryConsolidator } from './memory-consolidator.js';

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

function createMockDb(
  options: {
    duplicateGroups?: { taskType: string; approach: string; count: number }[];
    lessonsInGroup?: Record<string, unknown>[];
    contradictions?: { subject: string; predicate: string; count: number }[];
    contradictingFacts?: Record<string, unknown>[];
    staleLessons?: { id: string }[];
    staleFacts?: { id: string }[];
  } = {},
) {
  const duplicateGroups = options.duplicateGroups ?? [];
  const lessonsInGroup = options.lessonsInGroup ?? [];
  const staleLessons = options.staleLessons ?? [];
  const staleFacts = options.staleFacts ?? [];

  let selectCount = 0;
  const deletedIds: string[] = [];

  return {
    select: mock((..._args: unknown[]) => ({
      from: mock((_table: unknown) => ({
        where: mock((..._w: unknown[]) => {
          selectCount++;
          // mergeDuplicateLessons - first call: groupBy chain
          if (selectCount === 1 && duplicateGroups.length > 0) {
            return {
              groupBy: mock((..._g: unknown[]) => ({
                having: mock(() => duplicateGroups),
              })),
            };
          }
          // mergeDuplicateLessons - second call: orderBy chain for lessons in group
          if (selectCount === 2 && lessonsInGroup.length > 0) {
            return {
              orderBy: mock((..._o: unknown[]) => lessonsInGroup),
            };
          }
          // validateFacts - groupBy chain for contradictions
          if (options.contradictions && selectCount === 3) {
            return {
              groupBy: mock((..._g: unknown[]) => ({
                having: mock(() => options.contradictions),
              })),
            };
          }
          // validateFacts - orderBy chain for contradicting facts
          if (options.contradictingFacts && selectCount === 4) {
            return {
              orderBy: mock((..._o: unknown[]) => options.contradictingFacts),
            };
          }
          // archiveStale - returns stale lessons directly
          if (staleLessons.length > 0) return staleLessons;
          // mergeDuplicateLessons (call 1) and validateFacts (call 2) need groupBy chain
          // archiveStale (call 3+) needs plain array
          if (selectCount <= 2) {
            return {
              groupBy: mock((..._g: unknown[]) => ({
                having: mock(() => []),
              })),
              orderBy: mock((..._o: unknown[]) => []),
            };
          }
          return [];
        }),
        groupBy: mock((..._g: unknown[]) => ({
          having: mock(() => duplicateGroups),
        })),
        orderBy: mock((..._o: unknown[]) => lessonsInGroup),
      })),
    })),
    insert: mock((_table: unknown) => ({
      values: mock(() => ({
        returning: mock(() => []),
      })),
    })),
    update: mock((_table: unknown) => ({
      set: mock((_vals: Record<string, unknown>) => ({
        where: mock(() => ({
          returning: mock(() => staleFacts),
        })),
      })),
    })),
    delete: mock((_table: unknown) => ({
      where: mock((..._w: unknown[]) => {
        deletedIds.push('deleted');
        return {};
      }),
    })),
    _deletedIds: deletedIds,
  };
}

describe('MemoryConsolidator', () => {
  test('consolidate runs all phases and emits event', async () => {
    const db = createMockDb();
    const eventBus = createMockEventBus();
    const consolidator = new MemoryConsolidator({
      db: db as never,
      eventBus,
    });

    const result = await consolidator.consolidate(COMPANY_ID);

    expect(result).toHaveProperty('lessonsMerged');
    expect(result).toHaveProperty('factsValidated');
    expect(result).toHaveProperty('lessonsArchived');
    expect(result).toHaveProperty('factsInvalidated');
    expect(eventBus.emittedEvents.length).toBe(1);
    expect(eventBus.emittedEvents[0]!.type).toBe('evolution.memory_consolidated');
  });

  test('mergeDuplicateLessons merges lessons with same taskType+approach', async () => {
    const db = createMockDb({
      duplicateGroups: [{ taskType: 'code_review', approach: 'line-by-line', count: 3 }],
      lessonsInGroup: [
        { id: '1', confidence: 0.9, timesRetrieved: 5 },
        { id: '2', confidence: 0.7, timesRetrieved: 2 },
        { id: '3', confidence: 0.5, timesRetrieved: 1 },
      ],
    });
    const eventBus = createMockEventBus();
    const consolidator = new MemoryConsolidator({
      db: db as never,
      eventBus,
    });

    const merged = await consolidator.mergeDuplicateLessons(COMPANY_ID);
    expect(merged).toBe(2); // 2 duplicates removed
    expect(db.update).toHaveBeenCalled(); // keeper updated
    expect(db.delete).toHaveBeenCalled(); // duplicates deleted
  });

  test('archiveStale removes old low-quality lessons', async () => {
    const db = createMockDb({
      staleLessons: [{ id: '1' }, { id: '2' }],
    });
    const eventBus = createMockEventBus();
    const consolidator = new MemoryConsolidator({
      db: db as never,
      eventBus,
      archiveThresholdDays: 90,
      minConfidenceToKeep: 0.3,
      minRetrievalsToKeep: 1,
    });

    const archived = await consolidator.archiveStale(COMPANY_ID);
    expect(archived).toBe(2);
  });

  test('invalidateStaleFacts invalidates old low-confidence facts', async () => {
    const db = createMockDb({
      staleFacts: [{ id: '1' }, { id: '2' }, { id: '3' }],
    });
    const eventBus = createMockEventBus();
    const consolidator = new MemoryConsolidator({
      db: db as never,
      eventBus,
    });

    const invalidated = await consolidator.invalidateStaleFacts(COMPANY_ID);
    expect(invalidated).toBe(3);
  });
});
