// Runs a command against the derived test database, creating it first.
// `pnpm migrate:test` uses this so migrations can be applied without going
// through the whole suite.
import { spawnSync } from 'node:child_process';
import pg from 'pg';
import { env } from '../src/config/env.ts';
import { RESETTABLE_DATABASE, resolveTestDatabaseName } from '../tests/setup/testDatabaseName.ts';

const database = resolveTestDatabaseName();
if (!RESETTABLE_DATABASE.test(database)) {
  throw new Error(
    `Refusing to use a database that does not look like a test database: ${database}`
  );
}

const client = new pg.Client({
  host: env.db.hostname,
  port: env.db.port,
  user: env.db.user,
  password: env.db.password,
  database: env.db.maintenanceDatabase,
});

await client.connect();
const exists = await client.query('select 1 from pg_database where datname = $1', [database]);
if (exists.rowCount === 0) await client.query(`create database "${database}"`);
await client.end();

const [command, ...args] = process.argv.slice(2);
const result = spawnSync(command, args, {
  stdio: 'inherit',
  env: { ...process.env, DB_DATABASE: database },
});
process.exit(result.status ?? 1);
