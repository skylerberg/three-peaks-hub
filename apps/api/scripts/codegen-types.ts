// Regenerates src/db/types.generated.ts.
//
// It migrates a SCRATCH database from src/db/migrations, introspects that, and
// drops it. It never reads the database you develop against -- introspecting
// that is how a column left behind by an abandoned branch gets committed
// looking exactly like a real one. The scratch name carries this checkout, so
// parallel worktrees can regenerate at once.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { basename } from 'node:path';
import pg from 'pg';
import { env } from '../src/config/env.ts';
import { checkoutRoot } from '../tests/setup/testDatabaseName.ts';

const hash = createHash('sha256').update(checkoutRoot).digest('hex').slice(0, 8);
const scratch = `three_peaks_hub_codegen_${basename(checkoutRoot)
  .replace(/[^a-z0-9]+/gi, '_')
  .toLowerCase()}_${hash}`.slice(0, 63);

function maintenance() {
  return new pg.Client({
    host: env.db.hostname,
    port: env.db.port,
    user: env.db.user,
    password: env.db.password,
    database: env.db.maintenanceDatabase,
  });
}

const setup = maintenance();
await setup.connect();
await setup.query(`drop database if exists "${scratch}"`);
await setup.query(`create database "${scratch}"`);
await setup.end();

const url = `postgres://${env.db.user}:${encodeURIComponent(env.db.password)}@${env.db.hostname}:${env.db.port}/${scratch}`;

try {
  const migrated = spawnSync('node', ['--import', 'tsx', 'src/db/migrate.ts'], {
    stdio: 'inherit',
    env: { ...process.env, DB_DATABASE: scratch },
  });
  if (migrated.status !== 0) throw new Error('migrations failed against the scratch database');

  const generated = spawnSync(
    'pnpm',
    [
      'exec',
      'kysely-codegen',
      '--url',
      url,
      '--dialect',
      'postgres',
      '--out-file',
      'src/db/types.generated.ts',
      '--singular',
      'false',
    ],
    { stdio: 'inherit' }
  );
  if (generated.status !== 0) throw new Error('kysely-codegen failed');

  spawnSync(
    'pnpm',
    ['exec', 'prettier', '--write', '--log-level', 'warn', 'src/db/types.generated.ts'],
    {
      stdio: 'inherit',
    }
  );
} finally {
  const teardown = maintenance();
  await teardown.connect();
  await teardown.query(`drop database if exists "${scratch}"`);
  await teardown.end();
}

console.log('wrote src/db/types.generated.ts');
