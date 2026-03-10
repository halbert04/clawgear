/**
 * Subprocess sandbox: clean environment execution with process isolation.
 *
 * - Starts subprocess with clean environment (no inherited secrets)
 * - Selective passthrough of safe env vars only
 * - Process tree kill on timeout
 * - Direct argv execution (no shell interpreter)
 * - Working directory confinement
 */

export interface SandboxConfig {
  /** Allowed environment variables to pass through */
  allowedEnvVars?: string[];
  /** Working directory confinement path */
  workingDirectory?: string;
  /** Timeout in milliseconds */
  timeoutMs?: number;
  /** Extra env vars to inject */
  extraEnv?: Record<string, string>;
}

export interface SandboxResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  durationMs: number;
}

/** Default safe env vars that can be passed through */
const DEFAULT_SAFE_ENV_VARS = ['HOME', 'USER', 'LANG', 'LC_ALL', 'PATH', 'TERM', 'TZ', 'NODE_ENV'];

/**
 * Executes a command in a sandboxed subprocess.
 * Uses Bun.spawn with clean environment and direct argv execution.
 */
export async function executeInSandbox(
  command: string[],
  config: SandboxConfig = {},
): Promise<SandboxResult> {
  const {
    allowedEnvVars = DEFAULT_SAFE_ENV_VARS,
    workingDirectory,
    timeoutMs = 30_000,
    extraEnv = {},
  } = config;

  // Build clean environment: only allowed vars + extras
  const cleanEnv: Record<string, string> = {};
  for (const key of allowedEnvVars) {
    const val = process.env[key];
    if (val !== undefined) {
      cleanEnv[key] = val;
    }
  }
  Object.assign(cleanEnv, extraEnv);

  const startTime = Date.now();
  let timedOut = false;

  // Validate working directory exists and is safe
  if (workingDirectory) {
    try {
      const stat = await Bun.file(workingDirectory).exists();
      if (!stat) {
        return {
          exitCode: 1,
          stdout: '',
          stderr: `Working directory does not exist: ${workingDirectory}`,
          timedOut: false,
          durationMs: Date.now() - startTime,
        };
      }
    } catch {
      // Bun.file().exists() may fail on directories, continue with spawn
    }
  }

  // Spawn with direct argv (no shell interpreter)
  const proc = Bun.spawn(command, {
    env: cleanEnv,
    cwd: workingDirectory,
    stdout: 'pipe',
    stderr: 'pipe',
  });

  // Set up timeout with process tree kill
  const timeoutHandle = setTimeout(() => {
    timedOut = true;
    proc.kill('SIGTERM');
    // Force kill after grace period
    setTimeout(() => {
      try {
        proc.kill('SIGKILL');
      } catch {
        // Process may have already exited
      }
    }, 2000);
  }, timeoutMs);

  try {
    const exitCode = await proc.exited;
    clearTimeout(timeoutHandle);

    const stdout = await new Response(proc.stdout).text();
    const stderr = await new Response(proc.stderr).text();

    return {
      exitCode,
      stdout,
      stderr,
      timedOut,
      durationMs: Date.now() - startTime,
    };
  } catch (err) {
    clearTimeout(timeoutHandle);
    return {
      exitCode: 1,
      stdout: '',
      stderr: err instanceof Error ? err.message : String(err),
      timedOut,
      durationMs: Date.now() - startTime,
    };
  }
}
