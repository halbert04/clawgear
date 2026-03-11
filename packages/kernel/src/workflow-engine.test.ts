import { describe, expect, it, mock } from 'bun:test';
import { WorkflowEngine } from './workflow-engine.js';

// Mock factory for database
const createMockDb = (overrides: Record<string, unknown> = {}) => {
  const calls: { method: string; data?: unknown }[] = [];

  const workflowRow = {
    id: 'wf-1',
    companyId: 'company-1',
    name: 'Test Workflow',
    isActive: true,
    definition: overrides.definition ?? { steps: [] },
    ...overrides,
  };

  const runRow = {
    id: 'run-1',
    companyId: 'company-1',
    workflowId: 'wf-1',
    status: 'running',
    currentStepIndex: 0,
    totalSteps: 0,
  };

  return {
    calls,
    select: () => ({
      from: () => ({
        where: () => ({
          orderBy: () => ({
            limit: () => Promise.resolve([]),
          }),
          limit: () => Promise.resolve([workflowRow]),
        }),
        leftJoin: () => ({
          where: () => ({
            orderBy: () => ({
              limit: () => Promise.resolve([{ agentId: 'agent-1', avgQualityScore: 0.9 }]),
            }),
          }),
        }),
      }),
    }),
    insert: () => ({
      values: (data: unknown) => ({
        returning: () => {
          calls.push({ method: 'insert', data });
          return Promise.resolve([{ ...runRow, ...(data as Record<string, unknown>) }]);
        },
      }),
    }),
    update: () => ({
      set: (data: unknown) => ({
        where: () => {
          calls.push({ method: 'update', data });
          return {
            returning: () => Promise.resolve([]),
          };
        },
      }),
    }),
  } as any;
};

const createMockEventBus = () => {
  const emitted: Array<{ type: string; payload: unknown }> = [];
  return {
    on: () => ({ unsubscribe: () => {} }),
    once: () => ({ unsubscribe: () => {} }),
    emit: (event: unknown) => {
      emitted.push(event as any);
    },
    emitted,
  } as any;
};

const createMockHeartbeatEngine = () =>
  ({
    executeHeartbeat: mock(() =>
      Promise.resolve({
        runId: 'hb-run-1',
        status: 'succeeded' as const,
        output: 'Step completed successfully',
        durationMs: 500,
      }),
    ),
  }) as any;

describe('WorkflowEngine', () => {
  describe('Basic Execution Tests', () => {
    it('execute creates a workflow run and returns runId', async () => {
      const definition = {
        steps: [
          {
            name: 'step-1',
            mode: 'sequential' as const,
            agentId: 'agent-1',
            prompt: 'Do something',
          },
        ],
      };

      const mockDb = createMockDb({ definition });
      const mockEventBus = createMockEventBus();
      const mockHeartbeatEngine = createMockHeartbeatEngine();

      const engine = new WorkflowEngine({
        db: mockDb,
        eventBus: mockEventBus,
        heartbeatEngine: mockHeartbeatEngine,
      });

      const result = await engine.execute('company-1', 'wf-1', {});

      expect(result).toHaveProperty('runId');
      expect(result.runId).toBe('run-1');

      const startedEvent = mockEventBus.emitted.find((e: any) => e.type === 'workflow.started');
      expect(startedEvent).toBeDefined();
    });

    it('throws error for non-existent workflow', async () => {
      const mockDb = {
        select: () => ({
          from: () => ({
            where: () => ({
              limit: () => Promise.resolve([]),
            }),
          }),
        }),
      } as any;

      const engine = new WorkflowEngine({
        db: mockDb,
        eventBus: createMockEventBus(),
        heartbeatEngine: createMockHeartbeatEngine(),
      });

      await expect(engine.execute('company-1', 'non-existent', {})).rejects.toThrow();
    });

    it('throws error for inactive workflow', async () => {
      const mockDb = createMockDb({ definition: { steps: [] }, isActive: false });

      const engine = new WorkflowEngine({
        db: mockDb,
        eventBus: createMockEventBus(),
        heartbeatEngine: createMockHeartbeatEngine(),
      });

      await expect(engine.execute('company-1', 'wf-1', {})).rejects.toThrow();
    });
  });

  describe('Sequential Execution Tests', () => {
    it('executes steps sequentially', async () => {
      const definition = {
        steps: [
          { name: 'step-1', mode: 'sequential' as const, agentId: 'agent-1', prompt: 'First step' },
          {
            name: 'step-2',
            mode: 'sequential' as const,
            agentId: 'agent-2',
            prompt: 'Second step',
          },
        ],
      };

      const mockDb = createMockDb({ definition });
      const mockHeartbeatEngine = createMockHeartbeatEngine();

      const engine = new WorkflowEngine({
        db: mockDb,
        eventBus: createMockEventBus(),
        heartbeatEngine: mockHeartbeatEngine,
      });

      await engine.execute('company-1', 'wf-1', {});
      await new Promise((r) => setTimeout(r, 100));

      expect(mockHeartbeatEngine.executeHeartbeat).toHaveBeenCalledTimes(2);
    });
  });

  describe('Fan-out Tests', () => {
    it('executes fan_out substeps in parallel', async () => {
      const definition = {
        steps: [
          {
            name: 'parallel-step',
            mode: 'fan_out' as const,
            subSteps: [
              { name: 'sub-1', mode: 'sequential' as const, agentId: 'agent-1', prompt: 'Task A' },
              { name: 'sub-2', mode: 'sequential' as const, agentId: 'agent-2', prompt: 'Task B' },
            ],
          },
        ],
      };

      const mockDb = createMockDb({ definition });
      const mockHeartbeatEngine = createMockHeartbeatEngine();

      const engine = new WorkflowEngine({
        db: mockDb,
        eventBus: createMockEventBus(),
        heartbeatEngine: mockHeartbeatEngine,
      });

      await engine.execute('company-1', 'wf-1', {});
      await new Promise((r) => setTimeout(r, 100));

      expect(mockHeartbeatEngine.executeHeartbeat).toHaveBeenCalledTimes(2);
    });
  });

  describe('Error Handling Tests', () => {
    it('onError: skip continues execution', async () => {
      const definition = {
        steps: [
          {
            name: 'failing-step',
            mode: 'sequential' as const,
            agentId: 'agent-1',
            prompt: 'Fail',
            onError: 'skip' as const,
          },
          {
            name: 'second-step',
            mode: 'sequential' as const,
            agentId: 'agent-2',
            prompt: 'Continue',
          },
        ],
      };

      const mockDb = createMockDb({ definition });
      let callCount = 0;
      const mockHeartbeatEngine = {
        executeHeartbeat: mock(() => {
          callCount++;
          if (callCount === 1) {
            return Promise.resolve({
              runId: 'hb-1',
              status: 'failed' as const,
              error: 'Fail',
              durationMs: 100,
            });
          }
          return Promise.resolve({
            runId: 'hb-2',
            status: 'succeeded' as const,
            output: 'OK',
            durationMs: 100,
          });
        }),
      } as any;

      const engine = new WorkflowEngine({
        db: mockDb,
        eventBus: createMockEventBus(),
        heartbeatEngine: mockHeartbeatEngine,
      });

      await engine.execute('company-1', 'wf-1', {});
      await new Promise((r) => setTimeout(r, 100));

      expect(mockHeartbeatEngine.executeHeartbeat).toHaveBeenCalledTimes(2);
    });

    it('onError: fail stops execution', async () => {
      const definition = {
        steps: [
          {
            name: 'failing-step',
            mode: 'sequential' as const,
            agentId: 'agent-1',
            prompt: 'Fail',
            onError: 'fail' as const,
          },
          { name: 'second-step', mode: 'sequential' as const, agentId: 'agent-2', prompt: 'Skip' },
        ],
      };

      const mockDb = createMockDb({ definition });
      const mockEventBus = createMockEventBus();
      const mockHeartbeatEngine = {
        executeHeartbeat: mock(() =>
          Promise.resolve({
            runId: 'hb-1',
            status: 'failed' as const,
            error: 'Fail',
            durationMs: 100,
          }),
        ),
      } as any;

      const engine = new WorkflowEngine({
        db: mockDb,
        eventBus: mockEventBus,
        heartbeatEngine: mockHeartbeatEngine,
      });

      await engine.execute('company-1', 'wf-1', {});
      await new Promise((r) => setTimeout(r, 100));

      expect(mockHeartbeatEngine.executeHeartbeat).toHaveBeenCalledTimes(1);

      const failedEvent = mockEventBus.emitted.find((e: any) => e.type === 'workflow.failed');
      expect(failedEvent).toBeDefined();
    });
  });

  describe('Cancel Tests', () => {
    it('cancelRun updates status to cancelled', async () => {
      const updates: unknown[] = [];
      const mockDb = {
        select: () => ({
          from: () => ({
            where: () => ({
              limit: () =>
                Promise.resolve([{ id: 'run-1', status: 'running', companyId: 'company-1' }]),
            }),
          }),
        }),
        update: () => ({
          set: (data: unknown) => ({
            where: () => {
              updates.push(data);
              return { returning: () => Promise.resolve([]) };
            },
          }),
        }),
      } as any;

      const engine = new WorkflowEngine({
        db: mockDb,
        eventBus: createMockEventBus(),
        heartbeatEngine: createMockHeartbeatEngine(),
      });

      await engine.cancelRun('run-1');

      expect(updates.length).toBeGreaterThan(0);
      expect((updates[0] as any).status).toBe('cancelled');
    });

    it('cancelRun throws for non-running workflow', async () => {
      const mockDb = {
        select: () => ({
          from: () => ({
            where: () => ({
              limit: () =>
                Promise.resolve([{ id: 'run-1', status: 'completed', companyId: 'company-1' }]),
            }),
          }),
        }),
      } as any;

      const engine = new WorkflowEngine({
        db: mockDb,
        eventBus: createMockEventBus(),
        heartbeatEngine: createMockHeartbeatEngine(),
      });

      await expect(engine.cancelRun('run-1')).rejects.toThrow();
    });
  });

  describe('Variable Substitution Tests', () => {
    it('substitutes input variables in prompts', async () => {
      const definition = {
        steps: [
          {
            name: 'step-1',
            mode: 'sequential' as const,
            agentId: 'agent-1',
            prompt: 'Process {{input.userName}}',
          },
        ],
      };

      const mockDb = createMockDb({ definition });
      const mockHeartbeatEngine = createMockHeartbeatEngine();

      const engine = new WorkflowEngine({
        db: mockDb,
        eventBus: createMockEventBus(),
        heartbeatEngine: mockHeartbeatEngine,
      });

      await engine.execute('company-1', 'wf-1', { userName: 'Alice' });
      await new Promise((r) => setTimeout(r, 100));

      expect(mockHeartbeatEngine.executeHeartbeat).toHaveBeenCalled();
    });
  });
});
