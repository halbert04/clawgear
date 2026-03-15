import { describe, expect, mock, test } from 'bun:test';
import { AdapterRegistry } from '@clawgear/runtime';
import type {
  Adapter,
  AdapterContext,
  AdapterResult,
  BudgetStatus,
  KernelHandle,
  ToolDefinition,
} from '@clawgear/shared/interfaces';
import { InProcessEventBus } from './event-bus.js';
import { HeartbeatEngine } from './heartbeat-engine.js';

/**
 * Integration test for the heartbeat pipeline wiring.
 * Validates that tool definitions and toolExecutor are properly
 * threaded from HeartbeatEngine → assembleContext → Adapter.
 */

const COMPANY_ID = '550e8400-e29b-41d4-a716-446655440001';
const AGENT_ID = '660e8400-e29b-41d4-a716-446655440002';
const RUN_ID = '770e8400-e29b-41d4-a716-446655440003';

// Adapter that captures what it receives and optionally calls tools
class CapturingAdapter implements Adapter {
  readonly name = 'claude_code';
  capturedCtx: AdapterContext | null = null;
  toolCallResults: unknown[] = [];

  async execute(ctx: AdapterContext): Promise<AdapterResult> {
    this.capturedCtx = ctx;

    // If tools are provided, try calling the toolExecutor
    const toolExecutor = ctx.adapterConfig?.toolExecutor as
      | ((name: string, args: Record<string, unknown>) => Promise<unknown>)
      | undefined;

    if (toolExecutor) {
      try {
        const result = await toolExecutor('report_progress', {
          status: 'working',
          percentComplete: 50,
          details: 'Halfway done',
        });
        this.toolCallResults.push(result);
      } catch (err) {
        this.toolCallResults.push({ error: String(err) });
      }
    }

    return {
      output: 'Executed with tools',
      toolCalls: [],
      usage: {
        inputTokens: 100,
        outputTokens: 50,
        costCents: 5,
        provider: 'mock',
        model: 'mock-model',
      },
      sessionId: 'session-123',
    };
  }

  async testEnvironment() {
    return { ok: true, adapter: 'claude_code', checks: [] };
  }
}

function makeAgentRow() {
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
  };
}

function createMockDb() {
  let selectCallCount = 0;

  return {
    select: mock((..._args: unknown[]) => ({
      from: mock((_table: unknown) => ({
        where: mock(() => {
          selectCallCount++;
          if (selectCallCount === 1) return [makeAgentRow()];
          return [];
        }),
      })),
    })),
    insert: mock((_table: unknown) => ({
      values: mock((vals: Record<string, unknown>) => ({
        returning: mock(() => [{ id: RUN_ID, ...vals }]),
        onConflictDoUpdate: mock(() => ({})),
      })),
    })),
    update: mock((_table: unknown) => ({
      set: mock((_vals: Record<string, unknown>) => ({
        where: mock(() => ({
          returning: mock(() => [{ id: AGENT_ID }]),
        })),
      })),
    })),
  };
}

function createMockKernelHandle(): KernelHandle {
  return {
    checkBudget: mock(
      async (): Promise<BudgetStatus> => ({
        budgetCents: 10000n,
        spentCents: 0n,
        remainingCents: 10000n,
        percentUsed: 0,
        isExhausted: false,
        isWarning: false,
      }),
    ),
    checkCapability: mock(async () => true),
    emitEvent: mock(() => {}),
    recordCost: mock(async () => {}),
  };
}

describe('HeartbeatEngine wiring', () => {
  test('adapter receives tool definitions', async () => {
    const adapter = new CapturingAdapter();
    const registry = new AdapterRegistry();
    registry.register(adapter);

    const db = createMockDb();
    const eventBus = new InProcessEventBus();

    const engine = new HeartbeatEngine({
      db: db as never,
      eventBus,
      adapterRegistry: registry,
      kernelHandle: createMockKernelHandle(),
    });

    await engine.executeHeartbeat(AGENT_ID, 'manual');

    // The adapter should have received the context
    expect(adapter.capturedCtx).not.toBeNull();

    // Tools should be populated (getKernelToolDefinitions returns 26+ tools)
    const tools = adapter.capturedCtx!.tools;
    expect(tools.length).toBeGreaterThan(10);

    // Check specific well-known tools exist
    const toolNames = tools.map((t: ToolDefinition) => t.name);
    expect(toolNames).toContain('checkout_issue');
    expect(toolNames).toContain('update_issue_status');
    expect(toolNames).toContain('add_comment');
    expect(toolNames).toContain('memory_store');
    expect(toolNames).toContain('memory_retrieve');
    expect(toolNames).toContain('fact_store');
    expect(toolNames).toContain('message_agent');
    expect(toolNames).toContain('report_progress');
    expect(toolNames).toContain('complete_task');
    // CEO tools
    expect(toolNames).toContain('list_agents');
    expect(toolNames).toContain('create_issue');
    expect(toolNames).toContain('assign_issue');
  });

  test('adapter receives working toolExecutor', async () => {
    const adapter = new CapturingAdapter();
    const registry = new AdapterRegistry();
    registry.register(adapter);

    const db = createMockDb();
    const eventBus = new InProcessEventBus();
    const emittedEvents: unknown[] = [];
    eventBus.emit = ((event: unknown) => {
      emittedEvents.push(event);
    }) as typeof eventBus.emit;

    const engine = new HeartbeatEngine({
      db: db as never,
      eventBus,
      adapterRegistry: registry,
      kernelHandle: createMockKernelHandle(),
    });

    await engine.executeHeartbeat(AGENT_ID, 'manual');

    // The adapter should have a toolExecutor in adapterConfig
    const toolExecutor = adapter.capturedCtx!.adapterConfig?.toolExecutor;
    expect(toolExecutor).toBeDefined();
    expect(typeof toolExecutor).toBe('function');

    // The adapter called report_progress, which emits an event
    expect(adapter.toolCallResults.length).toBe(1);
    expect(adapter.toolCallResults[0]).toEqual({ reported: true });

    // The event bus should have received the agent.progress event
    const progressEvent = emittedEvents.find(
      (e) => (e as Record<string, unknown>).type === 'agent.progress',
    );
    expect(progressEvent).toBeDefined();
  });

  test('toolExecutor is scoped to correct agent and company', async () => {
    const adapter = new CapturingAdapter();
    const registry = new AdapterRegistry();
    registry.register(adapter);

    const db = createMockDb();
    const eventBus = new InProcessEventBus();
    const emittedEvents: unknown[] = [];
    eventBus.emit = ((event: unknown) => {
      emittedEvents.push(event);
    }) as typeof eventBus.emit;

    const engine = new HeartbeatEngine({
      db: db as never,
      eventBus,
      adapterRegistry: registry,
      kernelHandle: createMockKernelHandle(),
    });

    await engine.executeHeartbeat(AGENT_ID, 'manual');

    // The progress event should contain the correct agentId
    const progressEvent = emittedEvents.find(
      (e) => (e as Record<string, unknown>).type === 'agent.progress',
    ) as Record<string, unknown> | undefined;
    expect(progressEvent).toBeDefined();
    expect((progressEvent!.payload as Record<string, unknown>).agentId).toBe(AGENT_ID);
    expect(progressEvent!.companyId).toBe(COMPANY_ID);
  });

  test('system prompt includes tool manifest', async () => {
    const adapter = new CapturingAdapter();
    const registry = new AdapterRegistry();
    registry.register(adapter);

    const db = createMockDb();
    const eventBus = new InProcessEventBus();

    const engine = new HeartbeatEngine({
      db: db as never,
      eventBus,
      adapterRegistry: registry,
      kernelHandle: createMockKernelHandle(),
    });

    await engine.executeHeartbeat(AGENT_ID, 'manual');

    // The system prompt should include "Available Tools"
    const systemPrompt = adapter.capturedCtx!.systemPrompt;
    expect(systemPrompt).toContain('Available Tools');
    expect(systemPrompt).toContain('checkout_issue');
    expect(systemPrompt).toContain('list_agents');
  });
});
