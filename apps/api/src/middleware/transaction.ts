import type { MiddlewareHandler } from 'hono';
import { db } from '../db/index.ts';
import { logger } from '../utils/logger.ts';
import type { PostCommitHook, Variables } from '../types/index.ts';

const TRANSACTIONAL_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

async function runPostCommitHooks(hooks: PostCommitHook[]): Promise<void> {
  for (const hook of hooks) {
    // Two layers of containment, because a hook can fail in two ways and
    // neither may turn a committed write into a 500 the client will retry.
    try {
      await hook();
    } catch (error) {
      logger.error('post-commit hook failed', { error });
    }
  }
}

export const transactionMiddleware: MiddlewareHandler<{ Variables: Variables }> = async (
  c,
  next
) => {
  const hooks: PostCommitHook[] = [];
  c.set('postCommitHooks', hooks);

  if (!TRANSACTIONAL_METHODS.has(c.req.method)) {
    c.set('db', db);
    await next();
    await runPostCommitHooks(hooks);
    return;
  }

  await db.transaction().execute(async (trx) => {
    c.set('db', trx);
    await next();
    // Hono's compose catches a handler throw and parks it on c.error, so next()
    // resolves even for a request that failed. Without this rethrow Kysely sees
    // a clean return and commits the half-finished write.
    if (c.error) throw c.error;
  });

  await runPostCommitHooks(hooks);
};
