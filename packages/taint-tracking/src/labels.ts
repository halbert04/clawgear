/**
 * Taint label creation and propagation.
 * When tainted values combine, the result inherits the union of categories
 * and the maximum sensitivity level.
 */

import type { SensitivityLevel, TaintLabel } from './types.js';
import { SENSITIVITY_ORDER } from './types.js';

/** Create a new taint label */
export function createLabel(
  sensitivity: SensitivityLevel,
  source: string,
  categories: string[] = [],
): TaintLabel {
  return {
    sensitivity,
    categories: new Set(categories),
    source,
  };
}

/**
 * Combine two taint labels (e.g., when concatenating tainted strings).
 * Result has the maximum sensitivity and the union of all categories.
 * Source is set to 'combined' to indicate a merge.
 */
export function combineLabels(a: TaintLabel, b: TaintLabel): TaintLabel {
  const maxSensitivity =
    compareSensitivity(a.sensitivity, b.sensitivity) >= 0 ? a.sensitivity : b.sensitivity;

  const combinedCategories = new Set<string>([...a.categories, ...b.categories]);

  return {
    sensitivity: maxSensitivity,
    categories: combinedCategories,
    source: 'combined',
  };
}

/**
 * Compare two sensitivity levels.
 * Returns positive if a > b, negative if a < b, 0 if equal.
 */
export function compareSensitivity(a: SensitivityLevel, b: SensitivityLevel): number {
  return SENSITIVITY_ORDER[a] - SENSITIVITY_ORDER[b];
}

/**
 * Check if a sensitivity level meets or exceeds a threshold.
 */
export function meetsThreshold(level: SensitivityLevel, threshold: SensitivityLevel): boolean {
  return SENSITIVITY_ORDER[level] >= SENSITIVITY_ORDER[threshold];
}

/**
 * Elevate a label's sensitivity level (can only increase, never decrease).
 */
export function elevateLabel(label: TaintLabel, newSensitivity: SensitivityLevel): TaintLabel {
  if (SENSITIVITY_ORDER[newSensitivity] <= SENSITIVITY_ORDER[label.sensitivity]) {
    return label;
  }
  return {
    ...label,
    sensitivity: newSensitivity,
    categories: new Set(label.categories),
  };
}

/**
 * Add categories to a label without changing sensitivity.
 */
export function addCategories(label: TaintLabel, categories: string[]): TaintLabel {
  const newCategories = new Set([...label.categories, ...categories]);
  return {
    ...label,
    categories: newCategories,
  };
}
