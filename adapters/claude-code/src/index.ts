import type {
  Adapter,
  AdapterContext,
  AdapterResult,
  EnvironmentTestResult,
} from '@clawgear/shared/interfaces';

export interface ClaudeCodeAdapterConfig {
  claudeBinaryPath?: string;
  defaultModel?: string;
}

export class ClaudeCodeAdapter implements Adapter {
  readonly name = 'claude_code';
  private binaryPath: string;
  private defaultModel: string;

  constructor(config: ClaudeCodeAdapterConfig = {}) {
    this.binaryPath = config.claudeBinaryPath ?? 'claude';
    this.defaultModel = config.defaultModel ?? 'sonnet';
  }

  async execute(ctx: AdapterContext): Promise<AdapterResult> {
    const args = ['--print', '--output-format', 'json'];

    if (ctx.sessionId) {
      args.push('--session-id', ctx.sessionId);
    }

    args.push('--model', this.defaultModel);

    const prompt = `${ctx.systemPrompt}\n\n---\n\n${ctx.taskPrompt}`;
    args.push(prompt);

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), ctx.timeout);

    try {
      const proc = Bun.spawn([this.binaryPath, ...args], {
        stdout: 'pipe',
        stderr: 'pipe',
        signal: controller.signal,
      });

      const stdout = await new Response(proc.stdout).text();
      const stderr = await new Response(proc.stderr).text();
      const exitCode = await proc.exited;

      clearTimeout(timeoutId);

      if (exitCode !== 0) {
        throw new Error(`Claude CLI exited with code ${exitCode}: ${stderr}`);
      }

      return this.parseOutput(stdout, ctx.sessionId);
    } catch (err) {
      clearTimeout(timeoutId);
      if (err instanceof Error && err.name === 'AbortError') {
        throw new Error(`Claude CLI timed out after ${ctx.timeout}ms`);
      }
      throw err;
    }
  }

  private parseOutput(stdout: string, sessionId: string | null): AdapterResult {
    try {
      const parsed = JSON.parse(stdout);
      return {
        output: parsed.result ?? parsed.text ?? stdout,
        toolCalls: [],
        usage: {
          inputTokens: parsed.usage?.input_tokens ?? parsed.input_tokens ?? 0,
          outputTokens: parsed.usage?.output_tokens ?? parsed.output_tokens ?? 0,
          costCents: parsed.usage?.cost_cents ?? parsed.cost_cents ?? 0,
          provider: 'anthropic',
          model: parsed.model ?? this.defaultModel,
        },
        sessionId: parsed.session_id ?? sessionId,
      };
    } catch {
      // If output isn't JSON, treat raw stdout as the result
      return {
        output: stdout.trim(),
        toolCalls: [],
        usage: {
          inputTokens: 0,
          outputTokens: 0,
          costCents: 0,
          provider: 'anthropic',
          model: this.defaultModel,
        },
        sessionId,
      };
    }
  }

  async testEnvironment(): Promise<EnvironmentTestResult> {
    const checks: EnvironmentTestResult['checks'] = [];

    try {
      const proc = Bun.spawn([this.binaryPath, '--version'], {
        stdout: 'pipe',
        stderr: 'pipe',
      });
      const stdout = await new Response(proc.stdout).text();
      const exitCode = await proc.exited;

      checks.push({
        name: 'claude_binary',
        passed: exitCode === 0,
        message: exitCode === 0 ? `Found: ${stdout.trim()}` : 'Claude CLI not found',
      });
    } catch {
      checks.push({
        name: 'claude_binary',
        passed: false,
        message: `Claude CLI not found at: ${this.binaryPath}`,
      });
    }

    return {
      ok: checks.every((c) => c.passed),
      adapter: this.name,
      checks,
    };
  }
}
