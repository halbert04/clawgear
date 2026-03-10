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

  // Channel / Communication
  CHANNEL_MESSAGE_RECEIVED: 'channel.message_received',
  CHANNEL_MESSAGE_SENT: 'channel.message_sent',
  CONVERSATION_CREATED: 'conversation.created',
  CONVERSATION_CLOSED: 'conversation.closed',

  // Hands (Autonomous Operations)
  HAND_ACTIVATED: 'hand.activated',
  HAND_DEACTIVATED: 'hand.deactivated',

  // Evolution
  SKILL_PROPOSED: 'evolution.skill_proposed',
  SKILL_APPROVED: 'evolution.skill_approved',
  SKILL_DEPRECATED: 'evolution.skill_deprecated',
  PROMPT_OPTIMIZED: 'evolution.prompt_optimized',
  PROMPT_ROLLBACK: 'evolution.prompt_rollback',
  COMPETENCE_DECAYED: 'evolution.competence_decayed',
  STRATEGY_REINFORCED: 'evolution.strategy_reinforced',
  MEMORY_CONSOLIDATED: 'evolution.memory_consolidated',

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

export interface ChannelMessageReceivedEvent extends SystemEvent {
  type: typeof EventTypes.CHANNEL_MESSAGE_RECEIVED;
  payload: {
    conversationId: string;
    messageId: string;
    agentId: string;
    channelName: string;
    senderId: string;
    senderName: string;
    content: string;
  };
}

export interface ChannelMessageSentEvent extends SystemEvent {
  type: typeof EventTypes.CHANNEL_MESSAGE_SENT;
  payload: {
    conversationId: string;
    messageId: string;
    agentId: string;
    channelName: string;
    content: string;
  };
}

export interface ConversationCreatedEvent extends SystemEvent {
  type: typeof EventTypes.CONVERSATION_CREATED;
  payload: {
    conversationId: string;
    agentId: string;
    channelName: string;
    participantId: string | null;
    participantName: string | null;
  };
}

export interface HandActivatedEvent extends SystemEvent {
  type: typeof EventTypes.HAND_ACTIVATED;
  payload: {
    agentId: string;
    handName: string;
    schedule: string;
  };
}

export interface HandDeactivatedEvent extends SystemEvent {
  type: typeof EventTypes.HAND_DEACTIVATED;
  payload: {
    agentId: string;
    handName: string;
  };
}

export interface SkillProposedEvent extends SystemEvent {
  type: typeof EventTypes.SKILL_PROPOSED;
  payload: {
    skillId: string;
    agentId: string;
    skillName: string;
    version: number;
  };
}

export interface SkillApprovedEvent extends SystemEvent {
  type: typeof EventTypes.SKILL_APPROVED;
  payload: {
    skillId: string;
    skillName: string;
    approvedBy: string;
  };
}

export interface PromptOptimizedEvent extends SystemEvent {
  type: typeof EventTypes.PROMPT_OPTIMIZED;
  payload: {
    promptVersionId: string;
    agentRole: string;
    version: number;
    evaluationScore: number;
  };
}

export interface CompetenceDecayedEvent extends SystemEvent {
  type: typeof EventTypes.COMPETENCE_DECAYED;
  payload: {
    agentId: string;
    taskType: string;
    previousLevel: string;
    newLevel: string;
  };
}

export interface StrategyReinforcedEvent extends SystemEvent {
  type: typeof EventTypes.STRATEGY_REINFORCED;
  payload: {
    patternId: string;
    agentId: string;
    patternType: string;
    confidence: number;
  };
}

export interface MemoryConsolidatedEvent extends SystemEvent {
  type: typeof EventTypes.MEMORY_CONSOLIDATED;
  payload: {
    lessonsMerged: number;
    factsValidated: number;
    lessonsArchived: number;
  };
}

export type TypedSystemEvent =
  | AgentStatusChangedEvent
  | IssueStatusChangedEvent
  | HeartbeatCompletedEvent
  | BudgetWarningEvent
  | ApprovalRequestedEvent
  | QualityGateResultEvent
  | ChannelMessageReceivedEvent
  | ChannelMessageSentEvent
  | ConversationCreatedEvent
  | HandActivatedEvent
  | HandDeactivatedEvent
  | SkillProposedEvent
  | SkillApprovedEvent
  | PromptOptimizedEvent
  | CompetenceDecayedEvent
  | StrategyReinforcedEvent
  | MemoryConsolidatedEvent;
