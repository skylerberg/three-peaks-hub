import { type Kysely, sql } from 'kysely';

// A deck is an ordered list of card images with a copy count each, one card
// size, and one image on the back. It is what the print sheets are built from.
//
// Backward compatible with the previous release by construction: both tables
// are new, so a pod still running that release neither reads nor writes either
// one, and nothing it already issues changes shape.
export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable('deck')
    .addColumn('id', 'uuid', (col) => col.primaryKey())
    .addColumn('project_id', 'uuid', (col) =>
      col.notNull().references('project.id').onDelete('cascade')
    )
    .addColumn('name', 'text', (col) => col.notNull())
    // Millimetres, and no preset id beside them. A stored preset id would be a
    // second answer to how big the card is, free to disagree with the first;
    // the named size is derived on read by matching these two numbers instead.
    .addColumn('card_width_mm', 'numeric(6, 2)', (col) => col.notNull())
    .addColumn('card_height_mm', 'numeric(6, 2)', (col) => col.notNull())
    // Set null rather than cascade: purging the image used as the back must
    // leave the deck standing with no back, not delete the deck and every
    // quantity in it.
    .addColumn('back_file_id', 'uuid', (col) => col.references('file.id').onDelete('set null'))
    // Cascade, matching folder.created_by and file.uploaded_by. Project content
    // follows its author here; file_version.created_by is the deliberate
    // exception, and for a reason that does not apply to a list of ids.
    .addColumn('created_by', 'uuid', (col) =>
      col.notNull().references('app_user.id').onDelete('cascade')
    )
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .addColumn('updated_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .addCheckConstraint('deck_name_not_empty', sql`char_length(name) > 0`)
    // The bounds MODEL_LIMITS.card names, so a size the API would reject cannot
    // reach the table by any other route either.
    .addCheckConstraint(
      'deck_card_size_in_range',
      sql`card_width_mm between 10 and 300 and card_height_mm between 10 and 300`
    )
    .execute();

  await db.schema.createIndex('deck_project_idx').on('deck').column('project_id').execute();

  // Case-folded, like every other name in the project: two decks differing only
  // in case is a rename trap on a case-insensitive client. No deleted_at
  // predicate, because deleting a deck is not soft -- it holds no stored bytes.
  await sql`
    create unique index deck_unique_name_in_project
      on deck (project_id, lower(name))
  `.execute(db);

  await db.schema
    .createTable('deck_card')
    .addColumn('id', 'uuid', (col) => col.primaryKey())
    .addColumn('deck_id', 'uuid', (col) => col.notNull().references('deck.id').onDelete('cascade'))
    // Cascade: purging the image takes the card out of the deck by itself. A
    // file that is merely deleted keeps its row, so the deck still shows it and
    // restoring the file puts it back in the print run.
    .addColumn('file_id', 'uuid', (col) => col.notNull().references('file.id').onDelete('cascade'))
    .addColumn('quantity', 'integer', (col) => col.notNull().defaultTo(1))
    .addColumn('position', 'integer', (col) => col.notNull())
    // One row per image with a count, rather than the same image n times: the
    // count is the fact the designer is editing.
    .addUniqueConstraint('deck_card_unique_file', ['deck_id', 'file_id'])
    .addCheckConstraint('deck_card_quantity_in_range', sql`quantity between 1 and 999`)
    .addCheckConstraint('deck_card_position_non_negative', sql`position >= 0`)
    .execute();

  // Deliberately not unique. The list is rewritten wholesale on every edit, so
  // a reorder never needs to pass through a state where two rows share a
  // position -- which a unique constraint would refuse without deferring it.
  await db.schema
    .createIndex('deck_card_deck_position_idx')
    .on('deck_card')
    .columns(['deck_id', 'position'])
    .execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable('deck_card').execute();
  await db.schema.dropTable('deck').execute();
}
