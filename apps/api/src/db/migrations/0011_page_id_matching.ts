import { type Kysely, sql } from 'kysely';

// Lets a card be recognised by the id its source gave the page, as well as by
// the title it was imported under.
//
// A column of its own rather than a fourth prefix on identity_key, because the
// two answer different questions and a card wants both. Folded into one column,
// adopting the id would throw the title away -- and the title is the only thing
// a ZIP import has, so a deck built that way could never be picked up by the
// app without tombstoning every card and adding it back.
//
// This ships alongside its writer rather than a release ahead, and the ordering
// is what makes that safe: the migrate Job runs before the rollout, so the
// widened constraints and the new columns are in place before any pod exists
// that writes them. A pod on the previous release goes on writing the two
// matched_by values it knows -- still admitted -- names its columns on every
// insert, and never selects what it does not know about. The direction that
// would need a release of its own is the reverse: narrowing either constraint
// has to wait until nothing on either side can still write what it refuses.
const WIDENED = sql`matched_by is null or matched_by in ('page_id', 'identity', 'page_number')`;
const ORIGINAL = sql`matched_by is null or matched_by in ('identity', 'page_number')`;

const CONSTRAINTS = [
  { table: 'import_run_page', name: 'import_run_page_matched_by_known' },
  { table: 'import_run_card', name: 'import_run_card_matched_by_known' },
] as const;

export async function up(db: Kysely<unknown>): Promise<void> {
  for (const { table, name } of CONSTRAINTS) {
    await sql`alter table ${sql.ref(table)} drop constraint ${sql.ref(name)}`.execute(db);
    await sql`
      alter table ${sql.ref(table)} add constraint ${sql.ref(name)} check (${WIDENED})
    `.execute(db);
  }

  // On the mapping row, this is what the card is known by. On the ledger row it
  // is what the plan decided the card should be known by, which finishing then
  // applies -- exactly the pair identity_key already forms across these two
  // tables.
  await db.schema.alterTable('deck_import_card').addColumn('source_page_id', 'text').execute();
  await db.schema.alterTable('import_run_page').addColumn('source_page_id', 'text').execute();

  // Predicated on detached_at like the identity index beside it, and on the
  // column being present: a deck's ZIP-imported cards all have none, and null
  // is not a value two rows can collide on anyway.
  await sql`
    create unique index deck_import_card_unique_source_page
      on deck_import_card (import_id, source_page_id)
      where detached_at is null and source_page_id is not null
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`drop index deck_import_card_unique_source_page`.execute(db);
  await db.schema.alterTable('import_run_page').dropColumn('source_page_id').execute();
  await db.schema.alterTable('deck_import_card').dropColumn('source_page_id').execute();

  // The ledger is what a deck's history is made of, so a row is reset rather
  // than deleted -- and to 'page_number' rather than null, because a matched
  // row that lost its tier would read as one that matched nothing at all.
  for (const table of ['import_run_page', 'import_run_card'] as const) {
    await sql`
      update ${sql.ref(table)} set matched_by = 'page_number' where matched_by = 'page_id'
    `.execute(db);
  }

  for (const { table, name } of CONSTRAINTS) {
    await sql`alter table ${sql.ref(table)} drop constraint ${sql.ref(name)}`.execute(db);
    await sql`
      alter table ${sql.ref(table)} add constraint ${sql.ref(name)} check (${ORIGINAL})
    `.execute(db);
  }
}
