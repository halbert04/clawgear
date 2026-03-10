import type { MiddlewareHandler } from 'hono';

export const requestLogger: MiddlewareHandler = async (c, next) => {
  const start = performance.now();
  const method = c.req.method;
  const path = c.req.path;

  await next();

  const duration = (performance.now() - start).toFixed(1);
  const status = c.res.status;
  const level = status >= 500 ? 'ERROR' : status >= 400 ? 'WARN' : 'INFO';

  console.log(
    JSON.stringify({
      level,
      method,
      path,
      status,
      durationMs: Number(duration),
      timestamp: new Date().toISOString(),
    }),
  );
};
