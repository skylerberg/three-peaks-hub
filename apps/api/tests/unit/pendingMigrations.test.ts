import { cpSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
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

// Kysely orders migrations by filename and refuses one that sorts before a
// migration the database has already run. Two branches numbering their
// migrations the same is what produces that: the names differ, so git merges
// them without a conflict, and CI migrates a database with nothing applied yet,
// where all of them are pending and the order is whatever sorting says. Only a
// database that has already run the later one refuses -- which in practice
// means production, at deploy time, with the rollout behind it.
describe('migration numbering', () => {
  const numbered = readdirSync(join(process.cwd(), 'src', 'db', 'migrations'))
    .filter((name) => name.endsWith('.ts'))
    .map((name) => ({ name, order: Number(name.slice(0, 4)) }));

  it('reads a number off every migration', () => {
    expect(numbered.filter((entry) => !Number.isInteger(entry.order))).toEqual([]);
  });

  it('gives each migration a number no other one has', () => {
    const seen = new Map<number, string[]>();
    for (const entry of numbered) {
      seen.set(entry.order, [...(seen.get(entry.order) ?? []), entry.name]);
    }
    const shared = [...seen.entries()].filter(([, names]) => names.length > 1);
    expect(shared.map(([order, names]) => `${order}: ${names.join(', ')}`)).toEqual([]);
  });

  // Sorting by name and sorting by number have to agree, or a file whose name
  // sorts differently from its number lands in a place the runner will not
  // accept later.
  it('sorts the same by name as by number', () => {
    const byName = [...numbered].sort((a, b) => a.name.localeCompare(b.name));
    const byNumber = [...numbered].sort((a, b) => a.order - b.order);
    expect(byName.map((entry) => entry.name)).toEqual(byNumber.map((entry) => entry.name));
  });
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
