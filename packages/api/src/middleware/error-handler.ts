import type { ErrorHandler } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { ZodError } from 'zod';

export const errorHandler: ErrorHandler = (err, c) => {
  if (err instanceof ZodError) {
    return c.json(
      {
        error: 'Validation Error',
        message: 'Invalid request data',
        issues: err.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
        statusCode: 400,
      },
      400,
    );
  }

  if (err instanceof HTTPException) {
    return c.json(
      {
        error: err.message,
        statusCode: err.status,
      },
      err.status,
    );
  }

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
