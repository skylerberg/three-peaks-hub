import type { Context, ErrorHandler, NotFoundHandler } from 'hono';
import { AppError } from '../utils/errors.ts';
import { logger } from '../utils/logger.ts';

export const errorHandler: ErrorHandler = (err, c) => {
  if (err instanceof AppError) {
    const fields = { path: c.req.path, method: c.req.method, status: err.statusCode };
    if (err.statusCode >= 500) logger.error(err.message, fields);
    else if (err.statusCode >= 400) logger.warn(err.message, fields);
    return c.json({ error: err.message, ...err.extra }, err.statusCode);
  }

  logger.error('unhandled error', { path: c.req.path, method: c.req.method, error: err });
  // Never echo err.message here. Driver errors carry table names, constraint
  // names and sometimes column values.
  return c.json({ error: 'Internal Server Error' }, 500);
};

export const notFoundHandler: NotFoundHandler = (c: Context) =>
  c.json({ error: 'Not Found', path: c.req.path }, 404);
