import type { Database } from '@clawgear/db';
import { agents } from '@clawgear/db/pg';
import type { EventBus, SystemEvent } from '@clawgear/shared/interfaces';
import type { HandConfig } from '@clawgear/shared/types';
import { CronExpressionParser } from 'cron-parser';
import { and, eq } from 'drizzle-orm';
import type { HeartbeatEngine } from './heartbeat-engine.js';

const TICK_INTERVAL_MS = 30_000; // 30s polling

interface ScheduledHand {
  nextRunAt: Date;
  cronExpression: string;
  companyId: string;
  handName: string;
}

export interface HandSchedulerConfig {
  db: Database;
  heartbeatEngine: HeartbeatEngine;
  eventBus: EventBus;
}

export class HandScheduler {
  private db: Database;
  private heartbeatEngine: HeartbeatEngine;
  private eventBus: EventBus;
  private hands = new Map<string, ScheduledHand>();
  private tickTimer: ReturnType<typeof setInterval> | null = null;
  private running = false;

  constructor(config: HandSchedulerConfig) {
    this.db = config.db;
    this.heartbeatEngine = config.heartbeatEngine;
    this.eventBus = config.eventBus;

    // Listen for hand lifecycle events
    this.eventBus.on('hand.activated', (event: SystemEvent) => {
      const { agentId, schedule } = event.payload as {
        agentId: string;
        schedule: string;
        handName: string;
      };
      this.addHand(
        agentId,
        schedule,
        event.companyId,
        (event.payload as { handName: string }).handName,
      );
    });

    this.eventBus.on('hand.deactivated', (event: SystemEvent) => {
      const { agentId } = event.payload as { agentId: string };
      this.removeHand(agentId);
    });

    this.eventBus.on('agent.status_changed', (event: SystemEvent) => {
      const { agentId, newStatus } = event.payload as {
        agentId: string;
        newStatus: string;
      };
      if (newStatus === 'paused' || newStatus === 'terminated') {
        this.removeHand(agentId);
      }
    });
  }

  async start(): Promise<void> {
    if (this.running) return;
    this.running = true;

    // Load all hand agents on startup
    await this.loadActiveHands();

    // Start polling timer
    this.tickTimer = setInterval(() => {
      this.tick().catch((err) => {
        console.error('HandScheduler tick error:', (err as Error).message);
      });
    }, TICK_INTERVAL_MS);
  }

  stop(): void {
    this.running = false;
    if (this.tickTimer) {
      clearInterval(this.tickTimer);
      this.tickTimer = null;
    }
    this.hands.clear();
  }

  private async loadActiveHands(): Promise<void> {
    const handAgents = await this.db
      .select()
      .from(agents)
      .where(and(eq(agents.adapterType, 'hand'), eq(agents.status, 'idle')));

    for (const agent of handAgents) {
      const config = agent.adapterConfig as Record<string, unknown>;
      const handConfig = (config?.handConfig ?? config) as HandConfig | undefined;
      if (handConfig?.schedule) {
        this.addHand(agent.id, handConfig.schedule, agent.companyId, handConfig.name ?? agent.name);
      }
    }
  }

  private async tick(): Promise<void> {
    if (!this.running) return;

    const now = new Date();

    for (const [agentId, hand] of this.hands) {
      if (hand.nextRunAt <= now) {
        // Update next run time before executing
        try {
          const cron = CronExpressionParser.parse(hand.cronExpression);
          hand.nextRunAt = cron.next().toDate();
        } catch {
          console.error(`Invalid cron for hand ${agentId}: ${hand.cronExpression}`);
          this.hands.delete(agentId);
          continue;
        }

        // Execute heartbeat (fire-and-forget, don't block the tick loop)
        this.heartbeatEngine.executeHeartbeat(agentId, 'scheduled').catch((err) => {
          console.error(`HandScheduler: heartbeat failed for ${agentId}:`, (err as Error).message);
        });
      }
    }
  }

  addHand(agentId: string, cronExpression: string, companyId: string, handName: string): void {
    try {
      const cron = CronExpressionParser.parse(cronExpression);
      const nextRunAt = cron.next().toDate();
      this.hands.set(agentId, {
        nextRunAt,
        cronExpression,
        companyId,
        handName,
      });
    } catch (err) {
      console.error(
        `HandScheduler: invalid cron expression "${cronExpression}" for ${agentId}:`,
        (err as Error).message,
      );
    }
  }

  removeHand(agentId: string): void {
    this.hands.delete(agentId);
  }

  getNextRunTime(agentId: string): Date | null {
    return this.hands.get(agentId)?.nextRunAt ?? null;
  }

  get scheduledHandCount(): number {
    return this.hands.size;
  }

  getScheduledHands(): Array<{
    agentId: string;
    handName: string;
    companyId: string;
    nextRunAt: Date;
    cronExpression: string;
  }> {
    return Array.from(this.hands.entries()).map(([agentId, hand]) => ({
      agentId,
      handName: hand.handName,
      companyId: hand.companyId,
      nextRunAt: hand.nextRunAt,
      cronExpression: hand.cronExpression,
    }));
  }
}
