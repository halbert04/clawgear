import type { Database } from '@clawgear/db';
import { sql } from 'drizzle-orm';
import type { MiddlewareHandler } from 'hono';

/**
 * Sets the PostgreSQL session variable `app.current_company_id`
 * for Row-Level Security enforcement.
 */
export function companyScopeMiddleware(db: Database): MiddlewareHandler {
  return async (c, next) => {
    const companyId = c.req.param('companyId');
    if (companyId) {
      await db.execute(sql`SELECT set_config('app.current_company_id', ${companyId}, true)`);
    }
    await next();
  };
}
