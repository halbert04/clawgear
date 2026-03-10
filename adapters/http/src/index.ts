import type {
  Adapter,
  AdapterContext,
  AdapterResult,
  EnvironmentTestResult,
} from '@clawgear/shared/interfaces';

export interface HttpAdapterConfig {
  url: string;
  headers?: Record<string, string>;
  timeoutMs?: number;
}

export class HttpAdapter implements Adapter {
  readonly name = 'http';
  private config: HttpAdapterConfig;

  constructor(config: HttpAdapterConfig) {
    this.config = config;
  }

  async execute(ctx: AdapterContext): Promise<AdapterResult> {
    const controller = new AbortController();
    const timeoutMs = Math.min(ctx.timeout, this.config.timeoutMs ?? ctx.timeout);
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(this.config.url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...this.config.headers,
        },
        body: JSON.stringify({
          agentId: ctx.agentId,
          companyId: ctx.companyId,
          systemPrompt: ctx.systemPrompt,
          taskPrompt: ctx.taskPrompt,
          tools: ctx.tools,
          sessionId: ctx.sessionId,
        }),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const body = await response.text();
        throw new Error(`HTTP adapter returned ${response.status}: ${body}`);
      }

      const result = (await response.json()) as AdapterResult;

      return {
        output: result.output ?? '',
        toolCalls: result.toolCalls ?? [],
        usage: result.usage ?? {
          inputTokens: 0,
          outputTokens: 0,
          costCents: 0,
          provider: 'http',
          model: 'unknown',
        },
        sessionId: result.sessionId ?? ctx.sessionId,
      };
    } catch (err) {
      clearTimeout(timeoutId);
      if (err instanceof Error && err.name === 'AbortError') {
        throw new Error(`HTTP adapter timed out after ${timeoutMs}ms`);
      }
      throw err;
    }
  }

  async testEnvironment(): Promise<EnvironmentTestResult> {
    const checks: EnvironmentTestResult['checks'] = [];

    try {
      const url = new URL(this.config.url);
      checks.push({
        name: 'url_valid',
        passed: true,
        message: `URL: ${url.toString()}`,
      });
    } catch {
      checks.push({
        name: 'url_valid',
        passed: false,
        message: `Invalid URL: ${this.config.url}`,
      });
    }

    return {
      ok: checks.every((c) => c.passed),
      adapter: this.name,
      checks,
    };
  }
}
