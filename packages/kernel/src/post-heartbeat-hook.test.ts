import { describe, expect, mock, test } from 'bun:test';
import type { SystemEvent } from '@clawgear/shared/interfaces';
import { InProcessEventBus } from './event-bus.js';
import { PostHeartbeatHook } from './post-heartbeat-hook.js';

// ============================================================
// MOCKS
// ============================================================

const COMPANY_ID = 'comp-1';
const AGENT_ID = 'agent-1';
const RUN_ID = 'run-1';

function makeMockDb(runOverrides: Record<string, unknown> = {}) {
  const runRow = {
    id: RUN_ID,
    companyId: COMPANY_ID,
    agentId: AGENT_ID,
    status: 'succeeded',
    resultJson: { output: 'Task completed successfully', toolCalls: [] },
    usageJson: { costCents: 5 },
    ...runOverrides,
  };

  return {
    select: mock(() => ({
      from: mock(() => ({
        where: mock(() => [runRow]),
      })),
    })),
  };
}

// Track calls manually to avoid tuple type issues
let lastLessonStoreInput: Record<string, unknown> | null = null;
let lastCompetenceInput: Record<string, unknown> | null = null;
let lessonStoreCallCount = 0;
let competenceCallCount = 0;

function makeMockCompetenceTracker() {
  competenceCallCount = 0;
  lastCompetenceInput = null;
  return {
    update: mock(async (input: unknown) => {
      competenceCallCount++;
      lastCompetenceInput = input as Record<string, unknown>;
    }),
    getCompetence: mock(async () => []),
    getTeamCompetence: mock(async () => []),
    findBestAgent: mock(async () => null),
    applyDecay: mock(async () => 0),
  };
}

function makeMockLessonStore() {
  lessonStoreCallCount = 0;
  lastLessonStoreInput = null;
  return {
    store: mock(async (input: unknown) => {
      lessonStoreCallCount++;
      lastLessonStoreInput = input as Record<string, unknown>;
      return { id: 'lesson-1' };
    }),
    retrieveRelevant: mock(async () => []),
    getByAgent: mock(async () => []),
  };
}

function makeMockTaskRouter() {
  return {
    routeTask: mock(async () => null as unknown),
    rankAgents: mock(async () => []),
    getTaskComplexity: mock(async () => 'moderate' as const),
    suggestTasksForAgent: mock(async () => []),
  };
}

function makeHeartbeatEvent(overrides: Record<string, unknown> = {}): SystemEvent {
  return {
    type: 'heartbeat.completed',
    companyId: COMPANY_ID,
    timestamp: new Date(),
    payload: {
      agentId: AGENT_ID,
      runId: RUN_ID,
      durationMs: 5000,
      usage: { costCents: 5 },
      ...overrides,
    },
  };
}

// ============================================================
// TESTS
// ============================================================

describe('PostHeartbeatHook', () => {
  test('run executes full pipeline on success', async () => {
    const db = makeMockDb();
    const eventBus = new InProcessEventBus();
    const competenceTracker = makeMockCompetenceTracker();
    const lessonStore = makeMockLessonStore();
    const taskRouter = makeMockTaskRouter();

    const hook = new PostHeartbeatHook({
      db: db as never,
      eventBus,
      competenceTracker: competenceTracker as never,
      lessonStore: lessonStore as never,
      taskRouter: taskRouter as never,
    });

    await hook.run(makeHeartbeatEvent());

    // Lesson was stored
    expect(lessonStoreCallCount).toBe(1);
    expect(lastLessonStoreInput!.companyId).toBe(COMPANY_ID);
    expect(lastLessonStoreInput!.agentId).toBe(AGENT_ID);
    expect(lastLessonStoreInput!.outcome).toBe('success');

    // Competence was updated
    expect(competenceCallCount).toBe(1);
    expect(lastCompetenceInput!.succeeded).toBe(true);
    expect(lastCompetenceInput!.qualityScore).toBe(1.0);

    // Task routing was attempted (quality >= 0.5)
    expect(taskRouter.routeTask).toHaveBeenCalledTimes(1);
  });

  test('run handles failed heartbeat correctly', async () => {
    const db = makeMockDb({ status: 'failed', resultJson: { error: 'crashed' } });
    const eventBus = new InProcessEventBus();
    const competenceTracker = makeMockCompetenceTracker();
    const lessonStore = makeMockLessonStore();
    const taskRouter = makeMockTaskRouter();

    const hook = new PostHeartbeatHook({
      db: db as never,
      eventBus,
      competenceTracker: competenceTracker as never,
      lessonStore: lessonStore as never,
      taskRouter: taskRouter as never,
    });

    await hook.run(makeHeartbeatEvent());

    // Lesson stored with failure outcome
    expect(lastLessonStoreInput!.outcome).toBe('failure');

    // Competence updated with quality=0
    expect(lastCompetenceInput!.succeeded).toBe(false);
    expect(lastCompetenceInput!.qualityScore).toBe(0.0);

    // Task routing skipped (quality < 0.5)
    expect(taskRouter.routeTask).not.toHaveBeenCalled();
  });

  test('lesson extraction failure does not block competence update', async () => {
    const db = makeMockDb();
    const eventBus = new InProcessEventBus();
    const competenceTracker = makeMockCompetenceTracker();
    const lessonStore = {
      store: mock(async () => {
        throw new Error('DB connection lost');
      }),
      retrieveRelevant: mock(async () => []),
      getByAgent: mock(async () => []),
    };
    const taskRouter = makeMockTaskRouter();

    const hook = new PostHeartbeatHook({
      db: db as never,
      eventBus,
      competenceTracker: competenceTracker as never,
      lessonStore: lessonStore as never,
      taskRouter: taskRouter as never,
    });

    // Should not throw
    await hook.run(makeHeartbeatEvent());

    // Competence still updated despite lesson failure
    expect(competenceCallCount).toBe(1);
    // Task routing still attempted
    expect(taskRouter.routeTask).toHaveBeenCalledTimes(1);
  });

  test('register wires up heartbeat.completed listener', () => {
    const db = makeMockDb();
    const eventBus = new InProcessEventBus();
    const competenceTracker = makeMockCompetenceTracker();
    const lessonStore = makeMockLessonStore();
    const taskRouter = makeMockTaskRouter();

    const hook = new PostHeartbeatHook({
      db: db as never,
      eventBus,
      competenceTracker: competenceTracker as never,
      lessonStore: lessonStore as never,
      taskRouter: taskRouter as never,
    });

    hook.register();

    expect(eventBus.listenerCount('heartbeat.completed')).toBe(1);
  });

  test('emits task.routed event when task is routed', async () => {
    const db = makeMockDb();
    const eventBus = new InProcessEventBus();
    const competenceTracker = makeMockCompetenceTracker();
    const lessonStore = makeMockLessonStore();
    const taskRouter = {
      routeTask: mock(async () => ({
        agentId: 'agent-2',
        agentName: 'Worker',
        autonomyLevel: 'semi_auto',
        avgQualityScore: 0.8,
        totalRuns: 10,
        reason: 'Best match',
      })),
      rankAgents: mock(async () => []),
      getTaskComplexity: mock(async () => 'moderate' as const),
      suggestTasksForAgent: mock(async () => []),
    };

    const events: SystemEvent[] = [];
    eventBus.on('task.routed', (e) => events.push(e));

    const hook = new PostHeartbeatHook({
      db: db as never,
      eventBus,
      competenceTracker: competenceTracker as never,
      lessonStore: lessonStore as never,
      taskRouter: taskRouter as never,
    });

    await hook.run(makeHeartbeatEvent());

    expect(events).toHaveLength(1);
    expect(events[0]!.payload.toAgentId).toBe('agent-2');
  });
});
