// Drops test databases whose checkout no longer exists. Every one is stamped
// with its checkout path by globalSetup, so a worktree that has been removed is
// identifiable without guessing from the name.
import { existsSync } from 'node:fs';
import pg from 'pg';
import { env } from '../src/config/env.ts';
import {
  CHECKOUT_COMMENT_PREFIX,
  RESETTABLE_DATABASE,
  resolveTestDatabaseName,
} from '../tests/setup/testDatabaseName.ts';

const current = resolveTestDatabaseName();

const client = new pg.Client({
  host: env.db.hostname,
  port: env.db.port,
  user: env.db.user,
  password: env.db.password,
  database: env.db.maintenanceDatabase,
});

await client.connect();

const { rows } = await client.query<{ datname: string; comment: string | null }>(
  `select d.datname, shobj_description(d.oid, 'pg_database') as comment
     from pg_database d
    where not d.datistemplate`
);

let dropped = 0;
for (const row of rows) {
  if (row.datname === current) continue;
  if (!RESETTABLE_DATABASE.test(row.datname)) continue;

  const comment = row.comment ?? '';
  if (!comment.startsWith(CHECKOUT_COMMENT_PREFIX)) continue;

  const checkout = comment.slice(CHECKOUT_COMMENT_PREFIX.length);
  if (existsSync(checkout)) continue;

  console.log(`dropping ${row.datname} (checkout ${checkout} is gone)`);
  await client.query(`drop database if exists "${row.datname}"`);
  dropped += 1;
}

await client.end();
console.log(dropped === 0 ? 'nothing to prune' : `dropped ${dropped} database(s)`);
