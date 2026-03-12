export {
  addCategories,
  combineLabels,
  compareSensitivity,
  createLabel,
  elevateLabel,
  meetsThreshold,
} from './labels.js';
export { TaintPolicy } from './policy.js';
export { TaintTracker } from './tracker.js';
export type {
  SensitivityLevel,
  SinkPolicy,
  TaintCheckResult,
  TaintedValue,
  TaintLabel,
  TaintViolation,
} from './types.js';
export { SENSITIVITY_ORDER } from './types.js';
