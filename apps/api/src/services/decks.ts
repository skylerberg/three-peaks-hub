import { AppError } from '../utils/errors.ts';
import { FILE_COLUMNS, serializeFile } from './files.ts';
import type { AppContext, Connection } from '../types/index.ts';

// One reader for a deck and one for its cards, in a service rather than in the
// deck routes: the import finishes a run by rewriting a deck's contents, and an
// event announcing that has to carry the same rows the deck routes answer with.

interface DeckRow {
  id: string;
  project_id: string;
  name: string;
  // numeric comes back from pg as a string, the way bigint does.
  card_width_mm: string | number;
  card_height_mm: string | number;
  back_file_id: string | null;
  created_by: string;
  created_at: Date | string;
  updated_at: Date | string;
  deleted_at: Date | string | null;
  card_count: string | number | null;
  total_copies: string | number | null;
}

const DECK_COLUMNS = [
  'deck.id as id',
  'deck.project_id as project_id',
  'deck.name as name',
  'deck.card_width_mm as card_width_mm',
  'deck.card_height_mm as card_height_mm',
  'deck.back_file_id as back_file_id',
  'deck.created_by as created_by',
  'deck.created_at as created_at',
  'deck.updated_at as updated_at',
  'deck.deleted_at as deleted_at',
] as const;

export function serializeDeck(row: DeckRow) {
  return {
    id: row.id,
    project_id: row.project_id,
    name: row.name,
    card_width_mm: Number(row.card_width_mm),
    card_height_mm: Number(row.card_height_mm),
    back_file_id: row.back_file_id,
    created_by: row.created_by,
    created_at: new Date(row.created_at).toISOString(),
    updated_at: new Date(row.updated_at).toISOString(),
    deleted_at: row.deleted_at === null ? null : new Date(row.deleted_at).toISOString(),
    card_count: Number(row.card_count ?? 0),
    total_copies: Number(row.total_copies ?? 0),
  };
}

// The two totals every deck is listed with, as a correlated subquery each rather
// than a join: a join to deck_card would multiply the deck rows and both numbers
// would then have to be undone with a group by.
export function withCounts(db: Connection) {
  return db.selectFrom('deck').select((eb) => [
    ...DECK_COLUMNS,
    eb
      .selectFrom('deck_card')
      .whereRef('deck_card.deck_id', '=', 'deck.id')
      .select((inner) => inner.fn.countAll<string>().as('count'))
      .as('card_count'),
    eb
      .selectFrom('deck_card')
      .whereRef('deck_card.deck_id', '=', 'deck.id')
      .select((inner) => inner.fn.sum<string>('deck_card.quantity').as('total'))
      .as('total_copies'),
  ]);
}

export async function readDeck(c: Pick<AppContext, 'get'>, deckId: string) {
  const row = await withCounts(c.get('db')).where('deck.id', '=', deckId).executeTakeFirst();
  if (!row) throw new AppError(404, 'Deck not found');
  return serializeDeck(row);
}

export async function readDeckCards(c: Pick<AppContext, 'get'>, deckId: string) {
  const rows = await c
    .get('db')
    .selectFrom('deck_card')
    .innerJoin('file', 'file.id', 'deck_card.file_id')
    // The same columns and the same serializer every other read of a file uses.
    // Building the embedded object by hand here is what left name_locked off it
    // while the schema went on declaring it.
    .select(['deck_card.quantity as quantity', 'deck_card.position as position', ...FILE_COLUMNS])
    .where('deck_card.deck_id', '=', deckId)
    // id breaks the tie, so a listing is stable rather than whatever order the
    // planner happened to return equal positions in.
    .orderBy('deck_card.position', 'asc')
    .orderBy('deck_card.id', 'asc')
    .execute();

  return rows.map((row) => ({
    file_id: row.id,
    quantity: row.quantity,
    position: row.position,
    file: serializeFile(row),
  }));
}

/**
 * Refuses a card list that is not exactly the deck's own live artwork, bar a
 * back image that is not itself a card.
 *
 * Both halves matter. A file the deck does not own would be a card that Assets
 * still lists, which is the duplication owning artwork exists to remove; and a
 * file left out would be artwork in the deck that no list names, which is a
 * third place for an image to be and the one state this arrangement has none
 * of. Removing a card means deleting it or moving it to Assets, and the message
 * says so, because there is no other way to say it from here.
 */
export async function assertCardFiles(
  c: Pick<AppContext, 'get'>,
  deckId: string,
  fileIds: readonly string[]
): Promise<void> {
  const db = c.get('db');
  const deck = await db
    .selectFrom('deck')
    .select(['deck.back_file_id as back_file_id'])
    .where('deck.id', '=', deckId)
    .executeTakeFirstOrThrow();

  const owned = await db
    .selectFrom('file')
    .select(['file.id as id', 'file.filename as filename'])
    .where('file.deck_id', '=', deckId)
    .where('file.deleted_at', 'is', null)
    .orderBy('file.filename', 'asc')
    .execute();

  const ownedIds = new Set(owned.map((row) => row.id));
  const given = new Set(fileIds);

  for (const id of given) {
    if (!ownedIds.has(id)) {
      throw new AppError(
        422,
        'Every card has to be an image this deck holds. Upload it here, or move it in from Assets.'
      );
    }
  }

  const stranded = owned.filter((row) => !given.has(row.id) && row.id !== deck.back_file_id);
  if (stranded.length > 0) {
    const rest = stranded.length === 1 ? '' : ` and ${stranded.length - 1} more`;
    throw new AppError(
      422,
      `"${stranded[0].filename}"${rest} would be left in this deck with no place in it. Delete it, or move it to Assets.`
    );
  }
}
