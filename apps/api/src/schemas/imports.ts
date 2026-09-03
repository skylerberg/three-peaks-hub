import { type } from 'arktype';
import {
  IMPORT_MATCHED_BY,
  IMPORT_PAGE_ID_MAX_LENGTH,
  IMPORT_TITLE_MAX_LENGTH,
  MAX_DECK_CARDS,
} from '@three-peaks/shared';
import { optionalText, stringWithLength, uuid } from './common.ts';

// Enumerated rather than left a bare string, so adding a matching tier shows up
// as a red diff in the generated client -- which is exactly the change a client
// otherwise renders a blank cell for.
const matchedBy = type.enumerated(...IMPORT_MATCHED_BY).or('null');

export const deckImportSchema = type({
  id: 'string',
  deck_id: 'string',
  source_label: 'string | null',
  open_run_id: 'string | null',
  created_at: 'string',
  updated_at: 'string',
});

export const importRunCountsSchema = type({
  pages: 'number',
  added: 'number',
  updated: 'number',
  unchanged: 'number',
  removed: 'number',
  restored: 'number',
});

export const importRunSchema = type({
  id: 'string',
  import_id: 'string',
  status: 'string',
  source_label: 'string | null',
  page_count: 'number',
  started_by: 'string',
  started_at: 'string',
  finished_at: 'string | null',
  // Derived from the ledger on every read, never the cached column.
  counts: importRunCountsSchema,
});

export const importRunListSchema = type({
  runs: importRunSchema.array(),
});

// One card as a run left it. file_id is null once the image has been purged;
// the name and the page number are copied onto the row so it still says which
// card this was.
export const importRunCardSchema = type({
  page_number: 'number | null',
  outcome: 'string',
  matched_by: matchedBy,
  restored: 'boolean',
  name: 'string',
  file_id: 'string | null',
  file_version_number: 'number | null',
});

export const importRunDetailSchema = type({
  run: importRunSchema,
  cards: importRunCardSchema.array(),
});

// One card the imports had put in a deck, as of one run. Not the same row as
// importRunCardSchema: that one says what a run did, this one says what stood.
export const importRunDeckCardSchema = type({
  card_id: 'string',
  // Never null here: a purged card's ledger rows lost their mapping row and are
  // left out entirely. has_purged_history is how the screen learns that.
  file_id: 'string',
  name: 'string',
  // The version that run left this card at -- not the version the file happened
  // to be at when the run ran. A hand upload or a restore between runs moves the
  // file and writes no ledger row.
  file_version_number: 'number | null',
  // The export page of the run that last touched this card, kept only so the
  // order is stable. It is not a position in the deck, and two cards can share
  // one when a card is carried forward from an older export.
  page_number: 'number | null',
  last_run_id: 'string',
  outcome: 'string',
  // When the image was tombstoned, or null while it is not. A boolean here is
  // the present tense read as a claim about the past: the screen anchors this
  // against the run it is showing, and a file deleted before that run was
  // deleted before it. The card stood in the deck either way -- deleting a
  // card's image does not take the card out of the deck.
  image_deleted_at: 'string | null',
});

export const importRunDeckSchema = type({
  run: importRunSchema,
  cards: importRunDeckCardSchema.array(),
  // A boolean and never a count. A purged card's rows carry a null
  // import_card_id and nothing correlates them across runs, so how many there
  // were is not recoverable -- only that there was at least one.
  has_purged_history: 'boolean',
});

export const importPageResultSchema = type({
  page_number: 'number',
  outcome: 'string',
  matched_by: matchedBy,
  restored: 'boolean',
  // True when this page had already landed and the answer was read back off
  // its ledger row rather than worked out a second time.
  replayed: 'boolean',
  // Null only on a replay whose image has been purged since it landed: the
  // ledger still says what happened, and there is no longer a file to name.
  file_id: 'string | null',
  file_version_number: 'number | null',
  name: 'string',
});

// One rule for a page title, held by the manifest and by the upload that
// follows it, so neither can take a title the other refuses. The manifest used
// optionalText, which truncates: an over-long title was cut down into the plan
// and then refused by the page carrying it, and a run short of its page count
// can never finish, so abandoning it was the only way out. Control characters
// were the same shape of gap, and they end up in a filename.
const importTitle = stringWithLength(1, IMPORT_TITLE_MAX_LENGTH);

// The whole export, before any of it is uploaded. Page numbers have to be
// 1..n exactly once each: the run's page count is the length of this list, and
// finishing checks that count rather than enumerating what landed.
// The page's own id in the design it came from, and the strongest thing said
// about it. Required: the Canva app reads the design and always has one, and a
// manifest without it can only be matched by title and number -- which is a
// weaker import arriving silently rather than a caller being told. It is an
// opaque string from another system, so it is bounded and screened for control
// characters and otherwise taken exactly as given.
const sourcePageId = stringWithLength(1, IMPORT_PAGE_ID_MAX_LENGTH);

export const importRunPageInputSchema = type({
  page_number: `1 <= number.integer <= ${MAX_DECK_CARDS}`,
  'title?': importTitle,
  page_id: sourcePageId,
});

export const startImportRunRequestSchema = type({
  'id?': uuid,
  'source_label?': optionalText(IMPORT_TITLE_MAX_LENGTH),
  pages: importRunPageInputSchema.array().atLeastLength(1).atMostLength(MAX_DECK_CARDS),
});

// What starting the run decided, so a person can be shown what re-importing is
// about to do before fifty-four images are uploaded. `action` is what the page
// does to the deck, not what it does to the artwork: a page landing on a card
// that already exists says `update` whether or not its bytes turn out to have
// changed, which only appending the version can tell.
export const importPlanPageSchema = type({
  page_number: 'number',
  title: 'string | null',
  action: "'add' | 'update'",
  matched_by: matchedBy,
  // The card this page matched, as it is named right now, and null for a page
  // the plan calls new. What the file will be called afterwards is the page's
  // own title, which the caller already has.
  name: 'string | null',
});

// A card the export has stopped having, named rather than counted: this is the
// destructive half of the plan and the only chance to see it before it happens.
export const importPlanRemovalSchema = type({
  file_id: 'string',
  name: 'string',
});

export const importRunPlanSchema = type({
  added: 'number',
  updated: 'number',
  removed: importPlanRemovalSchema.array(),
  pages: importPlanPageSchema.array(),
});

export const startedImportRunSchema = importRunSchema.and({ plan: importRunPlanSchema });

export const importPageQuerySchema = type({
  page_number: '/^[1-9][0-9]{0,3}$/',
  'title?': importTitle,
});
