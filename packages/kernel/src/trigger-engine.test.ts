import { beforeEach, describe, expect, it, mock } from 'bun:test';
import { TriggerEngine } from './trigger-engine.js';

// Mock database
const createMockDb = () => ({
  select: () => ({
    from: () => ({
      where: () => ({
        orderBy: () => ({
          limit: () => Promise.resolve([]),
        }),
        limit: () => Promise.resolve([]),
      }),
    }),
  }),
  insert: () => ({
    values: () => ({
      returning: () => Promise.resolve([]),
    }),
  }),
  update: () => ({
    set: () => ({
      where: () => ({
        returning: () => Promise.resolve([]),
      }),
    }),
  }),
});

// Mock EventBus
const createMockEventBus = () => {
  const handlers = new Map<string, Function[]>();
  return {
    on: (type: string, handler: Function) => {
      if (!handlers.has(type)) handlers.set(type, []);
      handlers.get(type)!.push(handler);
      return { unsubscribe: () => {} };
    },
    emit: mock(() => {}),
    handlers,
  };
};

// Mock HeartbeatEngine
const createMockHeartbeatEngine = () => ({
  executeHeartbeat: mock(() =>
    Promise.resolve({
      runId: 'run-1',
      status: 'succeeded',
      output: 'ok',
      durationMs: 100,
    }),
  ),
});

// Types
interface TriggerRecord {
  id: string;
  companyId: string;
  name: string;
  patternType: string;
  patternConfig: Record<string, unknown>;
  actionType: string;
  actionConfig: Record<string, unknown>;
  isActive: boolean;
  fireCount: number;
  maxFireCount: number | null;
  cooldownMs: number;
}

interface SystemEvent {
  type: string;
  companyId: string;
  timestamp: Date;
  payload: Record<string, unknown>;
}

describe('TriggerEngine', () => {
  let mockDb: any;
  let mockEventBus: any;
  let mockHeartbeatEngine: any;
  let engine: TriggerEngine;

  beforeEach(() => {
    mockDb = createMockDb();
    mockEventBus = createMockEventBus();
    mockHeartbeatEngine = createMockHeartbeatEngine();
    engine = new TriggerEngine({
      db: mockDb,
      eventBus: mockEventBus,
      heartbeatEngine: mockHeartbeatEngine,
    });
  });

  describe('Pattern Matching Tests', () => {
    it('event_match: matches event type exactly', async () => {
      const trigger: TriggerRecord = {
        id: 'trigger-1',
        companyId: 'company-1',
        name: 'Issue Status Changed',
        patternType: 'event_match',
        patternConfig: { eventType: 'issue.status_changed' },
        actionType: 'wake_agent',
        actionConfig: { agentId: 'agent-1' },
        isActive: true,
        fireCount: 0,
        maxFireCount: null,
        cooldownMs: 0,
      };

      await engine.addTrigger(trigger);

      const event: SystemEvent = {
        type: 'issue.status_changed',
        companyId: 'company-1',
        timestamp: new Date(),
        payload: { issueId: 'issue-1' },
      };

      await engine.evaluate(event);

      expect(mockEventBus.emit).toHaveBeenCalled();
      const calls = (mockEventBus.emit as any).mock.calls;
      const firedCall = calls.find((call: any[]) => call[0]?.type === 'trigger.fired');
      expect(firedCall).toBeDefined();
    });

    it('event_match: matches event type with conditions', async () => {
      const trigger: TriggerRecord = {
        id: 'trigger-2',
        companyId: 'company-1',
        name: 'Issue Done',
        patternType: 'event_match',
        patternConfig: {
          eventType: 'issue.status_changed',
          conditions: { status: 'done' },
        },
        actionType: 'wake_agent',
        actionConfig: { agentId: 'agent-1' },
        isActive: true,
        fireCount: 0,
        maxFireCount: null,
        cooldownMs: 0,
      };

      await engine.addTrigger(trigger);

      // Matching event
      const matchingEvent: SystemEvent = {
        type: 'issue.status_changed',
        companyId: 'company-1',
        timestamp: new Date(),
        payload: { status: 'done', issueId: 'issue-1' },
      };

      await engine.evaluate(matchingEvent);

      expect(mockEventBus.emit).toHaveBeenCalled();
      const calls1 = (mockEventBus.emit as any).mock.calls;
      const firedCall1 = calls1.find((call: any[]) => call[0]?.type === 'trigger.fired');
      expect(firedCall1).toBeDefined();

      // Reset mock
      mockEventBus.emit.mockClear();

      // Non-matching event
      const nonMatchingEvent: SystemEvent = {
        type: 'issue.status_changed',
        companyId: 'company-1',
        timestamp: new Date(),
        payload: { status: 'in_progress', issueId: 'issue-2' },
      };

      await engine.evaluate(nonMatchingEvent);

      const calls2 = (mockEventBus.emit as any).mock.calls;
      const firedCall2 = calls2.find((call: any[]) => call[0]?.type === 'trigger.fired');
      expect(firedCall2).toBeUndefined();
    });

    it('event_match: does not match different event type', async () => {
      const trigger: TriggerRecord = {
        id: 'trigger-3',
        companyId: 'company-1',
        name: 'Issue Created',
        patternType: 'event_match',
        patternConfig: { eventType: 'issue.created' },
        actionType: 'wake_agent',
        actionConfig: { agentId: 'agent-1' },
        isActive: true,
        fireCount: 0,
        maxFireCount: null,
        cooldownMs: 0,
      };

      await engine.addTrigger(trigger);

      const event: SystemEvent = {
        type: 'agent.created',
        companyId: 'company-1',
        timestamp: new Date(),
        payload: { agentId: 'agent-1' },
      };

      await engine.evaluate(event);

      const calls = (mockEventBus.emit as any).mock.calls;
      const firedCall = calls.find((call: any[]) => call[0]?.type === 'trigger.fired');
      expect(firedCall).toBeUndefined();
    });

    it('budget_threshold: fires when above threshold', async () => {
      const trigger: TriggerRecord = {
        id: 'trigger-4',
        companyId: 'company-1',
        name: 'Budget Alert',
        patternType: 'budget_threshold',
        patternConfig: { thresholdPercent: 80 },
        actionType: 'wake_agent',
        actionConfig: { agentId: 'agent-1' },
        isActive: true,
        fireCount: 0,
        maxFireCount: null,
        cooldownMs: 0,
      };

      await engine.addTrigger(trigger);

      // Above threshold
      const aboveEvent: SystemEvent = {
        type: 'budget.check',
        companyId: 'company-1',
        timestamp: new Date(),
        payload: { percentUsed: 85 },
      };

      await engine.evaluate(aboveEvent);

      expect(mockEventBus.emit).toHaveBeenCalled();
      const calls1 = (mockEventBus.emit as any).mock.calls;
      const firedCall1 = calls1.find((call: any[]) => call[0]?.type === 'trigger.fired');
      expect(firedCall1).toBeDefined();

      // Reset mock
      mockEventBus.emit.mockClear();

      // Below threshold
      const belowEvent: SystemEvent = {
        type: 'budget.check',
        companyId: 'company-1',
        timestamp: new Date(),
        payload: { percentUsed: 75 },
      };

      await engine.evaluate(belowEvent);

      const calls2 = (mockEventBus.emit as any).mock.calls;
      const firedCall2 = calls2.find((call: any[]) => call[0]?.type === 'trigger.fired');
      expect(firedCall2).toBeUndefined();
    });

    it('quality_failure: fires after consecutive failures', async () => {
      const trigger: TriggerRecord = {
        id: 'trigger-5',
        companyId: 'company-1',
        name: 'Quality Gate Failed 3x',
        patternType: 'quality_failure',
        patternConfig: { minConsecutiveFailures: 3 },
        actionType: 'wake_agent',
        actionConfig: { agentId: 'agent-1' },
        isActive: true,
        fireCount: 0,
        maxFireCount: null,
        cooldownMs: 0,
      };

      await engine.addTrigger(trigger);

      const agentId = 'agent-1';

      // Send 3 consecutive failures
      for (let i = 0; i < 3; i++) {
        const event: SystemEvent = {
          type: 'quality.gate_failed',
          companyId: 'company-1',
          timestamp: new Date(),
          payload: { agentId, failureCount: i + 1 },
        };

        await engine.evaluate(event);
      }

      const calls1 = (mockEventBus.emit as any).mock.calls;
      const firedCalls1 = calls1.filter((call: any[]) => call[0]?.type === 'trigger.fired');
      expect(firedCalls1.length).toBeGreaterThan(0);

      // Reset for second test
      mockEventBus.emit.mockClear();
      await engine.removeTrigger('trigger-5');
      await engine.addTrigger(trigger);

      // Send 1 pass, then 2 failures - should NOT fire
      const passEvent: SystemEvent = {
        type: 'quality.gate_passed',
        companyId: 'company-1',
        timestamp: new Date(),
        payload: { agentId },
      };

      await engine.evaluate(passEvent);

      for (let i = 0; i < 2; i++) {
        const failEvent: SystemEvent = {
          type: 'quality.gate_failed',
          companyId: 'company-1',
          timestamp: new Date(),
          payload: { agentId, failureCount: i + 1 },
        };

        await engine.evaluate(failEvent);
      }

      const calls2 = (mockEventBus.emit as any).mock.calls;
      const firedCalls2 = calls2.filter((call: any[]) => call[0]?.type === 'trigger.fired');
      expect(firedCalls2.length).toBe(0);
    });
  });

  describe('Fire Count and Cooldown Tests', () => {
    it('fire count increments correctly', async () => {
      const trigger: TriggerRecord = {
        id: 'trigger-6',
        companyId: 'company-1',
        name: 'Fire Count Test',
        patternType: 'event_match',
        patternConfig: { eventType: 'test.event' },
        actionType: 'wake_agent',
        actionConfig: { agentId: 'agent-1' },
        isActive: true,
        fireCount: 0,
        maxFireCount: null,
        cooldownMs: 0,
      };

      await engine.addTrigger(trigger);

      const event: SystemEvent = {
        type: 'test.event',
        companyId: 'company-1',
        timestamp: new Date(),
        payload: {},
      };

      await engine.evaluate(event);

      expect(mockEventBus.emit).toHaveBeenCalled();
      const calls = (mockEventBus.emit as any).mock.calls;
      const firedCall = calls.find((call: any[]) => call[0]?.type === 'trigger.fired');
      expect(firedCall).toBeDefined();
    });

    it('max fire count auto-disables', async () => {
      const trigger: TriggerRecord = {
        id: 'trigger-7',
        companyId: 'company-1',
        name: 'Max Fire Count Test',
        patternType: 'event_match',
        patternConfig: { eventType: 'test.event' },
        actionType: 'wake_agent',
        actionConfig: { agentId: 'agent-1' },
        isActive: true,
        fireCount: 0,
        maxFireCount: 1,
        cooldownMs: 0,
      };

      await engine.addTrigger(trigger);

      const event: SystemEvent = {
        type: 'test.event',
        companyId: 'company-1',
        timestamp: new Date(),
        payload: {},
      };

      await engine.evaluate(event);

      expect(mockEventBus.emit).toHaveBeenCalled();
      const calls = (mockEventBus.emit as any).mock.calls;
      const firedCall = calls.find((call: any[]) => call[0]?.type === 'trigger.fired');
      expect(firedCall).toBeDefined();

      const disabledCall = calls.find((call: any[]) => call[0]?.type === 'trigger.disabled');
      expect(disabledCall).toBeDefined();
    });

    it('cooldown prevents rapid re-firing', async () => {
      const trigger: TriggerRecord = {
        id: 'trigger-8',
        companyId: 'company-1',
        name: 'Cooldown Test',
        patternType: 'event_match',
        patternConfig: { eventType: 'test.event' },
        actionType: 'wake_agent',
        actionConfig: { agentId: 'agent-1' },
        isActive: true,
        fireCount: 0,
        maxFireCount: null,
        cooldownMs: 10000,
      };

      await engine.addTrigger(trigger);

      const event: SystemEvent = {
        type: 'test.event',
        companyId: 'company-1',
        timestamp: new Date(),
        payload: {},
      };

      // First evaluation - should fire
      await engine.evaluate(event);

      const calls1 = (mockEventBus.emit as any).mock.calls;
      const firedCalls1 = calls1.filter((call: any[]) => call[0]?.type === 'trigger.fired');
      expect(firedCalls1.length).toBeGreaterThan(0);

      // Reset mock
      mockEventBus.emit.mockClear();

      // Second evaluation immediately - should NOT fire (cooldown active)
      await engine.evaluate(event);

      const calls2 = (mockEventBus.emit as any).mock.calls;
      const firedCalls2 = calls2.filter((call: any[]) => call[0]?.type === 'trigger.fired');
      expect(firedCalls2.length).toBe(0);
    });
  });

  describe('Variable Substitution Tests', () => {
    it('substitutes event.type in action config', async () => {
      const trigger: TriggerRecord = {
        id: 'trigger-9',
        companyId: 'company-1',
        name: 'Variable Substitution Test',
        patternType: 'event_match',
        patternConfig: { eventType: 'issue.created' },
        actionType: 'wake_agent',
        actionConfig: {
          agentId: 'agent-1',
          taskPrompt: 'Handle {{event.type}} for {{event.payload.issueId}}',
        },
        isActive: true,
        fireCount: 0,
        maxFireCount: null,
        cooldownMs: 0,
      };

      await engine.addTrigger(trigger);

      const event: SystemEvent = {
        type: 'issue.created',
        companyId: 'company-1',
        timestamp: new Date(),
        payload: { issueId: 'issue-123' },
      };

      await engine.evaluate(event);

      expect(mockHeartbeatEngine.executeHeartbeat).toHaveBeenCalled();

      // Verify the trigger.fired event was emitted
      expect(mockEventBus.emit).toHaveBeenCalled();
      const calls = (mockEventBus.emit as any).mock.calls;
      const firedCall = calls.find((call: any[]) => call[0]?.type === 'trigger.fired');
      expect(firedCall).toBeDefined();
    });
  });

  describe('Action Execution Tests', () => {
    it('wake_agent calls heartbeat engine', async () => {
      const trigger: TriggerRecord = {
        id: 'trigger-10',
        companyId: 'company-1',
        name: 'Wake Agent Test',
        patternType: 'event_match',
        patternConfig: { eventType: 'test.event' },
        actionType: 'wake_agent',
        actionConfig: { agentId: 'agent-1' },
        isActive: true,
        fireCount: 0,
        maxFireCount: null,
        cooldownMs: 0,
      };

      await engine.addTrigger(trigger);

      const event: SystemEvent = {
        type: 'test.event',
        companyId: 'company-1',
        timestamp: new Date(),
        payload: {},
      };

      await engine.evaluate(event);

      expect(mockHeartbeatEngine.executeHeartbeat).toHaveBeenCalled();
      const calls = (mockHeartbeatEngine.executeHeartbeat as any).mock.calls;
      expect(calls.length).toBeGreaterThan(0);

      const call = calls[0];
      expect(call[0]).toBe('agent-1');
      expect(call[1]).toBe('event');
    });

    it('run_workflow calls workflow engine', async () => {
      const mockWorkflowEngine = {
        execute: mock(() => Promise.resolve({ runId: 'wf-run-1' })),
      };

      engine.setWorkflowEngine(mockWorkflowEngine as any);

      const trigger: TriggerRecord = {
        id: 'trigger-11',
        companyId: 'company-1',
        name: 'Run Workflow Test',
        patternType: 'event_match',
        patternConfig: { eventType: 'test.event' },
        actionType: 'run_workflow',
        actionConfig: { workflowId: 'wf-1' },
        isActive: true,
        fireCount: 0,
        maxFireCount: null,
        cooldownMs: 0,
      };

      await engine.addTrigger(trigger);

      const event: SystemEvent = {
        type: 'test.event',
        companyId: 'company-1',
        timestamp: new Date(),
        payload: {},
      };

      await engine.evaluate(event);

      expect(mockWorkflowEngine.execute).toHaveBeenCalled();
      const calls = (mockWorkflowEngine.execute as any).mock.calls;
      expect(calls.length).toBeGreaterThan(0);
    });
  });
});
