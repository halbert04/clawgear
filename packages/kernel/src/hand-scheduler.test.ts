import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test';
import { HandScheduler } from './hand-scheduler.js';

// Mock dependencies
function createMockEventBus() {
  const handlers = new Map<string, Set<(event: unknown) => void>>();
  return {
    emit: mock(() => {}),
    on: mock((type: string, handler: (event: unknown) => void) => {
      if (!handlers.has(type)) handlers.set(type, new Set());
      handlers.get(type)!.add(handler);
      return { unsubscribe: () => handlers.get(type)?.delete(handler) };
    }),
    once: mock(() => ({ unsubscribe: () => {} })),
    _trigger(type: string, event: unknown) {
      for (const h of handlers.get(type) ?? []) h(event);
    },
  };
}

function createMockDb() {
  return {
    select: mock(() => ({
      from: mock(() => ({
        where: mock(() => Promise.resolve([])),
      })),
    })),
    insert: mock(() => ({
      values: mock(() => ({
        returning: mock(() => Promise.resolve([])),
      })),
    })),
    update: mock(() => ({
      set: mock(() => ({
        where: mock(() => ({
          returning: mock(() => Promise.resolve([])),
        })),
      })),
    })),
  } as unknown;
}

function createMockHeartbeatEngine() {
  return {
    executeHeartbeat: mock(() =>
      Promise.resolve({
        runId: 'test-run',
        status: 'succeeded',
        output: 'ok',
        durationMs: 100,
      }),
    ),
  };
}

describe('HandScheduler', () => {
  let scheduler: HandScheduler;
  let eventBus: ReturnType<typeof createMockEventBus>;
  let heartbeatEngine: ReturnType<typeof createMockHeartbeatEngine>;

  beforeEach(() => {
    eventBus = createMockEventBus();
    heartbeatEngine = createMockHeartbeatEngine();
    scheduler = new HandScheduler({
      db: createMockDb() as any,
      heartbeatEngine: heartbeatEngine as any,
      eventBus: eventBus as any,
    });
  });

  afterEach(() => {
    scheduler.stop();
  });

  it('starts with zero scheduled hands', () => {
    expect(scheduler.scheduledHandCount).toBe(0);
  });

  it('adds a hand with valid cron expression', () => {
    scheduler.addHand('agent-1', '*/5 * * * *', 'company-1', 'researcher');
    expect(scheduler.scheduledHandCount).toBe(1);
  });

  it('rejects invalid cron expressions gracefully', () => {
    scheduler.addHand('agent-1', 'not-a-cron', 'company-1', 'test');
    expect(scheduler.scheduledHandCount).toBe(0);
  });

  it('removes a hand', () => {
    scheduler.addHand('agent-1', '*/5 * * * *', 'company-1', 'researcher');
    expect(scheduler.scheduledHandCount).toBe(1);

    scheduler.removeHand('agent-1');
    expect(scheduler.scheduledHandCount).toBe(0);
  });

  it('returns next run time for scheduled hand', () => {
    scheduler.addHand('agent-1', '*/5 * * * *', 'company-1', 'researcher');
    const nextRun = scheduler.getNextRunTime('agent-1');
    expect(nextRun).toBeInstanceOf(Date);
    expect(nextRun!.getTime()).toBeGreaterThan(Date.now());
  });

  it('returns null for unknown agent', () => {
    expect(scheduler.getNextRunTime('nonexistent')).toBeNull();
  });

  it('lists scheduled hands with details', () => {
    scheduler.addHand('agent-1', '*/5 * * * *', 'company-1', 'researcher');
    scheduler.addHand('agent-2', '0 */4 * * *', 'company-1', 'collector');

    const hands = scheduler.getScheduledHands();
    expect(hands).toHaveLength(2);
    expect(hands[0]!.agentId).toBe('agent-1');
    expect(hands[0]!.handName).toBe('researcher');
    expect(hands[0]!.cronExpression).toBe('*/5 * * * *');
    expect(hands[1]!.agentId).toBe('agent-2');
  });

  it('reacts to hand.activated events', () => {
    eventBus._trigger('hand.activated', {
      type: 'hand.activated',
      companyId: 'company-1',
      timestamp: new Date(),
      payload: {
        agentId: 'agent-1',
        handName: 'researcher',
        schedule: '*/10 * * * *',
      },
    });

    expect(scheduler.scheduledHandCount).toBe(1);
    expect(scheduler.getNextRunTime('agent-1')).toBeInstanceOf(Date);
  });

  it('reacts to hand.deactivated events', () => {
    scheduler.addHand('agent-1', '*/5 * * * *', 'company-1', 'researcher');
    expect(scheduler.scheduledHandCount).toBe(1);

    eventBus._trigger('hand.deactivated', {
      type: 'hand.deactivated',
      companyId: 'company-1',
      timestamp: new Date(),
      payload: { agentId: 'agent-1' },
    });

    expect(scheduler.scheduledHandCount).toBe(0);
  });

  it('removes hand on agent paused event', () => {
    scheduler.addHand('agent-1', '*/5 * * * *', 'company-1', 'researcher');

    eventBus._trigger('agent.status_changed', {
      type: 'agent.status_changed',
      companyId: 'company-1',
      timestamp: new Date(),
      payload: { agentId: 'agent-1', newStatus: 'paused' },
    });

    expect(scheduler.scheduledHandCount).toBe(0);
  });

  it('removes hand on agent terminated event', () => {
    scheduler.addHand('agent-1', '*/5 * * * *', 'company-1', 'researcher');

    eventBus._trigger('agent.status_changed', {
      type: 'agent.status_changed',
      companyId: 'company-1',
      timestamp: new Date(),
      payload: { agentId: 'agent-1', newStatus: 'terminated' },
    });

    expect(scheduler.scheduledHandCount).toBe(0);
  });

  it('stops cleanly', () => {
    scheduler.addHand('agent-1', '*/5 * * * *', 'company-1', 'researcher');
    scheduler.stop();
    expect(scheduler.scheduledHandCount).toBe(0);
  });
});
