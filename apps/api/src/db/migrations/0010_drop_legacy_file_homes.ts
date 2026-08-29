import { type Kysely, sql } from 'kysely';

// The second half of 0009, and the release it was waiting for.
//
// 0009 gave every file an owner and then deliberately left three things behind,
// each of them something the release before it still read. That release is gone
// now, so this clears them and puts the invariant into a CHECK.
//
// Backward compatible with 0009's release, which is what serves during this
// rollout:
//
//  * It lists assets by `deck_id is null and component_id is null`, so a
//    `folder_id` cleared out from under an owned row is one it never reads.
//    `parseHome` reaches the folder branch only when both owner columns are
//    null, which is the same statement said in the application.
//  * It names `deck_import.folder_id` nowhere. The column has had no reader and
//    no writer since 0009's release shipped.
//  * Its 3D studio reads `component_model` for a deck card. The rows deleted
//    below are the non-card dial-ins 0009 copied onto `component`, whose files
//    are owned by a component and so are not cards -- and the component is
//    where that release already reads their settings from.
//
// Rolling back leaves the columns dropped. That is the one direction this
// cannot give back, and it is why it waited for a release rather than riding
// along with the one that made the copies.
export async function up(db: Kysely<unknown>): Promise<void> {
  // The rows 0009 copied, and only those: it minted each component under the id
  // of the settings row it came from, so the join is exact rather than a guess
  // at which dial-ins were superseded.
  await sql`
    delete from component_model
    using component
    where component.id = component_model.id
  `.execute(db);

  await sql`
    update file set folder_id = null
    where folder_id is not null
      and (deck_id is not null or component_id is not null)
  `.execute(db);

  // The invariant 0009 could only assert in prose. A file belongs to a deck, to
  // a component, or to the folder tree, and now nothing can write a row that
  // claims two of them.
  await sql`
    alter table file add constraint file_home_is_exclusive
      check (num_nonnulls(deck_id, component_id) = 0 or folder_id is null)
  `.execute(db);

  await db.schema.alterTable('deck_import').dropColumn('folder_id').execute();
}

// A development affordance rather than a rollout mechanism, like 0006's and
// 0009's. The folder ids this puts a column back for are gone: a file that was
// moved into a deck has no record of where in Assets it used to sit, and there
// is nowhere to read one from.
export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .alterTable('deck_import')
    .addColumn('folder_id', 'uuid', (col) => col.references('folder.id').onDelete('set null'))
    .execute();
  await db.schema
    .createIndex('deck_import_folder_idx')
    .on('deck_import')
    .column('folder_id')
    .ifNotExists()
    .execute();
  await sql`alter table file drop constraint file_home_is_exclusive`.execute(db);
}
