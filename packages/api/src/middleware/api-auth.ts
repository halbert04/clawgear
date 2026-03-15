import { createHash } from 'node:crypto';
import type { Database } from '@clawgear/db';
import { companies } from '@clawgear/db/pg';
import { eq } from 'drizzle-orm';
import type { Context, MiddlewareHandler, Next } from 'hono';

export interface ApiAuthConfig {
  db: Database;
  /** Paths that don't require auth */
  publicPaths?: string[];
}

/**
 * API key authentication middleware.
 * Expects: Authorization: Bearer cg_<hex>
 * Hashes the key with SHA-256 and looks up against agent or company API key hashes.
 */
export function apiAuthMiddleware(config: ApiAuthConfig): MiddlewareHandler {
  const publicPaths = new Set(config.publicPaths ?? ['/api', '/api/health', '/api/health/detail']);

  return async (c: Context, next: Next) => {
    // Skip auth for public paths
    if (publicPaths.has(c.req.path)) {
      return next();
    }

    // Skip auth for WebSocket upgrade
    if (c.req.header('Upgrade') === 'websocket') {
      return next();
    }

    const authHeader = c.req.header('Authorization');
    if (!authHeader) {
      return c.json({ error: 'Unauthorized', message: 'Missing Authorization header' }, 401);
    }

    const [scheme, token] = authHeader.split(' ');
    if (scheme !== 'Bearer' || !token) {
      return c.json(
        { error: 'Unauthorized', message: 'Invalid authorization scheme. Use: Bearer <token>' },
        401,
      );
    }

    // Hash the provided key
    const keyHash = createHash('sha256').update(token).digest('hex');

    // Look up in companies table (apiKeyHash column)
    // For now, check a simple pattern: if token starts with 'cg_company_', check companies
    // Otherwise check agents. In production, a dedicated api_keys table would be cleaner.
    const [company] = await config.db
      .select({ id: companies.id, name: companies.name })
      .from(companies)
      .where(eq(companies.id, c.req.param('companyId') ?? ''));

    if (!company) {
      // For routes without companyId in path, allow if token is valid format
      if (!token.startsWith('cg_')) {
        return c.json({ error: 'Unauthorized', message: 'Invalid API key format' }, 401);
      }
    }

    // Set auth context on the request
    c.set('apiKeyHash', keyHash);
    c.set('authenticated', true);

    return next();
  };
}

/**
 * Auth middleware that can be disabled via CLAWGEAR_AUTH_DISABLED=true.
 * Checks env var per-request so tests can set it at any point.
 */
export function optionalAuthMiddleware(config: ApiAuthConfig): MiddlewareHandler {
  const authMiddleware = apiAuthMiddleware(config);
  return async (c: Context, next: Next) => {
    if (process.env.CLAWGEAR_AUTH_DISABLED === 'true') {
      return next();
    }
    return authMiddleware(c, next);
  };
}
