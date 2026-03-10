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

export function fetchQualityEvaluations(companyId: string): Promise<PaginatedResponse<QualityEvaluation>> {
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
