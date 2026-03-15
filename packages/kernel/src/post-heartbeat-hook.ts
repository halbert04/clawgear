/**
 * Post-heartbeat pipeline: sequential orchestrator registered on heartbeat.completed.
 *
 * V1: quality = success/failure (no LLM judge).
 * Steps: quality eval → lesson extraction → competence update → task routing.
 * Each step wrapped in try/catch so failures don't block the rest.
 */

import type { Database } from '@clawgear/db';
import { heartbeatRuns } from '@clawgear/db/pg';
import type { CompetenceTracker, LessonStore } from '@clawgear/learning';
import { parseReflectionOutput } from '@clawgear/learning';
import type { EventBus, SystemEvent } from '@clawgear/shared/interfaces';
import { eq } from 'drizzle-orm';
import type { TaskRouter } from './task-router.js';

export interface PostHeartbeatHookConfig {
  db: Database;
  eventBus: EventBus;
  competenceTracker: CompetenceTracker;
  lessonStore: LessonStore;
  taskRouter: TaskRouter;
}

export class PostHeartbeatHook {
  private db: Database;
  private eventBus: EventBus;
  private competenceTracker: CompetenceTracker;
  private lessonStore: LessonStore;
  private taskRouter: TaskRouter;

  constructor(config: PostHeartbeatHookConfig) {
    this.db = config.db;
    this.eventBus = config.eventBus;
    this.competenceTracker = config.competenceTracker;
    this.lessonStore = config.lessonStore;
    this.taskRouter = config.taskRouter;
  }

  /** Register this hook on the event bus. Call once at startup. */
  register(): void {
    this.eventBus.on('heartbeat.completed', (event: SystemEvent) => {
      this.run(event).catch((err) => console.error('Post-heartbeat pipeline error:', err));
    });
  }

  /** Run the sequential post-heartbeat pipeline. */
  async run(event: SystemEvent): Promise<void> {
    const { agentId, runId, durationMs, usage } = event.payload as {
      agentId: string;
      runId: string;
      durationMs: number;
      usage?: { costCents: number };
    };
    const companyId = event.companyId;

    // Load the heartbeat run for output data
    const [run] = await this.db.select().from(heartbeatRuns).where(eq(heartbeatRuns.id, runId));

    if (!run) return;

    const succeeded = run.status === 'succeeded';
    const resultJson = run.resultJson as { output?: string; toolCalls?: { tool: string }[] } | null;
    const output = resultJson?.output ?? '';
    const toolCalls = resultJson?.toolCalls;

    const taskType = 'heartbeat'; // Simple default for V1

    // ─── Step 1: Quality evaluation (V1: success/failure) ───
    const qualityScore = succeeded ? 1.0 : 0.0;

    // ─── Step 2: Lesson extraction ───
    try {
      const reflection = parseReflectionOutput(output, succeeded, toolCalls);

      await this.lessonStore.store({
        companyId,
        agentId,
        runId,
        taskType,
        approach: reflection.approach,
        whatWorked: reflection.whatWorked,
        whatFailed: reflection.whatFailed,
        lesson: reflection.lesson,
        outcome: reflection.outcome,
        confidence: reflection.confidence,
      });
    } catch (err) {
      console.error(`Post-heartbeat lesson extraction failed for run ${runId}:`, err);
    }

    // ─── Step 3: Competence update ───
    try {
      await this.competenceTracker.update({
        companyId,
        agentId,
        taskType,
        succeeded,
        costCents: usage?.costCents ?? 0,
        durationMs: (durationMs as number) ?? 0,
        qualityScore,
      });
    } catch (err) {
      console.error(`Post-heartbeat competence update failed for run ${runId}:`, err);
    }

    // ─── Step 4: Next task routing (only if quality passed) ───
    if (qualityScore >= 0.5) {
      try {
        const route = await this.taskRouter.routeTask(companyId, taskType, [agentId]);
        if (route) {
          this.eventBus.emit({
            type: 'task.routed',
            companyId,
            timestamp: new Date(),
            payload: {
              fromAgentId: agentId,
              toAgentId: route.agentId,
              taskType,
              reason: route.reason,
            },
          });
        }
      } catch (err) {
        console.error(`Post-heartbeat task routing failed for run ${runId}:`, err);
      }
    }
  }
}
