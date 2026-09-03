import { type Kysely, sql } from 'kysely';

// A card the deck holds and prints none of. The row, its position and its
// artwork all stay; only the number of pieces of card behind it goes to zero.
//
// Backward compatible with the previous release, which reads the column as a
// number and would serve a zero without noticing. What that release refuses is
// writing one -- its request schema still says one at least -- so during the
// rollout a save from a pod on it answers 422 and the same save on a new pod
// succeeds. That is a validation message for the length of one rollout rather
// than a partial write, which is why the constraint moves a release ahead of
// nothing.
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    alter table deck_card drop constraint deck_card_quantity_in_range
  `.execute(db);
  await sql`
    alter table deck_card add constraint deck_card_quantity_in_range
      check (quantity between 0 and 999)
  `.execute(db);
}

// A development affordance rather than a rollout mechanism, like 0013's. The
// old constraint refuses every zeroed card, and there is nowhere to read back
// what a person meant by one, so they come back as a single copy -- which is
// the deck the release before this one could describe.
export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`update deck_card set quantity = 1 where quantity = 0`.execute(db);
  await sql`
    alter table deck_card drop constraint deck_card_quantity_in_range
  `.execute(db);
  await sql`
    alter table deck_card add constraint deck_card_quantity_in_range
      check (quantity between 1 and 999)
  `.execute(db);
}
