import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { sql } from 'kysely';
import { FileMigrationProvider, Migrator } from 'kysely/migration';
import { db } from './index.ts';
import { logger } from '../utils/logger.ts';

// Well under Postgres's 1s deadlock_timeout, so a migration that cannot take
// its lock gives up immediately and retries rather than blocking the queue
// behind it — which on a live table is how a deploy takes the site down.
const LOCK_TIMEOUT_MS = 100;
const MAX_ATTEMPTS = 30;
const BASE_BACKOFF_MS = 50;
const MAX_BACKOFF_MS = 2000;

// deadlock_detected and lock_not_available. Nothing else is retried: a
// migration that is simply wrong must report that on the first attempt.
const RETRYABLE_SQLSTATES = new Set(['40P01', '55P03']);

function isRetryable(error: unknown): boolean {
  const code = (error as { code?: string } | null)?.code;
  return code !== undefined && RETRYABLE_SQLSTATES.has(code);
}

function migrationFolder(): string {
  return path.join(path.dirname(fileURLToPath(import.meta.url)), 'migrations');
}

function createMigrator(folder: string = migrationFolder()): Migrator {
  return new Migrator({
    db,
    provider: new FileMigrationProvider({
      fs,
      path,
      migrationFolder: folder,
    }),
  });
}

// The folder is a parameter only so a test can hand it one holding a migration
// the database has never seen; nothing in the app passes it.
export async function pendingMigrations(folder?: string): Promise<string[]> {
  const migrations = await createMigrator(folder).getMigrations();
  return migrations
    .filter((migration) => migration.executedAt === undefined)
    .map((migration) => migration.name);
}

// Said at boot and never fatal. Deploys are rolling and the migrate Job runs
// before the rollout, so a pod that starts mid-deploy has nothing pending and a
// pod that refused to start would take the release down for a condition its own
// database is about to satisfy. What this catches is the development case: a
// database a branch has moved past, which otherwise surfaces as a 500 from the
// first query to touch a table that is not there yet.
export async function reportPendingMigrations(): Promise<void> {
  let pending: string[];
  try {
    pending = await pendingMigrations();
  } catch (error) {
    logger.warn('could not read the migration history', { error });
    return;
  }

  if (pending.length === 0) return;
  logger.error(
    `this database is behind the code: ${pending.length} migration(s) have never been applied. ` +
      'Every request touching what they add will fail until `pnpm migrate` has run.',
    { pending }
  );
}

async function run(direction: 'up' | 'down'): Promise<void> {
  const migrator = createMigrator();

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    try {
      await sql`set lock_timeout = ${sql.lit(LOCK_TIMEOUT_MS)}`.execute(db);
      const { error, results } = await (direction === 'up'
        ? migrator.migrateToLatest()
        : migrator.migrateDown());

      for (const result of results ?? []) {
        if (result.status === 'Success') {
          logger.info(`migration ${result.direction} ${result.migrationName}`);
        } else if (result.status === 'Error') {
          logger.error(`migration failed ${result.migrationName}`);
        }
      }

      if (error) throw error;
      return;
    } catch (error) {
      if (!isRetryable(error) || attempt === MAX_ATTEMPTS) throw error;
      const backoff = Math.min(BASE_BACKOFF_MS * 2 ** (attempt - 1), MAX_BACKOFF_MS);
      const jitter = Math.floor(Math.random() * backoff);
      logger.warn(`migration lock contention, retrying`, { attempt, waitMs: jitter });
      await new Promise((resolve) => setTimeout(resolve, jitter));
    }
  }
}

export async function migrateToLatest(): Promise<void> {
  await run('up');
}

// Doubles as the CLI the migrate Job runs: `node --import tsx src/db/migrate.ts`.
if (import.meta.url === `file://${process.argv[1]}`) {
  const direction = process.argv[2] === 'down' ? 'down' : 'up';
  try {
    await run(direction);
    logger.info('migrations complete');
    await db.destroy();
  } catch (error) {
    logger.error('migration run failed', { error });
    await db.destroy();
    process.exit(1);
  }
}
