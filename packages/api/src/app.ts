import type { Database } from '@clawgear/db';
import type {
  ChannelRouter,
  HandScheduler,
  HeartbeatEngine,
  InProcessEventBus,
  TriggerEngine,
  WorkflowEngine,
} from '@clawgear/kernel';
import { Hono } from 'hono';
import { createBunWebSocket } from 'hono/bun';
import { cors } from 'hono/cors';
import { optionalAuthMiddleware } from './middleware/api-auth.js';
import { companyScopeMiddleware } from './middleware/company-scope.js';
import { errorHandler } from './middleware/error-handler.js';
import { requestLogger } from './middleware/logger.js';
import { rateLimiterMiddleware } from './middleware/rate-limiter.js';
import { securityHeaders } from './middleware/security-headers.js';
import { activityRoutes } from './routes/activity.js';
import { agentRoutes } from './routes/agents.js';
import { approvalRoutes } from './routes/approvals.js';
import { auditRoutes } from './routes/audit.js';
import { budgetRoutes } from './routes/budget.js';
import { channelBindingRoutes } from './routes/channel-bindings.js';
import { companyRoutes } from './routes/companies.js';
import { conversationRoutes } from './routes/conversations.js';
import { evolutionRoutes } from './routes/evolution.js';
import { factRoutes } from './routes/facts.js';
import { goalRoutes } from './routes/goals.js';
import { handRoutes } from './routes/hands.js';
import { healthRoutes } from './routes/health.js';
import { heartbeatRoutes } from './routes/heartbeats.js';
import { issueRoutes } from './routes/issues.js';
import { marketplaceRoutes } from './routes/marketplace.js';
import { memoryRoutes } from './routes/memory.js';
import { projectRoutes } from './routes/projects.js';
import { qualityRoutes } from './routes/quality.js';
import { triggerRoutes } from './routes/triggers.js';
import { workflowRoutes, workflowRunRoutes } from './routes/workflows.js';
import { EventBridge } from './ws/event-bridge.js';

export interface AppDeps {
  db: Database;
  eventBus: InProcessEventBus;
  heartbeatEngine?: HeartbeatEngine;
  channelRouter?: ChannelRouter;
  handScheduler?: HandScheduler;
  triggerEngine?: TriggerEngine;
  workflowEngine?: WorkflowEngine;
}

const { upgradeWebSocket, websocket } = createBunWebSocket();

export { websocket };

export function createApp(deps: AppDeps) {
  const app = new Hono();
  const eventBridge = new EventBridge(deps.eventBus);

  // Global middleware
  app.use('*', cors());
  app.use('*', securityHeaders);
  app.use('*', requestLogger);
  app.use('*', rateLimiterMiddleware({ maxRequests: 100, windowMs: 60_000 }));
  app.use('*', optionalAuthMiddleware({ db: deps.db }));
  app.use('/api/companies/:companyId/*', companyScopeMiddleware(deps.db));
  app.onError(errorHandler);

  // Routes
  app.route('/api/health', healthRoutes(deps.db));
  app.route('/api/companies', companyRoutes(deps));
  app.route('/api/companies/:companyId/agents', agentRoutes(deps));
  app.route('/api/companies/:companyId/goals', goalRoutes(deps));
  app.route('/api/companies/:companyId/projects', projectRoutes(deps));
  app.route('/api/companies/:companyId/issues', issueRoutes(deps));
  app.route('/api/companies/:companyId/budget', budgetRoutes(deps));
  app.route('/api/companies/:companyId/approvals', approvalRoutes(deps));
  app.route('/api/companies/:companyId/activity', activityRoutes(deps));
  app.route('/api/companies/:companyId/audit', auditRoutes(deps));
  app.route('/api/companies/:companyId/quality', qualityRoutes(deps));
  app.route('/api/companies/:companyId/facts', factRoutes(deps));
  app.route('/api/companies/:companyId/memory', memoryRoutes(deps));
  app.route('/api/companies/:companyId/conversations', conversationRoutes(deps));
  app.route('/api/companies/:companyId/channel-bindings', channelBindingRoutes(deps));
  app.route('/api/companies/:companyId/hands', handRoutes(deps));
  app.route('/api/companies/:companyId/evolution', evolutionRoutes(deps));
  app.route('/api/companies/:companyId/triggers', triggerRoutes(deps));
  app.route('/api/companies/:companyId/workflows', workflowRoutes(deps));
  app.route('/api/companies/:companyId/workflow-runs', workflowRunRoutes(deps));
  app.route('/api/companies/:companyId/marketplace', marketplaceRoutes(deps));

  // Heartbeat routes (requires heartbeat engine)
  if (deps.heartbeatEngine) {
    app.route(
      '/api/companies/:companyId/agents/:agentId/heartbeats',
      heartbeatRoutes({ ...deps, heartbeatEngine: deps.heartbeatEngine }),
    );
  }

  // WebSocket event bridge (JSON-RPC gateway)
  app.get(
    '/api/ws',
    upgradeWebSocket(() => ({
      onOpen(_evt, ws) {
        eventBridge.addClient(ws);
      },
      onMessage(evt, ws) {
        const data = typeof evt.data === 'string' ? evt.data : '';
        eventBridge.handleMessage(ws, data);
      },
      onClose(_evt, ws) {
        eventBridge.removeClient(ws);
      },
    })),
  );

  app.get('/api', (c) => {
    return c.json({
      name: 'ClawGear API',
      version: '0.1.0',
      docs: '/api/health',
    });
  });

  return app;
}
