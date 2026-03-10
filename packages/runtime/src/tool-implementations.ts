import type { Database } from '@clawgear/db';
import { facts, issueComments, issues, lessonsLearned } from '@clawgear/db/pg';
import type { EventBus, SystemEvent, ToolDefinition } from '@clawgear/shared/interfaces';
import { and, eq, sql } from 'drizzle-orm';

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
      description: 'Create a sub-issue under an existing issue',
      parameters: {
        parentIssueId: { type: 'string' },
        title: { type: 'string' },
        description: { type: 'string' },
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

    default:
      throw new Error(`Unknown tool: ${toolName}`);
  }
}

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
) {
  // Get parent issue for context
  const [parent] = await ctx.db.select().from(issues).where(eq(issues.id, parentIssueId));

  if (!parent) throw new Error(`Parent issue ${parentIssueId} not found`);

  // Use a placeholder issue number (will be properly incremented in production)
  const [subIssue] = await ctx.db
    .insert(issues)
    .values({
      companyId: ctx.companyId,
      parentId: parentIssueId,
      projectId: parent.projectId,
      goalId: parent.goalId,
      issueNumber: 0, // Needs proper counter increment
      identifier: `SUB-${Date.now()}`,
      title,
      description,
      priority: parent.priority,
      assigneeAgentId: ctx.agentId,
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
