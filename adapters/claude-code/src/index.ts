import type {
  Adapter,
  AdapterContext,
  AdapterResult,
  EnvironmentTestResult,
  ToolCallRecord,
} from '@clawgear/shared/interfaces';

export interface ClaudeCodeAdapterConfig {
  apiKey?: string;
  defaultModel?: string;
  apiBaseUrl?: string;
  maxRetries?: number;
}

/** Per-million-token pricing in cents */
const MODEL_PRICING: Record<string, { input: number; output: number }> = {
  'claude-opus-4-20250514': { input: 1500, output: 7500 },
  'claude-sonnet-4-5-20250929': { input: 300, output: 1500 },
  'claude-sonnet-4-20250514': { input: 300, output: 1500 },
  'claude-3-5-haiku-20241022': { input: 80, output: 400 },
};

/** Map short aliases to full model IDs */
const MODEL_ALIASES: Record<string, string> = {
  opus: 'claude-opus-4-20250514',
  sonnet: 'claude-sonnet-4-20250514',
  haiku: 'claude-3-5-haiku-20241022',
};

const RETRYABLE_STATUS_CODES = new Set([408, 429, 500, 502, 503, 504, 529]);
const MAX_TOOL_ROUNDS = 50;

interface AnthropicMessage {
  role: 'user' | 'assistant';
  content: AnthropicContent[];
}

type AnthropicContent =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }
  | { type: 'tool_result'; tool_use_id: string; content: string };

interface AnthropicToolDef {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}

interface AnthropicResponse {
  id: string;
  type: 'message';
  role: 'assistant';
  content: AnthropicContent[];
  model: string;
  stop_reason: 'end_turn' | 'tool_use' | 'max_tokens' | 'stop_sequence';
  usage: { input_tokens: number; output_tokens: number };
}

export class ClaudeCodeAdapter implements Adapter {
  readonly name = 'claude_code';
  private apiKey: string;
  private defaultModel: string;
  private apiBaseUrl: string;
  private maxRetries: number;

  constructor(config: ClaudeCodeAdapterConfig = {}) {
    const apiKey = config.apiKey ?? process.env.ANTHROPIC_API_KEY ?? '';
    if (!apiKey) {
      throw new Error(
        'ClaudeCodeAdapter: ANTHROPIC_API_KEY environment variable is required. ' +
          'Set it in your environment or pass apiKey in config.',
      );
    }
    this.apiKey = apiKey;
    this.defaultModel = config.defaultModel ?? 'sonnet';
    this.apiBaseUrl = config.apiBaseUrl ?? 'https://api.anthropic.com';
    this.maxRetries = config.maxRetries ?? 3;
  }

  async execute(ctx: AdapterContext): Promise<AdapterResult> {
    const modelId = this.resolveModel(ctx);
    const tools = this.convertTools(ctx.tools);
    const toolExecutor = this.buildToolExecutor(ctx);

    const messages: AnthropicMessage[] = [
      { role: 'user', content: [{ type: 'text', text: ctx.taskPrompt }] },
    ];

    let totalInputTokens = 0;
    let totalOutputTokens = 0;
    const toolCalls: ToolCallRecord[] = [];

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), ctx.timeout);

    try {
      for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
        const response = await this.callApi(
          {
            model: modelId,
            max_tokens: modelId.includes('opus') ? 32768 : 8192,
            system: ctx.systemPrompt,
            messages,
            tools: tools.length > 0 ? tools : undefined,
          },
          controller.signal,
        );

        totalInputTokens += response.usage.input_tokens;
        totalOutputTokens += response.usage.output_tokens;

        if (response.stop_reason !== 'tool_use') {
          // Final response - extract text output
          const output = response.content
            .filter((c): c is { type: 'text'; text: string } => c.type === 'text')
            .map((c) => c.text)
            .join('\n');

          clearTimeout(timeoutId);

          return {
            output,
            toolCalls,
            usage: {
              inputTokens: totalInputTokens,
              outputTokens: totalOutputTokens,
              costCents: this.computeCost(modelId, totalInputTokens, totalOutputTokens),
              provider: 'anthropic',
              model: modelId,
            },
            sessionId: ctx.sessionId,
          };
        }

        // Tool use round - execute tools and continue
        messages.push({ role: 'assistant', content: response.content });

        const toolResults: AnthropicContent[] = [];
        for (const block of response.content) {
          if (block.type !== 'tool_use') continue;

          const startMs = Date.now();
          let result: unknown;
          try {
            result = await toolExecutor(block.name, block.input);
          } catch (err) {
            result = { error: err instanceof Error ? err.message : String(err) };
          }
          const durationMs = Date.now() - startMs;

          toolCalls.push({ tool: block.name, args: block.input, result, durationMs });
          toolResults.push({
            type: 'tool_result',
            tool_use_id: block.id,
            content: typeof result === 'string' ? result : JSON.stringify(result),
          });
        }

        messages.push({ role: 'user', content: toolResults });
      }

      // Exhausted tool rounds
      clearTimeout(timeoutId);
      throw new Error(`Exceeded maximum tool rounds (${MAX_TOOL_ROUNDS})`);
    } catch (err) {
      clearTimeout(timeoutId);
      if (err instanceof Error && err.name === 'AbortError') {
        throw new Error(`Anthropic API timed out after ${ctx.timeout}ms`);
      }
      throw err;
    }
  }

  async testEnvironment(): Promise<EnvironmentTestResult> {
    const checks: EnvironmentTestResult['checks'] = [];

    checks.push({
      name: 'anthropic_api_key',
      passed: true,
      message: 'ANTHROPIC_API_KEY is set',
    });

    try {
      const res = await fetch(`${this.apiBaseUrl}/v1/messages`, {
        method: 'POST',
        headers: this.buildHeaders(),
        body: JSON.stringify({
          model: this.resolveModel({} as AdapterContext),
          max_tokens: 1,
          messages: [{ role: 'user', content: 'ping' }],
        }),
      });
      // Any response (even 400) means the API is reachable
      checks.push({
        name: 'anthropic_api_reachable',
        passed: res.status < 500,
        message: res.status < 500 ? `API reachable (${res.status})` : `API error (${res.status})`,
      });
    } catch (err) {
      checks.push({
        name: 'anthropic_api_reachable',
        passed: false,
        message: `API unreachable: ${err instanceof Error ? err.message : String(err)}`,
      });
    }

    return {
      ok: checks.every((c) => c.passed),
      adapter: this.name,
      checks,
    };
  }

  private resolveModel(ctx: AdapterContext): string {
    const configModel = (ctx.adapterConfig?.model as string) ?? this.defaultModel;
    return MODEL_ALIASES[configModel] ?? configModel;
  }

  private buildHeaders(): Record<string, string> {
    return {
      'x-api-key': this.apiKey,
      'anthropic-version': '2023-06-01',
      'Content-Type': 'application/json',
    };
  }

  private convertTools(tools: AdapterContext['tools']): AnthropicToolDef[] {
    return tools.map((t) => ({
      name: t.name,
      description: t.description,
      input_schema: {
        type: 'object',
        properties: t.parameters,
      },
    }));
  }

  private buildToolExecutor(
    ctx: AdapterContext,
  ): (name: string, args: Record<string, unknown>) => Promise<unknown> {
    // The kernel provides a toolExecutor via adapterConfig if tools are registered
    const executor = ctx.adapterConfig?.toolExecutor as
      | ((name: string, args: Record<string, unknown>) => Promise<unknown>)
      | undefined;

    if (executor) return executor;

    // No executor available - return error for any tool call
    return async (name: string) => {
      return { error: `No tool executor configured for tool: ${name}` };
    };
  }

  private async callApi(
    body: Record<string, unknown>,
    signal: AbortSignal,
  ): Promise<AnthropicResponse> {
    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      try {
        const res = await fetch(`${this.apiBaseUrl}/v1/messages`, {
          method: 'POST',
          headers: this.buildHeaders(),
          body: JSON.stringify(body),
          signal,
        });

        if (res.ok) {
          return (await res.json()) as AnthropicResponse;
        }

        if (RETRYABLE_STATUS_CODES.has(res.status) && attempt < this.maxRetries) {
          const retryAfter = res.headers.get('retry-after');
          const delayMs = retryAfter
            ? Number(retryAfter) * 1000
            : Math.min(1000 * 2 ** attempt, 30_000);
          await new Promise((resolve) => setTimeout(resolve, delayMs));
          lastError = new Error(`Anthropic API ${res.status}: ${await res.text()}`);
          continue;
        }

        const errorBody = await res.text();
        throw new Error(`Anthropic API ${res.status}: ${errorBody}`);
      } catch (err) {
        if (err instanceof Error && err.name === 'AbortError') throw err;
        if (
          attempt < this.maxRetries &&
          !(err instanceof Error && err.message.startsWith('Anthropic API 4'))
        ) {
          lastError = err instanceof Error ? err : new Error(String(err));
          const delayMs = Math.min(1000 * 2 ** attempt, 30_000);
          await new Promise((resolve) => setTimeout(resolve, delayMs));
          continue;
        }
        throw err;
      }
    }

    throw lastError ?? new Error('Anthropic API call failed after retries');
  }

  private computeCost(model: string, inputTokens: number, outputTokens: number): number {
    const pricing = MODEL_PRICING[model];
    if (!pricing) return 0;
    // Pricing is in cents per million tokens
    return Math.round((inputTokens * pricing.input + outputTokens * pricing.output) / 1_000_000);
  }
}
