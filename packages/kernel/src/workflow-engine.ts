import type { Database } from '@clawgear/db';
import {
  agentCompetence,
  agents,
  workflowRuns,
  workflowStepRuns,
  workflows,
} from '@clawgear/db/pg';
import type { EventBus } from '@clawgear/shared/interfaces';
import { and, desc, eq, sql } from 'drizzle-orm';
import type { HeartbeatEngine } from './heartbeat-engine.js';

export interface WorkflowStep {
  name: string;
  mode: 'sequential' | 'fan_out' | 'conditional';
  agentRole?: string;
  agentId?: string;
  prompt?: string;
  onError?: 'fail' | 'skip' | 'retry';
  maxRetries?: number;
  timeoutMs?: number;
  subSteps?: WorkflowStep[];
  condition?: string;
  ifTrue?: WorkflowStep;
  ifFalse?: WorkflowStep;
}

export interface WorkflowDefinition {
  steps: WorkflowStep[];
}

export interface WorkflowEngineConfig {
  db: Database;
  eventBus: EventBus;
  heartbeatEngine: HeartbeatEngine;
}

export class WorkflowEngine {
  private db: Database;
  private eventBus: EventBus;
  private heartbeatEngine: HeartbeatEngine;

  constructor(config: WorkflowEngineConfig) {
    this.db = config.db;
    this.eventBus = config.eventBus;
    this.heartbeatEngine = config.heartbeatEngine;
  }

  async execute(
    companyId: string,
    workflowId: string,
    inputVars: Record<string, unknown>,
  ): Promise<{ runId: string }> {
    const workflowRows = await this.db
      .select()
      .from(workflows)
      .where(and(eq(workflows.id, workflowId), eq(workflows.companyId, companyId)))
      .limit(1);

    const workflow = workflowRows[0];
    if (!workflow) {
      throw new Error(`Workflow ${workflowId} not found for company ${companyId}`);
    }

    if (!workflow.isActive) {
      throw new Error(`Workflow ${workflowId} is not active`);
    }

    const definition = workflow.definition as WorkflowDefinition;
    if (!definition?.steps) {
      throw new Error(`Workflow ${workflowId} has invalid definition`);
    }

    const totalSteps = definition.steps.length;

    const runRows = await this.db
      .insert(workflowRuns)
      .values({
        companyId,
        workflowId,
        status: 'running',
        inputVars,
        currentStepIndex: 0,
        totalSteps,
        startedAt: new Date(),
      })
      .returning();

    const run = runRows[0]!;

    this.eventBus.emit({
      type: 'workflow.started',
      companyId,
      timestamp: new Date(),
      payload: {
        workflowId,
        runId: run.id,
        workflowName: workflow.name,
        totalSteps,
      },
    });

    const startedAt = Date.now();

    // Execute steps asynchronously (fire-and-forget)
    this.executeSteps(run.id, companyId, workflowId, definition.steps, { input: inputVars })
      .then(async (output) => {
        await this.db
          .update(workflowRuns)
          .set({ status: 'completed', outputVars: output, finishedAt: new Date() })
          .where(eq(workflowRuns.id, run.id));

        this.eventBus.emit({
          type: 'workflow.completed',
          companyId,
          timestamp: new Date(),
          payload: {
            workflowId,
            runId: run.id,
            workflowName: workflow.name,
            durationMs: Date.now() - startedAt,
          },
        });
      })
      .catch(async (error: unknown) => {
        await this.db
          .update(workflowRuns)
          .set({ status: 'failed', finishedAt: new Date() })
          .where(eq(workflowRuns.id, run.id));

        this.eventBus.emit({
          type: 'workflow.failed',
          companyId,
          timestamp: new Date(),
          payload: {
            workflowId,
            runId: run.id,
            workflowName: workflow.name,
            error: (error as Error).message,
            failedStep: (error as Error).message,
          },
        });
      });

    return { runId: run.id };
  }

  async cancelRun(runId: string): Promise<void> {
    const runRows = await this.db
      .select()
      .from(workflowRuns)
      .where(eq(workflowRuns.id, runId))
      .limit(1);

    const run = runRows[0];
    if (!run) {
      throw new Error(`Workflow run ${runId} not found`);
    }

    if (run.status !== 'running') {
      throw new Error(`Workflow run ${runId} is not running (status: ${run.status})`);
    }

    await this.db
      .update(workflowRuns)
      .set({ status: 'cancelled', finishedAt: new Date() })
      .where(eq(workflowRuns.id, runId));

    await this.db
      .update(workflowStepRuns)
      .set({ status: 'skipped', finishedAt: new Date() })
      .where(
        and(
          eq(workflowStepRuns.workflowRunId, runId),
          sql`${workflowStepRuns.status} IN ('pending', 'running')`,
        ),
      );
  }

  private async executeSteps(
    runId: string,
    companyId: string,
    workflowId: string,
    steps: WorkflowStep[],
    context: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    const output: Record<string, unknown> = { ...context };

    for (let i = 0; i < steps.length; i++) {
      const step = steps[i]!;

      await this.db
        .update(workflowRuns)
        .set({ currentStepIndex: i })
        .where(eq(workflowRuns.id, runId));

      if (step.mode === 'fan_out') {
        if (!step.subSteps || step.subSteps.length === 0) {
          continue;
        }

        const subResults = await Promise.allSettled(
          step.subSteps.map((subStep) =>
            this.executeSequentialStep(runId, companyId, workflowId, subStep, i, output),
          ),
        );

        const fanOutResults: Record<string, unknown> = {};
        for (let j = 0; j < subResults.length; j++) {
          const result = subResults[j]!;
          const subStep = step.subSteps[j]!;
          if (result.status === 'fulfilled') {
            fanOutResults[subStep.name] = result.value;
          } else {
            fanOutResults[subStep.name] = { error: (result.reason as Error).message };
          }
        }

        output[step.name] = fanOutResults;
      } else if (step.mode === 'conditional') {
        const conditionResult = this.evaluateCondition(step.condition, output);

        if (conditionResult && step.ifTrue) {
          const result = await this.executeSequentialStep(
            runId,
            companyId,
            workflowId,
            step.ifTrue,
            i,
            output,
          );
          output[step.name] = result;
        } else if (!conditionResult && step.ifFalse) {
          const result = await this.executeSequentialStep(
            runId,
            companyId,
            workflowId,
            step.ifFalse,
            i,
            output,
          );
          output[step.name] = result;
        } else {
          output[step.name] = { skipped: true, reason: 'no_branch_defined' };
        }
      } else {
        // Sequential (default)
        const result = await this.executeSequentialStep(
          runId,
          companyId,
          workflowId,
          step,
          i,
          output,
        );
        output[step.name] = result;
      }
    }

    return output;
  }

  private async executeSequentialStep(
    runId: string,
    companyId: string,
    _workflowId: string,
    step: WorkflowStep,
    stepIndex: number,
    context: Record<string, unknown>,
  ): Promise<unknown> {
    const maxRetries = step.maxRetries ?? 1;
    const onError = step.onError ?? 'fail';
    let lastError: Error | null = null;

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        const agentId = step.agentId ?? (await this.resolveAgent(companyId, step.agentRole));
        if (!agentId) {
          throw new Error(`No agent found for role ${step.agentRole} in company ${companyId}`);
        }

        const prompt = step.prompt ? this.substituteVars(step.prompt, context) : '';

        const stepRunRows = await this.db
          .insert(workflowStepRuns)
          .values({
            workflowRunId: runId,
            stepName: step.name,
            stepIndex,
            mode: step.mode,
            status: 'pending',
            agentId,
            inputVars: { prompt },
            retryCount: attempt,
          })
          .returning();

        const stepRun = stepRunRows[0]!;

        await this.db
          .update(workflowStepRuns)
          .set({ status: 'running', startedAt: new Date() })
          .where(eq(workflowStepRuns.id, stepRun.id));

        const timeoutMs = step.timeoutMs ?? 300000;
        const result = await this.executeWithTimeout(
          this.heartbeatEngine.executeHeartbeat(agentId, 'event'),
          timeoutMs,
        );

        if (result.status === 'succeeded') {
          await this.db
            .update(workflowStepRuns)
            .set({
              status: 'completed',
              outputVars: { output: result.output, runId: result.runId },
              heartbeatRunId: result.runId,
              finishedAt: new Date(),
            })
            .where(eq(workflowStepRuns.id, stepRun.id));

          this.eventBus.emit({
            type: 'workflow.step_completed',
            companyId,
            timestamp: new Date(),
            payload: {
              workflowId: _workflowId,
              runId,
              stepName: step.name,
              stepIndex,
              status: 'completed',
            },
          });

          return { output: result.output, runId: result.runId };
        }
        throw new Error(result.error ?? `Heartbeat ${result.status}`);
      } catch (error) {
        lastError = error as Error;

        if (attempt < maxRetries - 1 && onError === 'retry') {
          continue;
        }

        if (onError === 'skip') {
          await this.updateStepStatus(runId, step.name, 'skipped', lastError.message);
          return { skipped: true, error: lastError.message };
        }
        // Default: fail
        await this.updateStepStatus(runId, step.name, 'failed', lastError.message);
        throw lastError;
      }
    }

    throw lastError ?? new Error('Unknown error during step execution');
  }

  private async updateStepStatus(
    runId: string,
    stepName: string,
    status: string,
    errorMessage: string,
  ): Promise<void> {
    const rows = await this.db
      .select()
      .from(workflowStepRuns)
      .where(
        and(eq(workflowStepRuns.workflowRunId, runId), eq(workflowStepRuns.stepName, stepName)),
      )
      .orderBy(desc(workflowStepRuns.createdAt))
      .limit(1);

    const stepRun = rows[0];
    if (stepRun) {
      await this.db
        .update(workflowStepRuns)
        .set({ status, errorMessage, finishedAt: new Date() })
        .where(eq(workflowStepRuns.id, stepRun.id));
    }
  }

  private async resolveAgent(companyId: string, agentRole?: string): Promise<string | null> {
    if (!agentRole) {
      return null;
    }

    const results = await this.db
      .select({ agentId: agents.id, avgQualityScore: agentCompetence.avgQualityScore })
      .from(agents)
      .leftJoin(agentCompetence, eq(agentCompetence.agentId, agents.id))
      .where(
        and(eq(agents.companyId, companyId), eq(agents.role, agentRole), eq(agents.status, 'idle')),
      )
      .orderBy(desc(agentCompetence.avgQualityScore))
      .limit(1);

    if (results.length > 0) {
      return results[0]!.agentId;
    }

    const fallbackRows = await this.db
      .select()
      .from(agents)
      .where(
        and(eq(agents.companyId, companyId), eq(agents.role, agentRole), eq(agents.status, 'idle')),
      )
      .limit(1);

    return fallbackRows[0]?.id ?? null;
  }

  private substituteVars(template: string, context: Record<string, unknown>): string {
    return template.replace(/\{\{([^}]+)\}\}/g, (match, path: string) => {
      const parts = path.trim().split('.');
      let value: unknown = context;

      for (const part of parts) {
        if (value && typeof value === 'object' && part in value) {
          value = (value as Record<string, unknown>)[part];
        } else {
          return match;
        }
      }

      return String(value ?? match);
    });
  }

  private evaluateCondition(
    condition: string | undefined,
    context: Record<string, unknown>,
  ): boolean {
    if (!condition) {
      return false;
    }

    const parts = condition.split('.');
    let value: unknown = context;

    for (const part of parts) {
      if (value && typeof value === 'object' && part in value) {
        value = (value as Record<string, unknown>)[part];
      } else {
        return false;
      }
    }

    return Boolean(value);
  }

  private async executeWithTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => {
        reject(new Error(`Operation timed out after ${timeoutMs}ms`));
      }, timeoutMs);
    });

    return Promise.race([promise, timeoutPromise]);
  }
}
