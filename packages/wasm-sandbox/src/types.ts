export interface WasmSandboxConfig {
  /** Maximum fuel (instruction count) before termination. Default: 1_000_000 */
  maxFuel: number;
  /** Maximum wall-clock execution time in ms (epoch metering). Default: 5000 */
  maxEpochMs: number;
  /** Maximum memory in bytes the WASM module can allocate. Default: 16MB */
  maxMemoryBytes: number;
  /** Allowed WASI capabilities (empty = no host access) */
  allowedCapabilities: WasmCapability[];
  /** Whether to collect execution metrics */
  collectMetrics: boolean;
}

export type WasmCapability =
  | { type: 'fs_read'; paths: string[] }
  | { type: 'fs_write'; paths: string[] }
  | { type: 'net_connect'; hosts: string[] }
  | { type: 'env_var'; keys: string[] }
  | { type: 'stdout' }
  | { type: 'stderr' };

export interface WasmExecutionRequest {
  /** The WASM module bytes */
  moduleBytes: Uint8Array;
  /** Entry function to call (default: '_start' for WASI or 'main') */
  entryFunction: string;
  /** Arguments to pass to the entry function */
  args?: number[];
  /** Environment variables available to the WASM module */
  env?: Record<string, string>;
  /** Sandbox configuration overrides */
  config?: Partial<WasmSandboxConfig>;
}

export interface WasmExecutionResult {
  success: boolean;
  /** Return value from the WASM function (if any) */
  returnValue?: number;
  /** Captured stdout output */
  stdout: string;
  /** Captured stderr output */
  stderr: string;
  /** Why execution stopped */
  terminationReason: TerminationReason;
  /** Execution metrics */
  metrics: WasmMetrics;
  /** Error message if failed */
  error?: string;
}

export type TerminationReason =
  | 'completed'
  | 'fuel_exhausted'
  | 'epoch_timeout'
  | 'memory_exceeded'
  | 'capability_denied'
  | 'runtime_error'
  | 'watchdog_killed';

export interface WasmMetrics {
  /** Fuel consumed (instructions executed) */
  fuelConsumed: number;
  /** Wall-clock duration in milliseconds */
  durationMs: number;
  /** Peak memory usage in bytes */
  peakMemoryBytes: number;
  /** Number of host calls made */
  hostCalls: number;
}

export const DEFAULT_WASM_CONFIG: WasmSandboxConfig = {
  maxFuel: 1_000_000,
  maxEpochMs: 5_000,
  maxMemoryBytes: 16 * 1024 * 1024,
  allowedCapabilities: [],
  collectMetrics: true,
};
