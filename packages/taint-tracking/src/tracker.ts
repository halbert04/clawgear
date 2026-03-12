/**
 * TaintTracker — tags values with taint labels and tracks information flow.
 * Provides an in-memory registry of tainted values for the current execution context.
 */

import { combineLabels, createLabel } from './labels.js';
import type { SensitivityLevel, TaintedValue, TaintLabel } from './types.js';

let nextTrackingId = 0;

function generateTrackingId(): string {
  return `taint_${Date.now()}_${nextTrackingId++}`;
}

export class TaintTracker {
  private readonly registry = new Map<string, TaintedValue>();

  /**
   * Taint a value with a sensitivity label.
   * Returns a TaintedValue that tracks the data's sensitivity.
   */
  taint<T>(
    value: T,
    sensitivity: SensitivityLevel,
    source: string,
    categories: string[] = [],
  ): TaintedValue<T> {
    const label = createLabel(sensitivity, source, categories);
    const trackingId = generateTrackingId();

    const tainted: TaintedValue<T> = {
      value,
      label,
      trackingId,
      taintedAt: new Date().toISOString(),
    };

    this.registry.set(trackingId, tainted as TaintedValue);
    return tainted;
  }

  /**
   * Combine two tainted values (e.g., string concatenation, object merge).
   * The result inherits the maximum sensitivity and union of categories.
   */
  combine<T>(a: TaintedValue, b: TaintedValue, combinedValue: T): TaintedValue<T> {
    const label = combineLabels(a.label, b.label);
    const trackingId = generateTrackingId();

    const tainted: TaintedValue<T> = {
      value: combinedValue,
      label,
      trackingId,
      taintedAt: new Date().toISOString(),
    };

    this.registry.set(trackingId, tainted as TaintedValue);
    return tainted;
  }

  /**
   * Propagate taint from one value to a derived value.
   * The new value inherits the same label.
   */
  propagate<T>(source: TaintedValue, derivedValue: T): TaintedValue<T> {
    const trackingId = generateTrackingId();

    const tainted: TaintedValue<T> = {
      value: derivedValue,
      label: { ...source.label, categories: new Set(source.label.categories) },
      trackingId,
      taintedAt: new Date().toISOString(),
    };

    this.registry.set(trackingId, tainted as TaintedValue);
    return tainted;
  }

  /** Look up a tainted value by tracking ID */
  lookup(trackingId: string): TaintedValue | undefined {
    return this.registry.get(trackingId);
  }

  /** Get all tracked tainted values */
  getAll(): ReadonlyMap<string, TaintedValue> {
    return this.registry;
  }

  /** Get count of tracked values */
  getCount(): number {
    return this.registry.size;
  }

  /** Get the taint label for a tracked value */
  getLabel(trackingId: string): TaintLabel | undefined {
    return this.registry.get(trackingId)?.label;
  }

  /** Clear all tracked values */
  clear(): void {
    this.registry.clear();
  }
}
