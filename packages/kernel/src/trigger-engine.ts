import type { Database } from '@clawgear/db';
import { agents, companies, heartbeatRuns, issues, triggers } from '@clawgear/db/pg';
import type { EventBus, EventSubscription, SystemEvent } from '@clawgear/shared/interfaces';
import { and, desc, eq } from 'drizzle-orm';
import type { HeartbeatEngine } from './heartbeat-engine.js';

export interface TriggerEngineConfig {
  db: Database;
  eventBus: EventBus;
  heartbeatEngine: HeartbeatEngine;
  workflowEngine?: WorkflowEngineHandle;
}

// Minimal interface to avoid circular dependency with WorkflowEngine
export interface WorkflowEngineHandle {
  execute(
    companyId: string,
    workflowId: string,
    inputVars: Record<string, unknown>,
  ): Promise<{ runId: string }>;
}

interface TriggerRecord {
  id: string;
  companyId: string;
  name: string;
  patternType: string;
  patternConfig: Record<string, unknown>;
  actionType: string;
  actionConfig: Record<string, unknown>;
  isActive: boolean;
  fireCount: number;
  maxFireCount: number | null;
  cooldownMs: number;
}

export class TriggerEngine {
  private db: Database;
  private eventBus: EventBus;
  private heartbeatEngine: HeartbeatEngine;
  private workflowEngine?: WorkflowEngineHandle;
  private activeTriggers: Map<string, TriggerRecord>;
  private subscription: EventSubscription | null;
  private lastFireTimes: Map<string, number>;
  private qualityFailureCounts: Map<string, number>;

  constructor(config: TriggerEngineConfig) {
    this.db = config.db;
    this.eventBus = config.eventBus;
    this.heartbeatEngine = config.heartbeatEngine;
    this.workflowEngine = config.workflowEngine;
    this.activeTriggers = new Map();
    this.subscription = null;
    this.lastFireTimes = new Map();
    this.qualityFailureCounts = new Map();
  }

  setWorkflowEngine(engine: WorkflowEngineHandle): void {
    this.workflowEngine = engine;
  }

  async start(): Promise<void> {
    // Load all active triggers from database
    const activeTriggerRows = await this.db
      .select()
      .from(triggers)
      .where(eq(triggers.isActive, true));

    for (const trigger of activeTriggerRows) {
      this.activeTriggers.set(trigger.id, {
        id: trigger.id,
        companyId: trigger.companyId,
        name: trigger.name,
        patternType: trigger.patternType,
        patternConfig: trigger.patternConfig as Record<string, unknown>,
        actionType: trigger.actionType,
        actionConfig: trigger.actionConfig as Record<string, unknown>,
        isActive: trigger.isActive,
        fireCount: trigger.fireCount,
        maxFireCount: trigger.maxFireCount,
        cooldownMs: trigger.cooldownMs,
      });
    }

    // Subscribe to all events
    this.subscription = this.eventBus.on('*', (event) => {
      this.evaluate(event).catch((err) => {
        console.error('TriggerEngine evaluate error:', (err as Error).message);
      });
    });
  }

  stop(): void {
    if (this.subscription) {
      this.subscription.unsubscribe();
      this.subscription = null;
    }
    this.activeTriggers.clear();
    this.lastFireTimes.clear();
    this.qualityFailureCounts.clear();
  }

  async evaluate(event: SystemEvent): Promise<void> {
    for (const [triggerId, trigger] of this.activeTriggers) {
      try {
        // Check if pattern matches
        let matches = false;
        switch (trigger.patternType) {
          case 'event_match':
            matches = this.matchEventMatch(trigger, event);
            break;
          case 'budget_threshold':
            matches = this.matchBudgetThreshold(trigger, event);
            break;
          case 'quality_failure':
            matches = this.matchQualityFailure(trigger, event);
            break;
          case 'agent_idle':
            matches = await this.matchAgentIdle(trigger, event);
            break;
          case 'schedule_missed':
            matches = this.matchScheduleMissed(trigger, event);
            break;
        }

        if (!matches) {
          continue;
        }

        // Check cooldown
        const lastFireTime = this.lastFireTimes.get(triggerId);
        if (lastFireTime && Date.now() - lastFireTime < trigger.cooldownMs) {
          continue;
        }

        // Check maxFireCount
        if (trigger.maxFireCount !== null && trigger.fireCount >= trigger.maxFireCount) {
          continue;
        }

        // Execute action
        await this.executeAction(trigger, event);

        // Update fire count and timestamp
        const newFireCount = trigger.fireCount + 1;
        const now = new Date();
        await this.db
          .update(triggers)
          .set({
            fireCount: newFireCount,
            lastFiredAt: now,
          })
          .where(eq(triggers.id, triggerId));

        trigger.fireCount = newFireCount;
        this.lastFireTimes.set(triggerId, Date.now());

        // Emit trigger.fired event
        this.eventBus.emit({
          type: 'trigger.fired',
          companyId: trigger.companyId,
          timestamp: now,
          payload: {
            triggerId: trigger.id,
            triggerName: trigger.name,
            patternType: trigger.patternType,
            actionType: trigger.actionType,
            eventType: event.type,
            fireCount: newFireCount,
          },
        });

        // Check if maxFireCount reached, auto-disable
        if (trigger.maxFireCount !== null && newFireCount >= trigger.maxFireCount) {
          await this.db.update(triggers).set({ isActive: false }).where(eq(triggers.id, triggerId));

          this.activeTriggers.delete(triggerId);

          this.eventBus.emit({
            type: 'trigger.disabled',
            companyId: trigger.companyId,
            timestamp: new Date(),
            payload: {
              triggerId: trigger.id,
              triggerName: trigger.name,
              reason: 'max_fire_count_reached',
            },
          });
        }
      } catch (err) {
        console.error(
          `TriggerEngine error evaluating trigger ${triggerId}:`,
          (err as Error).message,
        );
      }
    }
  }

  private matchEventMatch(trigger: TriggerRecord, event: SystemEvent): boolean {
    const config = trigger.patternConfig as {
      eventType: string;
      conditions?: Record<string, unknown>;
    };

    if (event.type !== config.eventType) {
      return false;
    }

    if (config.conditions) {
      for (const [key, value] of Object.entries(config.conditions)) {
        if (event.payload[key] !== value) {
          return false;
        }
      }
    }

    return true;
  }

  private matchBudgetThreshold(trigger: TriggerRecord, event: SystemEvent): boolean {
    const config = trigger.patternConfig as { thresholdPercent: number };

    if (typeof event.payload.percentUsed !== 'number') {
      return false;
    }

    return event.payload.percentUsed >= config.thresholdPercent;
  }

  private matchQualityFailure(trigger: TriggerRecord, event: SystemEvent): boolean {
    const config = trigger.patternConfig as { minConsecutiveFailures: number };

    if (event.type === 'quality.gate_failed') {
      const agentId = event.payload.agentId as string;
      if (!agentId) return false;

      const currentCount = (this.qualityFailureCounts.get(agentId) || 0) + 1;
      this.qualityFailureCounts.set(agentId, currentCount);

      return currentCount >= config.minConsecutiveFailures;
    }

    if (event.type === 'quality.gate_passed') {
      const agentId = event.payload.agentId as string;
      if (agentId) {
        this.qualityFailureCounts.delete(agentId);
      }
    }

    return false;
  }

  private async matchAgentIdle(trigger: TriggerRecord, event: SystemEvent): Promise<boolean> {
    // Only check on heartbeat.completed events for performance
    if (event.type !== 'heartbeat.completed') {
      return false;
    }

    const config = trigger.patternConfig as { idleMinutes: number };
    const idleThresholdMs = config.idleMinutes * 60 * 1000;
    const cutoffTime = new Date(Date.now() - idleThresholdMs);

    // Find agents in the same company who haven't had a recent heartbeat
    const companyAgents = await this.db
      .select()
      .from(agents)
      .where(and(eq(agents.companyId, trigger.companyId), eq(agents.status, 'idle')));

    for (const agent of companyAgents) {
      const recentRuns = await this.db
        .select()
        .from(heartbeatRuns)
        .where(eq(heartbeatRuns.agentId, agent.id))
        .orderBy(desc(heartbeatRuns.startedAt))
        .limit(1);

      if (
        recentRuns.length === 0 ||
        (recentRuns[0]!.startedAt && recentRuns[0]!.startedAt < cutoffTime)
      ) {
        return true;
      }
    }

    return false;
  }

  private matchScheduleMissed(trigger: TriggerRecord, event: SystemEvent): boolean {
    const config = trigger.patternConfig as { lateByMinutes: number };

    // Check for schedule-related events
    if (!event.type.includes('schedule') && event.type !== 'hand.deactivated') {
      return false;
    }

    // Check if the event payload indicates a schedule miss
    if (typeof event.payload.lateByMinutes === 'number') {
      return event.payload.lateByMinutes >= config.lateByMinutes;
    }

    return false;
  }

  private async executeAction(trigger: TriggerRecord, event: SystemEvent): Promise<void> {
    try {
      switch (trigger.actionType) {
        case 'wake_agent':
          await this.executeWakeAgent(trigger, event);
          break;
        case 'create_issue':
          await this.executeCreateIssue(trigger, event);
          break;
        case 'run_workflow':
          await this.executeRunWorkflow(trigger, event);
          break;
        default:
          console.warn(`Unknown action type: ${trigger.actionType}`);
      }
    } catch (err) {
      console.error(
        `TriggerEngine error executing action ${trigger.actionType}:`,
        (err as Error).message,
      );
      throw err;
    }
  }

  private async executeWakeAgent(trigger: TriggerRecord, _event: SystemEvent): Promise<void> {
    const config = trigger.actionConfig as { agentId: string; taskPrompt: string };

    if (!config.agentId) {
      throw new Error('wake_agent action requires agentId');
    }

    // Call heartbeat engine with event source
    await this.heartbeatEngine.executeHeartbeat(config.agentId, 'event');
  }

  private async executeCreateIssue(trigger: TriggerRecord, event: SystemEvent): Promise<void> {
    const config = trigger.actionConfig as { agentId?: string; title: string; body: string };

    if (!config.title) {
      throw new Error('create_issue action requires title');
    }

    // Get company to generate issue identifier
    const companyRows = await this.db
      .select()
      .from(companies)
      .where(eq(companies.id, trigger.companyId));

    const company = companyRows[0];
    if (!company) {
      throw new Error(`Company not found: ${trigger.companyId}`);
    }

    // Increment issue counter
    const newCounter = company.issueCounter + 1;
    await this.db
      .update(companies)
      .set({ issueCounter: newCounter })
      .where(eq(companies.id, trigger.companyId));

    const identifier = `${company.issuePrefix}-${newCounter}`;

    // Insert issue
    await this.db.insert(issues).values({
      companyId: trigger.companyId,
      issueNumber: newCounter,
      identifier,
      title: this.substituteVars(config.title, event),
      description: this.substituteVars(config.body || '', event),
      assigneeAgentId: config.agentId || null,
    });
  }

  private async executeRunWorkflow(trigger: TriggerRecord, _event: SystemEvent): Promise<void> {
    const config = trigger.actionConfig as {
      workflowId: string;
      inputVars?: Record<string, unknown>;
    };

    if (!config.workflowId) {
      throw new Error('run_workflow action requires workflowId');
    }

    if (!this.workflowEngine) {
      throw new Error('WorkflowEngine not configured');
    }

    await this.workflowEngine.execute(trigger.companyId, config.workflowId, config.inputVars ?? {});
  }

  private substituteVars(template: string, event: SystemEvent): string {
    return template.replace(/\{\{(\w+(?:\.\w+)*)\}\}/g, (match, path) => {
      const parts = path.split('.');
      let value: unknown = { event };
      for (const part of parts) {
        if (value && typeof value === 'object') {
          value = (value as Record<string, unknown>)[part];
        } else {
          return match;
        }
      }
      return value !== undefined && value !== null ? String(value) : match;
    });
  }

  async addTrigger(trigger: TriggerRecord): Promise<void> {
    this.activeTriggers.set(trigger.id, trigger);
  }

  async removeTrigger(triggerId: string): Promise<void> {
    this.activeTriggers.delete(triggerId);
    this.lastFireTimes.delete(triggerId);
  }
}
