import { describe, expect, it, mock } from 'bun:test';
import { HandAdapter } from './index.js';

function createMockAdapterRegistry() {
  const mockInnerAdapter = {
    name: 'claude_code',
    execute: mock(() =>
      Promise.resolve({
        output:
          'Research complete.\nFACT: ClawGear | is | awesome\nFACT: Hands | enable | autonomy',
        toolCalls: [],
        usage: {
          inputTokens: 100,
          outputTokens: 50,
          costCents: 1,
          provider: 'anthropic',
          model: 'claude-sonnet-4-20250514',
        },
        sessionId: null,
      }),
    ),
    testEnvironment: mock(() => Promise.resolve({ ok: true, adapter: 'claude_code', checks: [] })),
  };

  return {
    get: mock(() => mockInnerAdapter),
    register: mock(() => {}),
    list: mock(() => ['claude_code']),
    testAll: mock(() => Promise.resolve([])),
    _innerAdapter: mockInnerAdapter,
  };
}

function createMockDb() {
  const insertedValues: unknown[] = [];
  return {
    insert: mock(() => ({
      values: mock((vals: unknown) => {
        insertedValues.push(vals);
        return { returning: mock(() => Promise.resolve([{ id: 'test-id' }])) };
      }),
    })),
    select: mock(() => ({
      from: mock(() => ({
        where: mock(() => ({
          limit: mock(() => Promise.resolve([{ id: 'issue-1' }])),
        })),
      })),
    })),
    update: mock(() => ({
      set: mock(() => ({
        where: mock(() => ({
          returning: mock(() => Promise.resolve([{ id: 'test' }])),
        })),
      })),
    })),
    _insertedValues: insertedValues,
  } as unknown;
}

function createMockEventBus() {
  return {
    emit: mock(() => {}),
    on: mock(() => ({ unsubscribe: () => {} })),
    once: mock(() => ({ unsubscribe: () => {} })),
  };
}

describe('HandAdapter', () => {
  it('has correct name', () => {
    const adapter = new HandAdapter({
      adapterRegistry: createMockAdapterRegistry() as never,
      db: createMockDb() as never,
      eventBus: createMockEventBus() as never,
    });
    expect(adapter.name).toBe('hand');
  });

  it('delegates to inner adapter', async () => {
    const registry = createMockAdapterRegistry();
    const adapter = new HandAdapter({
      adapterRegistry: registry as never,
      db: createMockDb() as never,
      eventBus: createMockEventBus() as never,
    });

    const result = await adapter.execute({
      agentId: 'agent-1',
      companyId: 'company-1',
      systemPrompt: '',
      taskPrompt: 'research topic',
      tools: [],
      sessionId: null,
      timeout: 60000,
      adapterConfig: {
        handConfig: {
          name: 'researcher',
          description: 'Research hand',
          schedule: '0 */6 * * *',
          innerAdapter: 'claude_code',
          innerAdapterConfig: {},
          taskPrompt: 'Do research',
          tools: [],
          settings: {},
          metrics: [],
          requiresApproval: false,
          outputMode: 'silent',
          ownerAgentId: null,
        },
      },
    });

    expect(result.output).toContain('Research complete');
    expect(registry.get).toHaveBeenCalledWith('claude_code');
    expect(registry._innerAdapter.execute).toHaveBeenCalled();
  });

  it('creates approval request when requiresApproval is true', async () => {
    const db = createMockDb();
    const eventBus = createMockEventBus();
    const adapter = new HandAdapter({
      adapterRegistry: createMockAdapterRegistry() as never,
      db: db as never,
      eventBus: eventBus as never,
    });

    const result = await adapter.execute({
      agentId: 'agent-1',
      companyId: 'company-1',
      systemPrompt: '',
      taskPrompt: 'automate browser',
      tools: [],
      sessionId: null,
      timeout: 60000,
      adapterConfig: {
        handConfig: {
          name: 'browser',
          description: 'Browser hand',
          schedule: '0 9 * * 1-5',
          innerAdapter: 'claude_code',
          innerAdapterConfig: {},
          taskPrompt: 'Automate browser',
          tools: [],
          settings: {},
          metrics: [],
          requiresApproval: true,
          outputMode: 'comment',
          ownerAgentId: null,
        },
      },
    });

    expect(result.output).toContain('requires approval');
    expect(result.usage.costCents).toBe(0);
    expect(eventBus.emit).toHaveBeenCalled();
  });

  it('processes fact output mode', async () => {
    const db = createMockDb();
    const adapter = new HandAdapter({
      adapterRegistry: createMockAdapterRegistry() as never,
      db: db as never,
      eventBus: createMockEventBus() as never,
    });

    await adapter.execute({
      agentId: 'agent-1',
      companyId: 'company-1',
      systemPrompt: '',
      taskPrompt: 'collect data',
      tools: [],
      sessionId: null,
      timeout: 60000,
      adapterConfig: {
        handConfig: {
          name: 'collector',
          description: 'Collector hand',
          schedule: '0 */4 * * *',
          innerAdapter: 'claude_code',
          innerAdapterConfig: {},
          taskPrompt: 'Collect data',
          tools: [],
          settings: {},
          metrics: [],
          requiresApproval: false,
          outputMode: 'fact',
          ownerAgentId: null,
        },
      },
    });

    // The mock inner adapter returns output with FACT lines,
    // so storeFacts should have been called
    expect((db as Record<string, unknown>).insert).toHaveBeenCalled();
  });

  it('throws on missing handConfig', async () => {
    const adapter = new HandAdapter({
      adapterRegistry: createMockAdapterRegistry() as never,
      db: createMockDb() as never,
      eventBus: createMockEventBus() as never,
    });

    expect(
      adapter.execute({
        agentId: 'agent-1',
        companyId: 'company-1',
        systemPrompt: '',
        taskPrompt: '',
        tools: [],
        sessionId: null,
        timeout: 60000,
        adapterConfig: {},
      }),
    ).rejects.toThrow('missing handConfig');
  });

  it('passes testEnvironment check', async () => {
    const adapter = new HandAdapter({
      adapterRegistry: createMockAdapterRegistry() as never,
      db: createMockDb() as never,
      eventBus: createMockEventBus() as never,
    });

    const result = await adapter.testEnvironment();
    expect(result.ok).toBe(true);
    expect(result.adapter).toBe('hand');
  });
});
