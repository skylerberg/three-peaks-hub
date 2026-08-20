import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import { transactionMiddleware } from '../../src/middleware/transaction.ts';
import { db } from '../../src/db/index.ts';
import { newId } from '../../src/utils/uuid.ts';
import { AppError } from '../../src/utils/errors.ts';
import type { Variables } from '../../src/types/index.ts';

// The route handlers all validate before they write, so no e2e request in this
// suite performs a successful write and *then* fails -- which is precisely the
// case the rollback exists for. This drives the middleware directly instead, on
// a throwaway app whose handler does exactly that.
//
// A mutation-guard entry points here: without the `if (c.error) throw c.error`
// rethrow, Hono's compose has already parked the error on c.error and Kysely
// sees a clean return, so the first write commits.
function appWithHandler(handler: (c: never) => Promise<Response>) {
  const app = new Hono<{ Variables: Variables }>();
  app.use('*', transactionMiddleware);
  app.post('/probe', handler as never);
  app.onError((error, c) =>
    c.json({ error: error instanceof AppError ? error.message : 'boom' }, 500)
  );
  return app;
}

async function userExists(id: string): Promise<boolean> {
  const row = await db
    .selectFrom('app_user')
    .select('app_user.id')
    .where('app_user.id', '=', id)
    .executeTakeFirst();
  return row !== undefined;
}

describe('transactionMiddleware', () => {
  it('rolls back a write when a later step in the same request throws', async () => {
    const id = newId();

    const app = appWithHandler(async (c) => {
      const trx = (c as { get: (key: string) => never }).get('db') as never as typeof db;
      await trx
        .insertInto('app_user')
        .values({
          id,
          email: `rollback-${id}@example.test`,
          password_hash: 'x',
          name: 'Rollback',
        })
        .execute();

      // The row exists inside the transaction.
      expect(await userExists(id)).toBe(false);
      throw new AppError(500, 'failing after the write');
    });

    const res = await app.request('/probe', { method: 'POST' });
    expect(res.status).toBe(500);

    // ...and is gone once the request has ended.
    expect(await userExists(id)).toBe(false);
  });

  it('commits a write when the request succeeds', async () => {
    const id = newId();

    const app = appWithHandler(async (c) => {
      const trx = (c as { get: (key: string) => never }).get('db') as never as typeof db;
      await trx
        .insertInto('app_user')
        .values({
          id,
          email: `commit-${id}@example.test`,
          password_hash: 'x',
          name: 'Commit',
        })
        .execute();
      return (c as unknown as { body: (b: null, s: number) => Response }).body(null, 204);
    });

    const res = await app.request('/probe', { method: 'POST' });
    expect(res.status).toBe(204);
    // The control the rollback case needs: without this, a rollback test passes
    // just as well against a handler whose write never happened at all.
    expect(await userExists(id)).toBe(true);

    await db.deleteFrom('app_user').where('app_user.id', '=', id).execute();
  });

  it('runs post-commit hooks only after the transaction commits', async () => {
    const ran: string[] = [];

    const app = appWithHandler(async (c) => {
      const ctx = c as unknown as {
        get: (key: string) => (() => void)[];
        body: (b: null, s: number) => Response;
      };
      ctx.get('postCommitHooks').push(() => ran.push('hook'));
      return ctx.body(null, 204);
    });

    await app.request('/probe', { method: 'POST' });
    expect(ran).toEqual(['hook']);
  });

  it('does not run post-commit hooks when the request rolled back', async () => {
    const ran: string[] = [];

    const app = appWithHandler(async (c) => {
      const ctx = c as unknown as { get: (key: string) => (() => void)[] };
      ctx.get('postCommitHooks').push(() => ran.push('hook'));
      throw new AppError(500, 'nope');
    });

    await app.request('/probe', { method: 'POST' });
    expect(ran).toEqual([]);
  });
});
