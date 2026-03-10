import { describe, expect, mock, test } from 'bun:test';
import { AdapterRegistry } from '@clawgear/runtime';
import type {
  Adapter,
  AdapterContext,
  AdapterResult,
  BudgetStatus,
  KernelHandle,
} from '@clawgear/shared/interfaces';
import { InProcessEventBus } from './event-bus.js';
import { HeartbeatEngine } from './heartbeat-engine.js';

// ============================================================
// MOCK ADAPTER
// ============================================================

function createMockAdapter(overrides: Partial<AdapterResult> = {}): Adapter {
  const defaultResult: AdapterResult = {
    output: 'Hello from mock adapter',
    toolCalls: [],
    usage: {
      inputTokens: 100,
      outputTokens: 50,
      costCents: 5,
      provider: 'mock',
      model: 'mock-model',
    },
    sessionId: 'session-123',
    ...overrides,
  };

  return {
    name: 'claude_code',
    execute: mock(async (_ctx: AdapterContext) => defaultResult),
    testEnvironment: mock(async () => ({
      ok: true,
      adapter: 'claude_code',
      checks: [{ name: 'mock', passed: true, message: 'ok' }],
    })),
  };
}

function createSlowAdapter(delayMs: number): Adapter {
  return {
    name: 'claude_code',
    execute: async (_ctx: AdapterContext) => {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
      return {
        output: 'Slow result',
        toolCalls: [],
        usage: { inputTokens: 0, outputTokens: 0, costCents: 0, provider: 'mock', model: 'mock' },
        sessionId: null,
      };
    },
    testEnvironment: async () => ({
      ok: true,
      adapter: 'claude_code',
      checks: [],
    }),
  };
}

function createFailingAdapter(errorMessage: string): Adapter {
  return {
    name: 'claude_code',
    execute: async () => {
      throw new Error(errorMessage);
    },
    testEnvironment: async () => ({
      ok: true,
      adapter: 'claude_code',
      checks: [],
    }),
  };
}

// ============================================================
// MOCK DB
// ============================================================

const COMPANY_ID = '550e8400-e29b-41d4-a716-446655440001';
const AGENT_ID = '660e8400-e29b-41d4-a716-446655440002';
const RUN_ID = '770e8400-e29b-41d4-a716-446655440003';

function makeAgentRow(overrides: Record<string, unknown> = {}) {
  return {
    id: AGENT_ID,
    companyId: COMPANY_ID,
    name: 'TestAgent',
    title: 'Engineer',
    role: 'engineer',
    icon: null,
    status: 'idle',
    reportsTo: null,
    capabilities: [],
    permissions: {},
    adapterType: 'claude_code',
    adapterConfig: {},
    modelTier: 'smart',
    modelOverride: null,
    budgetMonthlyCents: 10000n,
    spentMonthlyCents: 0n,
    systemPrompt: 'You are a test agent.',
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function createMockDb(
  options: {
    agentRow?: ReturnType<typeof makeAgentRow> | null;
    runningRun?: { id: string } | null;
    runtimeState?: Record<string, unknown> | null;
  } = {},
) {
  const agentRow = options.agentRow ?? makeAgentRow();
  const runningRun = options.runningRun ?? null;
  const runtimeState = options.runtimeState ?? null;

  let selectCallCount = 0;

  // Track updates for assertions
  const updateCalls: { table: string; values: Record<string, unknown> }[] = [];
  const insertCalls: { table: string; values: Record<string, unknown> }[] = [];

  const db = {
    select: mock((..._args: unknown[]) => ({
      from: mock((_table: unknown) => ({
        where: mock(() => {
          selectCallCount++;
          // Call 1: load agent, Call 2: check running runs, Call 3: load runtime state
          if (selectCallCount === 1) return agentRow ? [agentRow] : [];
          if (selectCallCount === 2) return runningRun ? [runningRun] : [];
          if (selectCallCount === 3) return runtimeState ? [runtimeState] : [];
          return [];
        }),
      })),
    })),
    insert: mock((_table: unknown) => ({
      values: mock((vals: Record<string, unknown>) => {
        insertCalls.push({ table: 'unknown', values: vals });
        return {
          returning: mock(() => [{ id: RUN_ID, ...vals }]),
          onConflictDoUpdate: mock(() => ({})),
        };
      }),
    })),
    update: mock((_table: unknown) => ({
      set: mock((vals: Record<string, unknown>) => {
        updateCalls.push({ table: 'unknown', values: vals });
        return {
          where: mock(() => ({
            returning: mock(() => [{ id: AGENT_ID, ...vals }]),
          })),
        };
      }),
    })),
  };

  return { db, updateCalls, insertCalls };
}

// ============================================================
// MOCK KERNEL HANDLE
// ============================================================

function createMockKernelHandle(overrides: Partial<BudgetStatus> = {}): KernelHandle {
  const budgetStatus: BudgetStatus = {
    budgetCents: 10000n,
    spentCents: 0n,
    remainingCents: 10000n,
    percentUsed: 0,
    isExhausted: false,
    isWarning: false,
    ...overrides,
  };

  return {
    checkBudget: mock(async () => budgetStatus),
    checkCapability: mock(async () => true),
    emitEvent: mock(() => {}),
    recordCost: mock(async () => {}),
  };
}

// ============================================================
// TESTS
// ============================================================

describe('HeartbeatEngine', () => {
  test('successful heartbeat execution', async () => {
    const mockAdapter = createMockAdapter();
    const registry = new AdapterRegistry();
    registry.register(mockAdapter);

    const { db } = createMockDb();
    const eventBus = new InProcessEventBus();
    const emitSpy = mock(() => {});
    eventBus.emit = emitSpy;
    const kernelHandle = createMockKernelHandle();

    const engine = new HeartbeatEngine({
      db: db as never,
      eventBus,
      adapterRegistry: registry,
      kernelHandle,
    });

    const result = await engine.executeHeartbeat(AGENT_ID, 'manual');

    expect(result.status).toBe('succeeded');
    expect(result.runId).toBe(RUN_ID);
    expect(result.output).toBe('Hello from mock adapter');
    expect(result.usage?.costCents).toBe(5);
    expect(result.durationMs).toBeGreaterThanOrEqual(0);

    // Verify adapter was called
    expect(mockAdapter.execute).toHaveBeenCalledTimes(1);

    // Verify heartbeat.completed event was emitted
    expect(emitSpy).toHaveBeenCalledWith(expect.objectContaining({ type: 'heartbeat.completed' }));
  });

  test('concurrency guard prevents duplicate execution', async () => {
    const registry = new AdapterRegistry();
    registry.register(createMockAdapter());

    const { db } = createMockDb({ runningRun: { id: 'existing-run-id' } });
    const eventBus = new InProcessEventBus();
    const kernelHandle = createMockKernelHandle();

    const engine = new HeartbeatEngine({
      db: db as never,
      eventBus,
      adapterRegistry: registry,
      kernelHandle,
    });

    await expect(engine.executeHeartbeat(AGENT_ID, 'manual')).rejects.toThrow(
      'already has a running heartbeat',
    );
  });

  test('budget exhaustion prevents execution', async () => {
    const registry = new AdapterRegistry();
    registry.register(createMockAdapter());

    const { db } = createMockDb();
    const eventBus = new InProcessEventBus();
    const kernelHandle = createMockKernelHandle({ isExhausted: true });

    const engine = new HeartbeatEngine({
      db: db as never,
      eventBus,
      adapterRegistry: registry,
      kernelHandle,
    });

    await expect(engine.executeHeartbeat(AGENT_ID, 'manual')).rejects.toThrow('budget exhausted');
  });

  test('adapter error results in failed run', async () => {
    const registry = new AdapterRegistry();
    registry.register(createFailingAdapter('Adapter crashed'));

    const { db } = createMockDb();
    const eventBus = new InProcessEventBus();
    const emitSpy = mock(() => {});
    eventBus.emit = emitSpy;
    const kernelHandle = createMockKernelHandle();

    const engine = new HeartbeatEngine({
      db: db as never,
      eventBus,
      adapterRegistry: registry,
      kernelHandle,
    });

    const result = await engine.executeHeartbeat(AGENT_ID, 'manual');

    expect(result.status).toBe('failed');
    expect(result.error).toBe('Adapter crashed');

    // Verify heartbeat.failed event was emitted
    expect(emitSpy).toHaveBeenCalledWith(expect.objectContaining({ type: 'heartbeat.failed' }));
  });

  test('timeout results in timed_out run', async () => {
    const registry = new AdapterRegistry();
    registry.register(createSlowAdapter(5000));

    const { db } = createMockDb({
      agentRow: makeAgentRow({
        adapterConfig: { heartbeatTimeoutMs: 100 },
      }),
    });
    const eventBus = new InProcessEventBus();
    const emitSpy = mock(() => {});
    eventBus.emit = emitSpy;
    const kernelHandle = createMockKernelHandle();

    const engine = new HeartbeatEngine({
      db: db as never,
      eventBus,
      adapterRegistry: registry,
      kernelHandle,
    });

    const result = await engine.executeHeartbeat(AGENT_ID, 'manual');

    expect(result.status).toBe('timed_out');
    expect(result.error).toContain('timed out');

    expect(emitSpy).toHaveBeenCalledWith(expect.objectContaining({ type: 'heartbeat.failed' }));
  });

  test('agent not found throws error', async () => {
    const registry = new AdapterRegistry();
    registry.register(createMockAdapter());

    // Create a db mock that always returns empty arrays for all selects
    const emptyDb = {
      select: mock((..._args: unknown[]) => ({
        from: mock((_table: unknown) => ({
          where: mock(() => []),
        })),
      })),
      insert: mock((_table: unknown) => ({
        values: mock(() => ({
          returning: mock(() => []),
          onConflictDoUpdate: mock(() => ({})),
        })),
      })),
      update: mock((_table: unknown) => ({
        set: mock(() => ({
          where: mock(() => ({ returning: mock(() => []) })),
        })),
      })),
    };

    const eventBus = new InProcessEventBus();
    const kernelHandle = createMockKernelHandle();

    const engine = new HeartbeatEngine({
      db: emptyDb as never,
      eventBus,
      adapterRegistry: registry,
      kernelHandle,
    });

    await expect(engine.executeHeartbeat('nonexistent-id', 'manual')).rejects.toThrow(
      'Agent not found',
    );
  });
});
