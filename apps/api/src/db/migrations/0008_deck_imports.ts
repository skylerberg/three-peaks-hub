import { type Kysely, sql } from 'kysely';

// Keeps a deck's artwork in step with a Canva export. A deck may be bound to a
// folder; each run plans its whole export up front and then posts one page at a
// time; the mapping between a page and the file it became is what lets a later
// run version a card instead of adding a second one.
//
// Rollout notes, since old and new pods serve side by side:
//
//  * Five of these tables are new, so nothing the previous release issues even
//    names them, and no statement of its own changes shape.
//  * file.name_locked is NOT NULL with a constant default, which Postgres
//    records in the catalogue without rewriting the table. Every insert of a
//    file names its columns and every select names the ones it wants, so the
//    extra column reaches no reader that would be surprised by it. The pod on
//    the previous release simply never sets it: a name typed during the rollout
//    window is unprotected until it is typed again.
//  * The new foreign keys point AT file, folder, deck and app_user, and each
//    one either cascades or nulls. None restricts an existing destructive path,
//    so the deletes that release already issues keep succeeding.
//  * Rolling back leaves these tables in place, unread. Redeploying resumes.
export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable('deck_import')
    .addColumn('id', 'uuid', (col) => col.primaryKey())
    // Unique, which is what makes binding idempotent: there is one source per
    // deck and re-binding updates the row rather than adding a second one.
    .addColumn('deck_id', 'uuid', (col) =>
      col.notNull().unique().references('deck.id').onDelete('cascade')
    )
    // Null is "not bound right now", whether somebody unbound it or the folder
    // was purged underneath it. Set null rather than cascade for exactly that
    // second case: cascading would take the mapping and every run with it, and
    // the history is the thing this feature exists to keep.
    .addColumn('folder_id', 'uuid', (col) => col.references('folder.id').onDelete('set null'))
    .addColumn('source_kind', 'text', (col) => col.notNull())
    .addColumn('source_label', 'text')
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .addColumn('updated_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .addCheckConstraint('deck_import_source_kind_known', sql`source_kind in ('zip')`)
    .execute();

  // The one lookup that is not by deck_id, and it is here so that nulling this
  // column when a folder is purged does not scan the table.
  await db.schema
    .createIndex('deck_import_folder_idx')
    .on('deck_import')
    .column('folder_id')
    .execute();

  await db.schema
    .createTable('deck_import_card')
    .addColumn('id', 'uuid', (col) => col.primaryKey())
    .addColumn('import_id', 'uuid', (col) =>
      col.notNull().references('deck_import.id').onDelete('cascade')
    )
    // Keyed on the file, never on deck_card: PUT /api/decks/:deckId/cards
    // deletes every row of that table and re-inserts with fresh ids, so a
    // column added there is gone after the next hand edit in the deck editor.
    .addColumn('file_id', 'uuid', (col) => col.notNull().references('file.id').onDelete('cascade'))
    .addColumn('identity_key', 'text', (col) => col.notNull())
    // A fact about the export rather than about the deck, which is why it is
    // here and not beside deck_card.position -- that column answers what order
    // the deck prints in, and a person is free to change it.
    .addColumn('page_number', 'integer', (col) => col.notNull())
    // The file left the bound folder. A soft mark, so the runs that already
    // named this card still resolve it.
    .addColumn('detached_at', 'timestamptz')
    // When a finished run handed this card to the deck. Null and live means the
    // deck has never been given it, which is what tells a card imported under
    // an abandoned run apart from one somebody took out of the deck by hand.
    .addColumn('added_to_deck_at', 'timestamptz')
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .addCheckConstraint('deck_import_card_page_positive', sql`page_number >= 1`)
    .execute();

  // Both predicated on detached_at, so a card that has left the folder stops
  // reserving its file and its key for the cards still in it.
  await sql`
    create unique index deck_import_card_unique_file
      on deck_import_card (file_id) where detached_at is null
  `.execute(db);
  await sql`
    create unique index deck_import_card_unique_identity
      on deck_import_card (import_id, identity_key) where detached_at is null
  `.execute(db);
  await sql`
    create index deck_import_card_page_idx
      on deck_import_card (import_id, page_number) where detached_at is null
  `.execute(db);

  await db.schema
    .createTable('import_run')
    .addColumn('id', 'uuid', (col) => col.primaryKey())
    .addColumn('import_id', 'uuid', (col) =>
      col.notNull().references('deck_import.id').onDelete('cascade')
    )
    .addColumn('status', 'text', (col) => col.notNull())
    .addColumn('source_label', 'text')
    // How many pages the client says it is about to post. Finishing checks the
    // count against it, so a transfer that stopped half way cannot be mistaken
    // for a deck that lost the cards it never sent.
    .addColumn('page_count', 'integer', (col) => col.notNull())
    // Restrict, the exception file_version.created_by already writes down.
    .addColumn('started_by', 'uuid', (col) =>
      col.notNull().references('app_user.id').onDelete('restrict')
    )
    .addColumn('started_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .addColumn('finished_at', 'timestamptz')
    // A cached projection of the ledger below. Every response derives its
    // counts instead of reading this, for the same reason there is no
    // current-version pointer on file.
    .addColumn('summary', 'jsonb')
    .addCheckConstraint('import_run_status_known', sql`status in ('open', 'finished', 'abandoned')`)
    .addCheckConstraint('import_run_page_count_in_range', sql`page_count between 1 and 500`)
    .addCheckConstraint(
      'import_run_open_is_unfinished',
      sql`(status = 'open') = (finished_at is null)`
    )
    .execute();

  await sql`
    create unique index import_run_one_open_per_import
      on import_run (import_id) where status = 'open'
  `.execute(db);
  await sql`
    create index import_run_timeline_idx
      on import_run (import_id, started_at desc)
  `.execute(db);

  // The plan, written once when the run starts and never rewritten. Every page
  // of the export gets a row saying which mapping row it will land on and what
  // that card's key becomes when the run finishes, so nothing a page does
  // depends on which other pages have arrived yet.
  await db.schema
    .createTable('import_run_page')
    .addColumn('id', 'uuid', (col) => col.primaryKey())
    .addColumn('run_id', 'uuid', (col) =>
      col.notNull().references('import_run.id').onDelete('cascade')
    )
    .addColumn('page_number', 'integer', (col) => col.notNull())
    // The mapping row this page will use, which for a page the plan calls new
    // does not exist yet -- the page inserts it under this id when its bytes
    // arrive. That is why there is no foreign key: the id is minted here and
    // honoured later, rather than pointing at a row that has to exist first.
    .addColumn('card_id', 'uuid', (col) => col.notNull())
    // How the plan found that card, and null when it found none.
    .addColumn('matched_by', 'text')
    // What the card's key becomes at finish. Chosen against the mapping as it
    // will stand once every page of this plan has been applied, so the whole
    // export is deconflicted before a single byte is uploaded.
    .addColumn('identity_key', 'text', (col) => col.notNull())
    .addCheckConstraint('import_run_page_page_positive', sql`page_number >= 1`)
    .addCheckConstraint(
      'import_run_page_matched_by_known',
      sql`matched_by is null or matched_by in ('identity', 'page_number')`
    )
    .execute();

  // Also the lookup a page does on arrival: one row, by run and number.
  await sql`
    create unique index import_run_page_unique_page
      on import_run_page (run_id, page_number)
  `.execute(db);
  // One page per card, so two pages of one export cannot both be planned onto
  // the same card however the plan was computed.
  await sql`
    create unique index import_run_page_unique_card
      on import_run_page (run_id, card_id)
  `.execute(db);

  await db.schema
    .createTable('import_run_card')
    .addColumn('id', 'uuid', (col) => col.primaryKey())
    .addColumn('run_id', 'uuid', (col) =>
      col.notNull().references('import_run.id').onDelete('cascade')
    )
    // Nullable by design. Purging the image must not erase what a past run did,
    // so the link goes and the name and page below carry the rest.
    .addColumn('import_card_id', 'uuid', (col) =>
      col.references('deck_import_card.id').onDelete('set null')
    )
    .addColumn('outcome', 'text', (col) => col.notNull())
    .addColumn('matched_by', 'text')
    .addColumn('restored', 'boolean', (col) => col.notNull().defaultTo(false))
    .addColumn('page_number', 'integer')
    // Copied off the file rather than joined to it, so the row still says which
    // card it was once import_card_id has gone null.
    .addColumn('name', 'text', (col) => col.notNull())
    .addColumn('file_version_number', 'integer')
    .addCheckConstraint(
      'import_run_card_outcome_known',
      sql`outcome in ('added', 'updated', 'unchanged', 'removed')`
    )
    .addCheckConstraint(
      'import_run_card_matched_by_known',
      sql`matched_by is null or matched_by in ('identity', 'page_number')`
    )
    .execute();

  // The memo a replayed page is answered from, and the reason a second post of
  // one page cannot import it twice.
  await sql`
    create unique index import_run_card_unique_page
      on import_run_card (run_id, page_number) where page_number is not null
  `.execute(db);
  await db.schema
    .createIndex('import_run_card_run_idx')
    .on('import_run_card')
    .column('run_id')
    .execute();
  // Not decoration: the set null above fires on every file purge.
  await db.schema
    .createIndex('import_run_card_card_idx')
    .on('import_run_card')
    .column('import_card_id')
    .execute();

  // Whether a person has named this file themselves. An import derives a name
  // from the page it came from and must not overwrite one somebody typed.
  await db.schema
    .alterTable('file')
    .addColumn('name_locked', 'boolean', (col) => col.notNull().defaultTo(false))
    .execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.alterTable('file').dropColumn('name_locked').execute();
  await db.schema.dropTable('import_run_card').execute();
  await db.schema.dropTable('import_run_page').execute();
  await db.schema.dropTable('import_run').execute();
  await db.schema.dropTable('deck_import_card').execute();
  await db.schema.dropTable('deck_import').execute();
}
