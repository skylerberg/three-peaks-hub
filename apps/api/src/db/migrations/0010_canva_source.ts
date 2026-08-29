import { type Kysely, sql } from 'kysely';

// Widens what an import may say it came from, and gives it somewhere to name
// the design it came from.
//
// Both halves are here a release before anything writes either. The migrate Job
// runs before the rollout, so a pod on the previous release is still serving
// while this is in place, and its CHECK constraint is the one that would refuse
// a value written by a pod on the next one. Widening first is what makes the
// release after this free to write 'canva'.
//
//  * The CHECK only ever ADMITS more rows. Nothing the previous release writes
//    starts failing, and nothing it reads changes shape.
//  * `source_ref` is nullable with no default. Every insert of a deck_import
//    names its columns and every select names the ones it wants, so the
//    previous release leaves it null and never sees it.
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    alter table deck_import drop constraint deck_import_source_kind_known
  `.execute(db);
  await sql`
    alter table deck_import add constraint deck_import_source_kind_known
      check (source_kind in ('zip', 'canva'))
  `.execute(db);

  // What the source calls the thing an export came out of, when it has an
  // identity of its own. A ZIP has none -- its name is all there is, which is
  // why resuming compares labels -- and a Canva design has a stable id, which
  // settles what a label cannot: an export taken after an edit arrives under
  // the name the run already holds.
  await db.schema.alterTable('deck_import').addColumn('source_ref', 'text').execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.alterTable('deck_import').dropColumn('source_ref').execute();

  // Rows the widened constraint admitted have to go before the narrow one can
  // be put back, and a deck_import is the anchor of a deck's whole history --
  // so the kind is reset rather than the row deleted. Down is for a schema
  // nothing has used yet; past that, the way back is a further migration.
  await sql`update deck_import set source_kind = 'zip' where source_kind <> 'zip'`.execute(db);
  await sql`
    alter table deck_import drop constraint deck_import_source_kind_known
  `.execute(db);
  await sql`
    alter table deck_import add constraint deck_import_source_kind_known
      check (source_kind in ('zip'))
  `.execute(db);
}
