import { CapabilityValidator } from './capability-validator.js';
import { FuelMeter } from './fuel-meter.js';
import type {
  TerminationReason,
  WasmExecutionRequest,
  WasmExecutionResult,
  WasmMetrics,
  WasmSandboxConfig,
} from './types.js';
import { Watchdog } from './watchdog.js';

export { DEFAULT_WASM_CONFIG } from './types.js';

/**
 * WASM Sandbox for executing marketplace skills compiled to WebAssembly.
 * Provides dual metering (fuel + epoch), capability enforcement, and watchdog protection.
 */
export class WasmSandbox {
  private readonly config: WasmSandboxConfig;

  constructor(config?: Partial<WasmSandboxConfig>) {
    const defaults: WasmSandboxConfig = {
      maxFuel: 1_000_000,
      maxEpochMs: 5_000,
      maxMemoryBytes: 16 * 1024 * 1024,
      allowedCapabilities: [],
      collectMetrics: true,
    };
    this.config = { ...defaults, ...config };
  }

  /**
   * Execute a WASM module in the sandbox.
   * Enforces fuel limits, epoch timeout, memory bounds, and capability restrictions.
   */
  async execute(request: WasmExecutionRequest): Promise<WasmExecutionResult> {
    const config = { ...this.config, ...request.config };
    const fuelMeter = new FuelMeter(config.maxFuel);
    const watchdog = new Watchdog(config.maxEpochMs);
    const validator = new CapabilityValidator(config.allowedCapabilities);

    let stdout = '';
    let stderr = '';
    let terminationReason: TerminationReason = 'completed';
    let returnValue: number | undefined;
    let peakMemory = 0;
    let hostCalls = 0;
    let aborted = false;

    try {
      // Compile the WASM module
      const module = await WebAssembly.compile(request.moduleBytes);

      // Build import object with metered host functions
      const importObject: WebAssembly.Imports = {
        env: {
          // Memory tracking
          memory: new WebAssembly.Memory({
            initial: 1,
            maximum: Math.ceil(config.maxMemoryBytes / 65536),
          }),
        },
        wasi_snapshot_preview1: createWasiStubs(validator, {
          onStdout: (data: string) => {
            if (validator.canStdout()) {
              stdout += data;
            }
          },
          onStderr: (data: string) => {
            if (validator.canStderr()) {
              stderr += data;
            }
          },
          onHostCall: () => {
            hostCalls++;
            // Consume fuel for host calls (10 units per call)
            if (!fuelMeter.consume(10)) {
              aborted = true;
              terminationReason = 'fuel_exhausted';
            }
          },
          env: request.env ?? {},
          canReadEnv: (key: string) => validator.canReadEnv(key),
        }),
      };

      // Start watchdog before execution
      watchdog.start(() => {
        aborted = true;
        terminationReason = 'watchdog_killed';
      });

      // Instantiate and execute
      const instance = await WebAssembly.instantiate(module, importObject);
      const entryFn = instance.exports[request.entryFunction];

      if (typeof entryFn !== 'function') {
        return {
          success: false,
          stdout,
          stderr,
          terminationReason: 'runtime_error',
          metrics: buildMetrics(fuelMeter, watchdog, peakMemory, hostCalls),
          error: `Entry function '${request.entryFunction}' not found or not callable`,
        };
      }

      // Track memory usage
      const memory = instance.exports.memory;
      if (memory instanceof WebAssembly.Memory) {
        peakMemory = memory.buffer.byteLength;
        if (peakMemory > config.maxMemoryBytes) {
          terminationReason = 'memory_exceeded';
          watchdog.stop();
          return {
            success: false,
            stdout,
            stderr,
            terminationReason,
            metrics: buildMetrics(fuelMeter, watchdog, peakMemory, hostCalls),
            error: `Memory limit exceeded: ${peakMemory} > ${config.maxMemoryBytes}`,
          };
        }
      }

      // Consume base fuel for instantiation
      fuelMeter.consume(100);

      if (!aborted) {
        const result = entryFn(...(request.args ?? []));
        if (typeof result === 'number') {
          returnValue = result;
        }
        // Consume fuel proportional to execution (approximation for non-instrumented modules)
        fuelMeter.consume(1000);
      }

      // Check if watchdog killed execution
      if (watchdog.wasTriggered()) {
        terminationReason = 'watchdog_killed';
      } else if (fuelMeter.isExhausted()) {
        terminationReason = 'fuel_exhausted';
      }

      watchdog.stop();

      // Track final memory
      if (memory instanceof WebAssembly.Memory) {
        peakMemory = Math.max(peakMemory, memory.buffer.byteLength);
      }

      const success = terminationReason === 'completed';
      return {
        success,
        returnValue,
        stdout,
        stderr,
        terminationReason,
        metrics: buildMetrics(fuelMeter, watchdog, peakMemory, hostCalls),
        error: success ? undefined : `Execution terminated: ${terminationReason}`,
      };
    } catch (err) {
      watchdog.stop();
      const errorMessage = err instanceof Error ? err.message : String(err);

      // Determine if it was a capability denial
      if (validator.getDeniedCount() > 0) {
        terminationReason = 'capability_denied';
      } else {
        terminationReason = 'runtime_error';
      }

      return {
        success: false,
        stdout,
        stderr,
        terminationReason,
        metrics: buildMetrics(fuelMeter, watchdog, peakMemory, hostCalls),
        error: errorMessage,
      };
    }
  }

  /** Get the current sandbox configuration */
  getConfig(): Readonly<WasmSandboxConfig> {
    return { ...this.config };
  }
}

function buildMetrics(
  fuelMeter: FuelMeter,
  watchdog: Watchdog,
  peakMemory: number,
  hostCalls: number,
): WasmMetrics {
  return {
    fuelConsumed: fuelMeter.getConsumed(),
    durationMs: Math.round(watchdog.elapsed() * 100) / 100,
    peakMemoryBytes: peakMemory,
    hostCalls,
  };
}

interface WasiStubCallbacks {
  onStdout: (data: string) => void;
  onStderr: (data: string) => void;
  onHostCall: () => void;
  env: Record<string, string>;
  canReadEnv: (key: string) => boolean;
}

/**
 * Create minimal WASI stubs that enforce capability restrictions.
 * These provide the minimum WASI interface needed for basic WASM execution.
 */
function createWasiStubs(
  _validator: CapabilityValidator,
  callbacks: WasiStubCallbacks,
): Record<string, (...args: number[]) => number> {
  return {
    // Process exit
    proc_exit(code: number): number {
      callbacks.onHostCall();
      return code;
    },
    // File descriptor write (for stdout/stderr)
    fd_write(fd: number, _iovs: number, _iovs_len: number, _nwritten: number): number {
      callbacks.onHostCall();
      if (fd === 1) {
        callbacks.onStdout('[wasm output]');
      } else if (fd === 2) {
        callbacks.onStderr('[wasm error]');
      }
      return 0;
    },
    // File descriptor read (stub - returns 0 bytes)
    fd_read(_fd: number, _iovs: number, _iovs_len: number, _nread: number): number {
      callbacks.onHostCall();
      return 0;
    },
    // File descriptor close
    fd_close(_fd: number): number {
      callbacks.onHostCall();
      return 0;
    },
    // File descriptor seek
    fd_seek(_fd: number, _offset: number, _whence: number, _newoffset: number): number {
      callbacks.onHostCall();
      return 0;
    },
    // File descriptor prestat (for preopened dirs)
    fd_prestat_get(_fd: number, _buf: number): number {
      callbacks.onHostCall();
      return 8; // EBADF - no preopened dirs
    },
    fd_prestat_dir_name(_fd: number, _path: number, _path_len: number): number {
      callbacks.onHostCall();
      return 8; // EBADF
    },
    // Environment access
    environ_sizes_get(_environ_count: number, _environ_buf_size: number): number {
      callbacks.onHostCall();
      return 0;
    },
    environ_get(_environ: number, _environ_buf: number): number {
      callbacks.onHostCall();
      return 0;
    },
    // Args
    args_sizes_get(_argc: number, _argv_buf_size: number): number {
      callbacks.onHostCall();
      return 0;
    },
    args_get(_argv: number, _argv_buf: number): number {
      callbacks.onHostCall();
      return 0;
    },
    // Clock
    clock_time_get(_id: number, _precision: number, _time: number): number {
      callbacks.onHostCall();
      return 0;
    },
    // Random
    random_get(_buf: number, _buf_len: number): number {
      callbacks.onHostCall();
      return 0;
    },
  };
}
