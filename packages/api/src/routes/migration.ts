import type { PersistResult } from '@clawgear/migration';
import { migrate, persist } from '@clawgear/migration';
import { Hono } from 'hono';
import type { AppDeps } from '../app.js';
import { badRequest } from '../lib/errors.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function migrationRoutes(deps: AppDeps) {
  const { db } = deps;
  const app = new Hono();

  // POST /api/migration/openclaw
  app.post('/openclaw', async (c) => {
    const body = await c.req.json<{
      data: unknown;
      companyId: string;
      dryRun?: boolean;
    }>();

    if (!body.data) throw badRequest('data is required');
    if (!body.companyId) throw badRequest('companyId is required');
    if (!UUID_RE.test(body.companyId)) throw badRequest('companyId must be a valid UUID');

    const dryRun = body.dryRun ?? false;

    const { report, transformed } = migrate({
      source: 'openclaw',
      companyId: body.companyId,
      data: body.data,
      dryRun,
    });

    if (dryRun || report.status === 'failed') {
      return c.json({ report }, report.status === 'failed' ? 422 : 200);
    }

    let persistResult: PersistResult;
    try {
      persistResult = await persist(db, transformed, body.companyId, {
        verify: true,
      });
    } catch (err) {
      report.persistence = {
        inserted: {},
        skipped: {},
        errors: [
          {
            entityType: 'migration',
            entityId: body.companyId,
            message: `Persistence failed: ${String(err)}`,
            severity: 'error',
          },
        ],
        verified: {},
      };
      return c.json({ report }, 500);
    }

    report.persistence = persistResult;
    return c.json({ report }, persistResult.errors.length > 0 ? 207 : 200);
  });

  return app;
}
