import { sql } from 'drizzle-orm';
import {
  type AnyPgColumn,
  bigint,
  boolean,
  check,
  customType,
  date,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';

// ============================================================
// CUSTOM TYPES
// ============================================================

const vector = customType<{ data: number[]; driverParam: string }>({
  dataType() {
    return 'vector(1536)';
  },
  toDriver(value: number[]): string {
    return `[${value.join(',')}]`;
  },
  fromDriver(value: unknown): number[] {
    const str = value as string;
    return str.slice(1, -1).split(',').map(Number);
  },
});

// ============================================================
// CORE ORCHESTRATION
// ============================================================

export const companies = pgTable(
  'companies',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: text('name').notNull(),
    description: text('description'),
    status: text('status').notNull().default('active'),
    issuePrefix: text('issue_prefix').notNull(),
    issueCounter: integer('issue_counter').notNull().default(0),
    budgetMonthlyCents: bigint('budget_monthly_cents', { mode: 'bigint' })
      .notNull()
      .default(sql`0`),
    spentMonthlyCents: bigint('spent_monthly_cents', { mode: 'bigint' }).notNull().default(sql`0`),
    requireBoardApproval: boolean('require_board_approval').notNull().default(true),
    missionGoalId: uuid('mission_goal_id'), // FK added via ALTER TABLE (circular)
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check('companies_status_check', sql`${t.status} IN ('active', 'paused', 'archived')`),
    check('companies_budget_check', sql`${t.budgetMonthlyCents} >= 0`),
    check('companies_spent_check', sql`${t.spentMonthlyCents} >= 0`),
  ],
);

export const agents = pgTable(
  'agents',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    title: text('title'),
    role: text('role').notNull(),
    icon: text('icon'),
    status: text('status').notNull().default('idle'),
    reportsTo: uuid('reports_to').references((): AnyPgColumn => agents.id, {
      onDelete: 'set null',
    }),
    capabilities: jsonb('capabilities').notNull().default([]),
    permissions: jsonb('permissions').notNull().default({}),
    adapterType: text('adapter_type').notNull(),
    adapterConfig: jsonb('adapter_config').notNull().default({}),
    modelTier: text('model_tier').notNull().default('smart'),
    modelOverride: text('model_override'),
    budgetMonthlyCents: bigint('budget_monthly_cents', { mode: 'bigint' })
      .notNull()
      .default(sql`0`),
    spentMonthlyCents: bigint('spent_monthly_cents', { mode: 'bigint' }).notNull().default(sql`0`),
    systemPrompt: text('system_prompt'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique('agents_company_name').on(t.companyId, t.name),
    index('idx_agents_company').on(t.companyId),
    index('idx_agents_reports_to').on(t.reportsTo),
    check(
      'agents_status_check',
      sql`${t.status} IN ('idle', 'running', 'paused', 'error', 'terminated')`,
    ),
    check(
      'agents_role_check',
      sql`${t.role} IN ('ceo', 'cto', 'engineer', 'analyst', 'researcher', 'writer', 'designer', 'marketer', 'support')`,
    ),
    check(
      'agents_model_tier_check',
      sql`${t.modelTier} IN ('frontier', 'smart', 'fast', 'lightweight')`,
    ),
    check(
      'agents_adapter_type_check',
      sql`${t.adapterType} IN ('claude_code', 'process', 'http', 'hand')`,
    ),
    check('agents_budget_check', sql`${t.budgetMonthlyCents} >= 0`),
    check('agents_spent_check', sql`${t.spentMonthlyCents} >= 0`),
  ],
);

export const goals = pgTable(
  'goals',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id, { onDelete: 'cascade' }),
    parentId: uuid('parent_id').references((): AnyPgColumn => goals.id, {
      onDelete: 'set null',
    }),
    level: text('level').notNull(),
    status: text('status').notNull().default('active'),
    ownerAgentId: uuid('owner_agent_id').references(() => agents.id, { onDelete: 'set null' }),
    title: text('title').notNull(),
    description: text('description'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('idx_goals_parent').on(t.parentId),
    check('goals_level_check', sql`${t.level} IN ('company', 'team', 'agent', 'task')`),
    check('goals_status_check', sql`${t.status} IN ('active', 'completed', 'cancelled')`),
  ],
);

export const projects = pgTable('projects', {
  id: uuid('id').primaryKey().defaultRandom(),
  companyId: uuid('company_id')
    .notNull()
    .references(() => companies.id, { onDelete: 'cascade' }),
  goalId: uuid('goal_id').references(() => goals.id, { onDelete: 'set null' }),
  leadAgentId: uuid('lead_agent_id').references(() => agents.id, { onDelete: 'set null' }),
  name: text('name').notNull(),
  description: text('description'),
  status: text('status').notNull().default('active'),
  targetDate: date('target_date'),
  color: text('color'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const issues = pgTable(
  'issues',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id, { onDelete: 'cascade' }),
    projectId: uuid('project_id').references(() => projects.id, { onDelete: 'set null' }),
    goalId: uuid('goal_id').references(() => goals.id, { onDelete: 'set null' }),
    parentId: uuid('parent_id').references((): AnyPgColumn => issues.id, {
      onDelete: 'set null',
    }),
    issueNumber: integer('issue_number').notNull(),
    identifier: text('identifier').notNull(),
    title: text('title').notNull(),
    description: text('description'),
    status: text('status').notNull().default('backlog'),
    priority: text('priority').notNull().default('medium'),
    assigneeAgentId: uuid('assignee_agent_id').references(() => agents.id, {
      onDelete: 'set null',
    }),
    checkoutRunId: uuid('checkout_run_id'),
    executionLockedAt: timestamp('execution_locked_at', { withTimezone: true }),
    lockTimeoutAt: timestamp('lock_timeout_at', { withTimezone: true }),
    requiredCapabilities: jsonb('required_capabilities'),
    billingCode: text('billing_code'),
    requestDepth: integer('request_depth').notNull().default(0),
    startedAt: timestamp('started_at', { withTimezone: true }),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
    reopenedAt: timestamp('reopened_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique('issues_company_number').on(t.companyId, t.issueNumber),
    unique('issues_company_identifier').on(t.companyId, t.identifier),
    index('idx_issues_company_status').on(t.companyId, t.status),
    index('idx_issues_assignee').on(t.assigneeAgentId),
    index('idx_issues_project').on(t.projectId, t.status),
    check(
      'issues_status_check',
      sql`${t.status} IN ('backlog', 'todo', 'in_progress', 'in_review', 'done', 'cancelled')`,
    ),
    check('issues_priority_check', sql`${t.priority} IN ('critical', 'high', 'medium', 'low')`),
    check('issues_request_depth_check', sql`${t.requestDepth} >= 0`),
  ],
);

export const issueComments = pgTable(
  'issue_comments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id, { onDelete: 'cascade' }),
    issueId: uuid('issue_id')
      .notNull()
      .references(() => issues.id, { onDelete: 'cascade' }),
    authorAgentId: uuid('author_agent_id').references(() => agents.id, { onDelete: 'set null' }),
    authorUserId: text('author_user_id'),
    body: text('body').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('idx_issue_comments_issue').on(t.issueId, t.createdAt)],
);

export const heartbeatRuns = pgTable(
  'heartbeat_runs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id, { onDelete: 'cascade' }),
    agentId: uuid('agent_id')
      .notNull()
      .references(() => agents.id, { onDelete: 'cascade' }),
    invocationSource: text('invocation_source').notNull(),
    status: text('status').notNull().default('queued'),
    contextSnapshot: jsonb('context_snapshot'),
    usageJson: jsonb('usage_json'),
    resultJson: jsonb('result_json'),
    startedAt: timestamp('started_at', { withTimezone: true }),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('idx_heartbeat_runs_agent').on(t.companyId, t.agentId, t.createdAt),
    check(
      'heartbeat_runs_status_check',
      sql`${t.status} IN ('queued', 'running', 'succeeded', 'failed', 'cancelled', 'timed_out')`,
    ),
    check(
      'heartbeat_runs_source_check',
      sql`${t.invocationSource} IN ('scheduled', 'assigned', 'mentioned', 'manual', 'event')`,
    ),
  ],
);

export const costEvents = pgTable(
  'cost_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id, { onDelete: 'cascade' }),
    agentId: uuid('agent_id')
      .notNull()
      .references(() => agents.id, { onDelete: 'cascade' }),
    issueId: uuid('issue_id').references(() => issues.id, { onDelete: 'set null' }),
    projectId: uuid('project_id').references(() => projects.id, { onDelete: 'set null' }),
    goalId: uuid('goal_id').references(() => goals.id, { onDelete: 'set null' }),
    provider: text('provider').notNull(),
    model: text('model').notNull(),
    inputTokens: integer('input_tokens').notNull().default(0),
    outputTokens: integer('output_tokens').notNull().default(0),
    costCents: integer('cost_cents').notNull().default(0),
    billingCode: text('billing_code'),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('idx_cost_events_agent').on(t.companyId, t.agentId),
    index('idx_cost_events_time').on(t.companyId, t.occurredAt),
    check('cost_events_cost_check', sql`${t.costCents} >= 0`),
    check('cost_events_input_tokens_check', sql`${t.inputTokens} >= 0`),
    check('cost_events_output_tokens_check', sql`${t.outputTokens} >= 0`),
  ],
);

export const approvals = pgTable(
  'approvals',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id, { onDelete: 'cascade' }),
    type: text('type').notNull(),
    status: text('status').notNull().default('pending'),
    requestedByAgentId: uuid('requested_by_agent_id').references(() => agents.id, {
      onDelete: 'set null',
    }),
    payload: jsonb('payload').notNull(),
    decidedByUserId: text('decided_by_user_id'),
    decidedByAgentId: uuid('decided_by_agent_id').references(() => agents.id, {
      onDelete: 'set null',
    }),
    decisionNote: text('decision_note'),
    decidedAt: timestamp('decided_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check(
      'approvals_type_check',
      sql`${t.type} IN ('hire_agent', 'strategy', 'purchase', 'publish', 'budget_increase', 'hand_action', 'skill_proposal')`,
    ),
    check(
      'approvals_status_check',
      sql`${t.status} IN ('pending', 'approved', 'rejected', 'cancelled')`,
    ),
  ],
);

export const agentConfigRevisions = pgTable('agent_config_revisions', {
  id: uuid('id').primaryKey().defaultRandom(),
  companyId: uuid('company_id')
    .notNull()
    .references(() => companies.id, { onDelete: 'cascade' }),
  agentId: uuid('agent_id')
    .notNull()
    .references(() => agents.id, { onDelete: 'cascade' }),
  beforeConfig: jsonb('before_config').notNull(),
  afterConfig: jsonb('after_config').notNull(),
  changedKeys: text('changed_keys').array().notNull(),
  source: text('source').notNull().default('patch'),
  rolledBackFromRevisionId: uuid('rolled_back_from_revision_id'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const activityLog = pgTable(
  'activity_log',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id, { onDelete: 'cascade' }),
    actorType: text('actor_type').notNull(),
    actorId: text('actor_id').notNull(),
    action: text('action').notNull(),
    entityType: text('entity_type').notNull(),
    entityId: uuid('entity_id'),
    agentId: uuid('agent_id').references(() => agents.id, { onDelete: 'set null' }),
    runId: uuid('run_id').references(() => heartbeatRuns.id, { onDelete: 'set null' }),
    details: jsonb('details'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('idx_activity_log_company').on(t.companyId, t.createdAt),
    check('activity_log_actor_check', sql`${t.actorType} IN ('agent', 'user', 'system')`),
  ],
);

export const agentRuntimeState = pgTable('agent_runtime_state', {
  agentId: uuid('agent_id')
    .primaryKey()
    .references(() => agents.id, { onDelete: 'cascade' }),
  companyId: uuid('company_id')
    .notNull()
    .references(() => companies.id, { onDelete: 'cascade' }),
  sessionId: text('session_id'),
  stateJson: jsonb('state_json'),
  lastRunId: uuid('last_run_id').references(() => heartbeatRuns.id, { onDelete: 'set null' }),
  lastRunStatus: text('last_run_status'),
  containerId: text('container_id'),
  containerStatus: text('container_status'),
  cumulativeTokens: bigint('cumulative_tokens', { mode: 'bigint' }).notNull().default(sql`0`),
  cumulativeCostCents: bigint('cumulative_cost_cents', { mode: 'bigint' })
    .notNull()
    .default(sql`0`),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

// ============================================================
// QUALITY SYSTEM
// ============================================================

export const qualityRubrics = pgTable(
  'quality_rubrics',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    role: text('role'),
    taskType: text('task_type'),
    criteria: jsonb('criteria').notNull(),
    judgeModel: text('judge_model').notNull().default('claude-sonnet-4-20250514'),
    judgePrompt: text('judge_prompt').notNull(),
    minImprovementThreshold: doublePrecision('min_improvement_threshold').notNull().default(0.1),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique('quality_rubrics_company_name').on(t.companyId, t.name)],
);

export const qualityEvaluations = pgTable(
  'quality_evaluations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id, { onDelete: 'cascade' }),
    issueId: uuid('issue_id').references(() => issues.id, { onDelete: 'set null' }),
    runId: uuid('run_id')
      .notNull()
      .references(() => heartbeatRuns.id, { onDelete: 'cascade' }),
    agentId: uuid('agent_id')
      .notNull()
      .references(() => agents.id, { onDelete: 'cascade' }),
    rubricId: uuid('rubric_id').references(() => qualityRubrics.id, { onDelete: 'set null' }),
    evaluatorType: text('evaluator_type').notNull(),
    evaluatorAgentId: uuid('evaluator_agent_id').references(() => agents.id, {
      onDelete: 'set null',
    }),
    scores: jsonb('scores').notNull(),
    overallScore: doublePrecision('overall_score').notNull(),
    passed: boolean('passed').notNull(),
    feedback: text('feedback'),
    revisionNumber: integer('revision_number').notNull().default(1),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('idx_quality_evals_agent').on(t.companyId, t.agentId),
    index('idx_quality_evals_issue').on(t.issueId, t.createdAt),
    check(
      'quality_evals_evaluator_check',
      sql`${t.evaluatorType} IN ('self', 'peer', 'judge', 'deterministic')`,
    ),
    check('quality_evals_score_check', sql`${t.overallScore} >= 0 AND ${t.overallScore} <= 1`),
    check('quality_evals_revision_check', sql`${t.revisionNumber} >= 1`),
  ],
);

// ============================================================
// LEARNING SYSTEM
// ============================================================

export const lessonsLearned = pgTable(
  'lessons_learned',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id, { onDelete: 'cascade' }),
    agentId: uuid('agent_id')
      .notNull()
      .references(() => agents.id, { onDelete: 'cascade' }),
    runId: uuid('run_id').references(() => heartbeatRuns.id, { onDelete: 'set null' }),
    issueId: uuid('issue_id').references(() => issues.id, { onDelete: 'set null' }),
    taskType: text('task_type').notNull(),
    approach: text('approach').notNull(),
    whatWorked: text('what_worked'),
    whatFailed: text('what_failed'),
    lesson: text('lesson').notNull(),
    outcome: text('outcome').notNull(),
    confidence: doublePrecision('confidence').notNull().default(0.5),
    embedding: vector('embedding'),
    embeddingModel: text('embedding_model'),
    timesRetrieved: integer('times_retrieved').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('idx_lessons_company_type').on(t.companyId, t.taskType),
    check('lessons_outcome_check', sql`${t.outcome} IN ('success', 'partial_success', 'failure')`),
    check('lessons_confidence_check', sql`${t.confidence} >= 0 AND ${t.confidence} <= 1`),
  ],
);

export const agentCompetence = pgTable(
  'agent_competence',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id, { onDelete: 'cascade' }),
    agentId: uuid('agent_id')
      .notNull()
      .references(() => agents.id, { onDelete: 'cascade' }),
    taskType: text('task_type').notNull(),
    totalRuns: integer('total_runs').notNull().default(0),
    successfulRuns: integer('successful_runs').notNull().default(0),
    failedRuns: integer('failed_runs').notNull().default(0),
    avgCostCents: doublePrecision('avg_cost_cents').notNull().default(0),
    avgDurationMs: doublePrecision('avg_duration_ms').notNull().default(0),
    avgQualityScore: doublePrecision('avg_quality_score').notNull().default(0),
    qualityTrend: text('quality_trend').notNull().default('stable'),
    autonomyLevel: text('autonomy_level').notNull().default('supervised'),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique('agent_competence_unique').on(t.companyId, t.agentId, t.taskType),
    index('idx_competence_agent').on(t.companyId, t.agentId),
    check('competence_trend_check', sql`${t.qualityTrend} IN ('improving', 'stable', 'degrading')`),
    check(
      'competence_autonomy_check',
      sql`${t.autonomyLevel} IN ('supervised', 'semi_auto', 'auto', 'degraded')`,
    ),
    check('competence_runs_check', sql`${t.successfulRuns} + ${t.failedRuns} <= ${t.totalRuns}`),
    check('competence_quality_check', sql`${t.avgQualityScore} >= 0 AND ${t.avgQualityScore} <= 1`),
  ],
);

export const promptVersions = pgTable(
  'prompt_versions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id, { onDelete: 'cascade' }),
    agentRole: text('agent_role').notNull(),
    promptType: text('prompt_type').notNull(),
    version: integer('version').notNull(),
    content: text('content').notNull(),
    evaluationScore: doublePrecision('evaluation_score'),
    isActive: boolean('is_active').notNull().default(false),
    isAbTesting: boolean('is_ab_testing').notNull().default(false),
    abTrafficPercent: integer('ab_traffic_percent').notNull().default(0),
    sampleCount: integer('sample_count').notNull().default(0),
    parentVersionId: uuid('parent_version_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check('prompt_versions_type_check', sql`${t.promptType} IN ('heartbeat', 'system', 'skill')`),
    check(
      'prompt_versions_ab_traffic_check',
      sql`${t.abTrafficPercent} >= 0 AND ${t.abTrafficPercent} <= 100`,
    ),
  ],
);

// ============================================================
// SKILL EVOLUTION
// ============================================================

export const evolvedSkills = pgTable(
  'evolved_skills',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id, { onDelete: 'cascade' }),
    proposedByAgentId: uuid('proposed_by_agent_id')
      .notNull()
      .references(() => agents.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    description: text('description').notNull(),
    version: integer('version').notNull().default(1),
    content: text('content').notNull(),
    triggerConditions: text('trigger_conditions').notNull(),
    exampleInvocations: jsonb('example_invocations').notNull().default([]),
    status: text('status').notNull().default('proposed'),
    parentSkillId: uuid('parent_skill_id').references((): AnyPgColumn => evolvedSkills.id, {
      onDelete: 'set null',
    }),
    usageCount: integer('usage_count').notNull().default(0),
    embedding: vector('embedding'),
    embeddingModel: text('embedding_model'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique('evolved_skills_company_name_version').on(t.companyId, t.name, t.version),
    index('idx_evolved_skills_company').on(t.companyId, t.status),
    check(
      'evolved_skills_status_check',
      sql`${t.status} IN ('proposed', 'approved', 'active', 'deprecated')`,
    ),
    check('evolved_skills_version_check', sql`${t.version} >= 1`),
    check('evolved_skills_usage_check', sql`${t.usageCount} >= 0`),
  ],
);

// ============================================================
// STRATEGY LEARNING
// ============================================================

export const strategyPatterns = pgTable(
  'strategy_patterns',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id, { onDelete: 'cascade' }),
    agentId: uuid('agent_id')
      .notNull()
      .references(() => agents.id, { onDelete: 'cascade' }),
    patternType: text('pattern_type').notNull(),
    description: text('description').notNull(),
    successCount: integer('success_count').notNull().default(0),
    failureCount: integer('failure_count').notNull().default(0),
    confidence: doublePrecision('confidence').notNull().default(0.5),
    contextJson: jsonb('context_json').notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('idx_strategy_patterns_company').on(t.companyId, t.agentId),
    check(
      'strategy_patterns_type_check',
      sql`${t.patternType} IN ('goal_decomposition', 'delegation', 'resource_allocation')`,
    ),
    check('strategy_patterns_confidence_check', sql`${t.confidence} >= 0 AND ${t.confidence} <= 1`),
    check('strategy_patterns_success_check', sql`${t.successCount} >= 0`),
    check('strategy_patterns_failure_check', sql`${t.failureCount} >= 0`),
  ],
);

// ============================================================
// SHARED KNOWLEDGE
// ============================================================

export const facts = pgTable(
  'facts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id, { onDelete: 'cascade' }),
    agentId: uuid('agent_id')
      .notNull()
      .references(() => agents.id, { onDelete: 'cascade' }),
    factType: text('fact_type').notNull(),
    subject: text('subject').notNull(),
    predicate: text('predicate').notNull(),
    object: text('object').notNull(),
    confidence: doublePrecision('confidence').notNull().default(0.8),
    sourceRunId: uuid('source_run_id').references(() => heartbeatRuns.id, {
      onDelete: 'set null',
    }),
    sourceIssueId: uuid('source_issue_id').references(() => issues.id, { onDelete: 'set null' }),
    validFrom: timestamp('valid_from', { withTimezone: true }).notNull().defaultNow(),
    invalidatedAt: timestamp('invalidated_at', { withTimezone: true }),
    embedding: vector('embedding'),
    embeddingModel: text('embedding_model'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('idx_facts_company').on(t.companyId, t.factType),
    check(
      'facts_type_check',
      sql`${t.factType} IN ('decision', 'entity', 'relationship', 'observation')`,
    ),
    check('facts_confidence_check', sql`${t.confidence} >= 0 AND ${t.confidence} <= 1`),
  ],
);

export const sharedEmbeddings = pgTable(
  'shared_embeddings',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id, { onDelete: 'cascade' }),
    agentId: uuid('agent_id')
      .notNull()
      .references(() => agents.id, { onDelete: 'cascade' }),
    content: text('content').notNull(),
    contentType: text('content_type').notNull(),
    contentHash: text('content_hash').notNull(),
    embedding: vector('embedding'),
    embeddingModel: text('embedding_model'),
    metadata: jsonb('metadata'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique('shared_embeddings_hash').on(t.companyId, t.contentHash),
    check(
      'shared_embeddings_type_check',
      sql`${t.contentType} IN ('lesson', 'fact', 'document', 'code')`,
    ),
  ],
);

// ============================================================
// COMMUNICATION + CHANNELS
// ============================================================

export const channelBindings = pgTable(
  'channel_bindings',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id, { onDelete: 'cascade' }),
    channelName: text('channel_name').notNull(), // webchat | slack | discord | etc.
    agentId: uuid('agent_id')
      .notNull()
      .references(() => agents.id, { onDelete: 'cascade' }),
    externalChannelId: text('external_channel_id'), // Slack channel ID, etc.
    bindingType: text('binding_type').notNull().default('default'), // default | dm | channel | thread
    priority: integer('priority').notNull().default(0), // higher = more specific
    config: jsonb('config').notNull().default({}),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('idx_channel_bindings_company').on(t.companyId, t.channelName),
    index('idx_channel_bindings_agent').on(t.agentId),
    check(
      'channel_bindings_type_check',
      sql`${t.bindingType} IN ('default', 'dm', 'channel', 'thread')`,
    ),
  ],
);

export const conversations = pgTable(
  'conversations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id, { onDelete: 'cascade' }),
    agentId: uuid('agent_id')
      .notNull()
      .references(() => agents.id, { onDelete: 'cascade' }),
    channelName: text('channel_name').notNull(), // webchat | slack | etc.
    externalThreadId: text('external_thread_id'), // Slack thread TS, etc.
    title: text('title'),
    status: text('status').notNull().default('active'), // active | archived | closed
    participantId: text('participant_id'), // human user or external sender ID
    participantName: text('participant_name'),
    metadata: jsonb('metadata').notNull().default({}),
    lastMessageAt: timestamp('last_message_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('idx_conversations_company').on(t.companyId, t.status),
    index('idx_conversations_agent').on(t.agentId, t.status),
    index('idx_conversations_last_message').on(t.companyId, t.lastMessageAt),
    check('conversations_status_check', sql`${t.status} IN ('active', 'archived', 'closed')`),
  ],
);

export const conversationMessages = pgTable(
  'conversation_messages',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id, { onDelete: 'cascade' }),
    conversationId: uuid('conversation_id')
      .notNull()
      .references(() => conversations.id, { onDelete: 'cascade' }),
    role: text('role').notNull(), // user | agent | system
    content: text('content').notNull(),
    agentId: uuid('agent_id').references(() => agents.id, { onDelete: 'set null' }),
    senderId: text('sender_id'), // external user ID
    senderName: text('sender_name'),
    runId: uuid('run_id').references(() => heartbeatRuns.id, { onDelete: 'set null' }),
    metadata: jsonb('metadata').notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('idx_conversation_messages_conversation').on(t.conversationId, t.createdAt),
    check('conversation_messages_role_check', sql`${t.role} IN ('user', 'agent', 'system')`),
  ],
);

// ============================================================
// AUTOMATION (TRIGGERS + WORKFLOWS)
// ============================================================

export const triggers = pgTable(
  'triggers',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    description: text('description'),
    patternType: text('pattern_type').notNull(),
    patternConfig: jsonb('pattern_config').notNull().default({}),
    actionType: text('action_type').notNull(),
    actionConfig: jsonb('action_config').notNull().default({}),
    isActive: boolean('is_active').notNull().default(true),
    fireCount: integer('fire_count').notNull().default(0),
    maxFireCount: integer('max_fire_count'),
    lastFiredAt: timestamp('last_fired_at', { withTimezone: true }),
    cooldownMs: integer('cooldown_ms').notNull().default(10000),
    createdByAgentId: uuid('created_by_agent_id').references(() => agents.id, {
      onDelete: 'set null',
    }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('idx_triggers_company_active').on(t.companyId, t.isActive),
    check(
      'triggers_pattern_type_check',
      sql`${t.patternType} IN ('event_match', 'budget_threshold', 'schedule_missed', 'quality_failure', 'agent_idle')`,
    ),
    check(
      'triggers_action_type_check',
      sql`${t.actionType} IN ('wake_agent', 'create_issue', 'run_workflow')`,
    ),
    check('triggers_fire_count_check', sql`${t.fireCount} >= 0`),
    check('triggers_cooldown_check', sql`${t.cooldownMs} >= 0`),
  ],
);

export const workflows = pgTable(
  'workflows',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    description: text('description'),
    definition: jsonb('definition').notNull(),
    isActive: boolean('is_active').notNull().default(true),
    createdByAgentId: uuid('created_by_agent_id').references(() => agents.id, {
      onDelete: 'set null',
    }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('idx_workflows_company_active').on(t.companyId, t.isActive)],
);

export const workflowRuns = pgTable(
  'workflow_runs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id, { onDelete: 'cascade' }),
    workflowId: uuid('workflow_id')
      .notNull()
      .references(() => workflows.id, { onDelete: 'cascade' }),
    status: text('status').notNull().default('running'),
    inputVars: jsonb('input_vars').notNull().default({}),
    outputVars: jsonb('output_vars').notNull().default({}),
    currentStepIndex: integer('current_step_index').notNull().default(0),
    totalSteps: integer('total_steps').notNull().default(0),
    startedAt: timestamp('started_at', { withTimezone: true }),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('idx_workflow_runs_workflow_status').on(t.workflowId, t.status),
    index('idx_workflow_runs_company_status').on(t.companyId, t.status),
    check(
      'workflow_runs_status_check',
      sql`${t.status} IN ('running', 'completed', 'failed', 'cancelled')`,
    ),
  ],
);

export const workflowStepRuns = pgTable(
  'workflow_step_runs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workflowRunId: uuid('workflow_run_id')
      .notNull()
      .references(() => workflowRuns.id, { onDelete: 'cascade' }),
    stepName: text('step_name').notNull(),
    stepIndex: integer('step_index').notNull(),
    mode: text('mode').notNull(),
    status: text('status').notNull().default('pending'),
    agentId: uuid('agent_id').references(() => agents.id, { onDelete: 'set null' }),
    heartbeatRunId: uuid('heartbeat_run_id').references(() => heartbeatRuns.id, {
      onDelete: 'set null',
    }),
    inputVars: jsonb('input_vars').notNull().default({}),
    outputVars: jsonb('output_vars').notNull().default({}),
    errorMessage: text('error_message'),
    retryCount: integer('retry_count').notNull().default(0),
    startedAt: timestamp('started_at', { withTimezone: true }),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('idx_workflow_step_runs_run_index').on(t.workflowRunId, t.stepIndex),
    check(
      'workflow_step_runs_status_check',
      sql`${t.status} IN ('pending', 'running', 'completed', 'failed', 'skipped')`,
    ),
    check(
      'workflow_step_runs_mode_check',
      sql`${t.mode} IN ('sequential', 'fan_out', 'conditional')`,
    ),
  ],
);
