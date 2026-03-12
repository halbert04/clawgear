/**
 * Types for information flow taint tracking.
 * Labels data with sensitivity levels and prevents unauthorized flow to sinks.
 */

/** Sensitivity levels from least to most sensitive */
export type SensitivityLevel = 'public' | 'internal' | 'confidential' | 'secret';

/** Numeric ordering for sensitivity levels */
export const SENSITIVITY_ORDER: Record<SensitivityLevel, number> = {
  public: 0,
  internal: 1,
  confidential: 2,
  secret: 3,
};

/** A taint label attached to data flowing through the system */
export interface TaintLabel {
  /** Sensitivity level of the data */
  sensitivity: SensitivityLevel;
  /** Categories describing the data type (e.g., 'pii', 'credentials', 'financial') */
  categories: Set<string>;
  /** Source that produced this data (e.g., 'user_input', 'database', 'api_response') */
  source: string;
}

/** A value wrapped with taint tracking information */
export interface TaintedValue<T = unknown> {
  /** The actual value */
  value: T;
  /** The taint label attached to this value */
  label: TaintLabel;
  /** Unique tracking ID for audit trail */
  trackingId: string;
  /** Timestamp when the taint was applied */
  taintedAt: string;
}

/** Defines what sensitivity levels a sink (tool/channel) can accept */
export interface SinkPolicy {
  /** Sink identifier (tool name, channel name, etc.) */
  sinkId: string;
  /** Maximum sensitivity level this sink accepts */
  maxSensitivity: SensitivityLevel;
  /** Categories this sink is explicitly blocked from receiving */
  blockedCategories: Set<string>;
  /** Categories this sink is explicitly allowed to receive (empty = all allowed) */
  allowedCategories: Set<string>;
}

/** Result of a taint flow check */
export interface TaintCheckResult {
  /** Whether the flow is allowed */
  allowed: boolean;
  /** Violations found, if any */
  violations: TaintViolation[];
}

/** A specific taint violation */
export interface TaintViolation {
  /** Tracking ID of the tainted value */
  trackingId: string;
  /** The sink that was blocked */
  sinkId: string;
  /** Reason for the violation */
  reason: string;
  /** Sensitivity of the data */
  dataSensitivity: SensitivityLevel;
  /** Max sensitivity the sink accepts */
  sinkMaxSensitivity: SensitivityLevel;
  /** Categories that caused the violation */
  violatingCategories: string[];
}
