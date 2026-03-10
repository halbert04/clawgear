import type {
  Adapter,
  AdapterContext,
  AdapterResult,
  EnvironmentTestResult,
} from '@clawgear/shared/interfaces';

export interface ProcessAdapterConfig {
  command: string;
  args?: string[];
  cwd?: string;
  env?: Record<string, string>;
}

export class ProcessAdapter implements Adapter {
  readonly name = 'process';
  private config: ProcessAdapterConfig;

  constructor(config: ProcessAdapterConfig) {
    this.config = config;
  }

  async execute(ctx: AdapterContext): Promise<AdapterResult> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), ctx.timeout);

    try {
      const proc = Bun.spawn([this.config.command, ...(this.config.args ?? [])], {
        stdout: 'pipe',
        stderr: 'pipe',
        cwd: this.config.cwd,
        env: {
          ...process.env,
          ...this.config.env,
          CLAWGEAR_AGENT_ID: ctx.agentId,
          CLAWGEAR_COMPANY_ID: ctx.companyId,
          CLAWGEAR_SYSTEM_PROMPT: ctx.systemPrompt,
          CLAWGEAR_TASK_PROMPT: ctx.taskPrompt,
          CLAWGEAR_SESSION_ID: ctx.sessionId ?? '',
        },
        signal: controller.signal,
      });

      const stdout = await new Response(proc.stdout).text();
      const stderr = await new Response(proc.stderr).text();
      const exitCode = await proc.exited;

      clearTimeout(timeoutId);

      if (exitCode !== 0) {
        throw new Error(`Process exited with code ${exitCode}: ${stderr}`);
      }

      return {
        output: stdout.trim(),
        toolCalls: [],
        usage: {
          inputTokens: 0,
          outputTokens: 0,
          costCents: 0,
          provider: 'process',
          model: this.config.command,
        },
        sessionId: ctx.sessionId,
      };
    } catch (err) {
      clearTimeout(timeoutId);
      if (err instanceof Error && err.name === 'AbortError') {
        throw new Error(`Process timed out after ${ctx.timeout}ms`);
      }
      throw err;
    }
  }

  async testEnvironment(): Promise<EnvironmentTestResult> {
    const checks: EnvironmentTestResult['checks'] = [];

    try {
      const proc = Bun.spawn(['which', this.config.command], {
        stdout: 'pipe',
        stderr: 'pipe',
      });
      const stdout = await new Response(proc.stdout).text();
      const exitCode = await proc.exited;

      checks.push({
        name: 'command_exists',
        passed: exitCode === 0,
        message:
          exitCode === 0 ? `Found: ${stdout.trim()}` : `Command not found: ${this.config.command}`,
      });
    } catch {
      checks.push({
        name: 'command_exists',
        passed: false,
        message: `Failed to check for command: ${this.config.command}`,
      });
    }

    return {
      ok: checks.every((c) => c.passed),
      adapter: this.name,
      checks,
    };
  }
}
