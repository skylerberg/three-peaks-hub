import { type Kysely, sql } from 'kysely';

// Gives a place in its deck back to live artwork that lost one.
//
// A deck's cards are exactly its own live images, bar a back that is not itself
// a card, and the deck editor validates every saved list against that rule --
// so a live image the deck owns with no `deck_card` row is a deck no hand edit
// can save at all, only a list refused for leaving it out. Two paths left one
// behind: an import removal took the row while tombstoning the artwork and a
// later restore brought the file back without it, and a saved list that named
// every card but a tombstoned one dropped that row for good.
//
// Backward-compatible in the direction that matters: the previous release is
// the one demanding these rows, so a pod still serving it is unjammed by this
// rather than surprised. Both paths are closed in the release this ships with.
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    insert into deck_card (id, deck_id, file_id, quantity, position)
    select
      gen_random_uuid(),
      stranded.deck_id,
      stranded.id,
      1,
      coalesce(
        (select max(held.position) from deck_card held where held.deck_id = stranded.deck_id),
        -1
      )
      + row_number() over (
          partition by stranded.deck_id order by lower(stranded.filename), stranded.id
        )
    from file stranded
    join deck owner on owner.id = stranded.deck_id
    where stranded.deleted_at is null
      and (owner.back_file_id is null or owner.back_file_id <> stranded.id)
      and not exists (
        select 1 from deck_card held
        where held.deck_id = stranded.deck_id and held.file_id = stranded.id
      )
  `.execute(db);
}

// Nothing to undo: which of these rows this migration wrote is not recorded,
// and every one of them is a row the schema before it already wanted.
export async function down(): Promise<void> {}
