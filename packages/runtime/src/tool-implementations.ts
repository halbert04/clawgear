import type { Database } from '@clawgear/db';
import {
  agentCompetence,
  agents,
  approvals,
  companies,
  facts,
  goals,
  issueComments,
  issues,
  lessonsLearned,
  projects,
} from '@clawgear/db/pg';
import type { EventBus, SystemEvent, ToolDefinition } from '@clawgear/shared/interfaces';
import { and, desc, eq, sql } from 'drizzle-orm';

export interface ToolContext {
  db: Database;
  eventBus: EventBus;
  agentId: string;
  companyId: string;
}

export function getKernelToolDefinitions(): ToolDefinition[] {
  return [
    {
      name: 'checkout_issue',
      description: 'Checkout an issue for execution (atomic lock)',
      parameters: { issueId: { type: 'string', description: 'Issue ID to checkout' } },
    },
    {
      name: 'update_issue_status',
      description: 'Update an issue status',
      parameters: {
        issueId: { type: 'string' },
        status: { type: 'string', enum: ['in_progress', 'in_review', 'done'] },
      },
    },
    {
      name: 'add_comment',
      description: 'Add a comment to an issue',
      parameters: { issueId: { type: 'string' }, body: { type: 'string' } },
    },
    {
      name: 'create_sub_issue',
      description:
        'Create a sub-issue under an existing issue. Optionally assign to a specific agent.',
      parameters: {
        parentIssueId: { type: 'string' },
        title: { type: 'string' },
        description: { type: 'string' },
        assigneeAgentId: { type: 'string', description: 'Agent ID to assign (defaults to caller)' },
      },
    },
    {
      name: 'memory_store',
      description: 'Store a lesson learned from this task',
      parameters: {
        taskType: { type: 'string' },
        lesson: { type: 'string' },
        approach: { type: 'string' },
      },
    },
    {
      name: 'memory_retrieve',
      description: 'Retrieve relevant lessons from memory',
      parameters: { query: { type: 'string' }, limit: { type: 'number' } },
    },
    {
      name: 'fact_store',
      description: 'Store a fact (subject-predicate-object triple)',
      parameters: {
        factType: { type: 'string', enum: ['decision', 'entity', 'relationship', 'observation'] },
        subject: { type: 'string' },
        predicate: { type: 'string' },
        object: { type: 'string' },
      },
    },
    {
      name: 'fact_query',
      description: 'Query stored facts',
      parameters: {
        subject: { type: 'string' },
        predicate: { type: 'string' },
      },
    },
    {
      name: 'message_agent',
      description: 'Send a message to another agent',
      parameters: {
        toAgentId: { type: 'string' },
        body: { type: 'string' },
      },
    },
    {
      name: 'report_progress',
      description: 'Report progress on current task',
      parameters: {
        status: { type: 'string' },
        percentComplete: { type: 'number' },
        details: { type: 'string' },
      },
    },
    {
      name: 'complete_task',
      description: 'Mark the current task as complete',
      parameters: {
        summary: { type: 'string' },
        artifacts: { type: 'array', items: { type: 'string' } },
      },
    },
    // ============================================================
    // CEO MANAGEMENT TOOLS
    // ============================================================
    {
      name: 'list_agents',
      description: 'List all agents with status, role, and budget usage',
      parameters: {},
    },
    {
      name: 'list_issues',
      description: 'List issues with optional filters',
      parameters: {
        status: {
          type: 'string',
          description: 'Filter by status (backlog, todo, in_progress, in_review, done, cancelled)',
        },
        assigneeAgentId: { type: 'string', description: 'Filter by assignee agent ID' },
        projectId: { type: 'string', description: 'Filter by project ID' },
        limit: { type: 'number', description: 'Max results (default 20)' },
      },
    },
    {
      name: 'get_budget_summary',
      description: 'Get company and per-agent budget state',
      parameters: {},
    },
    {
      name: 'get_company_overview',
      description:
        'Get composite company overview: agents, issues, budget, pending approvals, quality',
      parameters: {},
    },
    {
      name: 'get_goal_tree',
      description: 'Get full goal hierarchy for the company',
      parameters: {},
    },
    {
      name: 'get_quality_summary',
      description: 'Get per-agent quality scores and trends',
      parameters: {},
    },
    {
      name: 'list_pending_approvals',
      description: 'List pending approval requests',
      parameters: {},
    },
    {
      name: 'create_goal',
      description: 'Create a new goal',
      parameters: {
        title: { type: 'string' },
        level: { type: 'string', enum: ['company', 'team', 'agent', 'task'] },
        parentId: { type: 'string', description: 'Parent goal ID (optional)' },
        ownerAgentId: { type: 'string', description: 'Agent ID to own this goal (optional)' },
        description: { type: 'string', description: 'Goal description (optional)' },
      },
    },
    {
      name: 'create_project',
      description: 'Create a new project',
      parameters: {
        name: { type: 'string' },
        goalId: { type: 'string', description: 'Goal ID to associate (optional)' },
        leadAgentId: { type: 'string', description: 'Agent ID to lead (optional)' },
        description: { type: 'string', description: 'Project description (optional)' },
      },
    },
    {
      name: 'create_issue',
      description: 'Create a top-level issue',
      parameters: {
        title: { type: 'string' },
        description: { type: 'string' },
        priority: { type: 'string', enum: ['critical', 'high', 'medium', 'low'] },
        projectId: { type: 'string', description: 'Project ID (optional)' },
        goalId: { type: 'string', description: 'Goal ID (optional)' },
        assigneeAgentId: { type: 'string', description: 'Agent ID to assign (optional)' },
      },
    },
    {
      name: 'assign_issue',
      description: 'Assign an issue to a specific agent',
      parameters: {
        issueId: { type: 'string' },
        agentId: { type: 'string' },
      },
    },
    {
      name: 'pause_agent',
      description: 'Pause a specific agent (prevents scheduled heartbeats)',
      parameters: {
        agentId: { type: 'string' },
        reason: { type: 'string', description: 'Why this agent is being paused' },
      },
    },
    {
      name: 'resume_agent',
      description: 'Resume a paused agent',
      parameters: {
        agentId: { type: 'string' },
      },
    },
    {
      name: 'approve_request',
      description: 'Approve a pending approval request',
      parameters: {
        approvalId: { type: 'string' },
        note: { type: 'string', description: 'Decision note (optional)' },
      },
    },
    {
      name: 'reject_request',
      description: 'Reject a pending approval request',
      parameters: {
        approvalId: { type: 'string' },
        note: { type: 'string', description: 'Rejection reason' },
      },
    },
  ];
}

export async function executeKernelTool(
  toolName: string,
  args: Record<string, unknown>,
  ctx: ToolContext,
): Promise<unknown> {
  switch (toolName) {
    case 'checkout_issue':
      return checkoutIssue(ctx, args.issueId as string);

    case 'update_issue_status':
      return updateIssueStatus(ctx, args.issueId as string, args.status as string);

    case 'add_comment':
      return addComment(ctx, args.issueId as string, args.body as string);

    case 'create_sub_issue':
      return createSubIssue(
        ctx,
        args.parentIssueId as string,
        args.title as string,
        (args.description as string) ?? '',
        (args.assigneeAgentId as string) ?? undefined,
      );

    case 'memory_store':
      return memoryStore(
        ctx,
        args.taskType as string,
        args.lesson as string,
        args.approach as string,
      );

    case 'memory_retrieve':
      return memoryRetrieve(ctx, args.query as string, (args.limit as number) ?? 5);

    case 'fact_store':
      return factStore(
        ctx,
        args.factType as string,
        args.subject as string,
        args.predicate as string,
        args.object as string,
      );

    case 'fact_query':
      return factQuery(ctx, args.subject as string, args.predicate as string);

    case 'message_agent':
      return messageAgent(ctx, args.toAgentId as string, args.body as string);

    case 'report_progress':
      return reportProgress(
        ctx,
        args.status as string,
        (args.percentComplete as number) ?? 0,
        (args.details as string) ?? '',
      );

    case 'complete_task':
      return completeTask(ctx, args.summary as string);

    // CEO management tools
    case 'list_agents':
      return listAgents(ctx);
    case 'list_issues':
      return listIssues(ctx, args);
    case 'get_budget_summary':
      return getBudgetSummary(ctx);
    case 'get_company_overview':
      return getCompanyOverview(ctx);
    case 'get_goal_tree':
      return getGoalTree(ctx);
    case 'get_quality_summary':
      return getQualitySummary(ctx);
    case 'list_pending_approvals':
      return listPendingApprovals(ctx);
    case 'create_goal':
      return createGoal(ctx, args);
    case 'create_project':
      return createProject(ctx, args);
    case 'create_issue':
      return createIssue(ctx, args);
    case 'assign_issue':
      return assignIssue(ctx, args.issueId as string, args.agentId as string);
    case 'pause_agent':
      return pauseAgent(ctx, args.agentId as string, (args.reason as string) ?? '');
    case 'resume_agent':
      return resumeAgent(ctx, args.agentId as string);
    case 'approve_request':
      return approveRequest(ctx, args.approvalId as string, (args.note as string) ?? '');
    case 'reject_request':
      return rejectRequest(ctx, args.approvalId as string, (args.note as string) ?? '');

    default:
      throw new Error(`Unknown tool: ${toolName}`);
  }
}

// ============================================================
// EXISTING TOOL IMPLEMENTATIONS
// ============================================================

async function checkoutIssue(ctx: ToolContext, issueId: string) {
  const [checkedOut] = await ctx.db
    .update(issues)
    .set({
      assigneeAgentId: ctx.agentId,
      status: 'in_progress',
      executionLockedAt: new Date(),
      startedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(issues.id, issueId),
        eq(issues.companyId, ctx.companyId),
        sql`(${issues.assigneeAgentId} IS NULL OR ${issues.executionLockedAt} IS NULL)`,
      ),
    )
    .returning();

  if (!checkedOut) throw new Error(`Issue ${issueId} is already checked out or not found`);
  return { issueId: checkedOut.id, status: 'checked_out' };
}

async function updateIssueStatus(ctx: ToolContext, issueId: string, status: string) {
  const [updated] = await ctx.db
    .update(issues)
    .set({ status, updatedAt: new Date() })
    .where(and(eq(issues.id, issueId), eq(issues.companyId, ctx.companyId)))
    .returning();

  if (!updated) throw new Error(`Issue ${issueId} not found`);
  return { issueId: updated.id, status: updated.status };
}

async function addComment(ctx: ToolContext, issueId: string, body: string) {
  const [comment] = await ctx.db
    .insert(issueComments)
    .values({
      companyId: ctx.companyId,
      issueId,
      authorAgentId: ctx.agentId,
      body,
    })
    .returning();

  return { commentId: comment!.id };
}

async function createSubIssue(
  ctx: ToolContext,
  parentIssueId: string,
  title: string,
  description: string,
  assigneeAgentId?: string,
) {
  const [parent] = await ctx.db.select().from(issues).where(eq(issues.id, parentIssueId));

  if (!parent) throw new Error(`Parent issue ${parentIssueId} not found`);

  // Enforce max depth: do not create sub-issues deeper than 3 levels
  if (parent.requestDepth >= 2) {
    throw new Error(`Cannot create sub-issue: max depth reached (depth=${parent.requestDepth})`);
  }

  const [subIssue] = await ctx.db
    .insert(issues)
    .values({
      companyId: ctx.companyId,
      parentId: parentIssueId,
      projectId: parent.projectId,
      goalId: parent.goalId,
      issueNumber: 0,
      identifier: `SUB-${Date.now()}`,
      title,
      description,
      priority: parent.priority,
      assigneeAgentId: assigneeAgentId ?? ctx.agentId,
      requestDepth: parent.requestDepth + 1,
    })
    .returning();

  return { issueId: subIssue!.id, identifier: subIssue!.identifier };
}

async function memoryStore(ctx: ToolContext, taskType: string, lesson: string, approach: string) {
  const [stored] = await ctx.db
    .insert(lessonsLearned)
    .values({
      companyId: ctx.companyId,
      agentId: ctx.agentId,
      taskType,
      approach,
      lesson,
      outcome: 'success',
    })
    .returning({ id: lessonsLearned.id });

  return { lessonId: stored!.id };
}

async function memoryRetrieve(ctx: ToolContext, query: string, limit: number) {
  const results = await ctx.db
    .select()
    .from(lessonsLearned)
    .where(
      and(
        eq(lessonsLearned.companyId, ctx.companyId),
        sql`(
          ${lessonsLearned.lesson} ILIKE ${`%${query}%`}
          OR ${lessonsLearned.approach} ILIKE ${`%${query}%`}
        )`,
      ),
    )
    .limit(limit);

  return results.map((r) => ({
    id: r.id,
    taskType: r.taskType,
    lesson: r.lesson,
    approach: r.approach,
    outcome: r.outcome,
    confidence: r.confidence,
  }));
}

async function factStore(
  ctx: ToolContext,
  factType: string,
  subject: string,
  predicate: string,
  object: string,
) {
  const [stored] = await ctx.db
    .insert(facts)
    .values({
      companyId: ctx.companyId,
      agentId: ctx.agentId,
      factType,
      subject,
      predicate,
      object,
    })
    .returning({ id: facts.id });

  return { factId: stored!.id };
}

async function factQuery(ctx: ToolContext, subject: string, predicate: string) {
  const conditions = [eq(facts.companyId, ctx.companyId)];
  if (subject) conditions.push(eq(facts.subject, subject));
  if (predicate) conditions.push(eq(facts.predicate, predicate));

  const results = await ctx.db
    .select()
    .from(facts)
    .where(and(...conditions))
    .limit(20);

  return results.map((f) => ({
    id: f.id,
    subject: f.subject,
    predicate: f.predicate,
    object: f.object,
    factType: f.factType,
    confidence: f.confidence,
  }));
}

async function messageAgent(ctx: ToolContext, toAgentId: string, body: string) {
  const event: SystemEvent = {
    type: 'agent.message_received',
    companyId: ctx.companyId,
    timestamp: new Date(),
    payload: {
      fromAgentId: ctx.agentId,
      toAgentId,
      body,
    },
  };
  ctx.eventBus.emit(event);
  return { sent: true };
}

async function reportProgress(
  ctx: ToolContext,
  status: string,
  percentComplete: number,
  details: string,
) {
  const event: SystemEvent = {
    type: 'agent.progress',
    companyId: ctx.companyId,
    timestamp: new Date(),
    payload: {
      agentId: ctx.agentId,
      status,
      percentComplete,
      details,
    },
  };
  ctx.eventBus.emit(event);
  return { reported: true };
}

async function completeTask(ctx: ToolContext, summary: string) {
  const event: SystemEvent = {
    type: 'agent.task_completed',
    companyId: ctx.companyId,
    timestamp: new Date(),
    payload: {
      agentId: ctx.agentId,
      summary,
    },
  };
  ctx.eventBus.emit(event);
  return { completed: true };
}

// ============================================================
// CEO MANAGEMENT TOOL IMPLEMENTATIONS
// ============================================================

async function listAgents(ctx: ToolContext) {
  const rows = await ctx.db
    .select({
      id: agents.id,
      name: agents.name,
      role: agents.role,
      status: agents.status,
      budgetMonthlyCents: agents.budgetMonthlyCents,
      spentMonthlyCents: agents.spentMonthlyCents,
    })
    .from(agents)
    .where(eq(agents.companyId, ctx.companyId));

  return rows.map((a) => ({
    id: a.id,
    name: a.name,
    role: a.role,
    status: a.status,
    budgetCents: Number(a.budgetMonthlyCents),
    spentCents: Number(a.spentMonthlyCents),
    budgetPercentUsed:
      a.budgetMonthlyCents > 0n
        ? Math.round((Number(a.spentMonthlyCents) / Number(a.budgetMonthlyCents)) * 100)
        : 0,
  }));
}

async function listIssues(ctx: ToolContext, args: Record<string, unknown>) {
  const conditions = [eq(issues.companyId, ctx.companyId)];
  if (args.status) conditions.push(eq(issues.status, args.status as string));
  if (args.assigneeAgentId)
    conditions.push(eq(issues.assigneeAgentId, args.assigneeAgentId as string));
  if (args.projectId) conditions.push(eq(issues.projectId, args.projectId as string));

  const limit = (args.limit as number) ?? 20;

  const rows = await ctx.db
    .select({
      id: issues.id,
      identifier: issues.identifier,
      title: issues.title,
      status: issues.status,
      priority: issues.priority,
      assigneeAgentId: issues.assigneeAgentId,
      projectId: issues.projectId,
      requestDepth: issues.requestDepth,
      createdAt: issues.createdAt,
    })
    .from(issues)
    .where(and(...conditions))
    .orderBy(desc(issues.createdAt))
    .limit(limit);

  return rows;
}

async function getBudgetSummary(ctx: ToolContext) {
  const [company] = await ctx.db
    .select({
      budgetMonthlyCents: companies.budgetMonthlyCents,
      spentMonthlyCents: companies.spentMonthlyCents,
    })
    .from(companies)
    .where(eq(companies.id, ctx.companyId));

  const agentBudgets = await ctx.db
    .select({
      id: agents.id,
      name: agents.name,
      budgetMonthlyCents: agents.budgetMonthlyCents,
      spentMonthlyCents: agents.spentMonthlyCents,
    })
    .from(agents)
    .where(eq(agents.companyId, ctx.companyId));

  return {
    company: company
      ? {
          budgetCents: Number(company.budgetMonthlyCents),
          spentCents: Number(company.spentMonthlyCents),
          remainingCents: Number(company.budgetMonthlyCents - company.spentMonthlyCents),
          percentUsed:
            company.budgetMonthlyCents > 0n
              ? Math.round(
                  (Number(company.spentMonthlyCents) / Number(company.budgetMonthlyCents)) * 100,
                )
              : 0,
        }
      : null,
    agents: agentBudgets.map((a) => ({
      id: a.id,
      name: a.name,
      budgetCents: Number(a.budgetMonthlyCents),
      spentCents: Number(a.spentMonthlyCents),
    })),
  };
}

async function getCompanyOverview(ctx: ToolContext) {
  const [company] = await ctx.db.select().from(companies).where(eq(companies.id, ctx.companyId));

  const agentRows = await ctx.db
    .select({ id: agents.id, name: agents.name, role: agents.role, status: agents.status })
    .from(agents)
    .where(eq(agents.companyId, ctx.companyId));

  const issueCounts = await ctx.db
    .select({
      status: issues.status,
      count: sql<number>`count(*)::int`,
    })
    .from(issues)
    .where(eq(issues.companyId, ctx.companyId))
    .groupBy(issues.status);

  const pendingApprovalCount = await ctx.db
    .select({ count: sql<number>`count(*)::int` })
    .from(approvals)
    .where(and(eq(approvals.companyId, ctx.companyId), eq(approvals.status, 'pending')));

  return {
    company: company ? { name: company.name, status: company.status } : null,
    budget: company
      ? {
          budgetCents: Number(company.budgetMonthlyCents),
          spentCents: Number(company.spentMonthlyCents),
          percentUsed:
            company.budgetMonthlyCents > 0n
              ? Math.round(
                  (Number(company.spentMonthlyCents) / Number(company.budgetMonthlyCents)) * 100,
                )
              : 0,
        }
      : null,
    agents: {
      total: agentRows.length,
      byStatus: Object.fromEntries(
        ['idle', 'running', 'paused', 'error'].map((s) => [
          s,
          agentRows.filter((a) => a.status === s).length,
        ]),
      ),
      list: agentRows.map((a) => ({ id: a.id, name: a.name, role: a.role, status: a.status })),
    },
    issues: Object.fromEntries(issueCounts.map((r) => [r.status, r.count])),
    pendingApprovals: pendingApprovalCount[0]?.count ?? 0,
  };
}

async function getGoalTree(ctx: ToolContext) {
  const allGoals = await ctx.db
    .select({
      id: goals.id,
      parentId: goals.parentId,
      level: goals.level,
      status: goals.status,
      ownerAgentId: goals.ownerAgentId,
      title: goals.title,
    })
    .from(goals)
    .where(eq(goals.companyId, ctx.companyId));

  return allGoals;
}

async function getQualitySummary(ctx: ToolContext) {
  const rows = await ctx.db
    .select({
      agentId: agentCompetence.agentId,
      agentName: agents.name,
      taskType: agentCompetence.taskType,
      totalRuns: agentCompetence.totalRuns,
      successfulRuns: agentCompetence.successfulRuns,
      avgQualityScore: agentCompetence.avgQualityScore,
      qualityTrend: agentCompetence.qualityTrend,
      autonomyLevel: agentCompetence.autonomyLevel,
    })
    .from(agentCompetence)
    .innerJoin(agents, eq(agents.id, agentCompetence.agentId))
    .where(eq(agentCompetence.companyId, ctx.companyId));

  return rows.map((r) => ({
    ...r,
    successRate: r.totalRuns > 0 ? Math.round((r.successfulRuns / r.totalRuns) * 100) : 0,
  }));
}

async function listPendingApprovals(ctx: ToolContext) {
  return ctx.db
    .select({
      id: approvals.id,
      type: approvals.type,
      requestedByAgentId: approvals.requestedByAgentId,
      payload: approvals.payload,
      createdAt: approvals.createdAt,
    })
    .from(approvals)
    .where(and(eq(approvals.companyId, ctx.companyId), eq(approvals.status, 'pending')))
    .orderBy(desc(approvals.createdAt))
    .limit(20);
}

async function createGoal(ctx: ToolContext, args: Record<string, unknown>) {
  const [goal] = await ctx.db
    .insert(goals)
    .values({
      companyId: ctx.companyId,
      title: args.title as string,
      level: (args.level as string) ?? 'task',
      parentId: (args.parentId as string) ?? null,
      ownerAgentId: (args.ownerAgentId as string) ?? null,
      description: (args.description as string) ?? null,
    })
    .returning({ id: goals.id, title: goals.title });

  return { goalId: goal!.id, title: goal!.title };
}

async function createProject(ctx: ToolContext, args: Record<string, unknown>) {
  const [project] = await ctx.db
    .insert(projects)
    .values({
      companyId: ctx.companyId,
      name: args.name as string,
      goalId: (args.goalId as string) ?? null,
      leadAgentId: (args.leadAgentId as string) ?? null,
      description: (args.description as string) ?? null,
    })
    .returning({ id: projects.id, name: projects.name });

  return { projectId: project!.id, name: project!.name };
}

async function createIssue(ctx: ToolContext, args: Record<string, unknown>) {
  const [issue] = await ctx.db
    .insert(issues)
    .values({
      companyId: ctx.companyId,
      title: args.title as string,
      description: (args.description as string) ?? '',
      priority: (args.priority as string) ?? 'medium',
      projectId: (args.projectId as string) ?? null,
      goalId: (args.goalId as string) ?? null,
      assigneeAgentId: (args.assigneeAgentId as string) ?? null,
      issueNumber: 0,
      identifier: `ISS-${Date.now()}`,
      requestDepth: 0,
    })
    .returning({ id: issues.id, identifier: issues.identifier, title: issues.title });

  return { issueId: issue!.id, identifier: issue!.identifier, title: issue!.title };
}

async function assignIssue(ctx: ToolContext, issueId: string, agentId: string) {
  // Prevent assigning to self (CEO should not execute its own tasks)
  if (agentId === ctx.agentId) {
    throw new Error('Cannot assign issue to yourself');
  }

  const [updated] = await ctx.db
    .update(issues)
    .set({ assigneeAgentId: agentId, updatedAt: new Date() })
    .where(and(eq(issues.id, issueId), eq(issues.companyId, ctx.companyId)))
    .returning({ id: issues.id, assigneeAgentId: issues.assigneeAgentId });

  if (!updated) throw new Error(`Issue ${issueId} not found`);
  return { issueId: updated.id, assignedTo: updated.assigneeAgentId };
}

async function pauseAgent(ctx: ToolContext, agentId: string, reason: string) {
  // Cannot pause yourself
  if (agentId === ctx.agentId) {
    throw new Error('Cannot pause yourself');
  }

  const [updated] = await ctx.db
    .update(agents)
    .set({ status: 'paused', updatedAt: new Date() })
    .where(and(eq(agents.id, agentId), eq(agents.companyId, ctx.companyId)))
    .returning({ id: agents.id, name: agents.name });

  if (!updated) throw new Error(`Agent ${agentId} not found`);

  ctx.eventBus.emit({
    type: 'agent.paused',
    companyId: ctx.companyId,
    timestamp: new Date(),
    payload: { agentId, pausedBy: ctx.agentId, reason },
  });

  return { agentId: updated.id, name: updated.name, status: 'paused' };
}

async function resumeAgent(ctx: ToolContext, agentId: string) {
  const [updated] = await ctx.db
    .update(agents)
    .set({ status: 'idle', updatedAt: new Date() })
    .where(
      and(eq(agents.id, agentId), eq(agents.companyId, ctx.companyId), eq(agents.status, 'paused')),
    )
    .returning({ id: agents.id, name: agents.name });

  if (!updated) throw new Error(`Agent ${agentId} not found or not paused`);

  ctx.eventBus.emit({
    type: 'agent.resumed',
    companyId: ctx.companyId,
    timestamp: new Date(),
    payload: { agentId, resumedBy: ctx.agentId },
  });

  return { agentId: updated.id, name: updated.name, status: 'idle' };
}

async function approveRequest(ctx: ToolContext, approvalId: string, note: string) {
  const [updated] = await ctx.db
    .update(approvals)
    .set({
      status: 'approved',
      decidedByAgentId: ctx.agentId,
      decisionNote: note || null,
      decidedAt: new Date(),
    })
    .where(
      and(
        eq(approvals.id, approvalId),
        eq(approvals.companyId, ctx.companyId),
        eq(approvals.status, 'pending'),
      ),
    )
    .returning({ id: approvals.id, type: approvals.type });

  if (!updated) throw new Error(`Approval ${approvalId} not found or not pending`);

  ctx.eventBus.emit({
    type: 'approval.decided',
    companyId: ctx.companyId,
    timestamp: new Date(),
    payload: { approvalId, decision: 'approved', decidedBy: ctx.agentId },
  });

  return { approvalId: updated.id, type: updated.type, decision: 'approved' };
}

async function rejectRequest(ctx: ToolContext, approvalId: string, note: string) {
  const [updated] = await ctx.db
    .update(approvals)
    .set({
      status: 'rejected',
      decidedByAgentId: ctx.agentId,
      decisionNote: note || null,
      decidedAt: new Date(),
    })
    .where(
      and(
        eq(approvals.id, approvalId),
        eq(approvals.companyId, ctx.companyId),
        eq(approvals.status, 'pending'),
      ),
    )
    .returning({ id: approvals.id, type: approvals.type });

  if (!updated) throw new Error(`Approval ${approvalId} not found or not pending`);

  ctx.eventBus.emit({
    type: 'approval.decided',
    companyId: ctx.companyId,
    timestamp: new Date(),
    payload: { approvalId, decision: 'rejected', decidedBy: ctx.agentId },
  });

  return { approvalId: updated.id, type: updated.type, decision: 'rejected' };
}
