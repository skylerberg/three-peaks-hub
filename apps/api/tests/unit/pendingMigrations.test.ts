import { cpSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { pendingMigrations } from '../../src/db/migrate.ts';

// Inside the package, because the provider imports what it finds and a folder
// outside it resolves nothing. `scripts/tmp-*` is the sanctioned throwaway
// prefix: gitignored, and skipped by test discovery.
const scratch = mkdtempSync(join(process.cwd(), 'scripts', 'tmp-migrations-'));

afterAll(() => {
  rmSync(scratch, { recursive: true, force: true });
});

describe('pendingMigrations', () => {
  it('reports nothing against a database that has run them all', async () => {
    // The suite's own database, which globalSetup migrates before anything runs.
    expect(await pendingMigrations()).toEqual([]);
  });

  // The case the boot-time report exists for. Without it the first request that
  // touches the new table answers 500, and the reason is a Postgres error deep
  // in a stack trace rather than a line at startup.
  it('names a migration the database has never run', async () => {
    cpSync(join(process.cwd(), 'src', 'db', 'migrations'), scratch, { recursive: true });
    writeFileSync(
      join(scratch, '9999_not_applied.ts'),
      'export async function up(): Promise<void> {}\nexport async function down(): Promise<void> {}\n'
    );

    expect(await pendingMigrations(scratch)).toEqual(['9999_not_applied']);
  });
});
