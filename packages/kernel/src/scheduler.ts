import type { Database } from '@clawgear/db';
import { agents } from '@clawgear/db/pg';
import { and, eq } from 'drizzle-orm';
import type { HeartbeatEngine } from './heartbeat-engine.js';

export interface HeartbeatSchedulerConfig {
  db: Database;
  heartbeatEngine: HeartbeatEngine;
  defaultIntervalMs?: number;
}

export class HeartbeatScheduler {
  private db: Database;
  private heartbeatEngine: HeartbeatEngine;
  private timers = new Map<string, ReturnType<typeof setInterval>>();
  private running = false;

  constructor(config: HeartbeatSchedulerConfig) {
    this.db = config.db;
    this.heartbeatEngine = config.heartbeatEngine;
  }

  async start(): Promise<void> {
    if (this.running) return;
    this.running = true;
    await this.syncAgents();
  }

  stop(): void {
    this.running = false;
    for (const timer of this.timers.values()) {
      clearInterval(timer);
    }
    this.timers.clear();
  }

  async syncAgents(): Promise<void> {
    if (!this.running) return;

    const idleAgents = await this.db
      .select()
      .from(agents)
      .where(and(eq(agents.status, 'idle')));

    const currentAgentIds = new Set(idleAgents.map((a) => a.id));

    // Remove timers for agents that are no longer idle
    for (const [agentId, timer] of this.timers) {
      if (!currentAgentIds.has(agentId)) {
        clearInterval(timer);
        this.timers.delete(agentId);
      }
    }

    // Add timers for new idle agents that have scheduling enabled
    for (const agent of idleAgents) {
      if (this.timers.has(agent.id)) continue;

      const config = agent.adapterConfig as Record<string, unknown>;
      const intervalMs = (config?.heartbeatIntervalMs as number) ?? null;

      // Only schedule if agent has explicit heartbeat interval configured
      if (intervalMs == null) continue;

      const effectiveInterval = Math.max(intervalMs, 5000); // Min 5s

      const timer = setInterval(async () => {
        if (!this.running) return;

        try {
          await this.heartbeatEngine.executeHeartbeat(agent.id, 'scheduled');
        } catch (err) {
          console.error(
            `Scheduled heartbeat failed for agent ${agent.id}:`,
            (err as Error).message,
          );
        }
      }, effectiveInterval);

      this.timers.set(agent.id, timer);
    }
  }

  scheduleAgent(agentId: string, intervalMs: number): void {
    this.removeAgent(agentId);

    const effectiveInterval = Math.max(intervalMs, 5000);
    const timer = setInterval(async () => {
      if (!this.running) return;
      try {
        await this.heartbeatEngine.executeHeartbeat(agentId, 'scheduled');
      } catch (err) {
        console.error(`Scheduled heartbeat failed for agent ${agentId}:`, (err as Error).message);
      }
    }, effectiveInterval);

    this.timers.set(agentId, timer);
  }

  removeAgent(agentId: string): void {
    const timer = this.timers.get(agentId);
    if (timer) {
      clearInterval(timer);
      this.timers.delete(agentId);
    }
  }

  get scheduledAgentCount(): number {
    return this.timers.size;
  }
}
