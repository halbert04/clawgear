import type { InvocationSource } from '@clawgear/shared/constants';
import { EVENT_DEBOUNCE_WINDOW_MS } from '@clawgear/shared/constants';
import type { EventBus, EventSubscription, SystemEvent } from '@clawgear/shared/interfaces';
import type { HeartbeatEngine } from './heartbeat-engine.js';

interface WakeConfig {
  eventType: string;
  extractAgentId: (event: SystemEvent) => string | null;
  invocationSource: InvocationSource;
}

const WAKE_CONFIGS: WakeConfig[] = [
  {
    eventType: 'issue.assigned',
    extractAgentId: (e) => (e.payload.assigneeAgentId as string) ?? null,
    invocationSource: 'assigned',
  },
  {
    eventType: 'agent.resumed',
    extractAgentId: (e) => (e.payload.agentId as string) ?? null,
    invocationSource: 'event',
  },
];

export interface WakeHandlerConfig {
  eventBus: EventBus;
  heartbeatEngine: HeartbeatEngine;
  debounceMs?: number;
}

export class WakeHandler {
  private eventBus: EventBus;
  private heartbeatEngine: HeartbeatEngine;
  private debounceMs: number;
  private subscriptions: EventSubscription[] = [];
  private debounceTimers = new Map<string, ReturnType<typeof setTimeout>>();

  constructor(config: WakeHandlerConfig) {
    this.eventBus = config.eventBus;
    this.heartbeatEngine = config.heartbeatEngine;
    this.debounceMs = config.debounceMs ?? EVENT_DEBOUNCE_WINDOW_MS;
  }

  start(): void {
    for (const wakeConfig of WAKE_CONFIGS) {
      const sub = this.eventBus.on(wakeConfig.eventType, (event) => {
        const agentId = wakeConfig.extractAgentId(event);
        if (!agentId) return;
        this.debouncedTrigger(agentId, wakeConfig.invocationSource);
      });
      this.subscriptions.push(sub);
    }
  }

  stop(): void {
    for (const sub of this.subscriptions) {
      sub.unsubscribe();
    }
    this.subscriptions = [];

    for (const timer of this.debounceTimers.values()) {
      clearTimeout(timer);
    }
    this.debounceTimers.clear();
  }

  private debouncedTrigger(agentId: string, source: InvocationSource): void {
    const key = `${agentId}:${source}`;

    const existing = this.debounceTimers.get(key);
    if (existing) {
      clearTimeout(existing);
    }

    const timer = setTimeout(async () => {
      this.debounceTimers.delete(key);
      try {
        await this.heartbeatEngine.executeHeartbeat(agentId, source);
      } catch (err) {
        console.error(
          `Wake trigger failed for agent ${agentId} (${source}):`,
          (err as Error).message,
        );
      }
    }, this.debounceMs);

    this.debounceTimers.set(key, timer);
  }
}
