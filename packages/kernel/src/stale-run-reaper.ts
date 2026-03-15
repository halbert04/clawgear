import type { Database } from '@clawgear/db';
import { agents, heartbeatRuns } from '@clawgear/db/pg';
import { HEARTBEAT_DEFAULT_TIMEOUT_MS } from '@clawgear/shared/constants';
import type { EventBus, SystemEvent } from '@clawgear/shared/interfaces';
import { and, eq, lt, sql } from 'drizzle-orm';

const REAP_INTERVAL_MS = 60_000; // Check every 60s
const STALE_GRACE_PERIOD_MS = 30_000; // Extra 30s grace beyond timeout

export interface StaleRunReaperConfig {
  db: Database;
  eventBus: EventBus;
}

/**
 * Periodically finds heartbeat runs stuck in 'running' or 'queued' state
 * past their expected timeout and marks them as timed_out.
 * Resets the associated agent to 'idle' so it can be rescheduled.
 */
export class StaleRunReaper {
  private db: Database;
  private eventBus: EventBus;
  private timer: ReturnType<typeof setInterval> | null = null;
  private running = false;

  constructor(config: StaleRunReaperConfig) {
    this.db = config.db;
    this.eventBus = config.eventBus;
  }

  start(): void {
    if (this.running) return;
    this.running = true;

    this.timer = setInterval(() => {
      this.reap().catch((err) => {
        console.error('StaleRunReaper error:', (err as Error).message);
      });
    }, REAP_INTERVAL_MS);
  }

  stop(): void {
    this.running = false;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  async reap(): Promise<number> {
    const cutoff = new Date(Date.now() - HEARTBEAT_DEFAULT_TIMEOUT_MS - STALE_GRACE_PERIOD_MS);

    // Find runs stuck in running/queued that started before the cutoff
    const staleRuns = await this.db
      .select({
        id: heartbeatRuns.id,
        agentId: heartbeatRuns.agentId,
        companyId: heartbeatRuns.companyId,
        status: heartbeatRuns.status,
      })
      .from(heartbeatRuns)
      .where(
        and(
          sql`${heartbeatRuns.status} IN ('running', 'queued')`,
          lt(heartbeatRuns.createdAt, cutoff),
        ),
      );

    for (const run of staleRuns) {
      // Mark run as timed_out
      await this.db
        .update(heartbeatRuns)
        .set({
          status: 'timed_out',
          resultJson: { error: 'Reaped: run exceeded maximum lifetime' },
          finishedAt: new Date(),
        })
        .where(eq(heartbeatRuns.id, run.id));

      // Reset agent to idle
      await this.db
        .update(agents)
        .set({ status: 'idle', updatedAt: new Date() })
        .where(and(eq(agents.id, run.agentId), eq(agents.status, 'running')));

      // Emit event
      this.eventBus.emit({
        type: 'heartbeat.reaped',
        companyId: run.companyId,
        timestamp: new Date(),
        payload: {
          runId: run.id,
          agentId: run.agentId,
          previousStatus: run.status,
        },
      } as SystemEvent);
    }

    return staleRuns.length;
  }
}
