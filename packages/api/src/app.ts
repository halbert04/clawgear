import type { Database } from '@clawgear/db';
import type { InProcessEventBus } from '@clawgear/kernel';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { errorHandler } from './middleware/error-handler.js';
import { requestLogger } from './middleware/logger.js';
import { activityRoutes } from './routes/activity.js';
import { agentRoutes } from './routes/agents.js';
import { approvalRoutes } from './routes/approvals.js';
import { budgetRoutes } from './routes/budget.js';
import { companyRoutes } from './routes/companies.js';
import { goalRoutes } from './routes/goals.js';
import { healthRoutes } from './routes/health.js';
import { issueRoutes } from './routes/issues.js';
import { projectRoutes } from './routes/projects.js';
import { qualityRoutes } from './routes/quality.js';

export interface AppDeps {
  db: Database;
  eventBus: InProcessEventBus;
}

export function createApp(deps: AppDeps) {
  const app = new Hono();

  // Global middleware
  app.use('*', cors());
  app.use('*', requestLogger);
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
  app.route('/api/companies/:companyId/quality', qualityRoutes(deps));

  app.get('/api', (c) => {
    return c.json({
      name: 'ClawGear API',
      version: '0.1.0',
      docs: '/api/health',
    });
  });

  return app;
}
