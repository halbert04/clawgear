import type { MiddlewareHandler } from 'hono';

/**
 * Security headers middleware.
 * Applies CSP, HSTS, X-Frame-Options, X-Content-Type-Options to all responses.
 */
export const securityHeaders: MiddlewareHandler = async (c, next) => {
  await next();

  // Prevent clickjacking
  c.header('X-Frame-Options', 'DENY');

  // Prevent MIME-type sniffing
  c.header('X-Content-Type-Options', 'nosniff');

  // Enable XSS protection (legacy browsers)
  c.header('X-XSS-Protection', '1; mode=block');

  // HSTS: enforce HTTPS (1 year)
  c.header('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');

  // Content Security Policy: restrict resource loading
  c.header(
    'Content-Security-Policy',
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self' ws: wss:; frame-ancestors 'none'",
  );

  // Referrer Policy
  c.header('Referrer-Policy', 'strict-origin-when-cross-origin');

  // Permissions Policy: disable unnecessary browser features
  c.header('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
};
