import { describe, expect, it } from 'bun:test';
import { CapabilityValidator } from './capability-validator.js';
import { FuelMeter } from './fuel-meter.js';
import { WasmSandbox } from './sandbox.js';
import { DEFAULT_WASM_CONFIG } from './types.js';
import { Watchdog } from './watchdog.js';

// Minimal WASM module that exports an 'add' function: (i32, i32) -> i32
// Generated from WAT: (module (func (export "add") (param i32 i32) (result i32) local.get 0 local.get 1 i32.add))
const ADD_WASM = new Uint8Array([
  0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00, 0x01, 0x07, 0x01, 0x60, 0x02, 0x7f, 0x7f, 0x01,
  0x7f, 0x03, 0x02, 0x01, 0x00, 0x07, 0x07, 0x01, 0x03, 0x61, 0x64, 0x64, 0x00, 0x00, 0x0a, 0x09,
  0x01, 0x07, 0x00, 0x20, 0x00, 0x20, 0x01, 0x6a, 0x0b,
]);

// Minimal WASM module that exports a 'constant' function: () -> i32 (returns 42)
// Generated from WAT: (module (func (export "constant") (result i32) i32.const 42))
const CONSTANT_WASM = new Uint8Array([
  0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00, 0x01, 0x05, 0x01, 0x60, 0x00, 0x01, 0x7f, 0x03,
  0x02, 0x01, 0x00, 0x07, 0x0c, 0x01, 0x08, 0x63, 0x6f, 0x6e, 0x73, 0x74, 0x61, 0x6e, 0x74, 0x00,
  0x00, 0x0a, 0x06, 0x01, 0x04, 0x00, 0x41, 0x2a, 0x0b,
]);

// Invalid WASM bytes
const INVALID_WASM = new Uint8Array([0x00, 0x01, 0x02, 0x03]);

// ---------------------------------------------------------------------------
// FuelMeter tests
// ---------------------------------------------------------------------------
describe('FuelMeter', () => {
  it('should start with zero consumption', () => {
    const meter = new FuelMeter(1000);
    expect(meter.getConsumed()).toBe(0);
    expect(meter.getRemaining()).toBe(1000);
    expect(meter.isExhausted()).toBe(false);
  });

  it('should track fuel consumption', () => {
    const meter = new FuelMeter(1000);
    expect(meter.consume(500)).toBe(true);
    expect(meter.getConsumed()).toBe(500);
    expect(meter.getRemaining()).toBe(500);
  });

  it('should report exhaustion when limit reached', () => {
    const meter = new FuelMeter(100);
    expect(meter.consume(100)).toBe(true);
    expect(meter.isExhausted()).toBe(true);
    expect(meter.getRemaining()).toBe(0);
  });

  it('should return false when fuel exceeded', () => {
    const meter = new FuelMeter(100);
    expect(meter.consume(150)).toBe(false);
    expect(meter.isExhausted()).toBe(true);
  });

  it('should reset to initial state', () => {
    const meter = new FuelMeter(1000);
    meter.consume(500);
    meter.reset();
    expect(meter.getConsumed()).toBe(0);
    expect(meter.getRemaining()).toBe(1000);
  });

  it('should handle multiple consume calls', () => {
    const meter = new FuelMeter(100);
    meter.consume(30);
    meter.consume(30);
    meter.consume(30);
    expect(meter.getConsumed()).toBe(90);
    expect(meter.consume(20)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Watchdog tests
// ---------------------------------------------------------------------------
describe('Watchdog', () => {
  it('should report zero elapsed before start', () => {
    const watchdog = new Watchdog(1000);
    expect(watchdog.elapsed()).toBe(0);
    expect(watchdog.wasTriggered()).toBe(false);
  });

  it('should track elapsed time after start', async () => {
    const watchdog = new Watchdog(5000);
    watchdog.start(() => {});
    await new Promise((r) => setTimeout(r, 50));
    expect(watchdog.elapsed()).toBeGreaterThan(0);
    watchdog.stop();
  });

  it('should trigger callback on timeout', async () => {
    let triggered = false;
    const watchdog = new Watchdog(50);
    watchdog.start(() => {
      triggered = true;
    });
    await new Promise((r) => setTimeout(r, 100));
    expect(triggered).toBe(true);
    expect(watchdog.wasTriggered()).toBe(true);
    watchdog.stop();
  });

  it('should not trigger if stopped early', async () => {
    let triggered = false;
    const watchdog = new Watchdog(200);
    watchdog.start(() => {
      triggered = true;
    });
    watchdog.stop();
    await new Promise((r) => setTimeout(r, 250));
    expect(triggered).toBe(false);
    expect(watchdog.wasTriggered()).toBe(false);
  });

  it('should reset all state', async () => {
    const watchdog = new Watchdog(50);
    watchdog.start(() => {});
    await new Promise((r) => setTimeout(r, 70));
    expect(watchdog.wasTriggered()).toBe(true);
    watchdog.reset();
    expect(watchdog.wasTriggered()).toBe(false);
    expect(watchdog.elapsed()).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// CapabilityValidator tests
// ---------------------------------------------------------------------------
describe('CapabilityValidator', () => {
  it('should deny all by default (empty capabilities)', () => {
    const validator = new CapabilityValidator([]);
    expect(validator.canReadFs('/etc/passwd')).toBe(false);
    expect(validator.canWriteFs('/tmp/file')).toBe(false);
    expect(validator.canConnect('example.com')).toBe(false);
    expect(validator.canReadEnv('HOME')).toBe(false);
    expect(validator.canStdout()).toBe(false);
    expect(validator.canStderr()).toBe(false);
  });

  it('should allow filesystem read for declared paths', () => {
    const validator = new CapabilityValidator([{ type: 'fs_read', paths: ['/data/', '/config/'] }]);
    expect(validator.canReadFs('/data/file.txt')).toBe(true);
    expect(validator.canReadFs('/config/app.json')).toBe(true);
    expect(validator.canReadFs('/etc/passwd')).toBe(false);
  });

  it('should allow filesystem write for declared paths', () => {
    const validator = new CapabilityValidator([{ type: 'fs_write', paths: ['/tmp/'] }]);
    expect(validator.canWriteFs('/tmp/output.txt')).toBe(true);
    expect(validator.canWriteFs('/etc/file')).toBe(false);
  });

  it('should allow network connections for exact hosts', () => {
    const validator = new CapabilityValidator([
      { type: 'net_connect', hosts: ['api.example.com', 'localhost'] },
    ]);
    expect(validator.canConnect('api.example.com')).toBe(true);
    expect(validator.canConnect('localhost')).toBe(true);
    expect(validator.canConnect('evil.com')).toBe(false);
  });

  it('should support wildcard host matching', () => {
    const validator = new CapabilityValidator([{ type: 'net_connect', hosts: ['*.example.com'] }]);
    expect(validator.canConnect('api.example.com')).toBe(true);
    expect(validator.canConnect('sub.api.example.com')).toBe(true);
    expect(validator.canConnect('example.com')).toBe(false);
    expect(validator.canConnect('evil.com')).toBe(false);
  });

  it('should allow environment variable access for declared keys', () => {
    const validator = new CapabilityValidator([{ type: 'env_var', keys: ['HOME', 'PATH'] }]);
    expect(validator.canReadEnv('HOME')).toBe(true);
    expect(validator.canReadEnv('PATH')).toBe(true);
    expect(validator.canReadEnv('SECRET_KEY')).toBe(false);
  });

  it('should allow stdout/stderr when declared', () => {
    const validator = new CapabilityValidator([{ type: 'stdout' }, { type: 'stderr' }]);
    expect(validator.canStdout()).toBe(true);
    expect(validator.canStderr()).toBe(true);
  });

  it('should track denied access count', () => {
    const validator = new CapabilityValidator([]);
    expect(validator.getDeniedCount()).toBe(0);
    validator.recordDenied();
    validator.recordDenied();
    expect(validator.getDeniedCount()).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// WasmSandbox tests
// ---------------------------------------------------------------------------
describe('WasmSandbox', () => {
  it('should use default config when none provided', () => {
    const sandbox = new WasmSandbox();
    const config = sandbox.getConfig();
    expect(config.maxFuel).toBe(DEFAULT_WASM_CONFIG.maxFuel);
    expect(config.maxEpochMs).toBe(DEFAULT_WASM_CONFIG.maxEpochMs);
    expect(config.maxMemoryBytes).toBe(DEFAULT_WASM_CONFIG.maxMemoryBytes);
  });

  it('should merge custom config with defaults', () => {
    const sandbox = new WasmSandbox({ maxFuel: 500_000 });
    const config = sandbox.getConfig();
    expect(config.maxFuel).toBe(500_000);
    expect(config.maxEpochMs).toBe(DEFAULT_WASM_CONFIG.maxEpochMs);
  });

  it('should execute a simple WASM module', async () => {
    const sandbox = new WasmSandbox();
    const result = await sandbox.execute({
      moduleBytes: ADD_WASM,
      entryFunction: 'add',
      args: [2, 3],
    });
    expect(result.success).toBe(true);
    expect(result.returnValue).toBe(5);
    expect(result.terminationReason).toBe('completed');
    expect(result.metrics.fuelConsumed).toBeGreaterThan(0);
    expect(result.metrics.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('should execute a no-arg WASM function', async () => {
    const sandbox = new WasmSandbox();
    const result = await sandbox.execute({
      moduleBytes: CONSTANT_WASM,
      entryFunction: 'constant',
    });
    expect(result.success).toBe(true);
    expect(result.returnValue).toBe(42);
  });

  it('should return error for missing entry function', async () => {
    const sandbox = new WasmSandbox();
    const result = await sandbox.execute({
      moduleBytes: ADD_WASM,
      entryFunction: 'nonexistent',
    });
    expect(result.success).toBe(false);
    expect(result.terminationReason).toBe('runtime_error');
    expect(result.error).toContain('nonexistent');
  });

  it('should return error for invalid WASM bytes', async () => {
    const sandbox = new WasmSandbox();
    const result = await sandbox.execute({
      moduleBytes: INVALID_WASM,
      entryFunction: 'main',
    });
    expect(result.success).toBe(false);
    expect(result.terminationReason).toBe('runtime_error');
  });

  it('should allow per-execution config overrides', async () => {
    const sandbox = new WasmSandbox({ maxFuel: 1_000_000 });
    const result = await sandbox.execute({
      moduleBytes: ADD_WASM,
      entryFunction: 'add',
      args: [1, 1],
      config: { maxFuel: 5_000 },
    });
    expect(result.success).toBe(true);
  });

  it('should exhaust fuel with very low limit', async () => {
    const sandbox = new WasmSandbox({ maxFuel: 50 });
    const result = await sandbox.execute({
      moduleBytes: ADD_WASM,
      entryFunction: 'add',
      args: [1, 1],
    });
    expect(result.success).toBe(false);
    expect(result.terminationReason).toBe('fuel_exhausted');
  });

  it('should collect execution metrics', async () => {
    const sandbox = new WasmSandbox({ collectMetrics: true });
    const result = await sandbox.execute({
      moduleBytes: ADD_WASM,
      entryFunction: 'add',
      args: [10, 20],
    });
    expect(result.metrics).toBeDefined();
    expect(result.metrics.fuelConsumed).toBeGreaterThan(0);
    expect(typeof result.metrics.durationMs).toBe('number');
    expect(typeof result.metrics.peakMemoryBytes).toBe('number');
    expect(typeof result.metrics.hostCalls).toBe('number');
  });
});

// ---------------------------------------------------------------------------
// Default config tests
// ---------------------------------------------------------------------------
describe('DefaultConfig', () => {
  it('should have sensible defaults', () => {
    expect(DEFAULT_WASM_CONFIG.maxFuel).toBe(1_000_000);
    expect(DEFAULT_WASM_CONFIG.maxEpochMs).toBe(5_000);
    expect(DEFAULT_WASM_CONFIG.maxMemoryBytes).toBe(16 * 1024 * 1024);
    expect(DEFAULT_WASM_CONFIG.allowedCapabilities).toHaveLength(0);
    expect(DEFAULT_WASM_CONFIG.collectMetrics).toBe(true);
  });
});
