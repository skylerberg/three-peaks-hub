import { type Kysely, sql } from 'kysely';

// Deleting a file or a folder stops destroying it. The row is tombstoned and
// every stored object stays; only an explicit purge reclaims the bytes.
//
// Why this is backward compatible with the release before it:
//
//  1. Nothing an old pod issues can start failing. Both columns are nullable
//     with no default, every select names its columns, and both inserts name
//     their values -- so a widened row cannot surprise a reader and the new
//     columns take null.
//  2. The narrowed index predicate only ever ADMITS more rows: what each index
//     rejects afterwards is a strict subset of what it rejected before. The
//     dangerous direction is the reverse of this one.
//  3. The quota needs no rollout argument, because neither release filters its
//     sum by deleted_at -- old and new pods report the same number.
//
// And the asymmetries, which are real. An old pod's DELETE is still hard, so
// for the length of the rollout whether a delete can be undone depends on which
// pod served it; that is the previous release's own behaviour rather than
// something introduced here, but the window loses exactly what that release
// always lost. An old pod hard-deleting a row a new pod tombstoned is a purge
// under another name, and that release's key collection already reaches every
// version. An old pod lists tombstones as live and will rename one: cosmetic,
// and it resolves itself. A rollback leaves tombstones with no code filtering
// them, so deleted rows reappear in listings -- rows and objects intact, and
// redeploying hides them again.
export async function up(db: Kysely<unknown>): Promise<void> {
  // One statement per table, so each takes its lock once. No CHECK pairing the
  // two columns: deleted_by goes null on its own when that account is deleted,
  // while deleted_at stays set. No index on deleted_at either -- the deleted
  // listing filters by project_id first, which the existing indexes lead with.
  for (const table of ['file', 'folder'] as const) {
    await db.schema
      .alterTable(table)
      .addColumn('deleted_at', 'timestamptz')
      .addColumn('deleted_by', 'uuid', (col) => col.references('app_user.id').onDelete('set null'))
      .execute();
  }

  // A tombstone must not keep reserving the name it had, or a card that comes
  // back cannot be re-created under it. The names are reused rather than
  // suffixed, so a later release never has to know which one it is looking at.
  //
  // Kysely runs the whole pending batch in ONE transaction, so the ACCESS
  // EXCLUSIVE the statements above took on file and folder is held across all
  // four builds below. That is also what makes drop-then-create safe: no other
  // session can insert into the window where uniqueness is briefly absent.
  // CREATE INDEX CONCURRENTLY is not an option -- it cannot run in a
  // transaction at all.
  await sql`drop index folder_unique_name_in_parent`.execute(db);
  await sql`
    create unique index folder_unique_name_in_parent
      on folder (project_id, parent_id, lower(name))
      where parent_id is not null and deleted_at is null
  `.execute(db);

  await sql`drop index folder_unique_name_at_root`.execute(db);
  await sql`
    create unique index folder_unique_name_at_root
      on folder (project_id, lower(name))
      where parent_id is null and deleted_at is null
  `.execute(db);

  await sql`drop index file_unique_name_in_folder`.execute(db);
  await sql`
    create unique index file_unique_name_in_folder
      on file (project_id, folder_id, lower(filename))
      where folder_id is not null and deleted_at is null
  `.execute(db);

  await sql`drop index file_unique_name_at_root`.execute(db);
  await sql`
    create unique index file_unique_name_at_root
      on file (project_id, lower(filename))
      where folder_id is null and deleted_at is null
  `.execute(db);
}

// Recreating the original predicates fails with 23505 on a database that holds
// a tombstone sharing a name with a live row. That is correct: this direction is
// a development affordance, not a rollout mechanism.
export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`drop index folder_unique_name_in_parent`.execute(db);
  await sql`
    create unique index folder_unique_name_in_parent
      on folder (project_id, parent_id, lower(name))
      where parent_id is not null
  `.execute(db);

  await sql`drop index folder_unique_name_at_root`.execute(db);
  await sql`
    create unique index folder_unique_name_at_root
      on folder (project_id, lower(name))
      where parent_id is null
  `.execute(db);

  await sql`drop index file_unique_name_in_folder`.execute(db);
  await sql`
    create unique index file_unique_name_in_folder
      on file (project_id, folder_id, lower(filename))
      where folder_id is not null
  `.execute(db);

  await sql`drop index file_unique_name_at_root`.execute(db);
  await sql`
    create unique index file_unique_name_at_root
      on file (project_id, lower(filename))
      where folder_id is null
  `.execute(db);

  for (const table of ['file', 'folder'] as const) {
    await db.schema.alterTable(table).dropColumn('deleted_at').dropColumn('deleted_by').execute();
  }
}
