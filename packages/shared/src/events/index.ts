import type { SystemEvent } from '../interfaces/index.js';

// ============================================================
// EVENT TYPE CONSTANTS
// ============================================================

export const EventTypes = {
  // Agent lifecycle
  AGENT_STATUS_CHANGED: 'agent.status_changed',
  AGENT_CREATED: 'agent.created',
  AGENT_PAUSED: 'agent.paused',
  AGENT_RESUMED: 'agent.resumed',
  AGENT_TERMINATED: 'agent.terminated',

  // Issue lifecycle
  ISSUE_STATUS_CHANGED: 'issue.status_changed',
  ISSUE_CREATED: 'issue.created',
  ISSUE_ASSIGNED: 'issue.assigned',
  ISSUE_CHECKED_OUT: 'issue.checked_out',
  ISSUE_RELEASED: 'issue.released',

  // Heartbeat
  HEARTBEAT_QUEUED: 'heartbeat.queued',
  HEARTBEAT_STARTED: 'heartbeat.started',
  HEARTBEAT_COMPLETED: 'heartbeat.completed',
  HEARTBEAT_FAILED: 'heartbeat.failed',
  HEARTBEAT_TIMED_OUT: 'heartbeat.timed_out',

  // Budget
  BUDGET_WARNING: 'budget.warning',
  BUDGET_EXCEEDED: 'budget.exceeded',
  BUDGET_RESET: 'budget.reset',

  // Approval
  APPROVAL_REQUESTED: 'approval.requested',
  APPROVAL_DECIDED: 'approval.decided',

  // Quality
  QUALITY_GATE_PASSED: 'quality.gate_passed',
  QUALITY_GATE_FAILED: 'quality.gate_failed',
  QUALITY_ESCALATED: 'quality.escalated',

  // Learning
  LESSON_LEARNED: 'learning.lesson_learned',
  COMPETENCE_UPDATED: 'learning.competence_updated',
  AUTONOMY_CHANGED: 'learning.autonomy_changed',

  // System
  SYSTEM_HEALTH_CHANGED: 'system.health_changed',
  SYSTEM_DEGRADED: 'system.degraded',
} as const;

export type EventType = (typeof EventTypes)[keyof typeof EventTypes];

// ============================================================
// TYPED EVENT PAYLOADS
// ============================================================

export interface AgentStatusChangedEvent extends SystemEvent {
  type: typeof EventTypes.AGENT_STATUS_CHANGED;
  payload: {
    agentId: string;
    previousStatus: string;
    newStatus: string;
  };
}

export interface IssueStatusChangedEvent extends SystemEvent {
  type: typeof EventTypes.ISSUE_STATUS_CHANGED;
  payload: {
    issueId: string;
    previousStatus: string;
    newStatus: string;
    agentId: string | null;
  };
}

export interface HeartbeatCompletedEvent extends SystemEvent {
  type: typeof EventTypes.HEARTBEAT_COMPLETED;
  payload: {
    runId: string;
    agentId: string;
    status: string;
    durationMs: number;
    costCents: number;
  };
}

export interface BudgetWarningEvent extends SystemEvent {
  type: typeof EventTypes.BUDGET_WARNING;
  payload: {
    entityType: 'agent' | 'company';
    entityId: string;
    percentUsed: number;
    spentCents: bigint;
    budgetCents: bigint;
  };
}

export interface ApprovalRequestedEvent extends SystemEvent {
  type: typeof EventTypes.APPROVAL_REQUESTED;
  payload: {
    approvalId: string;
    approvalType: string;
    requestedByAgentId: string;
  };
}

export interface QualityGateResultEvent extends SystemEvent {
  type: typeof EventTypes.QUALITY_GATE_PASSED | typeof EventTypes.QUALITY_GATE_FAILED;
  payload: {
    evaluationId: string;
    issueId: string | null;
    agentId: string;
    score: number;
    passed: boolean;
    revisionNumber: number;
  };
}

export type TypedSystemEvent =
  | AgentStatusChangedEvent
  | IssueStatusChangedEvent
  | HeartbeatCompletedEvent
  | BudgetWarningEvent
  | ApprovalRequestedEvent
  | QualityGateResultEvent;
