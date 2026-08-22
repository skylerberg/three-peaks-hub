import { type } from 'arktype';
import { IMPORT_TITLE_MAX_LENGTH, MAX_DECK_CARDS } from '@three-peaks/shared';
import { optionalText, stringWithLength, uuid } from './common.ts';

export const deckImportSchema = type({
  id: 'string',
  deck_id: 'string',
  // Null is a binding with no folder: unbound by hand, or purged out from
  // under it. The cards and the runs are still here either way.
  folder_id: 'string | null',
  source_kind: 'string',
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
  matched_by: 'string | null',
  restored: 'boolean',
  name: 'string',
  file_id: 'string | null',
  file_version_number: 'number | null',
});

export const importRunDetailSchema = type({
  run: importRunSchema,
  cards: importRunCardSchema.array(),
});

export const importPageResultSchema = type({
  page_number: 'number',
  outcome: 'string',
  matched_by: 'string | null',
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

export const putDeckImportRequestSchema = type({
  folder_id: uuid,
  'source_kind?': "'zip'",
  'source_label?': optionalText(IMPORT_TITLE_MAX_LENGTH),
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
export const importRunPageInputSchema = type({
  page_number: `1 <= number.integer <= ${MAX_DECK_CARDS}`,
  'title?': importTitle,
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
  matched_by: 'string | null',
});

export const importRunPlanSchema = type({
  added: 'number',
  updated: 'number',
  removed: 'number',
  pages: importPlanPageSchema.array(),
});

export const startedImportRunSchema = importRunSchema.and({ plan: importRunPlanSchema });

export const importPageQuerySchema = type({
  page_number: '/^[1-9][0-9]{0,3}$/',
  'title?': importTitle,
});
