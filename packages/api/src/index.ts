import { ClaudeCodeAdapter } from '@clawgear/adapter-claude-code';
import { HandAdapter } from '@clawgear/adapter-hand';
import { createConnection } from '@clawgear/db';
import { agents, costEvents } from '@clawgear/db/pg';
import { logger } from '@clawgear/shared/logger';

// ============================================================
// ENVIRONMENT VALIDATION (fail fast)
// ============================================================

const requiredEnvVars = ['DATABASE_URL'] as const;
const optionalButWarned = ['ANTHROPIC_API_KEY'] as const;

for (const envVar of requiredEnvVars) {
  if (!process.env[envVar]) {
    logger.fatal(`Missing required environment variable: ${envVar}`);
    process.exit(1);
  }
}

for (const envVar of optionalButWarned) {
  if (!process.env[envVar]) {
    logger.warn(`Missing environment variable: ${envVar} — adapter will fail at runtime`);
  }
}

import {
  HandScheduler,
  HeartbeatEngine,
  HeartbeatScheduler,
  InProcessEventBus,
  PostHeartbeatHook,
  StaleRunReaper,
  TaskRouter,
  TriggerEngine,
  WakeHandler,
  WorkflowEngine,
} from '@clawgear/kernel';
import { CompetenceTracker, LessonStore } from '@clawgear/learning';
import { AdapterRegistry } from '@clawgear/runtime';
import { EnhancedSecurityGate } from '@clawgear/security';
import type { BudgetStatus, KernelHandle } from '@clawgear/shared/interfaces';
import type { Capability, CostEvent } from '@clawgear/shared/types';
import { eq, sql } from 'drizzle-orm';
import { createApp, websocket } from './app.js';

const port = Number(process.env.CLAWGEAR_PORT ?? 3000);
const host = process.env.CLAWGEAR_HOST ?? '0.0.0.0';

const { db, client } = createConnection();
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

// Learning + competence pipeline
const lessonStore = new LessonStore({ db });
const competenceTracker = new CompetenceTracker({ db });
const taskRouter = new TaskRouter({ db });

// Heartbeat engine (with lesson store for context enrichment)
const heartbeatEngine = new HeartbeatEngine({
  db,
  eventBus,
  adapterRegistry,
  kernelHandle,
  lessonStore,
  securityGate,
});

// Register adapters
const handAdapter = new HandAdapter({ adapterRegistry, db, eventBus });
adapterRegistry.register(handAdapter);

const claudeCodeAdapter = new ClaudeCodeAdapter();
adapterRegistry.register(claudeCodeAdapter);

// Post-heartbeat pipeline: quality eval → lesson extraction → competence update → task routing
const postHeartbeatHook = new PostHeartbeatHook({
  db,
  eventBus,
  competenceTracker,
  lessonStore,
  taskRouter,
});
postHeartbeatHook.register();

// Scheduler + wake handler
const scheduler = new HeartbeatScheduler({ db, heartbeatEngine });
const wakeHandler = new WakeHandler({ eventBus, heartbeatEngine });

// Hand scheduler (cron-based, separate from heartbeat scheduler)
const handScheduler = new HandScheduler({ db, heartbeatEngine, eventBus });

// Workflow engine
const workflowEngine = new WorkflowEngine({ db, eventBus, heartbeatEngine });

// Trigger engine (reactive automation)
const triggerEngine = new TriggerEngine({ db, eventBus, heartbeatEngine });
triggerEngine.setWorkflowEngine(workflowEngine);

// Stale run reaper (cleans up stuck runs)
const staleRunReaper = new StaleRunReaper({ db, eventBus });

const app = createApp({
  db,
  eventBus,
  heartbeatEngine,
  handScheduler,
  triggerEngine,
  workflowEngine,
});

// Start scheduler and wake handler
scheduler.start().catch((err) => {
  logger.error('Failed to start scheduler', { error: (err as Error).message });
});
wakeHandler.start();
handScheduler.start().catch((err) => {
  logger.error('Failed to start hand scheduler', { error: (err as Error).message });
});
triggerEngine.start().catch((err) => {
  logger.error('Failed to start trigger engine', { error: (err as Error).message });
});
staleRunReaper.start();

// Graceful shutdown
let isShuttingDown = false;

async function shutdown(signal: string) {
  if (isShuttingDown) return;
  isShuttingDown = true;

  logger.info(`Received ${signal}, shutting down gracefully`);

  // Stop accepting new work
  scheduler.stop();
  wakeHandler.stop();
  handScheduler.stop();
  triggerEngine.stop();
  staleRunReaper.stop();

  // Allow in-flight requests to drain (5s grace period)
  await new Promise((resolve) => setTimeout(resolve, 5000));

  // Close database connection
  await client.end();

  logger.info('Shutdown complete');
  process.exit(0);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

logger.info(`ClawGear API starting on ${host}:${port}`);

export default {
  port,
  hostname: host,
  fetch: app.fetch,
  websocket,
};

export { createApp } from './app.js';
