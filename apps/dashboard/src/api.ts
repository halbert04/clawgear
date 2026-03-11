// ============================================================
// API Client for ClawGear Hono API
// ============================================================

const BASE = '/api';

interface PaginatedResponse<T> {
  data: T[];
  total: number;
  limit: number;
  offset: number;
}

// --- Types matching serialized API responses ---

export interface Company {
  id: string;
  name: string;
  description: string | null;
  status: string;
  issuePrefix: string;
  issueCounter: number;
  budgetMonthlyCents: number;
  spentMonthlyCents: number;
  requireBoardApproval: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface Agent {
  id: string;
  companyId: string;
  name: string;
  title: string | null;
  role: string;
  icon: string | null;
  status: string;
  reportsTo: string | null;
  capabilities: string[];
  permissions: Record<string, unknown>;
  adapterType: string;
  modelTier: string;
  budgetMonthlyCents: number;
  spentMonthlyCents: number;
  createdAt: string;
  updatedAt: string;
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
  status: string;
  priority: string;
  assigneeAgentId: string | null;
  executionLockedAt: string | null;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Approval {
  id: string;
  companyId: string;
  type: string;
  status: string;
  requestedByAgentId: string | null;
  payload: Record<string, unknown>;
  decidedByUserId: string | null;
  decidedByAgentId: string | null;
  decisionNote: string | null;
  decidedAt: string | null;
  createdAt: string;
}

export interface BudgetSummary {
  companyId: string;
  budgetMonthlyCents: number;
  spentMonthlyCents: number;
  totalCostCents: number;
}

export interface QualityEvaluation {
  id: string;
  companyId: string;
  issueId: string | null;
  agentId: string;
  rubricId: string | null;
  evaluatorType: string;
  scores: Array<{ criterion: string; score: number; feedback?: string | null }>;
  overallScore: number;
  passed: boolean;
  feedback: string | null;
  revisionNumber: number;
  createdAt: string;
}

export interface ActivityEntry {
  id: string;
  companyId: string;
  actorType: string;
  actorId: string;
  action: string;
  entityType: string;
  entityId: string | null;
  agentId: string | null;
  details: Record<string, unknown> | null;
  createdAt: string;
}

// --- Fetch helpers ---

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`);
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`GET ${path} failed (${res.status}): ${body}`);
  }
  return res.json() as Promise<T>;
}

async function post<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`POST ${path} failed (${res.status}): ${text}`);
  }
  return res.json() as Promise<T>;
}

async function patch<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`PATCH ${path} failed (${res.status}): ${text}`);
  }
  return res.json() as Promise<T>;
}

// --- API functions ---

export function fetchCompanies(): Promise<PaginatedResponse<Company>> {
  return get('/companies?limit=100');
}

export function fetchAgents(companyId: string): Promise<PaginatedResponse<Agent>> {
  return get(`/companies/${companyId}/agents?limit=100`);
}

export function fetchIssues(companyId: string): Promise<PaginatedResponse<Issue>> {
  return get(`/companies/${companyId}/issues?limit=200`);
}

export function fetchApprovals(companyId: string): Promise<PaginatedResponse<Approval>> {
  return get(`/companies/${companyId}/approvals?status=pending&limit=100`);
}

export function fetchBudgetSummary(companyId: string): Promise<BudgetSummary> {
  return get(`/companies/${companyId}/budget/summary`);
}

export function fetchQualityEvaluations(
  companyId: string,
): Promise<PaginatedResponse<QualityEvaluation>> {
  return get(`/companies/${companyId}/quality/evaluations?limit=50`);
}

export function fetchActivity(companyId: string): Promise<PaginatedResponse<ActivityEntry>> {
  return get(`/companies/${companyId}/activity?limit=50`);
}

// --- Agent actions ---

export function pauseAgent(companyId: string, agentId: string): Promise<Agent> {
  return post(`/companies/${companyId}/agents/${agentId}/pause`);
}

export function resumeAgent(companyId: string, agentId: string): Promise<Agent> {
  return post(`/companies/${companyId}/agents/${agentId}/resume`);
}

export function terminateAgent(companyId: string, agentId: string): Promise<Agent> {
  return post(`/companies/${companyId}/agents/${agentId}/terminate`);
}

// --- Hand types and functions ---

export interface Hand {
  id: string;
  companyId: string;
  name: string;
  status: string;
  adapterType: string;
  adapterConfig: Record<string, unknown>;
  spentMonthlyCents: number;
  budgetMonthlyCents: number;
  nextRunAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export function fetchHands(companyId: string): Promise<PaginatedResponse<Hand>> {
  return get(`/companies/${companyId}/hands?limit=100`);
}

export function triggerHand(companyId: string, handId: string): Promise<unknown> {
  return post(`/companies/${companyId}/hands/${handId}/trigger`);
}

export function activateHand(companyId: string, handId: string): Promise<unknown> {
  return post(`/companies/${companyId}/hands/${handId}/activate`);
}

export function deactivateHand(companyId: string, handId: string): Promise<unknown> {
  return post(`/companies/${companyId}/hands/${handId}/deactivate`);
}

// --- Evolution types and functions ---

export interface EvolvedSkill {
  id: string;
  name: string;
  description: string;
  version: number;
  status: string;
  usageCount: number;
  proposedByAgentId: string;
  createdAt: string;
  updatedAt: string;
}

export interface TeamCompetence {
  taskType: string;
  totalAgents: number;
  avgSuccessRate: number | null;
  avgQuality: number | null;
  totalRuns: number;
}

export interface StrategyPattern {
  id: string;
  patternType: string;
  description: string;
  confidence: number;
  successCount: number;
  failureCount: number;
  agentId: string;
}

export function fetchEvolvedSkills(companyId: string): Promise<PaginatedResponse<EvolvedSkill>> {
  return get(`/companies/${companyId}/evolution/skills?limit=100`);
}

export function fetchTeamCompetence(companyId: string): Promise<{ data: TeamCompetence[] }> {
  return get(`/companies/${companyId}/evolution/competence/team`);
}

export function fetchStrategies(companyId: string): Promise<PaginatedResponse<StrategyPattern>> {
  return get(`/companies/${companyId}/evolution/strategies?limit=50`);
}

export function approveSkill(companyId: string, skillId: string): Promise<EvolvedSkill> {
  return patch(`/companies/${companyId}/evolution/skills/${skillId}/status`, {
    status: 'active',
  });
}

export function deprecateSkill(companyId: string, skillId: string): Promise<EvolvedSkill> {
  return patch(`/companies/${companyId}/evolution/skills/${skillId}/status`, {
    status: 'deprecated',
  });
}

// --- Approval actions ---

export function approveApproval(companyId: string, approvalId: string): Promise<Approval> {
  return post(`/companies/${companyId}/approvals/${approvalId}/decide`, {
    status: 'approved',
    decidedByUserId: 'dashboard-user',
  });
}

export function rejectApproval(companyId: string, approvalId: string): Promise<Approval> {
  return post(`/companies/${companyId}/approvals/${approvalId}/decide`, {
    status: 'rejected',
    decidedByUserId: 'dashboard-user',
  });
}

// --- Trigger types and functions ---

export interface Trigger {
  id: string;
  companyId: string;
  name: string;
  description: string | null;
  patternType: string;
  patternConfig: Record<string, unknown>;
  actionType: string;
  actionConfig: Record<string, unknown>;
  isActive: boolean;
  fireCount: number;
  maxFireCount: number | null;
  lastFiredAt: string | null;
  cooldownMs: number;
  createdByAgentId: string | null;
  createdAt: string;
  updatedAt: string;
}

export function fetchTriggers(companyId: string): Promise<PaginatedResponse<Trigger>> {
  return get(`/companies/${companyId}/triggers?limit=100`);
}

export function activateTrigger(companyId: string, triggerId: string): Promise<Trigger> {
  return post(`/companies/${companyId}/triggers/${triggerId}/activate`);
}

export function deactivateTrigger(companyId: string, triggerId: string): Promise<Trigger> {
  return post(`/companies/${companyId}/triggers/${triggerId}/deactivate`);
}

// --- Workflow types and functions ---

export interface WorkflowDefinition {
  steps: Array<Record<string, unknown>>;
}

export interface Workflow {
  id: string;
  companyId: string;
  name: string;
  description: string | null;
  definition: WorkflowDefinition;
  isActive: boolean;
  createdByAgentId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface WorkflowRun {
  id: string;
  companyId: string;
  workflowId: string;
  status: string;
  inputVars: Record<string, unknown>;
  outputVars: Record<string, unknown>;
  currentStepIndex: number;
  totalSteps: number;
  startedAt: string | null;
  finishedAt: string | null;
  createdAt: string;
}

export function fetchWorkflows(companyId: string): Promise<PaginatedResponse<Workflow>> {
  return get(`/companies/${companyId}/workflows?limit=100`);
}

export function executeWorkflow(
  companyId: string,
  workflowId: string,
  inputVars: Record<string, unknown>,
): Promise<WorkflowRun> {
  return post(`/companies/${companyId}/workflows/${workflowId}/execute`, { inputVars });
}

export function fetchWorkflowRuns(
  companyId: string,
  workflowId: string,
): Promise<PaginatedResponse<WorkflowRun>> {
  return get(`/companies/${companyId}/workflows/${workflowId}/runs?limit=50`);
}

export interface WorkflowStepRun {
  id: string;
  stepName: string;
  stepIndex: number;
  mode: string;
  status: string;
  agentId: string | null;
  heartbeatRunId: string | null;
  errorMessage: string | null;
  retryCount: number;
  startedAt: string | null;
  finishedAt: string | null;
  createdAt: string;
}

export interface WorkflowRunDetail extends WorkflowRun {
  steps: WorkflowStepRun[];
}

export function fetchWorkflowRunDetail(
  companyId: string,
  runId: string,
): Promise<WorkflowRunDetail> {
  return get(`/companies/${companyId}/workflow-runs/${runId}`);
}

export function cancelWorkflowRun(companyId: string, runId: string): Promise<{ success: boolean }> {
  return post(`/companies/${companyId}/workflow-runs/${runId}/cancel`);
}
