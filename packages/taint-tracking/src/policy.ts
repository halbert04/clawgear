/**
 * TaintPolicy engine — defines which taint labels can reach which sinks.
 * Enforces that sensitive data cannot flow to unauthorized tools or channels.
 */

import { compareSensitivity } from './labels.js';
import type {
  SensitivityLevel,
  SinkPolicy,
  TaintCheckResult,
  TaintedValue,
  TaintViolation,
} from './types.js';

export class TaintPolicy {
  private readonly sinkPolicies = new Map<string, SinkPolicy>();
  private readonly violations: TaintViolation[] = [];

  /**
   * Register a sink with its policy.
   * Defines what sensitivity levels and categories the sink can accept.
   */
  registerSink(
    sinkId: string,
    maxSensitivity: SensitivityLevel,
    options?: {
      blockedCategories?: string[];
      allowedCategories?: string[];
    },
  ): void {
    this.sinkPolicies.set(sinkId, {
      sinkId,
      maxSensitivity,
      blockedCategories: new Set(options?.blockedCategories ?? []),
      allowedCategories: new Set(options?.allowedCategories ?? []),
    });
  }

  /**
   * Check if a tainted value is allowed to flow to a specific sink.
   * Returns the check result with any violations found.
   */
  checkFlow(taintedValue: TaintedValue, sinkId: string): TaintCheckResult {
    const policy = this.sinkPolicies.get(sinkId);

    // If no policy exists for the sink, deny by default (fail-closed)
    if (!policy) {
      const violation: TaintViolation = {
        trackingId: taintedValue.trackingId,
        sinkId,
        reason: `No policy defined for sink '${sinkId}' — denied by default`,
        dataSensitivity: taintedValue.label.sensitivity,
        sinkMaxSensitivity: 'public',
        violatingCategories: [],
      };
      this.violations.push(violation);
      return { allowed: false, violations: [violation] };
    }

    const violations: TaintViolation[] = [];

    // Check sensitivity level
    if (compareSensitivity(taintedValue.label.sensitivity, policy.maxSensitivity) > 0) {
      violations.push({
        trackingId: taintedValue.trackingId,
        sinkId,
        reason: `Data sensitivity '${taintedValue.label.sensitivity}' exceeds sink max '${policy.maxSensitivity}'`,
        dataSensitivity: taintedValue.label.sensitivity,
        sinkMaxSensitivity: policy.maxSensitivity,
        violatingCategories: [],
      });
    }

    // Check blocked categories
    const blockedMatches: string[] = [];
    for (const cat of taintedValue.label.categories) {
      if (policy.blockedCategories.has(cat)) {
        blockedMatches.push(cat);
      }
    }
    if (blockedMatches.length > 0) {
      violations.push({
        trackingId: taintedValue.trackingId,
        sinkId,
        reason: `Data categories [${blockedMatches.join(', ')}] are blocked for sink '${sinkId}'`,
        dataSensitivity: taintedValue.label.sensitivity,
        sinkMaxSensitivity: policy.maxSensitivity,
        violatingCategories: blockedMatches,
      });
    }

    // Check allowed categories (if specified, data must have at least one)
    if (policy.allowedCategories.size > 0 && taintedValue.label.categories.size > 0) {
      const hasAllowed = [...taintedValue.label.categories].some((cat) =>
        policy.allowedCategories.has(cat),
      );
      if (!hasAllowed) {
        const cats = [...taintedValue.label.categories];
        violations.push({
          trackingId: taintedValue.trackingId,
          sinkId,
          reason: `Data categories [${cats.join(', ')}] not in sink's allowed list`,
          dataSensitivity: taintedValue.label.sensitivity,
          sinkMaxSensitivity: policy.maxSensitivity,
          violatingCategories: cats,
        });
      }
    }

    if (violations.length > 0) {
      this.violations.push(...violations);
    }

    return {
      allowed: violations.length === 0,
      violations,
    };
  }

  /** Get all recorded violations */
  getViolations(): ReadonlyArray<TaintViolation> {
    return this.violations;
  }

  /** Get violation count */
  getViolationCount(): number {
    return this.violations.length;
  }

  /** Get a sink policy by ID */
  getSinkPolicy(sinkId: string): SinkPolicy | undefined {
    return this.sinkPolicies.get(sinkId);
  }

  /** Get all registered sink IDs */
  getSinkIds(): string[] {
    return [...this.sinkPolicies.keys()];
  }

  /** Clear all recorded violations */
  clearViolations(): void {
    this.violations.length = 0;
  }
}
