/**
 * Types for multi-tenancy hardening.
 * Tenant isolation, per-tenant rate limiting, and database-per-tenant routing.
 */

/** Tenant tier determines resource limits */
export type TenantTier = 'free' | 'starter' | 'business' | 'enterprise' | 'whale';

/** Per-tenant rate limit configuration */
export interface TenantRateLimitConfig {
  /** Max requests per window */
  maxRequests: number;
  /** Window duration in ms */
  windowMs: number;
  /** Max concurrent requests (0 = unlimited) */
  maxConcurrent: number;
  /** Burst allowance above maxRequests for short spikes */
  burstAllowance: number;
}

/** Default rate limits per tier */
export const DEFAULT_RATE_LIMITS: Record<TenantTier, TenantRateLimitConfig> = {
  free: { maxRequests: 100, windowMs: 60_000, maxConcurrent: 5, burstAllowance: 10 },
  starter: { maxRequests: 500, windowMs: 60_000, maxConcurrent: 20, burstAllowance: 50 },
  business: { maxRequests: 2_000, windowMs: 60_000, maxConcurrent: 50, burstAllowance: 200 },
  enterprise: { maxRequests: 10_000, windowMs: 60_000, maxConcurrent: 200, burstAllowance: 1_000 },
  whale: { maxRequests: 50_000, windowMs: 60_000, maxConcurrent: 0, burstAllowance: 5_000 },
};

/** Configuration for a tenant */
export interface TenantConfig {
  /** Company/tenant ID */
  tenantId: string;
  /** Tenant tier */
  tier: TenantTier;
  /** Custom rate limit overrides (optional) */
  rateLimitOverride?: Partial<TenantRateLimitConfig>;
  /** Database routing config (null = shared database) */
  dedicatedDb: TenantDbConfig | null;
}

/** Database-per-tenant configuration */
export interface TenantDbConfig {
  /** Connection string for the dedicated database */
  connectionString: string;
  /** Whether this is a read replica */
  readOnly: boolean;
  /** Pool size for this tenant's connection */
  poolSize: number;
}

/** Result of a tenant isolation test */
export interface IsolationTestResult {
  /** Whether the test passed */
  passed: boolean;
  /** Endpoint tested */
  endpoint: string;
  /** Test description */
  description: string;
  /** Error details if failed */
  error: string | null;
}

/** Result of a full isolation audit */
export interface IsolationAuditResult {
  /** Overall pass/fail */
  passed: boolean;
  /** Total tests run */
  totalTests: number;
  /** Tests that passed */
  passedTests: number;
  /** Tests that failed */
  failedTests: number;
  /** Individual test results */
  results: IsolationTestResult[];
  /** Duration of the audit in ms */
  durationMs: number;
}

/** Rate limit check result */
export interface RateLimitResult {
  /** Whether the request is allowed */
  allowed: boolean;
  /** Remaining requests in current window */
  remaining: number;
  /** Current concurrent request count */
  concurrent: number;
  /** ms until the window resets */
  resetMs: number;
  /** ms to wait before retrying (0 if allowed) */
  retryAfterMs: number;
}
