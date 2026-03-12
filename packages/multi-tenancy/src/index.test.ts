import { describe, expect, it } from 'bun:test';
import { TenantDbRouter } from './db-router.js';
import { IsolationTester, type RequestFn, STANDARD_ENDPOINTS } from './isolation-tester.js';
import { TenantRateLimiter } from './rate-limiter.js';
import { DEFAULT_RATE_LIMITS } from './types.js';

// ---------------------------------------------------------------------------
// TenantRateLimiter tests
// ---------------------------------------------------------------------------
describe('TenantRateLimiter', () => {
  it('should allow requests within limits', () => {
    const limiter = new TenantRateLimiter();
    limiter.registerTenant({ tenantId: 't1', tier: 'business', dedicatedDb: null });

    const result = limiter.check('t1');
    expect(result.allowed).toBe(true);
    expect(result.remaining).toBeGreaterThan(0);
    expect(result.retryAfterMs).toBe(0);
  });

  it('should use free tier defaults for unknown tenants', () => {
    const limiter = new TenantRateLimiter();
    const config = limiter.getEffectiveConfig('unknown');
    expect(config.maxRequests).toBe(DEFAULT_RATE_LIMITS.free.maxRequests);
  });

  it('should apply tier-specific limits', () => {
    const limiter = new TenantRateLimiter();
    limiter.registerTenant({ tenantId: 't1', tier: 'enterprise', dedicatedDb: null });

    const config = limiter.getEffectiveConfig('t1');
    expect(config.maxRequests).toBe(DEFAULT_RATE_LIMITS.enterprise.maxRequests);
    expect(config.maxConcurrent).toBe(DEFAULT_RATE_LIMITS.enterprise.maxConcurrent);
  });

  it('should apply custom rate limit overrides', () => {
    const limiter = new TenantRateLimiter();
    limiter.registerTenant({
      tenantId: 't1',
      tier: 'starter',
      rateLimitOverride: { maxRequests: 999 },
      dedicatedDb: null,
    });

    const config = limiter.getEffectiveConfig('t1');
    expect(config.maxRequests).toBe(999);
    expect(config.windowMs).toBe(DEFAULT_RATE_LIMITS.starter.windowMs);
  });

  it('should exhaust tokens after many requests', () => {
    const limiter = new TenantRateLimiter();
    limiter.registerTenant({
      tenantId: 't1',
      tier: 'free',
      rateLimitOverride: { maxRequests: 5, burstAllowance: 0 },
      dedicatedDb: null,
    });

    for (let i = 0; i < 5; i++) {
      const r = limiter.check('t1');
      expect(r.allowed).toBe(true);
      limiter.release('t1');
    }

    const exhausted = limiter.check('t1');
    expect(exhausted.allowed).toBe(false);
    expect(exhausted.remaining).toBe(0);
    expect(exhausted.retryAfterMs).toBeGreaterThan(0);
  });

  it('should enforce concurrent request limits', () => {
    const limiter = new TenantRateLimiter();
    limiter.registerTenant({
      tenantId: 't1',
      tier: 'free',
      rateLimitOverride: { maxConcurrent: 2, maxRequests: 100, burstAllowance: 0 },
      dedicatedDb: null,
    });

    const r1 = limiter.check('t1');
    expect(r1.allowed).toBe(true);
    const r2 = limiter.check('t1');
    expect(r2.allowed).toBe(true);

    // Third concurrent request should be blocked
    const r3 = limiter.check('t1');
    expect(r3.allowed).toBe(false);

    // Release one, now it should work
    limiter.release('t1');
    const r4 = limiter.check('t1');
    expect(r4.allowed).toBe(true);
  });

  it('should track stats', () => {
    const limiter = new TenantRateLimiter();
    limiter.registerTenant({ tenantId: 't1', tier: 'business', dedicatedDb: null });

    expect(limiter.getStats('t1')).toBeNull();

    limiter.check('t1');
    const stats = limiter.getStats('t1');
    expect(stats).not.toBeNull();
    expect(stats!.concurrent).toBe(1);
    expect(stats!.remaining).toBeGreaterThan(0);
  });

  it('should remove tenants', () => {
    const limiter = new TenantRateLimiter();
    limiter.registerTenant({ tenantId: 't1', tier: 'free', dedicatedDb: null });
    limiter.check('t1');

    limiter.removeTenant('t1');
    expect(limiter.getStats('t1')).toBeNull();
    // Should fall back to free tier
    expect(limiter.getEffectiveConfig('t1').maxRequests).toBe(DEFAULT_RATE_LIMITS.free.maxRequests);
  });

  it('should cleanup stale buckets', async () => {
    const limiter = new TenantRateLimiter();
    limiter.registerTenant({ tenantId: 't1', tier: 'free', dedicatedDb: null });
    limiter.check('t1');
    limiter.release('t1');

    // Wait a tick so lastRefill is in the past
    await new Promise((r) => setTimeout(r, 10));

    // Cleanup with 5ms idle threshold should remove the bucket
    const removed = limiter.cleanup(5);
    expect(removed).toBe(1);
    expect(limiter.getStats('t1')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// IsolationTester tests
// ---------------------------------------------------------------------------
describe('IsolationTester', () => {
  it('should initialize with standard endpoints', () => {
    const tester = new IsolationTester();
    expect(tester.getEndpoints().length).toBe(STANDARD_ENDPOINTS.length);
    expect(tester.getEndpoints().length).toBeGreaterThan(0);
  });

  it('should accept custom endpoints', () => {
    const tester = new IsolationTester([
      {
        method: 'GET',
        pathPattern: '/api/custom/:companyId',
        description: 'Custom',
        returnsList: true,
      },
    ]);
    expect(tester.getEndpoints()).toHaveLength(1);
  });

  it('should pass when no cross-tenant data found', async () => {
    const mockRequest: RequestFn = async (_method, _url) => ({
      status: 200,
      body: { data: [{ companyId: 'tenant-b', name: 'item' }] },
    });

    const tester = new IsolationTester([
      {
        method: 'GET',
        pathPattern: '/api/companies/:companyId/agents',
        description: 'List agents',
        returnsList: true,
      },
    ]);

    const result = await tester.testEndpoint(
      tester.getEndpoints()[0]!,
      'tenant-a',
      'tenant-b',
      mockRequest,
    );
    expect(result.passed).toBe(true);
  });

  it('should fail when cross-tenant data is leaked', async () => {
    const mockRequest: RequestFn = async (_method, url) => {
      if (url.includes('tenant-b')) {
        return {
          status: 200,
          body: { data: [{ companyId: 'tenant-a', name: 'LEAKED' }] },
        };
      }
      return { status: 200, body: { data: [{ companyId: 'tenant-a', name: 'ok' }] } };
    };

    const tester = new IsolationTester([
      {
        method: 'GET',
        pathPattern: '/api/companies/:companyId/agents',
        description: 'List agents',
        returnsList: true,
      },
    ]);

    const result = await tester.testEndpoint(
      tester.getEndpoints()[0]!,
      'tenant-a',
      'tenant-b',
      mockRequest,
    );
    expect(result.passed).toBe(false);
    expect(result.error).toContain('leak');
  });

  it('should pass when tenant A gets 4xx', async () => {
    const mockRequest: RequestFn = async () => ({
      status: 403,
      body: { error: 'Forbidden' },
    });

    const tester = new IsolationTester([
      {
        method: 'GET',
        pathPattern: '/api/companies/:companyId/agents',
        description: 'List agents',
        returnsList: true,
      },
    ]);

    const result = await tester.testEndpoint(
      tester.getEndpoints()[0]!,
      'tenant-a',
      'tenant-b',
      mockRequest,
    );
    expect(result.passed).toBe(true);
  });

  it('should run a full audit', async () => {
    const mockRequest: RequestFn = async () => ({
      status: 200,
      body: { data: [] },
    });

    const tester = new IsolationTester([
      {
        method: 'GET',
        pathPattern: '/api/companies/:companyId/agents',
        description: 'Agents',
        returnsList: true,
      },
      {
        method: 'GET',
        pathPattern: '/api/companies/:companyId/goals',
        description: 'Goals',
        returnsList: true,
      },
    ]);

    const audit = await tester.runAudit('tenant-a', 'tenant-b', mockRequest);
    expect(audit.passed).toBe(true);
    expect(audit.totalTests).toBe(2);
    expect(audit.passedTests).toBe(2);
    expect(audit.failedTests).toBe(0);
    expect(audit.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('should catch request errors gracefully', async () => {
    const mockRequest: RequestFn = async () => {
      throw new Error('Network failure');
    };

    const tester = new IsolationTester([
      {
        method: 'GET',
        pathPattern: '/api/companies/:companyId/agents',
        description: 'Agents',
        returnsList: true,
      },
    ]);

    const result = await tester.testEndpoint(
      tester.getEndpoints()[0]!,
      'tenant-a',
      'tenant-b',
      mockRequest,
    );
    expect(result.passed).toBe(false);
    expect(result.error).toContain('Network failure');
  });
});

// ---------------------------------------------------------------------------
// TenantDbRouter tests
// ---------------------------------------------------------------------------
describe('TenantDbRouter', () => {
  it('should resolve to shared database by default', () => {
    const router = new TenantDbRouter('postgres://shared:5432/clawgear');
    const conn = router.resolve('any-tenant');
    expect(conn.isShared).toBe(true);
    expect(conn.connectionString).toBe('postgres://shared:5432/clawgear');
  });

  it('should resolve to dedicated database for whale tenants', () => {
    const router = new TenantDbRouter('postgres://shared:5432/clawgear');
    router.registerTenant({
      tenantId: 'whale-1',
      tier: 'whale',
      dedicatedDb: {
        connectionString: 'postgres://whale1:5432/whale1_db',
        readOnly: false,
        poolSize: 50,
      },
    });

    const conn = router.resolve('whale-1');
    expect(conn.isShared).toBe(false);
    expect(conn.connectionString).toBe('postgres://whale1:5432/whale1_db');
    expect(conn.poolSize).toBe(50);
  });

  it('should fall back to shared for tenants without dedicated DB', () => {
    const router = new TenantDbRouter('postgres://shared:5432/clawgear');
    router.registerTenant({
      tenantId: 'standard-1',
      tier: 'business',
      dedicatedDb: null,
    });

    const conn = router.resolve('standard-1');
    expect(conn.isShared).toBe(true);
  });

  it('should check dedicated DB existence', () => {
    const router = new TenantDbRouter('postgres://shared:5432/clawgear');
    router.registerTenant({
      tenantId: 'whale-1',
      tier: 'whale',
      dedicatedDb: {
        connectionString: 'postgres://whale1:5432/db',
        readOnly: false,
        poolSize: 10,
      },
    });

    expect(router.hasDedicatedDb('whale-1')).toBe(true);
    expect(router.hasDedicatedDb('other')).toBe(false);
  });

  it('should migrate tenant to dedicated database', () => {
    const router = new TenantDbRouter('postgres://shared:5432/clawgear');
    router.registerTenant({ tenantId: 't1', tier: 'enterprise', dedicatedDb: null });

    expect(router.hasDedicatedDb('t1')).toBe(false);

    const conn = router.migrateToDedicated('t1', {
      connectionString: 'postgres://t1:5432/t1_db',
      readOnly: false,
      poolSize: 30,
    });

    expect(conn.isShared).toBe(false);
    expect(router.hasDedicatedDb('t1')).toBe(true);
    expect(router.resolve('t1').connectionString).toBe('postgres://t1:5432/t1_db');
  });

  it('should migrate tenant back to shared database', () => {
    const router = new TenantDbRouter('postgres://shared:5432/clawgear');
    router.registerTenant({
      tenantId: 't1',
      tier: 'whale',
      dedicatedDb: {
        connectionString: 'postgres://t1:5432/t1_db',
        readOnly: false,
        poolSize: 10,
      },
    });

    expect(router.hasDedicatedDb('t1')).toBe(true);
    router.migrateToShared('t1');
    expect(router.hasDedicatedDb('t1')).toBe(false);
    expect(router.resolve('t1').isShared).toBe(true);
  });

  it('should remove tenants', () => {
    const router = new TenantDbRouter('postgres://shared:5432/clawgear');
    router.registerTenant({
      tenantId: 't1',
      tier: 'whale',
      dedicatedDb: {
        connectionString: 'postgres://t1:5432/db',
        readOnly: false,
        poolSize: 10,
      },
    });

    router.removeTenant('t1');
    expect(router.hasDedicatedDb('t1')).toBe(false);
    expect(router.getTenantConfig('t1')).toBeUndefined();
  });

  it('should track tenant and dedicated DB counts', () => {
    const router = new TenantDbRouter('postgres://shared:5432/clawgear');
    router.registerTenant({
      tenantId: 'w1',
      tier: 'whale',
      dedicatedDb: { connectionString: 'pg://w1', readOnly: false, poolSize: 10 },
    });
    router.registerTenant({ tenantId: 's1', tier: 'starter', dedicatedDb: null });
    router.registerTenant({ tenantId: 's2', tier: 'business', dedicatedDb: null });

    expect(router.getTenantIds()).toHaveLength(3);
    expect(router.getDedicatedDbCount()).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Default rate limits
// ---------------------------------------------------------------------------
describe('DEFAULT_RATE_LIMITS', () => {
  it('should have increasing limits per tier', () => {
    expect(DEFAULT_RATE_LIMITS.free.maxRequests).toBeLessThan(
      DEFAULT_RATE_LIMITS.starter.maxRequests,
    );
    expect(DEFAULT_RATE_LIMITS.starter.maxRequests).toBeLessThan(
      DEFAULT_RATE_LIMITS.business.maxRequests,
    );
    expect(DEFAULT_RATE_LIMITS.business.maxRequests).toBeLessThan(
      DEFAULT_RATE_LIMITS.enterprise.maxRequests,
    );
    expect(DEFAULT_RATE_LIMITS.enterprise.maxRequests).toBeLessThan(
      DEFAULT_RATE_LIMITS.whale.maxRequests,
    );
  });

  it('should have whale tier with unlimited concurrent', () => {
    expect(DEFAULT_RATE_LIMITS.whale.maxConcurrent).toBe(0);
  });
});
