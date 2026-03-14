import { describe, expect, mock, test } from 'bun:test';
import type { AdapterContext } from '@clawgear/shared/interfaces';
import { ClaudeCodeAdapter } from './index.js';

// ============================================================
// HELPERS
// ============================================================

function makeContext(overrides: Partial<AdapterContext> = {}): AdapterContext {
  return {
    agentId: 'agent-1',
    companyId: 'company-1',
    systemPrompt: 'You are a test agent.',
    taskPrompt: 'Say hello.',
    tools: [],
    sessionId: null,
    timeout: 30_000,
    ...overrides,
  };
}

function makeApiResponse(overrides: Record<string, unknown> = {}) {
  return {
    id: 'msg_123',
    type: 'message',
    role: 'assistant',
    content: [{ type: 'text', text: 'Hello!' }],
    model: 'claude-sonnet-4-20250514',
    stop_reason: 'end_turn',
    usage: { input_tokens: 100, output_tokens: 20 },
    ...overrides,
  };
}

// ============================================================
// TESTS
// ============================================================

describe('ClaudeCodeAdapter', () => {
  test('constructor defaults', () => {
    const adapter = new ClaudeCodeAdapter();
    expect(adapter.name).toBe('claude_code');
  });

  test('execute returns text output and usage', async () => {
    const apiResponse = makeApiResponse();
    const mockFetch = mock(async () => new Response(JSON.stringify(apiResponse), { status: 200 }));
    globalThis.fetch = mockFetch as unknown as typeof fetch;

    const adapter = new ClaudeCodeAdapter({ apiKey: 'test-key' });
    const result = await adapter.execute(makeContext());

    expect(result.output).toBe('Hello!');
    expect(result.usage.inputTokens).toBe(100);
    expect(result.usage.outputTokens).toBe(20);
    expect(result.usage.provider).toBe('anthropic');
    expect(result.usage.model).toBe('claude-sonnet-4-20250514');
    expect(result.usage.costCents).toBeGreaterThanOrEqual(0);

    // Verify API was called with correct structure
    const [url, options] = mockFetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.anthropic.com/v1/messages');
    const body = JSON.parse(options.body as string);
    expect(body.system).toBe('You are a test agent.');
    expect(body.messages[0].content[0].text).toBe('Say hello.');
  });

  test('execute handles tool_use loop', async () => {
    let callCount = 0;
    const mockFetch = mock(async () => {
      callCount++;
      if (callCount === 1) {
        return new Response(
          JSON.stringify(
            makeApiResponse({
              stop_reason: 'tool_use',
              content: [
                { type: 'text', text: 'Let me check...' },
                { type: 'tool_use', id: 'tu_1', name: 'fact_query', input: { subject: 'test' } },
              ],
            }),
          ),
          { status: 200 },
        );
      }
      // Second call: final response
      return new Response(
        JSON.stringify(makeApiResponse({ content: [{ type: 'text', text: 'Done!' }] })),
        { status: 200 },
      );
    });
    globalThis.fetch = mockFetch as unknown as typeof fetch;

    const toolExecutor = mock(async () => ({ found: true }));
    const adapter = new ClaudeCodeAdapter({ apiKey: 'test-key' });
    const result = await adapter.execute(
      makeContext({
        tools: [{ name: 'fact_query', description: 'Query facts', parameters: {} }],
        adapterConfig: { toolExecutor },
      }),
    );

    expect(result.output).toBe('Done!');
    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls[0]!.tool).toBe('fact_query');
    expect(result.toolCalls[0]!.result).toEqual({ found: true });
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  test('execute throws on timeout', async () => {
    const mockFetch = mock(async (_url: string, init: RequestInit) => {
      // Wait for the abort signal
      return new Promise<Response>((_resolve, reject) => {
        const signal = init.signal;
        if (signal) {
          signal.addEventListener('abort', () => {
            const err = new Error('The operation was aborted');
            err.name = 'AbortError';
            reject(err);
          });
        }
      });
    });
    globalThis.fetch = mockFetch as unknown as typeof fetch;

    const adapter = new ClaudeCodeAdapter({ apiKey: 'test-key' });

    await expect(adapter.execute(makeContext({ timeout: 50 }))).rejects.toThrow('timed out');
  });

  test('execute retries on 429', async () => {
    let callCount = 0;
    const mockFetch = mock(async () => {
      callCount++;
      if (callCount === 1) {
        return new Response('rate limited', {
          status: 429,
          headers: { 'retry-after': '0' },
        });
      }
      return new Response(JSON.stringify(makeApiResponse()), { status: 200 });
    });
    globalThis.fetch = mockFetch as unknown as typeof fetch;

    const adapter = new ClaudeCodeAdapter({ apiKey: 'test-key', maxRetries: 3 });
    const result = await adapter.execute(makeContext());

    expect(result.output).toBe('Hello!');
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  test('execute throws on non-retryable error', async () => {
    const mockFetch = mock(async () => new Response('{"error": "bad request"}', { status: 400 }));
    globalThis.fetch = mockFetch as unknown as typeof fetch;

    const adapter = new ClaudeCodeAdapter({ apiKey: 'test-key' });
    await expect(adapter.execute(makeContext())).rejects.toThrow('Anthropic API 400');
  });

  test('model alias resolution', async () => {
    const mockFetch = mock(
      async () => new Response(JSON.stringify(makeApiResponse()), { status: 200 }),
    );
    globalThis.fetch = mockFetch as unknown as typeof fetch;

    const adapter = new ClaudeCodeAdapter({ apiKey: 'test-key', defaultModel: 'haiku' });
    await adapter.execute(makeContext());

    const body = JSON.parse(
      (mockFetch.mock.calls[0] as unknown as [string, RequestInit])[1].body as string,
    );
    expect(body.model).toBe('claude-3-5-haiku-20241022');
  });

  test('cost computation', async () => {
    const response = makeApiResponse({
      model: 'claude-sonnet-4-20250514',
      usage: { input_tokens: 1_000_000, output_tokens: 100_000 },
    });
    const mockFetch = mock(async () => new Response(JSON.stringify(response), { status: 200 }));
    globalThis.fetch = mockFetch as unknown as typeof fetch;

    const adapter = new ClaudeCodeAdapter({ apiKey: 'test-key' });
    const result = await adapter.execute(makeContext());

    // Sonnet: input=300 cents/M, output=1500 cents/M
    // 1M * 300/1M + 100K * 1500/1M = 300 + 150 = 450 cents
    expect(result.usage.costCents).toBe(450);
  });

  test('testEnvironment checks API key and reachability', async () => {
    const mockFetch = mock(async () => new Response('{}', { status: 200 }));
    globalThis.fetch = mockFetch as unknown as typeof fetch;

    const adapter = new ClaudeCodeAdapter({ apiKey: 'test-key' });
    const env = await adapter.testEnvironment();

    expect(env.ok).toBe(true);
    expect(env.adapter).toBe('claude_code');
    expect(env.checks).toHaveLength(2);
    expect(env.checks[0]!.name).toBe('anthropic_api_key');
    expect(env.checks[0]!.passed).toBe(true);
  });

  test('testEnvironment fails without API key', async () => {
    const adapter = new ClaudeCodeAdapter({ apiKey: '' });
    const env = await adapter.testEnvironment();

    expect(env.ok).toBe(false);
    expect(env.checks[0]!.passed).toBe(false);
  });

  test('converts tools to Anthropic format', async () => {
    const mockFetch = mock(
      async () => new Response(JSON.stringify(makeApiResponse()), { status: 200 }),
    );
    globalThis.fetch = mockFetch as unknown as typeof fetch;

    const adapter = new ClaudeCodeAdapter({ apiKey: 'test-key' });
    await adapter.execute(
      makeContext({
        tools: [
          {
            name: 'test_tool',
            description: 'A test tool',
            parameters: { arg1: { type: 'string' } },
          },
        ],
      }),
    );

    const body = JSON.parse(
      (mockFetch.mock.calls[0] as unknown as [string, RequestInit])[1].body as string,
    );
    expect(body.tools).toHaveLength(1);
    expect(body.tools[0].name).toBe('test_tool');
    expect(body.tools[0].input_schema).toBeDefined();
    expect(body.tools[0].input_schema.properties.arg1.type).toBe('string');
  });
});
