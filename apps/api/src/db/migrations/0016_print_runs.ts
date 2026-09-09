import { type Kysely, sql } from 'kysely';

// What has already been put on paper, so a reprint can be only what has changed
// since.
//
// A ledger rather than a timestamp on the deck, for the same reason
// `file_version` has no pointer column: "printed" is a fact about one card at
// one version, and a single date per deck cannot tell a card left out of the
// last run from one that came off the printer in it.
//
// Backward compatible by construction: both tables are new, so a pod on the
// previous release neither reads nor writes either one, and both foreign keys
// point AT tables it already deletes from -- each cascading or nulling, so no
// destructive statement that release issues starts failing.
export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable('print_run')
    .addColumn('id', 'uuid', (col) => col.primaryKey())
    .addColumn('project_id', 'uuid', (col) =>
      col.notNull().references('project.id').onDelete('cascade')
    )
    // Set null rather than restrict or cascade, the way file.deleted_by is: an
    // account going away must neither be blocked by a record of what somebody
    // printed nor take that record out of a project it does not own.
    .addColumn('created_by', 'uuid', (col) => col.references('app_user.id').onDelete('set null'))
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .execute();

  await db.schema
    .createIndex('print_run_project_idx')
    .on('print_run')
    .columns(['project_id', 'created_at'])
    .execute();

  await db.schema
    .createTable('print_run_card')
    .addColumn('id', 'uuid', (col) => col.primaryKey())
    .addColumn('run_id', 'uuid', (col) =>
      col.notNull().references('print_run.id').onDelete('cascade')
    )
    // Keyed on the file rather than on deck_card, for the reason
    // deck_import_card gives: the deck editor deletes every row of that table
    // and re-inserts with fresh ids, so a reference to one is gone after the
    // next hand edit.
    .addColumn('file_id', 'uuid', (col) => col.notNull().references('file.id').onDelete('cascade'))
    // Which artwork went on the paper, not merely that some did. This is the
    // whole comparison: a card whose newest version is higher than every number
    // recorded here is a card the printed one no longer looks like.
    .addColumn('version_number', 'integer', (col) => col.notNull())
    .addColumn('copies', 'integer', (col) => col.notNull())
    // The reverse this card was printed with, and nothing if the run left the
    // backing pages out. A new back makes every card's reverse wrong, and this
    // pair is what says so per card rather than per deck.
    //
    // Deliberately without the check constraint pairing the two: purging the
    // back image nulls this column, and a check demanding the version go with
    // it would make that purge fail instead.
    .addColumn('back_file_id', 'uuid', (col) => col.references('file.id').onDelete('set null'))
    .addColumn('back_version_number', 'integer')
    // One row per card per run. Printing the same card twice in one run is a
    // copy count, which is the column above.
    .addUniqueConstraint('print_run_card_unique_file', ['run_id', 'file_id'])
    .addCheckConstraint('print_run_card_version_positive', sql`version_number >= 1`)
    .addCheckConstraint('print_run_card_copies_in_range', sql`copies between 1 and 999`)
    .addCheckConstraint(
      'print_run_card_back_version_positive',
      sql`back_version_number is null or back_version_number >= 1`
    )
    .execute();

  // The direction every read takes: one card, every run that ever printed it.
  await db.schema
    .createIndex('print_run_card_file_idx')
    .on('print_run_card')
    .column('file_id')
    .execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable('print_run_card').execute();
  await db.schema.dropTable('print_run').execute();
}
