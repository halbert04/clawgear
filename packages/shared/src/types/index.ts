import type {
  ActorType,
  AdapterType,
  AgentRole,
  AgentStatus,
  ApprovalStatus,
  ApprovalType,
  AutonomyLevel,
  ChannelBindingType,
  ChannelName,
  CompanyStatus,
  ConfigSource,
  ConversationStatus,
  ContentType,
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
} from '../constants/index.js';

// ============================================================
// CORE ORCHESTRATION
// ============================================================

export interface Company {
  id: string;
  name: string;
  description: string | null;
  status: CompanyStatus;
  issuePrefix: string;
  issueCounter: number;
  budgetMonthlyCents: bigint;
  spentMonthlyCents: bigint;
  requireBoardApproval: boolean;
  missionGoalId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface Agent {
  id: string;
  companyId: string;
  name: string;
  title: string | null;
  role: AgentRole;
  icon: string | null;
  status: AgentStatus;
  reportsTo: string | null;
  capabilities: Capability[];
  permissions: Record<string, unknown>;
  adapterType: AdapterType;
  adapterConfig: Record<string, unknown>;
  modelTier: ModelTier;
  modelOverride: string | null;
  budgetMonthlyCents: bigint;
  spentMonthlyCents: bigint;
  systemPrompt: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface Goal {
  id: string;
  companyId: string;
  parentId: string | null;
  level: GoalLevel;
  status: GoalStatus;
  ownerAgentId: string | null;
  title: string;
  description: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface Project {
  id: string;
  companyId: string;
  goalId: string | null;
  leadAgentId: string | null;
  name: string;
  description: string | null;
  status: string;
  targetDate: string | null;
  color: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface Issue {
  id: string;
  companyId: string;
  projectId: string | null;
  goalId: string | null;
  parentId: string | null;
  issueNumber: number;
  identifier: string;
  title: string;
  description: string | null;
  status: IssueStatus;
  priority: IssuePriority;
  assigneeAgentId: string | null;
  checkoutRunId: string | null;
  executionLockedAt: Date | null;
  lockTimeoutAt: Date | null;
  requiredCapabilities: string[] | null;
  billingCode: string | null;
  requestDepth: number;
  startedAt: Date | null;
  completedAt: Date | null;
  cancelledAt: Date | null;
  reopenedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface IssueComment {
  id: string;
  companyId: string;
  issueId: string;
  authorAgentId: string | null;
  authorUserId: string | null;
  body: string;
  createdAt: Date;
}

export interface HeartbeatRun {
  id: string;
  companyId: string;
  agentId: string;
  invocationSource: InvocationSource;
  status: HeartbeatRunStatus;
  contextSnapshot: Record<string, unknown> | null;
  usageJson: Record<string, unknown> | null;
  resultJson: Record<string, unknown> | null;
  startedAt: Date | null;
  finishedAt: Date | null;
  createdAt: Date;
}

export interface CostEvent {
  id: string;
  companyId: string;
  agentId: string;
  issueId: string | null;
  projectId: string | null;
  goalId: string | null;
  provider: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  costCents: number;
  billingCode: string | null;
  occurredAt: Date;
}

export interface Approval {
  id: string;
  companyId: string;
  type: ApprovalType;
  status: ApprovalStatus;
  requestedByAgentId: string | null;
  payload: Record<string, unknown>;
  decidedByUserId: string | null;
  decidedByAgentId: string | null;
  decisionNote: string | null;
  decidedAt: Date | null;
  createdAt: Date;
}

export interface AgentConfigRevision {
  id: string;
  companyId: string;
  agentId: string;
  beforeConfig: Record<string, unknown>;
  afterConfig: Record<string, unknown>;
  changedKeys: string[];
  source: ConfigSource;
  rolledBackFromRevisionId: string | null;
  createdAt: Date;
}

export interface ActivityLogEntry {
  id: string;
  companyId: string;
  actorType: ActorType;
  actorId: string;
  action: string;
  entityType: string;
  entityId: string | null;
  agentId: string | null;
  runId: string | null;
  details: Record<string, unknown> | null;
  createdAt: Date;
}

export interface AgentRuntimeState {
  agentId: string;
  companyId: string;
  sessionId: string | null;
  stateJson: Record<string, unknown> | null;
  lastRunId: string | null;
  lastRunStatus: string | null;
  containerId: string | null;
  containerStatus: string | null;
  cumulativeTokens: bigint;
  cumulativeCostCents: bigint;
  updatedAt: Date;
}

// ============================================================
// QUALITY SYSTEM
// ============================================================

export interface RubricCriterion {
  name: string;
  description: string;
  weight: number;
  passThreshold: number;
}

export interface QualityRubric {
  id: string;
  companyId: string;
  name: string;
  role: AgentRole | null;
  taskType: string | null;
  criteria: RubricCriterion[];
  judgeModel: string;
  judgePrompt: string;
  minImprovementThreshold: number;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface QualityEvaluation {
  id: string;
  companyId: string;
  issueId: string | null;
  runId: string;
  agentId: string;
  rubricId: string | null;
  evaluatorType: EvaluatorType;
  evaluatorAgentId: string | null;
  scores: Record<string, number>;
  overallScore: number;
  passed: boolean;
  feedback: string | null;
  revisionNumber: number;
  createdAt: Date;
}

// ============================================================
// LEARNING SYSTEM
// ============================================================

export interface LessonLearned {
  id: string;
  companyId: string;
  agentId: string;
  runId: string | null;
  issueId: string | null;
  taskType: string;
  approach: string;
  whatWorked: string | null;
  whatFailed: string | null;
  lesson: string;
  outcome: LessonOutcome;
  confidence: number;
  embeddingModel: string | null;
  timesRetrieved: number;
  createdAt: Date;
}

export interface AgentCompetence {
  id: string;
  companyId: string;
  agentId: string;
  taskType: string;
  totalRuns: number;
  successfulRuns: number;
  failedRuns: number;
  avgCostCents: number;
  avgDurationMs: number;
  avgQualityScore: number;
  qualityTrend: QualityTrend;
  autonomyLevel: AutonomyLevel;
  updatedAt: Date;
}

export interface PromptVersion {
  id: string;
  companyId: string;
  agentRole: string;
  promptType: PromptType;
  version: number;
  content: string;
  evaluationScore: number | null;
  isActive: boolean;
  parentVersionId: string | null;
  createdAt: Date;
}

// ============================================================
// SHARED KNOWLEDGE
// ============================================================

export interface Fact {
  id: string;
  companyId: string;
  agentId: string;
  factType: FactType;
  subject: string;
  predicate: string;
  object: string;
  confidence: number;
  sourceRunId: string | null;
  sourceIssueId: string | null;
  validFrom: Date;
  invalidatedAt: Date | null;
  embeddingModel: string | null;
  createdAt: Date;
}

export interface SharedEmbedding {
  id: string;
  companyId: string;
  agentId: string;
  content: string;
  contentType: ContentType;
  contentHash: string;
  embeddingModel: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: Date;
}

// ============================================================
// CAPABILITIES
// ============================================================

// ============================================================
// COMMUNICATION + CHANNELS
// ============================================================

export interface ChannelBinding {
  id: string;
  companyId: string;
  channelName: ChannelName;
  agentId: string;
  externalChannelId: string | null;
  bindingType: ChannelBindingType;
  priority: number;
  config: Record<string, unknown>;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface Conversation {
  id: string;
  companyId: string;
  agentId: string;
  channelName: ChannelName;
  externalThreadId: string | null;
  title: string | null;
  status: ConversationStatus;
  participantId: string | null;
  participantName: string | null;
  metadata: Record<string, unknown>;
  lastMessageAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface ConversationMessage {
  id: string;
  companyId: string;
  conversationId: string;
  role: MessageRole;
  content: string;
  agentId: string | null;
  senderId: string | null;
  senderName: string | null;
  runId: string | null;
  metadata: Record<string, unknown>;
  createdAt: Date;
}

// ============================================================
// CAPABILITIES
// ============================================================

export type Capability =
  | { type: 'file_read'; glob: string }
  | { type: 'file_write'; glob: string }
  | { type: 'net_connect'; pattern: string }
  | { type: 'tool_invoke'; toolId: string }
  | { type: 'agent_message'; agentId: string }
  | { type: 'shell_exec'; commands: string[] }
  | { type: 'docker_exec'; image: string };

// ============================================================
// API TYPES
// ============================================================

export interface PaginationParams {
  limit: number;
  offset: number;
}

export interface PaginatedResponse<T> {
  data: T[];
  total: number;
  limit: number;
  offset: number;
}

export interface ApiError {
  error: string;
  message: string;
  statusCode: number;
  details?: unknown;
}

export interface HealthCheck {
  status: 'ok' | 'degraded' | 'down';
  version: string;
  uptime: number;
}

export interface HealthCheckDetail extends HealthCheck {
  database: { connected: boolean; latencyMs: number };
  instanceId: string;
}
