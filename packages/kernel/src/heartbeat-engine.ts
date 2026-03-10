import type { Database } from '@clawgear/db';
import { agentRuntimeState, agents, costEvents, heartbeatRuns } from '@clawgear/db/pg';
import { type AdapterRegistry, assembleContext } from '@clawgear/runtime';
import type { InvocationSource } from '@clawgear/shared/constants';
import { HEARTBEAT_DEFAULT_TIMEOUT_MS } from '@clawgear/shared/constants';
import type {
  AdapterResult,
  EventBus,
  KernelHandle,
  SystemEvent,
} from '@clawgear/shared/interfaces';
import { and, eq, sql } from 'drizzle-orm';

export interface HeartbeatEngineConfig {
  db: Database;
  eventBus: EventBus;
  adapterRegistry: AdapterRegistry;
  kernelHandle: KernelHandle;
}

export interface HeartbeatResult {
  runId: string;
  status: 'succeeded' | 'failed' | 'timed_out';
  output?: string;
  usage?: AdapterResult['usage'];
  error?: string;
  durationMs: number;
}

export class HeartbeatEngine {
  private db: Database;
  private eventBus: EventBus;
  private adapterRegistry: AdapterRegistry;
  private kernelHandle: KernelHandle;

  constructor(config: HeartbeatEngineConfig) {
    this.db = config.db;
    this.eventBus = config.eventBus;
    this.adapterRegistry = config.adapterRegistry;
    this.kernelHandle = config.kernelHandle;
  }

  async executeHeartbeat(agentId: string, source: InvocationSource): Promise<HeartbeatResult> {
    const startTime = Date.now();

    // 1. Load agent
    const [agent] = await this.db.select().from(agents).where(eq(agents.id, agentId));

    if (!agent) {
      throw new Error(`Agent not found: ${agentId}`);
    }

    // 2. Concurrency guard: check for already-running heartbeats
    const [runningRun] = await this.db
      .select({ id: heartbeatRuns.id })
      .from(heartbeatRuns)
      .where(and(eq(heartbeatRuns.agentId, agentId), eq(heartbeatRuns.status, 'running')));

    if (runningRun) {
      throw new Error(`Agent ${agentId} already has a running heartbeat: ${runningRun.id}`);
    }

    // 3. Budget check
    const budget = await this.kernelHandle.checkBudget(agentId);
    if (budget.isExhausted) {
      throw new Error(
        `Agent ${agentId} budget exhausted: spent ${budget.spentCents} of ${budget.budgetCents} cents`,
      );
    }

    // 4. Insert heartbeat run (queued)
    const [run] = await this.db
      .insert(heartbeatRuns)
      .values({
        companyId: agent.companyId,
        agentId,
        invocationSource: source,
        status: 'queued',
      })
      .returning();

    const runId = run!.id;

    try {
      // 5. Set agent status → running
      await this.db
        .update(agents)
        .set({ status: 'running', updatedAt: new Date() })
        .where(eq(agents.id, agentId));

      // 6. Update run status → running
      await this.db
        .update(heartbeatRuns)
        .set({ status: 'running', startedAt: new Date() })
        .where(eq(heartbeatRuns.id, runId));

      // 7. Resolve adapter
      const adapter = this.adapterRegistry.get(agent.adapterType);

      // 8. Assemble context
      const timeout =
        ((agent.adapterConfig as Record<string, unknown>)?.heartbeatTimeoutMs as number) ??
        HEARTBEAT_DEFAULT_TIMEOUT_MS;

      // Load existing session
      const [runtimeState] = await this.db
        .select()
        .from(agentRuntimeState)
        .where(eq(agentRuntimeState.agentId, agentId));

      const ctx = assembleContext({
        agentId,
        companyId: agent.companyId,
        systemPrompt: agent.systemPrompt,
        taskDescription: null,
        sessionId: runtimeState?.sessionId ?? null,
        timeout,
      });

      // 9. Execute adapter with timeout
      const result = await Promise.race([adapter.execute(ctx), this.createTimeout(timeout)]);

      const durationMs = Date.now() - startTime;

      // 10. Record run success
      await this.db
        .update(heartbeatRuns)
        .set({
          status: 'succeeded',
          usageJson: result.usage as unknown as Record<string, unknown>,
          resultJson: { output: result.output, toolCalls: result.toolCalls },
          finishedAt: new Date(),
        })
        .where(eq(heartbeatRuns.id, runId));

      // 11. Record cost event
      if (result.usage.costCents > 0) {
        await this.kernelHandle.recordCost({
          companyId: agent.companyId,
          agentId,
          issueId: null,
          projectId: null,
          goalId: null,
          provider: result.usage.provider,
          model: result.usage.model,
          inputTokens: result.usage.inputTokens,
          outputTokens: result.usage.outputTokens,
          costCents: result.usage.costCents,
          billingCode: null,
        });
      }

      // Also insert into cost_events table directly
      await this.db.insert(costEvents).values({
        companyId: agent.companyId,
        agentId,
        provider: result.usage.provider,
        model: result.usage.model,
        inputTokens: result.usage.inputTokens,
        outputTokens: result.usage.outputTokens,
        costCents: result.usage.costCents,
      });

      // 12. Upsert agent_runtime_state
      const totalTokens = BigInt(result.usage.inputTokens + result.usage.outputTokens);
      const totalCost = BigInt(result.usage.costCents);

      await this.db
        .insert(agentRuntimeState)
        .values({
          agentId,
          companyId: agent.companyId,
          sessionId: result.sessionId,
          lastRunId: runId,
          lastRunStatus: 'succeeded',
          cumulativeTokens: totalTokens,
          cumulativeCostCents: totalCost,
          updatedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: agentRuntimeState.agentId,
          set: {
            sessionId: result.sessionId,
            lastRunId: runId,
            lastRunStatus: 'succeeded',
            cumulativeTokens: sql`${agentRuntimeState.cumulativeTokens} + ${totalTokens}`,
            cumulativeCostCents: sql`${agentRuntimeState.cumulativeCostCents} + ${totalCost}`,
            updatedAt: new Date(),
          },
        });

      // 13. Set agent → idle
      await this.db
        .update(agents)
        .set({ status: 'idle', updatedAt: new Date() })
        .where(eq(agents.id, agentId));

      // 14. Emit event
      this.emitHeartbeatEvent('heartbeat.completed', agent.companyId, {
        agentId,
        runId,
        source,
        durationMs,
        usage: result.usage,
      });

      return {
        runId,
        status: 'succeeded',
        output: result.output,
        usage: result.usage,
        durationMs,
      };
    } catch (err) {
      const durationMs = Date.now() - startTime;
      const errorMessage = err instanceof Error ? err.message : String(err);
      const isTimeout = errorMessage.includes('timed out');
      const status = isTimeout ? 'timed_out' : 'failed';

      // Record failure
      await this.db
        .update(heartbeatRuns)
        .set({
          status,
          resultJson: { error: errorMessage },
          finishedAt: new Date(),
        })
        .where(eq(heartbeatRuns.id, runId));

      // Set agent → idle
      await this.db
        .update(agents)
        .set({ status: 'idle', updatedAt: new Date() })
        .where(eq(agents.id, agentId));

      // Upsert runtime state on failure
      await this.db
        .insert(agentRuntimeState)
        .values({
          agentId,
          companyId: agent.companyId,
          lastRunId: runId,
          lastRunStatus: status,
          cumulativeTokens: 0n,
          cumulativeCostCents: 0n,
          updatedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: agentRuntimeState.agentId,
          set: {
            lastRunId: runId,
            lastRunStatus: status,
            updatedAt: new Date(),
          },
        });

      // Emit failure event
      this.emitHeartbeatEvent('heartbeat.failed', agent.companyId, {
        agentId,
        runId,
        source,
        error: errorMessage,
        durationMs,
      });

      return {
        runId,
        status,
        error: errorMessage,
        durationMs,
      };
    }
  }

  private createTimeout(ms: number): Promise<never> {
    return new Promise((_, reject) => {
      setTimeout(() => reject(new Error(`Adapter timed out after ${ms}ms`)), ms);
    });
  }

  private emitHeartbeatEvent(
    type: string,
    companyId: string,
    payload: Record<string, unknown>,
  ): void {
    const event: SystemEvent = {
      type,
      companyId,
      timestamp: new Date(),
      payload,
    };
    this.eventBus.emit(event);
  }
}
