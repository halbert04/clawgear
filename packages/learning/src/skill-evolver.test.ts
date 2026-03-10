import { describe, expect, mock, test } from 'bun:test';
import type { EventBus, SystemEvent } from '@clawgear/shared/interfaces';
import { SkillEvolver } from './skill-evolver.js';

// ============================================================
// MOCK HELPERS
// ============================================================

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
const SKILL_ID = '770e8400-e29b-41d4-a716-446655440003';

function createMockDb(
  options: {
    lessonCount?: number;
    existingSkill?: Record<string, unknown> | null;
    skill?: Record<string, unknown> | null;
  } = {},
) {
  const lessonCount = options.lessonCount ?? 0;
  const existingSkill = options.existingSkill ?? null;
  const skill = options.skill ?? null;

  let selectCount = 0;

  return {
    select: mock((..._args: unknown[]) => ({
      from: mock((_table: unknown) => ({
        where: mock((..._w: unknown[]) => {
          selectCount++;
          if (selectCount === 1 && lessonCount > 0) return [{ count: lessonCount }];
          if (selectCount === 1 && lessonCount === 0) return [{ count: 0 }];
          if (existingSkill) return [existingSkill];
          if (skill) return [skill];
          return [];
        }),
        orderBy: mock(() => ({
          limit: mock(() => []),
        })),
      })),
    })),
    insert: mock((_table: unknown) => ({
      values: mock((vals: Record<string, unknown>) => ({
        returning: mock(() => [{ id: SKILL_ID, ...vals }]),
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

// ============================================================
// TESTS
// ============================================================

describe('SkillEvolver', () => {
  test('canProposeSkill returns false when insufficient runs', async () => {
    const db = createMockDb({ lessonCount: 3 });
    const eventBus = createMockEventBus();
    const evolver = new SkillEvolver({
      db: db as never,
      eventBus,
      minSuccessfulRuns: 5,
    });

    const result = await evolver.canProposeSkill(COMPANY_ID, AGENT_ID, 'code_review');
    expect(result).toBe(false);
  });

  test('canProposeSkill returns true when sufficient runs', async () => {
    const db = createMockDb({ lessonCount: 7 });
    const eventBus = createMockEventBus();
    const evolver = new SkillEvolver({
      db: db as never,
      eventBus,
      minSuccessfulRuns: 5,
    });

    const result = await evolver.canProposeSkill(COMPANY_ID, AGENT_ID, 'code_review');
    expect(result).toBe(true);
  });

  test('proposeSkill creates skill and approval', async () => {
    const db = createMockDb();
    const eventBus = createMockEventBus();
    const evolver = new SkillEvolver({ db: db as never, eventBus });

    const result = await evolver.proposeSkill(COMPANY_ID, AGENT_ID, {
      name: 'code-review',
      description: 'Reviews code for quality',
      content: '# Code Review Skill\n...',
      triggerConditions: 'When a PR is opened',
      exampleInvocations: ['review PR #123'],
    });

    expect(result.skillId).toBe(SKILL_ID);
    expect(db.insert).toHaveBeenCalled();
    expect(eventBus.emittedEvents.length).toBe(1);
    expect(eventBus.emittedEvents[0]!.type).toBe('evolution.skill_proposed');
  });

  test('approveSkill transitions skill to active', async () => {
    // Build a custom mock that returns the proposed skill on the first select call
    let selectCount = 0;
    const db = {
      select: mock((..._args: unknown[]) => ({
        from: mock((_table: unknown) => ({
          where: mock((..._w: unknown[]) => {
            selectCount++;
            if (selectCount === 1) {
              return [
                {
                  id: SKILL_ID,
                  companyId: COMPANY_ID,
                  name: 'code-review',
                  status: 'proposed',
                  parentSkillId: null,
                },
              ];
            }
            return [];
          }),
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
    const eventBus = createMockEventBus();
    const evolver = new SkillEvolver({ db: db as never, eventBus });

    await evolver.approveSkill(SKILL_ID, 'admin-user');

    expect(db.update).toHaveBeenCalled();
    expect(eventBus.emittedEvents.length).toBe(1);
    expect(eventBus.emittedEvents[0]!.type).toBe('evolution.skill_approved');
  });

  test('approveSkill throws on non-proposed skill', async () => {
    // Custom mock that returns an active skill
    const db = {
      select: mock((..._args: unknown[]) => ({
        from: mock((_table: unknown) => ({
          where: mock((..._w: unknown[]) => [
            {
              id: SKILL_ID,
              companyId: COMPANY_ID,
              name: 'code-review',
              status: 'active',
              parentSkillId: null,
            },
          ]),
        })),
      })),
      update: mock((_table: unknown) => ({
        set: mock((_vals: Record<string, unknown>) => ({
          where: mock(() => ({})),
        })),
      })),
    };
    const eventBus = createMockEventBus();
    const evolver = new SkillEvolver({ db: db as never, eventBus });

    await expect(evolver.approveSkill(SKILL_ID, 'admin')).rejects.toThrow('not in proposed status');
  });

  test('deprecateSkill emits event', async () => {
    const db = createMockDb({
      skill: {
        id: SKILL_ID,
        companyId: COMPANY_ID,
        name: 'code-review',
        status: 'active',
      },
    });
    const eventBus = createMockEventBus();
    const evolver = new SkillEvolver({ db: db as never, eventBus });

    await evolver.deprecateSkill(SKILL_ID);

    expect(eventBus.emittedEvents.length).toBe(1);
    expect(eventBus.emittedEvents[0]!.type).toBe('evolution.skill_deprecated');
  });

  test('recordUsage increments usage count', async () => {
    const db = createMockDb();
    const eventBus = createMockEventBus();
    const evolver = new SkillEvolver({ db: db as never, eventBus });

    await evolver.recordUsage(SKILL_ID);
    expect(db.update).toHaveBeenCalled();
  });
});
