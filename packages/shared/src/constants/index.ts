// Status enums matching database CHECK constraints

export const CompanyStatus = ['active', 'paused', 'archived'] as const;
export type CompanyStatus = (typeof CompanyStatus)[number];

export const AgentStatus = ['idle', 'running', 'paused', 'error', 'terminated'] as const;
export type AgentStatus = (typeof AgentStatus)[number];

export const AgentRole = [
  'ceo',
  'cto',
  'engineer',
  'analyst',
  'researcher',
  'writer',
  'designer',
  'marketer',
  'support',
] as const;
export type AgentRole = (typeof AgentRole)[number];

export const ModelTier = ['frontier', 'smart', 'fast', 'lightweight'] as const;
export type ModelTier = (typeof ModelTier)[number];

export const AdapterType = ['claude_code', 'process', 'http', 'hand'] as const;
export type AdapterType = (typeof AdapterType)[number];

export const HandOutputMode = ['comment', 'issue', 'fact', 'silent'] as const;
export type HandOutputMode = (typeof HandOutputMode)[number];

export const GoalLevel = ['company', 'team', 'agent', 'task'] as const;
export type GoalLevel = (typeof GoalLevel)[number];

export const GoalStatus = ['active', 'completed', 'cancelled'] as const;
export type GoalStatus = (typeof GoalStatus)[number];

export const IssueStatus = [
  'backlog',
  'todo',
  'in_progress',
  'in_review',
  'done',
  'cancelled',
] as const;
export type IssueStatus = (typeof IssueStatus)[number];

export const IssuePriority = ['critical', 'high', 'medium', 'low'] as const;
export type IssuePriority = (typeof IssuePriority)[number];

export const HeartbeatRunStatus = [
  'queued',
  'running',
  'succeeded',
  'failed',
  'cancelled',
  'timed_out',
] as const;
export type HeartbeatRunStatus = (typeof HeartbeatRunStatus)[number];

export const InvocationSource = ['scheduled', 'assigned', 'mentioned', 'manual', 'event'] as const;
export type InvocationSource = (typeof InvocationSource)[number];

export const ApprovalType = [
  'hire_agent',
  'strategy',
  'purchase',
  'publish',
  'budget_increase',
  'hand_action',
  'skill_proposal',
] as const;
export type ApprovalType = (typeof ApprovalType)[number];

export const ApprovalStatus = ['pending', 'approved', 'rejected', 'cancelled'] as const;
export type ApprovalStatus = (typeof ApprovalStatus)[number];

export const EvaluatorType = ['self', 'peer', 'judge', 'deterministic'] as const;
export type EvaluatorType = (typeof EvaluatorType)[number];

export const LessonOutcome = ['success', 'partial_success', 'failure'] as const;
export type LessonOutcome = (typeof LessonOutcome)[number];

export const QualityTrend = ['improving', 'stable', 'degrading'] as const;
export type QualityTrend = (typeof QualityTrend)[number];

export const AutonomyLevel = ['supervised', 'semi_auto', 'auto', 'degraded'] as const;
export type AutonomyLevel = (typeof AutonomyLevel)[number];

export const SkillStatus = ['proposed', 'approved', 'active', 'deprecated'] as const;
export type SkillStatus = (typeof SkillStatus)[number];

export const StrategyPatternType = [
  'goal_decomposition',
  'delegation',
  'resource_allocation',
] as const;
export type StrategyPatternType = (typeof StrategyPatternType)[number];

export const FactType = ['decision', 'entity', 'relationship', 'observation'] as const;
export type FactType = (typeof FactType)[number];

export const ContentType = ['lesson', 'fact', 'document', 'code'] as const;
export type ContentType = (typeof ContentType)[number];

export const PromptType = ['heartbeat', 'system', 'skill'] as const;
export type PromptType = (typeof PromptType)[number];

export const ActorType = ['agent', 'user', 'system'] as const;
export type ActorType = (typeof ActorType)[number];

export const ConfigSource = ['patch', 'rollback'] as const;
export type ConfigSource = (typeof ConfigSource)[number];

export const ConversationStatus = ['active', 'archived', 'closed'] as const;
export type ConversationStatus = (typeof ConversationStatus)[number];

export const MessageRole = ['user', 'agent', 'system'] as const;
export type MessageRole = (typeof MessageRole)[number];

export const ChannelBindingType = ['default', 'dm', 'channel', 'thread'] as const;
export type ChannelBindingType = (typeof ChannelBindingType)[number];

export const ChannelName = [
  'webchat',
  'slack',
  'discord',
  'telegram',
  'whatsapp',
  'teams',
  'email',
] as const;
export type ChannelName = (typeof ChannelName)[number];

// Trigger priority ordering (higher index = higher priority)
export const TriggerPriority = [
  'scheduled',
  'mentioned',
  'assigned',
  'channel_message',
  'manual',
] as const;
export type TriggerPriority = (typeof TriggerPriority)[number];

// Trigger + Workflow automation
export const TriggerPatternType = [
  'event_match',
  'budget_threshold',
  'schedule_missed',
  'quality_failure',
  'agent_idle',
] as const;
export type TriggerPatternType = (typeof TriggerPatternType)[number];

export const TriggerActionType = ['wake_agent', 'create_issue', 'run_workflow'] as const;
export type TriggerActionType = (typeof TriggerActionType)[number];

export const WorkflowStepMode = ['sequential', 'fan_out', 'conditional'] as const;
export type WorkflowStepMode = (typeof WorkflowStepMode)[number];

export const WorkflowRunStatus = ['running', 'completed', 'failed', 'cancelled'] as const;
export type WorkflowRunStatus = (typeof WorkflowRunStatus)[number];

export const WorkflowStepStatus = ['pending', 'running', 'completed', 'failed', 'skipped'] as const;
export type WorkflowStepStatus = (typeof WorkflowStepStatus)[number];

// Limits
export const BUDGET_WARNING_THRESHOLD = 0.8;
export const MAX_REVISION_ITERATIONS = 3;
export const MIN_IMPROVEMENT_THRESHOLD = 0.1;
export const EVENT_DEBOUNCE_WINDOW_MS = 5000;
export const HEARTBEAT_DEFAULT_TIMEOUT_MS = 5 * 60 * 1000;
export const CHECKOUT_LOCK_TIMEOUT_MS = 30 * 60 * 1000;
