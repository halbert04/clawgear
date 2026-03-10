import type { ErrorHandler } from 'hono';

export const errorHandler: ErrorHandler = (err, c) => {
  console.error(
    JSON.stringify({
      level: 'ERROR',
      message: err.message,
      stack: err.stack,
      path: c.req.path,
      method: c.req.method,
      timestamp: new Date().toISOString(),
    }),
  );

  return c.json(
    {
      error: 'Internal Server Error',
      message: process.env.NODE_ENV === 'production' ? 'An unexpected error occurred' : err.message,
      statusCode: 500,
    },
    500,
  );
};
