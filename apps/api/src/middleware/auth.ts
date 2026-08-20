import type { MiddlewareHandler, Next } from 'hono';
import { db } from '../db/index.ts';
import { authenticateBearerToken } from '../services/credentials.ts';
import { AppError } from '../utils/errors.ts';
import type { PublicContext, Variables } from '../types/index.ts';

// Marker middlewares. They do nothing; what matters is that they are *this*
// function object, which authMiddleware finds by identity in the matched route
// chain. Identity rather than path means a rename or a remount carries the
// marker with it.
export const skipAuth: MiddlewareHandler<{ Variables: Variables }> = async (_c, next) => {
  await next();
};

export const optionalAuth: MiddlewareHandler<{ Variables: Variables }> = async (_c, next) => {
  await next();
};

function matchedHandlers(c: PublicContext): unknown[] {
  // Hono exposes the matched chain here; shape differs by router, so read
  // defensively rather than asserting.
  const routes = (c.req as unknown as { matchedRoutes?: { handler: unknown }[] }).matchedRoutes;
  return (routes ?? []).map((route) => route.handler);
}

function bearerToken(c: PublicContext): string | null {
  const header = c.req.header('authorization');
  if (!header) return null;
  const match = /^Bearer (.+)$/i.exec(header.trim());
  return match ? match[1] : null;
}

export async function authMiddleware(c: PublicContext, next: Next): Promise<void | Response> {
  const handlers = matchedHandlers(c);
  if (handlers.includes(skipAuth)) return await next();

  const optional = handlers.includes(optionalAuth);
  const token = bearerToken(c);

  if (token === null) {
    if (optional) return await next();
    throw new AppError(401, 'No token provided');
  }

  const credential = await authenticateBearerToken(c.get('db') ?? db, token);
  if (!credential) {
    if (optional) return await next();
    throw new AppError(401, 'Invalid or expired token');
  }

  c.set('credential', credential);
  c.set('user', credential.user);
  return await next();
}
