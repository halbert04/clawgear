import type { Database } from '@clawgear/db';
import type { InProcessEventBus } from '@clawgear/kernel';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { errorHandler } from './middleware/error-handler.js';
import { requestLogger } from './middleware/logger.js';
import { healthRoutes } from './routes/health.js';

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

  // Health check routes
  app.route('/api/health', healthRoutes(deps.db));

  // Placeholder for future routes
  app.get('/api', (c) => {
    return c.json({
      name: 'ClawGear API',
      version: '0.1.0',
      docs: '/api/health',
    });
  });

  return app;
}
