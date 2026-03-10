import { createHash } from 'node:crypto';
import type { EventBus, SystemEvent } from '@clawgear/shared/interfaces';

export interface LoopGuardConfig {
  /** Max tool calls per heartbeat (default 50) */
  maxIterations?: number;
  /** Max identical tool call signatures before circuit break (default 3) */
  maxDuplicates?: number;
  /** Optional event bus for alerting */
  eventBus?: EventBus;
}

export interface LoopGuardState {
  /** SHA256 hashes of tool call signatures */
  callHashes: Map<string, number>;
  /** Total tool calls in this heartbeat */
  totalCalls: number;
  /** Whether the circuit breaker has tripped */
  tripped: boolean;
  /** Reason for tripping */
  tripReason?: string;
}

export class LoopGuard {
  private maxIterations: number;
  private maxDuplicates: number;
  private eventBus?: EventBus;
  private states = new Map<string, LoopGuardState>();

  constructor(config: LoopGuardConfig = {}) {
    this.maxIterations = config.maxIterations ?? 50;
    this.maxDuplicates = config.maxDuplicates ?? 3;
    this.eventBus = config.eventBus;
  }

  /**
   * Start tracking a new heartbeat execution for an agent.
   * Call this at the beginning of each heartbeat.
   */
  startHeartbeat(agentId: string): void {
    this.states.set(agentId, {
      callHashes: new Map(),
      totalCalls: 0,
      tripped: false,
    });
  }

  /**
   * Record a tool call and check for loops.
   * Returns true if the call should proceed, false if loop detected.
   */
  recordToolCall(
    agentId: string,
    companyId: string,
    tool: string,
    args: Record<string, unknown>,
  ): { allowed: boolean; reason?: string } {
    let state = this.states.get(agentId);
    if (!state) {
      // Implicitly start tracking
      this.startHeartbeat(agentId);
      state = this.states.get(agentId)!;
    }

    // Already tripped — reject immediately
    if (state.tripped) {
      return { allowed: false, reason: state.tripReason };
    }

    state.totalCalls++;

    // Check max iterations
    if (state.totalCalls > this.maxIterations) {
      state.tripped = true;
      state.tripReason = `Max iterations exceeded (${this.maxIterations})`;
      this.emitLoopEvent(agentId, companyId, state.tripReason);
      return { allowed: false, reason: state.tripReason };
    }

    // Hash the tool call signature
    const signature = JSON.stringify({ tool, args });
    const hash = createHash('sha256').update(signature).digest('hex');

    const count = (state.callHashes.get(hash) ?? 0) + 1;
    state.callHashes.set(hash, count);

    // Check for duplicate tool calls
    if (count > this.maxDuplicates) {
      state.tripped = true;
      state.tripReason = `Duplicate tool call detected: ${tool} called ${count} times with same args`;
      this.emitLoopEvent(agentId, companyId, state.tripReason);
      return { allowed: false, reason: state.tripReason };
    }

    return { allowed: true };
  }

  /**
   * End tracking for an agent's heartbeat.
   */
  endHeartbeat(agentId: string): void {
    this.states.delete(agentId);
  }

  /**
   * Check if an agent's heartbeat has been tripped.
   */
  isTripped(agentId: string): boolean {
    return this.states.get(agentId)?.tripped ?? false;
  }

  private emitLoopEvent(agentId: string, companyId: string, reason: string): void {
    if (!this.eventBus) return;
    const event: SystemEvent = {
      type: 'security.loop_detected',
      companyId,
      timestamp: new Date(),
      payload: { agentId, reason },
    };
    this.eventBus.emit(event);
  }
}
