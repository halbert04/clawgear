import type { Database } from '@clawgear/db';
import { sql } from 'drizzle-orm';
import { Hono } from 'hono';

const VERSION = '0.1.0';
const startTime = Date.now();

export function healthRoutes(db: Database) {
  const app = new Hono();

  app.get('/', (c) => {
    return c.json({
      status: 'ok',
      version: VERSION,
      uptime: Math.floor((Date.now() - startTime) / 1000),
    });
  });

  app.get('/detail', async (c) => {
    let dbConnected = false;
    let dbLatencyMs = 0;

    try {
      const start = performance.now();
      await db.execute(sql`SELECT 1`);
      dbLatencyMs = Math.round(performance.now() - start);
      dbConnected = true;
    } catch {
      dbConnected = false;
    }

    const status = dbConnected ? 'ok' : 'degraded';

    return c.json({
      status,
      version: VERSION,
      uptime: Math.floor((Date.now() - startTime) / 1000),
      database: {
        connected: dbConnected,
        latencyMs: dbLatencyMs,
      },
      instanceId: process.env.CLAWGEAR_INSTANCE_ID ?? 'unknown',
    });
  });

  return app;
}
