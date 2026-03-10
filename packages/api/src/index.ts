import { HandAdapter } from '@clawgear/adapter-hand';
import { createConnection } from '@clawgear/db';
import { agents, costEvents } from '@clawgear/db/pg';
import {
  HandScheduler,
  HeartbeatEngine,
  HeartbeatScheduler,
  InProcessEventBus,
  WakeHandler,
} from '@clawgear/kernel';
import { AdapterRegistry } from '@clawgear/runtime';
import { EnhancedSecurityGate } from '@clawgear/security';
import type { BudgetStatus, KernelHandle } from '@clawgear/shared/interfaces';
import type { Capability, CostEvent } from '@clawgear/shared/types';
import { eq, sql } from 'drizzle-orm';
import { createApp, websocket } from './app.js';

const port = Number(process.env.CLAWGEAR_PORT ?? 3000);
const host = process.env.CLAWGEAR_HOST ?? '0.0.0.0';

const { db } = createConnection();
const eventBus = new InProcessEventBus();

// Adapter registry (adapters registered lazily on first use or at boot)
const adapterRegistry = new AdapterRegistry();

// Security gate with RBAC capability enforcement
const securityGate = new EnhancedSecurityGate({
  async getAgentCapabilities(agentId: string): Promise<Capability[]> {
    const [agent] = await db
      .select({ capabilities: agents.capabilities })
      .from(agents)
      .where(eq(agents.id, agentId));
    return (agent?.capabilities as Capability[]) ?? [];
  },
  eventBus,
  async getAgentCompanyId(agentId: string): Promise<string> {
    const [agent] = await db
      .select({ companyId: agents.companyId })
      .from(agents)
      .where(eq(agents.id, agentId));
    return agent?.companyId ?? 'unknown';
  },
});

// Kernel handle: budget checking + capability enforcement + cost recording
const kernelHandle: KernelHandle = {
  async checkBudget(agentId: string): Promise<BudgetStatus> {
    const [agent] = await db.select().from(agents).where(eq(agents.id, agentId));
    if (!agent) {
      return {
        budgetCents: 0n,
        spentCents: 0n,
        remainingCents: 0n,
        percentUsed: 0,
        isExhausted: true,
        isWarning: false,
      };
    }
    const budget = agent.budgetMonthlyCents;
    const spent = agent.spentMonthlyCents;
    const remaining = budget - spent;
    const percentUsed = budget > 0n ? Number(spent) / Number(budget) : 0;
    return {
      budgetCents: budget,
      spentCents: spent,
      remainingCents: remaining > 0n ? remaining : 0n,
      percentUsed,
      isExhausted: budget > 0n && remaining <= 0n,
      isWarning: percentUsed >= 0.8,
    };
  },
  async checkCapability(agentId: string, capability: Capability) {
    return securityGate.validateToolCall(agentId, capability.type, capability);
  },
  emitEvent(event) {
    eventBus.emit(event);
  },
  async recordCost(event: Omit<CostEvent, 'id' | 'occurredAt'>) {
    await db.insert(costEvents).values({
      companyId: event.companyId,
      agentId: event.agentId,
      issueId: event.issueId,
      projectId: event.projectId,
      goalId: event.goalId,
      provider: event.provider,
      model: event.model,
      inputTokens: event.inputTokens,
      outputTokens: event.outputTokens,
      costCents: event.costCents,
      billingCode: event.billingCode,
    });
    // Also update agent's spent counter
    await db
      .update(agents)
      .set({
        spentMonthlyCents: sql`${agents.spentMonthlyCents} + ${event.costCents}`,
      })
      .where(eq(agents.id, event.agentId));
  },
};

// Heartbeat engine
const heartbeatEngine = new HeartbeatEngine({
  db,
  eventBus,
  adapterRegistry,
  kernelHandle,
});

// Register HandAdapter
const handAdapter = new HandAdapter({ adapterRegistry, db, eventBus });
adapterRegistry.register(handAdapter);

// Scheduler + wake handler
const scheduler = new HeartbeatScheduler({ db, heartbeatEngine });
const wakeHandler = new WakeHandler({ eventBus, heartbeatEngine });

// Hand scheduler (cron-based, separate from heartbeat scheduler)
const handScheduler = new HandScheduler({ db, heartbeatEngine, eventBus });

const app = createApp({ db, eventBus, heartbeatEngine, handScheduler });

// Start scheduler and wake handler
scheduler.start().catch((err) => {
  console.error('Failed to start scheduler:', err);
});
wakeHandler.start();
handScheduler.start().catch((err) => {
  console.error('Failed to start hand scheduler:', err);
});

console.log(
  JSON.stringify({
    level: 'INFO',
    message: `ClawGear API starting on ${host}:${port}`,
    timestamp: new Date().toISOString(),
  }),
);

export default {
  port,
  hostname: host,
  fetch: app.fetch,
  websocket,
};

export { createApp } from './app.js';
