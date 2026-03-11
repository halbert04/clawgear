import { z } from 'zod';
import {
  ActorType,
  AdapterType,
  AgentRole,
  AgentStatus,
  type ApprovalStatus,
  ApprovalType,
  type AutonomyLevel,
  ChannelBindingType,
  ChannelName,
  CompanyStatus,
  type ContentType,
  ConversationStatus,
  type EvaluatorType,
  type FactType,
  GoalLevel,
  GoalStatus,
  HandOutputMode,
  type HeartbeatRunStatus,
  type InvocationSource,
  IssuePriority,
  IssueStatus,
  type LessonOutcome,
  type MessageRole,
  ModelTier,
  PromptType,
  type QualityTrend,
  SkillStatus,
  StrategyPatternType,
  TriggerActionType,
  TriggerPatternType,
  WorkflowStepMode,
} from '../constants/index.js';

// ============================================================
// PRIMITIVES
// ============================================================

export const uuidSchema = z.string().uuid();

export const paginationSchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0),
});

// ============================================================
// COMPANY
// ============================================================

export const createCompanySchema = z.object({
  name: z.string().min(1).max(255),
  description: z.string().max(2000).nullable().optional(),
  issuePrefix: z
    .string()
    .min(1)
    .max(10)
    .regex(/^[A-Z][A-Z0-9]*$/),
  budgetMonthlyCents: z.coerce.number().int().min(0).default(0),
  requireBoardApproval: z.boolean().default(true),
});

export const updateCompanySchema = z.object({
  name: z.string().min(1).max(255).optional(),
  description: z.string().max(2000).nullable().optional(),
  status: z.enum(CompanyStatus).optional(),
  budgetMonthlyCents: z.coerce.number().int().min(0).optional(),
  requireBoardApproval: z.boolean().optional(),
});

// ============================================================
// AGENT
// ============================================================

const capabilitySchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('file_read'), glob: z.string() }),
  z.object({ type: z.literal('file_write'), glob: z.string() }),
  z.object({ type: z.literal('net_connect'), pattern: z.string() }),
  z.object({ type: z.literal('tool_invoke'), toolId: z.string() }),
  z.object({ type: z.literal('agent_message'), agentId: z.string() }),
  z.object({ type: z.literal('shell_exec'), commands: z.array(z.string()) }),
  z.object({ type: z.literal('docker_exec'), image: z.string() }),
]);

export const createAgentSchema = z.object({
  name: z.string().min(1).max(255),
  title: z.string().max(255).nullable().optional(),
  role: z.enum(AgentRole),
  icon: z.string().max(50).nullable().optional(),
  reportsTo: uuidSchema.nullable().optional(),
  capabilities: z.array(capabilitySchema).default([]),
  permissions: z.record(z.unknown()).default({}),
  adapterType: z.enum(AdapterType),
  adapterConfig: z.record(z.unknown()).default({}),
  modelTier: z.enum(ModelTier).default('smart'),
  modelOverride: z.string().nullable().optional(),
  budgetMonthlyCents: z.coerce.number().int().min(0).default(0),
  systemPrompt: z.string().max(50000).nullable().optional(),
});

export const updateAgentSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  title: z.string().max(255).nullable().optional(),
  role: z.enum(AgentRole).optional(),
  icon: z.string().max(50).nullable().optional(),
  status: z.enum(AgentStatus).optional(),
  reportsTo: uuidSchema.nullable().optional(),
  capabilities: z.array(capabilitySchema).optional(),
  permissions: z.record(z.unknown()).optional(),
  adapterType: z.enum(AdapterType).optional(),
  adapterConfig: z.record(z.unknown()).optional(),
  modelTier: z.enum(ModelTier).optional(),
  modelOverride: z.string().nullable().optional(),
  budgetMonthlyCents: z.coerce.number().int().min(0).optional(),
  systemPrompt: z.string().max(50000).nullable().optional(),
});

// ============================================================
// GOAL
// ============================================================

export const createGoalSchema = z.object({
  parentId: uuidSchema.nullable().optional(),
  level: z.enum(GoalLevel),
  ownerAgentId: uuidSchema.nullable().optional(),
  title: z.string().min(1).max(500),
  description: z.string().max(5000).nullable().optional(),
});

export const updateGoalSchema = z.object({
  status: z.enum(GoalStatus).optional(),
  ownerAgentId: uuidSchema.nullable().optional(),
  title: z.string().min(1).max(500).optional(),
  description: z.string().max(5000).nullable().optional(),
});

// ============================================================
// PROJECT
// ============================================================

export const createProjectSchema = z.object({
  goalId: uuidSchema.nullable().optional(),
  leadAgentId: uuidSchema.nullable().optional(),
  name: z.string().min(1).max(255),
  description: z.string().max(5000).nullable().optional(),
  targetDate: z.string().date().nullable().optional(),
  color: z.string().max(20).nullable().optional(),
});

// ============================================================
// ISSUE
// ============================================================

export const createIssueSchema = z.object({
  projectId: uuidSchema.nullable().optional(),
  goalId: uuidSchema.nullable().optional(),
  parentId: uuidSchema.nullable().optional(),
  title: z.string().min(1).max(500),
  description: z.string().max(10000).nullable().optional(),
  priority: z.enum(IssuePriority).default('medium'),
  assigneeAgentId: uuidSchema.nullable().optional(),
  requiredCapabilities: z.array(z.string()).nullable().optional(),
  billingCode: z.string().max(100).nullable().optional(),
});

export const updateIssueSchema = z.object({
  title: z.string().min(1).max(500).optional(),
  description: z.string().max(10000).nullable().optional(),
  status: z.enum(IssueStatus).optional(),
  priority: z.enum(IssuePriority).optional(),
  assigneeAgentId: uuidSchema.nullable().optional(),
  projectId: uuidSchema.nullable().optional(),
  goalId: uuidSchema.nullable().optional(),
});

// ============================================================
// APPROVAL
// ============================================================

export const createApprovalSchema = z.object({
  type: z.enum(ApprovalType),
  requestedByAgentId: uuidSchema,
  payload: z.record(z.unknown()),
});

export const decideApprovalSchema = z.object({
  status: z.enum(['approved', 'rejected'] as const),
  decidedByUserId: z.string().nullable().optional(),
  decidedByAgentId: uuidSchema.nullable().optional(),
  decisionNote: z.string().max(2000).nullable().optional(),
});

// ============================================================
// ISSUE COMMENT
// ============================================================

export const createIssueCommentSchema = z.object({
  authorAgentId: uuidSchema.nullable().optional(),
  authorUserId: z.string().nullable().optional(),
  body: z.string().min(1).max(50000),
});

// ============================================================
// COST EVENT
// ============================================================

export const createCostEventSchema = z.object({
  agentId: uuidSchema,
  issueId: uuidSchema.nullable().optional(),
  projectId: uuidSchema.nullable().optional(),
  goalId: uuidSchema.nullable().optional(),
  provider: z.string().min(1).max(100),
  model: z.string().min(1).max(100),
  inputTokens: z.number().int().min(0),
  outputTokens: z.number().int().min(0),
  costCents: z.number().int().min(0),
  billingCode: z.string().max(100).nullable().optional(),
});

// ============================================================
// ACTIVITY LOG
// ============================================================

export const createActivityLogSchema = z.object({
  actorType: z.enum(ActorType),
  actorId: z.string().min(1),
  action: z.string().min(1).max(255),
  entityType: z.string().min(1).max(100),
  entityId: uuidSchema.nullable().optional(),
  agentId: uuidSchema.nullable().optional(),
  runId: uuidSchema.nullable().optional(),
  details: z.record(z.unknown()).nullable().optional(),
});

// ============================================================
// QUALITY
// ============================================================

const rubricCriterionSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().max(500),
  weight: z.number().min(0).max(1),
  passThreshold: z.number().min(0).max(1),
});

export const createRubricSchema = z.object({
  name: z.string().min(1).max(255),
  role: z.enum(AgentRole).nullable().optional(),
  taskType: z.string().max(100).nullable().optional(),
  criteria: z.array(rubricCriterionSchema).min(1),
  judgeModel: z.string().default('claude-sonnet-4-20250514'),
  judgePrompt: z.string().min(1).max(50000),
  minImprovementThreshold: z.number().min(0).max(1).default(0.1),
});

// ============================================================
// CHANNEL BINDING
// ============================================================

export const createChannelBindingSchema = z.object({
  channelName: z.enum(ChannelName),
  agentId: uuidSchema,
  externalChannelId: z.string().max(255).nullable().optional(),
  bindingType: z.enum(ChannelBindingType).default('default'),
  priority: z.number().int().min(0).max(100).default(0),
  config: z.record(z.unknown()).default({}),
});

export const updateChannelBindingSchema = z.object({
  agentId: uuidSchema.optional(),
  externalChannelId: z.string().max(255).nullable().optional(),
  bindingType: z.enum(ChannelBindingType).optional(),
  priority: z.number().int().min(0).max(100).optional(),
  config: z.record(z.unknown()).optional(),
  isActive: z.boolean().optional(),
});

// ============================================================
// CONVERSATION
// ============================================================

export const createConversationSchema = z.object({
  agentId: uuidSchema,
  channelName: z.enum(ChannelName).default('webchat'),
  title: z.string().max(255).nullable().optional(),
  participantId: z.string().max(255).nullable().optional(),
  participantName: z.string().max(255).nullable().optional(),
  metadata: z.record(z.unknown()).default({}),
});

export const updateConversationSchema = z.object({
  title: z.string().max(255).nullable().optional(),
  status: z.enum(ConversationStatus).optional(),
});

// ============================================================
// CONVERSATION MESSAGE
// ============================================================

export const createConversationMessageSchema = z.object({
  content: z.string().min(1).max(100000),
  senderId: z.string().max(255).nullable().optional(),
  senderName: z.string().max(255).nullable().optional(),
});

// ============================================================
// HAND CONFIG
// ============================================================

export const handConfigSchema = z.object({
  name: z.string().min(1).max(255),
  description: z.string().max(5000),
  schedule: z.string().min(1).max(100),
  innerAdapter: z.enum(AdapterType),
  innerAdapterConfig: z.record(z.unknown()).default({}),
  taskPrompt: z.string().min(1).max(50000),
  tools: z.array(z.string()).default([]),
  settings: z.record(z.unknown()).default({}),
  metrics: z.array(z.string()).default([]),
  requiresApproval: z.boolean().default(false),
  outputMode: z.enum(HandOutputMode).default('comment'),
  ownerAgentId: uuidSchema.nullable().default(null),
});

export const activateHandSchema = z.object({
  name: z.string().min(1).max(255),
  companyId: uuidSchema,
  ownerAgentId: uuidSchema.nullable().optional(),
  overrides: z
    .object({
      schedule: z.string().min(1).max(100).optional(),
      innerAdapter: z.enum(AdapterType).optional(),
      innerAdapterConfig: z.record(z.unknown()).optional(),
      settings: z.record(z.unknown()).optional(),
      requiresApproval: z.boolean().optional(),
      outputMode: z.enum(HandOutputMode).optional(),
    })
    .optional(),
});

// ============================================================
// EVOLVED SKILL
// ============================================================

export const createEvolvedSkillSchema = z.object({
  name: z.string().min(1).max(255),
  description: z.string().min(1).max(5000),
  content: z.string().min(1).max(100000),
  triggerConditions: z.string().min(1).max(5000),
  exampleInvocations: z.array(z.string().max(5000)).min(1).max(10),
  parentSkillId: uuidSchema.nullable().optional(),
});

export const updateSkillStatusSchema = z.object({
  status: z.enum(SkillStatus),
});

// ============================================================
// PROMPT VERSION
// ============================================================

export const createPromptVersionSchema = z.object({
  agentRole: z.string().min(1).max(100),
  promptType: z.enum(PromptType),
  content: z.string().min(1).max(100000),
  parentVersionId: uuidSchema.nullable().optional(),
});

// ============================================================
// STRATEGY PATTERN
// ============================================================

export const createStrategyPatternSchema = z.object({
  agentId: uuidSchema,
  patternType: z.enum(StrategyPatternType),
  description: z.string().min(1).max(5000),
  contextJson: z.record(z.unknown()).default({}),
});

// ============================================================
// TRIGGER
// ============================================================

export const createTriggerSchema = z.object({
  name: z.string().min(1).max(255),
  description: z.string().max(5000).nullable().optional(),
  patternType: z.enum(TriggerPatternType),
  patternConfig: z.record(z.unknown()),
  actionType: z.enum(TriggerActionType),
  actionConfig: z.record(z.unknown()),
  isActive: z.boolean().default(true),
  maxFireCount: z.number().int().min(1).nullable().optional(),
  cooldownMs: z.number().int().min(0).default(10000),
  createdByAgentId: uuidSchema.nullable().optional(),
});

export const updateTriggerSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  description: z.string().max(5000).nullable().optional(),
  patternConfig: z.record(z.unknown()).optional(),
  actionConfig: z.record(z.unknown()).optional(),
  isActive: z.boolean().optional(),
  maxFireCount: z.number().int().min(1).nullable().optional(),
  cooldownMs: z.number().int().min(0).optional(),
});

// ============================================================
// WORKFLOW
// ============================================================

const workflowStepSchema: z.ZodType<unknown> = z.lazy(() =>
  z.object({
    name: z.string().min(1).max(255),
    mode: z.enum(WorkflowStepMode),
    agentRole: z.string().max(100).optional(),
    agentId: uuidSchema.optional(),
    prompt: z.string().max(50000).optional(),
    onError: z.enum(['fail', 'skip', 'retry']).optional(),
    maxRetries: z.number().int().min(0).max(10).optional(),
    timeoutMs: z.number().int().min(1000).optional(),
    subSteps: z.array(workflowStepSchema).optional(),
    condition: z.string().max(5000).optional(),
    ifTrue: workflowStepSchema.optional(),
    ifFalse: workflowStepSchema.optional(),
  }),
);

export const createWorkflowSchema = z.object({
  name: z.string().min(1).max(255),
  description: z.string().max(5000).nullable().optional(),
  definition: z.object({
    steps: z.array(workflowStepSchema).min(1),
  }),
  isActive: z.boolean().default(true),
  createdByAgentId: uuidSchema.nullable().optional(),
});

export const updateWorkflowSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  description: z.string().max(5000).nullable().optional(),
  definition: z
    .object({
      steps: z.array(workflowStepSchema).min(1),
    })
    .optional(),
  isActive: z.boolean().optional(),
});

export const executeWorkflowSchema = z.object({
  inputVars: z.record(z.unknown()).default({}),
});

// Re-export for convenience
export type {
  ApprovalStatus,
  ApprovalType,
  AutonomyLevel,
  ChannelBindingType,
  ChannelName,
  CompanyStatus,
  ContentType,
  ConversationStatus,
  EvaluatorType,
  FactType,
  GoalLevel,
  GoalStatus,
  HeartbeatRunStatus,
  InvocationSource,
  IssuePriority,
  IssueStatus,
  LessonOutcome,
  MessageRole,
  ModelTier,
  PromptType,
  QualityTrend,
  SkillStatus,
  StrategyPatternType,
  TriggerActionType,
  TriggerPatternType,
  WorkflowStepMode,
};
