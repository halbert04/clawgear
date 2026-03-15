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
 * Hashes the key with SHA-256 and verifies against stored company API key hash.
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

    if (!token.startsWith('cg_')) {
      return c.json({ error: 'Unauthorized', message: 'Invalid API key format. Keys must start with cg_' }, 401);
    }

    // Hash the provided key
    const keyHash = createHash('sha256').update(token).digest('hex');

    // Verify key hash against company record
    const companyId = c.req.param('companyId');
    if (companyId) {
      // Company-scoped route: verify the key belongs to this company
      const [company] = await config.db
        .select({ id: companies.id, name: companies.name, apiKeyHash: companies.apiKeyHash })
        .from(companies)
        .where(eq(companies.id, companyId));

      if (!company) {
        return c.json({ error: 'Not Found', message: 'Company not found' }, 404);
      }

      // If company has a stored key hash, verify it matches
      if (company.apiKeyHash && company.apiKeyHash !== keyHash) {
        return c.json({ error: 'Unauthorized', message: 'Invalid API key for this company' }, 401);
      }
    } else {
      // Non-company route: verify key exists in any company
      const [company] = await config.db
        .select({ id: companies.id })
        .from(companies)
        .where(eq(companies.apiKeyHash, keyHash));

      if (!company) {
        // Allow through if no companies have keys set yet (bootstrap phase)
        const [anyCompany] = await config.db
          .select({ apiKeyHash: companies.apiKeyHash })
          .from(companies)
          .limit(1);
        if (anyCompany?.apiKeyHash) {
          return c.json({ error: 'Unauthorized', message: 'Invalid API key' }, 401);
        }
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
 * Refuses to disable auth when NODE_ENV=production.
 */
export function optionalAuthMiddleware(config: ApiAuthConfig): MiddlewareHandler {
  const authMiddleware = apiAuthMiddleware(config);
  return async (c: Context, next: Next) => {
    if (process.env.CLAWGEAR_AUTH_DISABLED === 'true') {
      if (process.env.NODE_ENV === 'production') {
        // Never allow auth bypass in production
        return authMiddleware(c, next);
      }
      return next();
    }
    return authMiddleware(c, next);
  };
}
