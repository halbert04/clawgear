/**
 * Per-tenant rate limiter with tiered limits.
 * Token bucket algorithm with burst allowance and concurrent request tracking.
 */

import type { RateLimitResult, TenantConfig, TenantRateLimitConfig } from './types.js';
import { DEFAULT_RATE_LIMITS } from './types.js';

interface TokenBucket {
  tokens: number;
  lastRefill: number;
  concurrent: number;
}

export class TenantRateLimiter {
  private readonly buckets = new Map<string, TokenBucket>();
  private readonly tenants = new Map<string, TenantConfig>();

  /** Register a tenant with their configuration */
  registerTenant(config: TenantConfig): void {
    this.tenants.set(config.tenantId, config);
  }

  /** Remove a tenant */
  removeTenant(tenantId: string): void {
    this.tenants.delete(tenantId);
    this.buckets.delete(tenantId);
  }

  /** Get the effective rate limit config for a tenant */
  getEffectiveConfig(tenantId: string): TenantRateLimitConfig {
    const tenant = this.tenants.get(tenantId);
    if (!tenant) {
      return DEFAULT_RATE_LIMITS.free;
    }
    const base = DEFAULT_RATE_LIMITS[tenant.tier];
    if (tenant.rateLimitOverride) {
      return { ...base, ...tenant.rateLimitOverride };
    }
    return base;
  }

  /** Check if a request is allowed for a tenant */
  check(tenantId: string): RateLimitResult {
    const config = this.getEffectiveConfig(tenantId);
    const now = Date.now();
    let bucket = this.buckets.get(tenantId);

    if (!bucket) {
      bucket = {
        tokens: config.maxRequests + config.burstAllowance,
        lastRefill: now,
        concurrent: 0,
      };
      this.buckets.set(tenantId, bucket);
    }

    // Refill tokens based on elapsed time
    const elapsed = now - bucket.lastRefill;
    const refillRate = (config.maxRequests + config.burstAllowance) / config.windowMs;
    const refillAmount = elapsed * refillRate;
    bucket.tokens = Math.min(
      config.maxRequests + config.burstAllowance,
      bucket.tokens + refillAmount,
    );
    bucket.lastRefill = now;

    // Check concurrent limit
    if (config.maxConcurrent > 0 && bucket.concurrent >= config.maxConcurrent) {
      return {
        allowed: false,
        remaining: Math.floor(bucket.tokens),
        concurrent: bucket.concurrent,
        resetMs: config.windowMs,
        retryAfterMs: 1000,
      };
    }

    // Check token availability
    if (bucket.tokens < 1) {
      const timeToNextToken = (1 - bucket.tokens) / refillRate;
      return {
        allowed: false,
        remaining: 0,
        concurrent: bucket.concurrent,
        resetMs: config.windowMs,
        retryAfterMs: Math.ceil(timeToNextToken),
      };
    }

    // Consume a token
    bucket.tokens -= 1;
    bucket.concurrent += 1;

    return {
      allowed: true,
      remaining: Math.floor(bucket.tokens),
      concurrent: bucket.concurrent,
      resetMs: config.windowMs,
      retryAfterMs: 0,
    };
  }

  /** Release a concurrent slot when request completes */
  release(tenantId: string): void {
    const bucket = this.buckets.get(tenantId);
    if (bucket && bucket.concurrent > 0) {
      bucket.concurrent -= 1;
    }
  }

  /** Get current stats for a tenant */
  getStats(tenantId: string): { remaining: number; concurrent: number } | null {
    const bucket = this.buckets.get(tenantId);
    if (!bucket) return null;
    return {
      remaining: Math.floor(bucket.tokens),
      concurrent: bucket.concurrent,
    };
  }

  /** Clean up stale buckets for removed or inactive tenants */
  cleanup(maxIdleMs = 300_000): number {
    const now = Date.now();
    let removed = 0;
    for (const [id, bucket] of this.buckets) {
      if (now - bucket.lastRefill > maxIdleMs) {
        this.buckets.delete(id);
        removed++;
      }
    }
    return removed;
  }
}
