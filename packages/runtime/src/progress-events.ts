import type { EventBus, EventSubscription, SystemEvent } from '@clawgear/shared/interfaces';

export interface ProgressRecord {
  agentId: string;
  companyId: string;
  lastProgressAt: Date;
  percentComplete: number;
  status: string;
}

export interface StuckDetectionConfig {
  eventBus: EventBus;
  stuckMultiplier?: number;
  checkIntervalMs?: number;
  onStuckDetected?: (agentId: string, companyId: string, lastProgressAt: Date) => void;
}

export class ProgressTracker {
  private eventBus: EventBus;
  private stuckMultiplier: number;
  private checkIntervalMs: number;
  private onStuckDetected?: (agentId: string, companyId: string, lastProgressAt: Date) => void;
  private progressMap = new Map<string, ProgressRecord>();
  private averageDurations = new Map<string, number>();
  private subscription: EventSubscription | null = null;
  private checkTimer: ReturnType<typeof setInterval> | null = null;

  constructor(config: StuckDetectionConfig) {
    this.eventBus = config.eventBus;
    this.stuckMultiplier = config.stuckMultiplier ?? 3;
    this.checkIntervalMs = config.checkIntervalMs ?? 30_000;
    this.onStuckDetected = config.onStuckDetected;
  }

  start(): void {
    this.subscription = this.eventBus.on('agent.progress', (event) => {
      this.recordProgress(event);
    });

    this.checkTimer = setInterval(() => this.checkForStuck(), this.checkIntervalMs);
  }

  stop(): void {
    this.subscription?.unsubscribe();
    this.subscription = null;
    if (this.checkTimer) {
      clearInterval(this.checkTimer);
      this.checkTimer = null;
    }
  }

  private recordProgress(event: SystemEvent): void {
    const agentId = event.payload.agentId as string;
    this.progressMap.set(agentId, {
      agentId,
      companyId: event.companyId,
      lastProgressAt: new Date(),
      percentComplete: (event.payload.percentComplete as number) ?? 0,
      status: (event.payload.status as string) ?? 'in_progress',
    });
  }

  recordDuration(agentId: string, durationMs: number): void {
    const existing = this.averageDurations.get(agentId);
    if (existing) {
      // Exponential moving average
      this.averageDurations.set(agentId, existing * 0.7 + durationMs * 0.3);
    } else {
      this.averageDurations.set(agentId, durationMs);
    }
  }

  private checkForStuck(): void {
    const now = Date.now();

    for (const [agentId, record] of this.progressMap) {
      const avgDuration = this.averageDurations.get(agentId) ?? 60_000;
      const threshold = avgDuration * this.stuckMultiplier;
      const elapsed = now - record.lastProgressAt.getTime();

      if (elapsed > threshold) {
        this.onStuckDetected?.(agentId, record.companyId, record.lastProgressAt);
        // Remove to avoid repeated notifications
        this.progressMap.delete(agentId);
      }
    }
  }

  getProgress(agentId: string): ProgressRecord | undefined {
    return this.progressMap.get(agentId);
  }
}
