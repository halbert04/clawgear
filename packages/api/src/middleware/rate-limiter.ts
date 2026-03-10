import type { Context, MiddlewareHandler, Next } from 'hono';

export interface RateLimiterConfig {
  /** Maximum requests in the window */
  maxRequests: number;
  /** Window size in milliseconds */
  windowMs: number;
}

interface TokenBucket {
  tokens: number;
  lastRefill: number;
}

/**
 * In-memory rate limiter using the token bucket algorithm.
 * Keys are derived from the client identifier (IP or API key hash).
 */
export class RateLimiter {
  private buckets = new Map<string, TokenBucket>();
  private maxTokens: number;
  private refillRate: number; // tokens per millisecond

  constructor(config: RateLimiterConfig) {
    this.maxTokens = config.maxRequests;
    this.refillRate = config.maxRequests / config.windowMs;
  }

  /**
   * Check if a request is allowed for the given key.
   * Returns the number of remaining tokens, or -1 if rate limited.
   */
  check(key: string): { allowed: boolean; remaining: number; retryAfterMs: number } {
    const now = Date.now();
    let bucket = this.buckets.get(key);

    if (!bucket) {
      bucket = { tokens: this.maxTokens, lastRefill: now };
      this.buckets.set(key, bucket);
    }

    // Refill tokens based on elapsed time
    const elapsed = now - bucket.lastRefill;
    bucket.tokens = Math.min(this.maxTokens, bucket.tokens + elapsed * this.refillRate);
    bucket.lastRefill = now;

    if (bucket.tokens >= 1) {
      bucket.tokens -= 1;
      return { allowed: true, remaining: Math.floor(bucket.tokens), retryAfterMs: 0 };
    }

    // Calculate retry-after
    const retryAfterMs = Math.ceil((1 - bucket.tokens) / this.refillRate);
    return { allowed: false, remaining: 0, retryAfterMs };
  }

  /**
   * Clean up stale entries (call periodically).
   */
  cleanup(): void {
    const now = Date.now();
    const staleThreshold = 60_000; // 1 minute of inactivity
    for (const [key, bucket] of this.buckets) {
      if (now - bucket.lastRefill > staleThreshold && bucket.tokens >= this.maxTokens) {
        this.buckets.delete(key);
      }
    }
  }
}

/**
 * Hono middleware for rate limiting.
 */
export function rateLimiterMiddleware(config: RateLimiterConfig): MiddlewareHandler {
  const limiter = new RateLimiter(config);

  // Periodic cleanup every 60 seconds
  setInterval(() => limiter.cleanup(), 60_000);

  return async (c: Context, next: Next) => {
    // Key: use API key hash if available, otherwise client IP
    const key = (c.get('apiKeyHash') as string) ?? c.req.header('x-forwarded-for') ?? 'unknown';

    const result = limiter.check(key);

    // Set rate limit headers
    c.header('X-RateLimit-Limit', String(config.maxRequests));
    c.header('X-RateLimit-Remaining', String(result.remaining));

    if (!result.allowed) {
      c.header('Retry-After', String(Math.ceil(result.retryAfterMs / 1000)));
      return c.json(
        {
          error: 'Too Many Requests',
          message: 'Rate limit exceeded',
          retryAfterMs: result.retryAfterMs,
        },
        429,
      );
    }

    return next();
  };
}
