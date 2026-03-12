import { randomUUID } from 'node:crypto';
import type { MigrationContext, PaperclipData } from '../types.js';

const VALID_ROLES = [
  'ceo',
  'cto',
  'engineer',
  'analyst',
  'researcher',
  'writer',
  'designer',
  'marketer',
  'support',
];
const VALID_ISSUE_STATUSES = ['backlog', 'todo', 'in_progress', 'in_review', 'done', 'cancelled'];
const VALID_PRIORITIES = ['critical', 'high', 'medium', 'low'];
const VALID_GOAL_LEVELS = ['company', 'team', 'agent', 'task'];

function mapRole(role: string): string {
  const normalized = role.toLowerCase().trim();
  if (VALID_ROLES.includes(normalized)) return normalized;
  // Common mappings
  const roleMap: Record<string, string> = {
    manager: 'cto',
    developer: 'engineer',
    dev: 'engineer',
    qa: 'analyst',
    tester: 'analyst',
    pm: 'analyst',
    content: 'writer',
    ux: 'designer',
    ui: 'designer',
    sales: 'marketer',
    customer_support: 'support',
    cs: 'support',
  };
  return roleMap[normalized] ?? 'engineer';
}

function mapIssueStatus(status: string): string {
  const normalized = status.toLowerCase().trim();
  if (VALID_ISSUE_STATUSES.includes(normalized)) return normalized;
  const statusMap: Record<string, string> = {
    open: 'todo',
    pending: 'todo',
    active: 'in_progress',
    working: 'in_progress',
    review: 'in_review',
    closed: 'done',
    resolved: 'done',
    wontfix: 'cancelled',
    rejected: 'cancelled',
  };
  return statusMap[normalized] ?? 'backlog';
}

function mapPriority(priority: string): string {
  const normalized = priority.toLowerCase().trim();
  if (VALID_PRIORITIES.includes(normalized)) return normalized;
  const priorityMap: Record<string, string> = {
    urgent: 'critical',
    p0: 'critical',
    p1: 'high',
    p2: 'medium',
    p3: 'low',
    normal: 'medium',
    minor: 'low',
    blocker: 'critical',
  };
  return priorityMap[normalized] ?? 'medium';
}

export function parsePaperclipData(raw: unknown): PaperclipData {
  const data = raw as Record<string, unknown>;
  return {
    companies: Array.isArray(data.companies) ? data.companies : [],
    agents: Array.isArray(data.agents) ? data.agents : [],
    goals: Array.isArray(data.goals) ? data.goals : [],
    projects: Array.isArray(data.projects) ? data.projects : [],
    issues: Array.isArray(data.issues) ? data.issues : [],
  };
}

export function transformPaperclip(data: PaperclipData, ctx: MigrationContext) {
  const result: {
    companies: Record<string, unknown>[];
    agents: Record<string, unknown>[];
    goals: Record<string, unknown>[];
    projects: Record<string, unknown>[];
    issues: Record<string, unknown>[];
  } = { companies: [], agents: [], goals: [], projects: [], issues: [] };

  let issueCounter = 0;

  // Transform companies
  for (const company of data.companies) {
    if (!company.name) {
      ctx.errors.push({
        entityType: 'company',
        entityId: company.id ?? 'unknown',
        message: 'Missing company name',
        severity: 'error',
      });
      continue;
    }
    const newId = randomUUID();
    ctx.idMaps.companies.set(company.id, newId);
    result.companies.push({
      id: newId,
      name: company.name,
      description: company.description ?? null,
      issuePrefix: company.issuePrefix ?? company.name.substring(0, 3).toUpperCase(),
      issueCounter: 0,
      status: 'active',
    });
    ctx.counts.companies = (ctx.counts.companies ?? 0) + 1;
  }

  // Transform agents
  for (const agent of data.agents) {
    if (!agent.name) {
      ctx.errors.push({
        entityType: 'agent',
        entityId: agent.id ?? 'unknown',
        message: 'Missing agent name',
        severity: 'error',
      });
      continue;
    }
    const mappedCompanyId = ctx.idMaps.companies.get(agent.companyId) ?? ctx.companyId;
    const newId = randomUUID();
    ctx.idMaps.agents.set(agent.id, newId);
    result.agents.push({
      id: newId,
      companyId: mappedCompanyId,
      name: agent.name,
      role: mapRole(agent.role ?? 'engineer'),
      title: agent.title ?? null,
      status: 'idle',
      adapterType: 'claude_code',
      adapterConfig: {},
      modelTier: 'smart',
      systemPrompt: agent.systemPrompt ?? null,
      budgetMonthlyCents: 0n,
      spentMonthlyCents: 0n,
    });
    ctx.counts.agents = (ctx.counts.agents ?? 0) + 1;
  }

  // Transform goals
  for (const goal of data.goals) {
    if (!goal.title) {
      ctx.warnings.push({
        entityType: 'goal',
        entityId: goal.id ?? 'unknown',
        message: 'Missing goal title, skipping',
        severity: 'warning',
      });
      continue;
    }
    const mappedCompanyId = ctx.idMaps.companies.get(goal.companyId) ?? ctx.companyId;
    const newId = randomUUID();
    ctx.idMaps.goals.set(goal.id, newId);
    result.goals.push({
      id: newId,
      companyId: mappedCompanyId,
      parentId: goal.parentId ? (ctx.idMaps.goals.get(goal.parentId) ?? null) : null,
      level: VALID_GOAL_LEVELS.includes(goal.level ?? '') ? goal.level : 'task',
      status: 'active',
      ownerAgentId: null,
      title: goal.title,
      description: goal.description ?? null,
    });
    ctx.counts.goals = (ctx.counts.goals ?? 0) + 1;
  }

  // Transform projects
  for (const project of data.projects) {
    if (!project.name) {
      ctx.warnings.push({
        entityType: 'project',
        entityId: project.id ?? 'unknown',
        message: 'Missing project name, skipping',
        severity: 'warning',
      });
      continue;
    }
    const mappedCompanyId = ctx.idMaps.companies.get(project.companyId) ?? ctx.companyId;
    const newId = randomUUID();
    ctx.idMaps.projects.set(project.id, newId);
    result.projects.push({
      id: newId,
      companyId: mappedCompanyId,
      goalId: project.goalId ? (ctx.idMaps.goals.get(project.goalId) ?? null) : null,
      leadAgentId: null,
      name: project.name,
      status: 'active',
    });
    ctx.counts.projects = (ctx.counts.projects ?? 0) + 1;
  }

  // Transform issues
  for (const issue of data.issues) {
    if (!issue.title) {
      ctx.errors.push({
        entityType: 'issue',
        entityId: issue.id ?? 'unknown',
        message: 'Missing issue title',
        severity: 'error',
      });
      continue;
    }
    const mappedCompanyId = ctx.idMaps.companies.get(issue.companyId) ?? ctx.companyId;
    const newId = randomUUID();
    ctx.idMaps.issues.set(issue.id, newId);
    issueCounter++;
    result.issues.push({
      id: newId,
      companyId: mappedCompanyId,
      projectId: issue.projectId ? (ctx.idMaps.projects.get(issue.projectId) ?? null) : null,
      goalId: issue.goalId ? (ctx.idMaps.goals.get(issue.goalId) ?? null) : null,
      parentId: issue.parentId ? (ctx.idMaps.issues.get(issue.parentId) ?? null) : null,
      issueNumber: issueCounter,
      title: issue.title,
      description: issue.description ?? null,
      status: mapIssueStatus(issue.status ?? 'backlog'),
      priority: mapPriority(issue.priority ?? 'medium'),
      assigneeAgentId: issue.assigneeId ? (ctx.idMaps.agents.get(issue.assigneeId) ?? null) : null,
    });
    ctx.counts.issues = (ctx.counts.issues ?? 0) + 1;
  }

  return result;
}
