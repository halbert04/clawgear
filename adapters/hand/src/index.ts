import type { Database } from '@clawgear/db';
import { approvals, facts, issueComments, issues } from '@clawgear/db/pg';
import type { AdapterRegistry } from '@clawgear/runtime';
import type {
  Adapter,
  AdapterContext,
  AdapterResult,
  EnvironmentTestResult,
  EventBus,
  SystemEvent,
} from '@clawgear/shared/interfaces';
import type { HandConfig } from '@clawgear/shared/types';
import { and, eq, sql } from 'drizzle-orm';

export interface HandAdapterConfig {
  adapterRegistry: AdapterRegistry;
  db: Database;
  eventBus: EventBus;
}

export class HandAdapter implements Adapter {
  readonly name = 'hand';
  private adapterRegistry: AdapterRegistry;
  private db: Database;
  private eventBus: EventBus;

  constructor(config: HandAdapterConfig) {
    this.adapterRegistry = config.adapterRegistry;
    this.db = config.db;
    this.eventBus = config.eventBus;
  }

  async execute(ctx: AdapterContext): Promise<AdapterResult> {
    const handConfig = (ctx.adapterConfig?.handConfig ?? ctx.adapterConfig) as HandConfig;

    if (!handConfig?.innerAdapter) {
      throw new Error('HandAdapter: missing handConfig in adapterConfig');
    }

    // If requires approval, create approval request and return early
    if (handConfig.requiresApproval) {
      await this.db.insert(approvals).values({
        companyId: ctx.companyId,
        type: 'hand_action',
        status: 'pending',
        requestedByAgentId: ctx.agentId,
        payload: {
          handName: handConfig.name,
          taskPrompt: handConfig.taskPrompt,
          outputMode: handConfig.outputMode,
        },
      });

      this.eventBus.emit({
        type: 'approval.requested',
        companyId: ctx.companyId,
        timestamp: new Date(),
        payload: {
          approvalType: 'hand_action',
          requestedByAgentId: ctx.agentId,
          handName: handConfig.name,
        },
      } as SystemEvent);

      return {
        output: `Hand "${handConfig.name}" requires approval before execution. Approval request created.`,
        toolCalls: [],
        usage: {
          inputTokens: 0,
          outputTokens: 0,
          costCents: 0,
          provider: 'hand',
          model: 'hand',
        },
        sessionId: null,
      };
    }

    // Use the outer system prompt if provided (e.g., CEO OODA prompt from HeartbeatEngine),
    // otherwise compose from hand description + settings
    let systemPrompt: string;
    if (ctx.systemPrompt) {
      systemPrompt = ctx.systemPrompt;
    } else {
      const systemPromptParts = [`You are the "${handConfig.name}" hand.`, handConfig.description];

      if (Object.keys(handConfig.settings).length > 0) {
        systemPromptParts.push(`## Settings\n${JSON.stringify(handConfig.settings, null, 2)}`);
      }

      if (ctx.adapterConfig?.systemPromptOverride) {
        systemPromptParts.push(ctx.adapterConfig.systemPromptOverride as string);
      }

      systemPrompt = systemPromptParts.join('\n\n');
    }

    // Resolve inner adapter
    const innerAdapter = this.adapterRegistry.get(handConfig.innerAdapter);

    // Build inner context
    const innerCtx: AdapterContext = {
      agentId: ctx.agentId,
      companyId: ctx.companyId,
      systemPrompt,
      taskPrompt: handConfig.taskPrompt,
      tools: ctx.tools,
      sessionId: ctx.sessionId,
      timeout: ctx.timeout,
      adapterConfig: {
        ...handConfig.innerAdapterConfig,
        // Pass through toolExecutor from outer context so inner adapter can call tools
        toolExecutor: ctx.adapterConfig?.toolExecutor,
      },
    };

    // Execute inner adapter
    const result = await innerAdapter.execute(innerCtx);

    // Post-process output based on outputMode
    await this.processOutput(ctx, handConfig, result);

    return result;
  }

  private async processOutput(
    ctx: AdapterContext,
    handConfig: HandConfig,
    result: AdapterResult,
  ): Promise<void> {
    switch (handConfig.outputMode) {
      case 'comment':
        await this.postAsComment(ctx, handConfig, result);
        break;
      case 'issue':
        await this.createIssue(ctx, handConfig, result);
        break;
      case 'fact':
        await this.storeFacts(ctx, result);
        break;
      case 'silent':
        // Result recorded only in heartbeat_run
        break;
    }
  }

  private async postAsComment(
    ctx: AdapterContext,
    handConfig: HandConfig,
    result: AdapterResult,
  ): Promise<void> {
    // Find the most recent open issue assigned to this agent
    const openIssues = await this.db
      .select({ id: issues.id })
      .from(issues)
      .where(
        and(
          eq(issues.companyId, ctx.companyId),
          eq(issues.assigneeAgentId, ctx.agentId),
          sql`${issues.status} IN ('todo', 'in_progress')`,
        ),
      )
      .limit(1);

    if (openIssues.length > 0) {
      await this.db.insert(issueComments).values({
        companyId: ctx.companyId,
        issueId: openIssues[0]!.id,
        authorAgentId: ctx.agentId,
        body: `## ${handConfig.name} Output\n\n${result.output}`,
      });
    }
  }

  private async createIssue(
    ctx: AdapterContext,
    handConfig: HandConfig,
    result: AdapterResult,
  ): Promise<void> {
    const title = `[${handConfig.name}] ${result.output.slice(0, 100)}`;
    await this.db.insert(issues).values({
      companyId: ctx.companyId,
      title,
      description: result.output,
      issueNumber: 0, // Will be properly numbered by the issue creation logic
      identifier: `HAND-${Date.now()}`,
      priority: 'medium',
      status: 'backlog',
      assigneeAgentId: handConfig.ownerAgentId,
    });
  }

  private async storeFacts(ctx: AdapterContext, result: AdapterResult): Promise<void> {
    // Parse output for SPO triples: look for lines like "FACT: subject | predicate | object"
    const lines = result.output.split('\n');
    for (const line of lines) {
      const match = line.match(/^FACT:\s*(.+?)\s*\|\s*(.+?)\s*\|\s*(.+)$/i);
      if (match) {
        await this.db.insert(facts).values({
          companyId: ctx.companyId,
          agentId: ctx.agentId,
          factType: 'observation',
          subject: match[1]!.trim(),
          predicate: match[2]!.trim(),
          object: match[3]!.trim(),
          confidence: 0.7,
        });
      }
    }
  }

  async testEnvironment(): Promise<EnvironmentTestResult> {
    return {
      ok: true,
      adapter: this.name,
      checks: [
        {
          name: 'hand-adapter-loaded',
          passed: true,
          message: 'HandAdapter loaded successfully',
        },
      ],
    };
  }
}
