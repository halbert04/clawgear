import { describe, expect, it } from 'bun:test';
import {
  addCategories,
  combineLabels,
  compareSensitivity,
  createLabel,
  elevateLabel,
  meetsThreshold,
} from './labels.js';
import { TaintPolicy } from './policy.js';
import { TaintTracker } from './tracker.js';
import { SENSITIVITY_ORDER } from './types.js';

// ---------------------------------------------------------------------------
// Label tests
// ---------------------------------------------------------------------------
describe('createLabel', () => {
  it('should create a label with sensitivity and source', () => {
    const label = createLabel('confidential', 'database');
    expect(label.sensitivity).toBe('confidential');
    expect(label.source).toBe('database');
    expect(label.categories.size).toBe(0);
  });

  it('should create a label with categories', () => {
    const label = createLabel('secret', 'api', ['pii', 'credentials']);
    expect(label.categories.has('pii')).toBe(true);
    expect(label.categories.has('credentials')).toBe(true);
    expect(label.categories.size).toBe(2);
  });
});

describe('combineLabels', () => {
  it('should take maximum sensitivity', () => {
    const a = createLabel('internal', 'src-a');
    const b = createLabel('confidential', 'src-b');
    const combined = combineLabels(a, b);
    expect(combined.sensitivity).toBe('confidential');
  });

  it('should union categories', () => {
    const a = createLabel('public', 'a', ['pii']);
    const b = createLabel('public', 'b', ['financial']);
    const combined = combineLabels(a, b);
    expect(combined.categories.has('pii')).toBe(true);
    expect(combined.categories.has('financial')).toBe(true);
    expect(combined.categories.size).toBe(2);
  });

  it('should set source to combined', () => {
    const a = createLabel('public', 'a');
    const b = createLabel('public', 'b');
    expect(combineLabels(a, b).source).toBe('combined');
  });

  it('should handle equal sensitivity levels', () => {
    const a = createLabel('secret', 'a');
    const b = createLabel('secret', 'b');
    expect(combineLabels(a, b).sensitivity).toBe('secret');
  });
});

describe('compareSensitivity', () => {
  it('should return 0 for equal levels', () => {
    expect(compareSensitivity('public', 'public')).toBe(0);
    expect(compareSensitivity('secret', 'secret')).toBe(0);
  });

  it('should return positive when first is higher', () => {
    expect(compareSensitivity('secret', 'public')).toBeGreaterThan(0);
    expect(compareSensitivity('confidential', 'internal')).toBeGreaterThan(0);
  });

  it('should return negative when first is lower', () => {
    expect(compareSensitivity('public', 'secret')).toBeLessThan(0);
    expect(compareSensitivity('internal', 'confidential')).toBeLessThan(0);
  });
});

describe('meetsThreshold', () => {
  it('should return true when level meets threshold', () => {
    expect(meetsThreshold('secret', 'confidential')).toBe(true);
    expect(meetsThreshold('confidential', 'confidential')).toBe(true);
  });

  it('should return false when level is below threshold', () => {
    expect(meetsThreshold('public', 'confidential')).toBe(false);
    expect(meetsThreshold('internal', 'secret')).toBe(false);
  });
});

describe('elevateLabel', () => {
  it('should increase sensitivity', () => {
    const label = createLabel('internal', 'src');
    const elevated = elevateLabel(label, 'secret');
    expect(elevated.sensitivity).toBe('secret');
  });

  it('should not decrease sensitivity', () => {
    const label = createLabel('confidential', 'src');
    const result = elevateLabel(label, 'public');
    expect(result.sensitivity).toBe('confidential');
  });

  it('should preserve categories and source', () => {
    const label = createLabel('public', 'src', ['pii']);
    const elevated = elevateLabel(label, 'secret');
    expect(elevated.categories.has('pii')).toBe(true);
    expect(elevated.source).toBe('src');
  });
});

describe('addCategories', () => {
  it('should add new categories', () => {
    const label = createLabel('public', 'src', ['pii']);
    const updated = addCategories(label, ['financial', 'health']);
    expect(updated.categories.size).toBe(3);
    expect(updated.categories.has('financial')).toBe(true);
    expect(updated.categories.has('health')).toBe(true);
  });

  it('should not duplicate existing categories', () => {
    const label = createLabel('public', 'src', ['pii']);
    const updated = addCategories(label, ['pii', 'financial']);
    expect(updated.categories.size).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// Tracker tests
// ---------------------------------------------------------------------------
describe('TaintTracker', () => {
  it('should taint a value', () => {
    const tracker = new TaintTracker();
    const tainted = tracker.taint('password123', 'secret', 'user_input', ['credentials']);
    expect(tainted.value).toBe('password123');
    expect(tainted.label.sensitivity).toBe('secret');
    expect(tainted.label.source).toBe('user_input');
    expect(tainted.label.categories.has('credentials')).toBe(true);
    expect(tainted.trackingId).toBeTruthy();
    expect(tainted.taintedAt).toBeTruthy();
    expect(tracker.getCount()).toBe(1);
  });

  it('should look up tracked values', () => {
    const tracker = new TaintTracker();
    const tainted = tracker.taint('data', 'internal', 'db');
    const found = tracker.lookup(tainted.trackingId);
    expect(found).toBeDefined();
    expect(found!.value).toBe('data');
  });

  it('should return undefined for unknown tracking ID', () => {
    const tracker = new TaintTracker();
    expect(tracker.lookup('nonexistent')).toBeUndefined();
  });

  it('should combine tainted values', () => {
    const tracker = new TaintTracker();
    const a = tracker.taint('first', 'internal', 'src-a', ['pii']);
    const b = tracker.taint('second', 'confidential', 'src-b', ['financial']);
    const combined = tracker.combine(a, b, 'first + second');

    expect(combined.value).toBe('first + second');
    expect(combined.label.sensitivity).toBe('confidential');
    expect(combined.label.categories.has('pii')).toBe(true);
    expect(combined.label.categories.has('financial')).toBe(true);
    expect(tracker.getCount()).toBe(3);
  });

  it('should propagate taint to derived values', () => {
    const tracker = new TaintTracker();
    const original = tracker.taint({ key: 'api_key_123' }, 'secret', 'env', ['credentials']);
    const derived = tracker.propagate(original, 'api_key_***');

    expect(derived.label.sensitivity).toBe('secret');
    expect(derived.label.categories.has('credentials')).toBe(true);
    expect(derived.trackingId).not.toBe(original.trackingId);
  });

  it('should get label by tracking ID', () => {
    const tracker = new TaintTracker();
    const tainted = tracker.taint('data', 'confidential', 'src');
    const label = tracker.getLabel(tainted.trackingId);
    expect(label).toBeDefined();
    expect(label!.sensitivity).toBe('confidential');
  });

  it('should clear all tracked values', () => {
    const tracker = new TaintTracker();
    tracker.taint('a', 'public', 'src');
    tracker.taint('b', 'public', 'src');
    expect(tracker.getCount()).toBe(2);
    tracker.clear();
    expect(tracker.getCount()).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Policy tests
// ---------------------------------------------------------------------------
describe('TaintPolicy', () => {
  it('should register sinks', () => {
    const policy = new TaintPolicy();
    policy.registerSink('console_log', 'internal');
    policy.registerSink('external_api', 'public');
    expect(policy.getSinkIds()).toHaveLength(2);
  });

  it('should allow flow within sensitivity limits', () => {
    const policy = new TaintPolicy();
    policy.registerSink('internal_log', 'confidential');

    const tracker = new TaintTracker();
    const value = tracker.taint('data', 'internal', 'db');

    const result = policy.checkFlow(value, 'internal_log');
    expect(result.allowed).toBe(true);
    expect(result.violations).toHaveLength(0);
  });

  it('should block flow exceeding sensitivity limits', () => {
    const policy = new TaintPolicy();
    policy.registerSink('public_api', 'public');

    const tracker = new TaintTracker();
    const value = tracker.taint('secret_data', 'secret', 'vault', ['credentials']);

    const result = policy.checkFlow(value, 'public_api');
    expect(result.allowed).toBe(false);
    expect(result.violations).toHaveLength(1);
    expect(result.violations[0]!.reason).toContain('exceeds');
  });

  it('should block flow with blocked categories', () => {
    const policy = new TaintPolicy();
    policy.registerSink('analytics', 'confidential', {
      blockedCategories: ['pii', 'credentials'],
    });

    const tracker = new TaintTracker();
    const value = tracker.taint('user email', 'internal', 'form', ['pii']);

    const result = policy.checkFlow(value, 'analytics');
    expect(result.allowed).toBe(false);
    expect(result.violations[0]!.violatingCategories).toContain('pii');
  });

  it('should allow flow when categories match allowed list', () => {
    const policy = new TaintPolicy();
    policy.registerSink('metrics_sink', 'confidential', {
      allowedCategories: ['metrics', 'performance'],
    });

    const tracker = new TaintTracker();
    const value = tracker.taint('latency=42ms', 'internal', 'perf', ['metrics']);

    const result = policy.checkFlow(value, 'metrics_sink');
    expect(result.allowed).toBe(true);
  });

  it('should block flow when categories not in allowed list', () => {
    const policy = new TaintPolicy();
    policy.registerSink('metrics_only', 'confidential', {
      allowedCategories: ['metrics'],
    });

    const tracker = new TaintTracker();
    const value = tracker.taint('user data', 'internal', 'db', ['pii']);

    const result = policy.checkFlow(value, 'metrics_only');
    expect(result.allowed).toBe(false);
    expect(result.violations[0]!.reason).toContain('not in sink');
  });

  it('should deny by default for unknown sinks', () => {
    const policy = new TaintPolicy();
    const tracker = new TaintTracker();
    const value = tracker.taint('data', 'public', 'src');

    const result = policy.checkFlow(value, 'unknown_sink');
    expect(result.allowed).toBe(false);
    expect(result.violations[0]!.reason).toContain('No policy defined');
  });

  it('should track violation count', () => {
    const policy = new TaintPolicy();
    policy.registerSink('public_api', 'public');

    const tracker = new TaintTracker();
    const v1 = tracker.taint('a', 'secret', 'src');
    const v2 = tracker.taint('b', 'confidential', 'src');

    policy.checkFlow(v1, 'public_api');
    policy.checkFlow(v2, 'public_api');

    expect(policy.getViolationCount()).toBe(2);
    expect(policy.getViolations()).toHaveLength(2);
  });

  it('should clear violations', () => {
    const policy = new TaintPolicy();
    policy.registerSink('sink', 'public');

    const tracker = new TaintTracker();
    const value = tracker.taint('data', 'secret', 'src');
    policy.checkFlow(value, 'sink');

    expect(policy.getViolationCount()).toBe(1);
    policy.clearViolations();
    expect(policy.getViolationCount()).toBe(0);
  });

  it('should detect multiple violations in a single check', () => {
    const policy = new TaintPolicy();
    policy.registerSink('restricted', 'internal', {
      blockedCategories: ['credentials'],
    });

    const tracker = new TaintTracker();
    // Secret + credentials: violates both sensitivity AND blocked category
    const value = tracker.taint('api_key', 'secret', 'env', ['credentials']);

    const result = policy.checkFlow(value, 'restricted');
    expect(result.allowed).toBe(false);
    expect(result.violations.length).toBeGreaterThanOrEqual(2);
  });

  it('should return sink policy by ID', () => {
    const policy = new TaintPolicy();
    policy.registerSink('my_sink', 'confidential', {
      blockedCategories: ['pii'],
    });
    const sinkPolicy = policy.getSinkPolicy('my_sink');
    expect(sinkPolicy).toBeDefined();
    expect(sinkPolicy!.maxSensitivity).toBe('confidential');
    expect(sinkPolicy!.blockedCategories.has('pii')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Sensitivity order tests
// ---------------------------------------------------------------------------
describe('SENSITIVITY_ORDER', () => {
  it('should have correct ordering', () => {
    expect(SENSITIVITY_ORDER.public).toBeLessThan(SENSITIVITY_ORDER.internal);
    expect(SENSITIVITY_ORDER.internal).toBeLessThan(SENSITIVITY_ORDER.confidential);
    expect(SENSITIVITY_ORDER.confidential).toBeLessThan(SENSITIVITY_ORDER.secret);
  });
});
