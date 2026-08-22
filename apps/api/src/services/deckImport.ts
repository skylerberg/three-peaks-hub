import type { Readable } from 'node:stream';
import { sql } from 'kysely';
import {
  ALLOWED_IMAGE_TYPES,
  MAX_DECK_CARDS,
  MAX_UPLOAD_BYTES,
  deckIdentityKey,
  deckPageFilename,
  extensionForImageType,
  type ImportRunSummary,
} from '@three-peaks/shared';
import { AppError, isUniqueViolation } from '../utils/errors.ts';
import { newId } from '../utils/uuid.ts';
import type { ImportAccess, ImportRunAccess } from './authorization.ts';
import {
  appendFileVersion,
  assertQuota,
  freeFilename,
  restoreFile,
  storeUpload,
  type StoredUpload,
} from './files.ts';
import { blockedMessage, deletedAncestor } from './folderTree.ts';
import { publishAfterCommit } from './realtime/index.ts';
import { deleteStoredObjectsAfterCommit, reclaim } from './storage/index.ts';
import type { AppContext, Connection } from '../types/index.ts';

// Keeping a deck's artwork in step with an export, in three moving parts: a
// binding that says where the images live, a run that carries one export from
// the first page to the last, and a mapping row per card that survives both.
//
// The rule the rest of this file is arranged around: which page becomes which
// card is decided once, at run start, before any bytes exist. Starting a run
// takes the whole page manifest, walks it in page-number order against the
// mapping as it stands, and writes a plan row per page. Uploading a page then
// looks its plan row up and appends a version -- it matches nothing, so there
// is nothing left for arrival order to decide. Finishing applies every planned
// key in one statement, which is the only moment the mapping is rewritten.

type Ctx = Pick<AppContext, 'get'>;

export interface SerializedImport {
  id: string;
  deck_id: string;
  folder_id: string | null;
  source_kind: string;
  source_label: string | null;
  open_run_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface SerializedRun {
  id: string;
  import_id: string;
  status: string;
  source_label: string | null;
  page_count: number;
  started_by: string;
  started_at: string;
  finished_at: string | null;
  counts: ImportRunSummary;
}

interface SerializedRunCard {
  page_number: number | null;
  outcome: string;
  matched_by: string | null;
  restored: boolean;
  name: string;
  file_id: string | null;
  file_version_number: number | null;
}

export interface RunDetail {
  run: SerializedRun;
  cards: SerializedRunCard[];
}

export interface ImportPageInput {
  pageNumber: number;
  title: string | null;
  body: Readable;
  declaredContentType: string;
  declaredLength: number;
}

interface ImportPageResult {
  page_number: number;
  outcome: string;
  matched_by: string | null;
  restored: boolean;
  replayed: boolean;
  file_id: string | null;
  file_version_number: number | null;
  name: string;
}

export interface ImportPageOutcome {
  result: ImportPageResult;
  // Whether a file row or a version row came out of this request, which is the
  // difference between a 201 and a 200.
  created: boolean;
}

const NOT_BOUND = 'This deck is not bound to an import folder';

function assertOpenRun(status: string): void {
  if (status !== 'open') throw new AppError(409, 'That import run is closed');
}

function assertBoundFolder(folderId: string | null): string {
  if (folderId === null) throw new AppError(409, NOT_BOUND);
  return folderId;
}

async function assertFolderVisible(db: Connection, folderId: string): Promise<void> {
  const blocked = await deletedAncestor(db, folderId);
  if (blocked !== null) throw new AppError(409, blockedMessage(blocked, 'This import'));
}

// --- the binding ------------------------------------------------------------

export async function readBinding(c: Ctx, deckId: string): Promise<SerializedImport> {
  const row = await c
    .get('db')
    .selectFrom('deck_import')
    .select((eb) => [
      'deck_import.id as id',
      'deck_import.deck_id as deck_id',
      'deck_import.folder_id as folder_id',
      'deck_import.source_kind as source_kind',
      'deck_import.source_label as source_label',
      'deck_import.created_at as created_at',
      'deck_import.updated_at as updated_at',
      eb
        .selectFrom('import_run')
        .whereRef('import_run.import_id', '=', 'deck_import.id')
        .where('import_run.status', '=', 'open')
        .select(['import_run.id as id'])
        .as('open_run_id'),
    ])
    .where('deck_import.deck_id', '=', deckId)
    .executeTakeFirstOrThrow();

  return {
    id: row.id,
    deck_id: row.deck_id,
    folder_id: row.folder_id,
    source_kind: row.source_kind,
    source_label: row.source_label,
    open_run_id: row.open_run_id ?? null,
    created_at: new Date(row.created_at).toISOString(),
    updated_at: new Date(row.updated_at).toISOString(),
  };
}

export interface BindImportInput {
  folderId: string;
  sourceKind: string;
  sourceLabel: string | null;
}

export async function bindImport(
  c: Ctx,
  deckId: string,
  projectId: string,
  input: BindImportInput
): Promise<{ binding: SerializedImport; created: boolean }> {
  const db = c.get('db');

  const folder = await db
    .selectFrom('folder')
    .select(['folder.id as id'])
    .where('folder.id', '=', input.folderId)
    .where('folder.project_id', '=', projectId)
    .executeTakeFirst();
  // Indistinguishable from a folder in somebody else's project, deliberately.
  if (!folder) throw new AppError(404, 'Folder not found');
  if ((await deletedAncestor(db, input.folderId)) !== null) {
    throw new AppError(404, 'Folder not found');
  }

  const existing = await db
    .selectFrom('deck_import')
    .select(['deck_import.id as id', 'deck_import.folder_id as folder_id'])
    .where('deck_import.deck_id', '=', deckId)
    .forUpdate()
    .executeTakeFirst();

  if (!existing) {
    try {
      await db
        .insertInto('deck_import')
        .values({
          id: newId(),
          deck_id: deckId,
          folder_id: input.folderId,
          source_kind: input.sourceKind,
          source_label: input.sourceLabel,
        })
        .execute();
    } catch (error) {
      // Two binds of one deck at once; the unique on deck_id refuses the second.
      if (isUniqueViolation(error)) {
        throw new AppError(409, 'This deck is already bound to a folder');
      }
      throw error;
    }
    return { binding: await readBinding(c, deckId), created: true };
  }

  // Asked about the cards rather than about the old folder id, so re-binding
  // the folder an unbind left behind resumes instead of being refused.
  const stray = await db
    .selectFrom('deck_import_card')
    .innerJoin('file', 'file.id', 'deck_import_card.file_id')
    .select(['deck_import_card.id as id'])
    .where('deck_import_card.import_id', '=', existing.id)
    .where('deck_import_card.detached_at', 'is', null)
    .where(sql<boolean>`file.folder_id is distinct from ${input.folderId}::uuid`)
    .limit(1)
    .executeTakeFirst();
  if (stray) {
    throw new AppError(
      409,
      'This deck has imported cards in another folder. Move them there first, or unbind'
    );
  }

  await db
    .updateTable('deck_import')
    .set({
      folder_id: input.folderId,
      source_kind: input.sourceKind,
      source_label: input.sourceLabel,
      updated_at: new Date(),
    })
    .where('deck_import.id', '=', existing.id)
    .execute();

  return { binding: await readBinding(c, deckId), created: false };
}

export async function unbindImport(c: Ctx, access: ImportAccess): Promise<void> {
  const db = c.get('db');
  await assertNoOpenRun(db, access.importId);

  // A row with no folder rather than no row: deleting it would cascade the
  // mapping and every run away, and re-binding would then see each card as new.
  await db
    .updateTable('deck_import')
    .set({ folder_id: null, updated_at: new Date() })
    .where('deck_import.id', '=', access.importId)
    .execute();
}

async function assertNoOpenRun(db: Connection, importId: string): Promise<void> {
  const open = await readOpenRun(db, importId);
  if (open) {
    throw new AppError(409, 'An import run is open for this deck. Finish or abandon it first', {
      run_id: open.id,
      started_at: new Date(open.started_at).toISOString(),
    });
  }
}

async function readOpenRun(db: Connection, importId: string) {
  return await db
    .selectFrom('import_run')
    .select(['import_run.id as id', 'import_run.started_at as started_at'])
    .where('import_run.import_id', '=', importId)
    .where('import_run.status', '=', 'open')
    .executeTakeFirst();
}

// --- runs -------------------------------------------------------------------

const RUN_COLUMNS = [
  'import_run.id as id',
  'import_run.import_id as import_id',
  'import_run.status as status',
  'import_run.source_label as source_label',
  'import_run.page_count as page_count',
  'import_run.started_by as started_by',
  'import_run.started_at as started_at',
  'import_run.finished_at as finished_at',
] as const;

function emptySummary(): ImportRunSummary {
  return { pages: 0, added: 0, updated: 0, unchanged: 0, removed: 0, restored: 0 };
}

// Counted off the ledger on every read. The summary column is a cache of this
// and nothing reads it back, so the two can never be seen disagreeing. One
// query for a whole timeline rather than one per run, which is what keeps a
// deck imported daily for three years to a single group by.
async function countsByRun(
  db: Connection,
  runIds: string[]
): Promise<Map<string, ImportRunSummary>> {
  const summaries = new Map(runIds.map((id) => [id, emptySummary()]));
  if (runIds.length === 0) return summaries;

  const rows = await db
    .selectFrom('import_run_card')
    .select((eb) => [
      'import_run_card.run_id as run_id',
      'import_run_card.outcome as outcome',
      eb.fn.countAll<string>().as('count'),
      sql<string>`count(*) filter (where import_run_card.restored)`.as('restored'),
    ])
    .where('import_run_card.run_id', 'in', runIds)
    .groupBy(['import_run_card.run_id', 'import_run_card.outcome'])
    .execute();

  for (const row of rows) {
    const summary = summaries.get(row.run_id);
    if (!summary) continue;
    const total = Number(row.count);
    if (row.outcome === 'added') summary.added += total;
    else if (row.outcome === 'updated') summary.updated += total;
    else if (row.outcome === 'unchanged') summary.unchanged += total;
    else if (row.outcome === 'removed') summary.removed += total;
    // A removed card carries no page: it is what the export stopped having.
    if (row.outcome !== 'removed') summary.pages += total;
    summary.restored += Number(row.restored);
  }
  return summaries;
}

interface RunRow {
  id: string;
  import_id: string;
  status: string;
  source_label: string | null;
  page_count: number;
  started_by: string;
  started_at: Date | string;
  finished_at: Date | string | null;
}

function serializeRun(row: RunRow, counts: ImportRunSummary): SerializedRun {
  return {
    id: row.id,
    import_id: row.import_id,
    status: row.status,
    source_label: row.source_label,
    page_count: row.page_count,
    started_by: row.started_by,
    started_at: new Date(row.started_at).toISOString(),
    finished_at: row.finished_at === null ? null : new Date(row.finished_at).toISOString(),
    counts,
  };
}

async function runCounts(db: Connection, runId: string): Promise<ImportRunSummary> {
  return (await countsByRun(db, [runId])).get(runId) ?? emptySummary();
}

async function readRun(c: Ctx, runId: string): Promise<SerializedRun> {
  const db = c.get('db');
  const row = await db
    .selectFrom('import_run')
    .select(RUN_COLUMNS)
    .where('import_run.id', '=', runId)
    .executeTakeFirstOrThrow();
  return serializeRun(row, await runCounts(db, runId));
}

export async function readTimeline(c: Ctx, importId: string): Promise<SerializedRun[]> {
  const db = c.get('db');
  const rows = await db
    .selectFrom('import_run')
    .select(RUN_COLUMNS)
    .where('import_run.import_id', '=', importId)
    .orderBy('import_run.started_at', 'desc')
    .orderBy('import_run.id', 'desc')
    .execute();

  const counts = await countsByRun(
    db,
    rows.map((row) => row.id)
  );
  return rows.map((row) => serializeRun(row, counts.get(row.id) ?? emptySummary()));
}

export async function readRunDetail(c: Ctx, runId: string): Promise<RunDetail> {
  const run = await readRun(c, runId);
  const cards = await c
    .get('db')
    .selectFrom('import_run_card')
    .leftJoin('deck_import_card', 'deck_import_card.id', 'import_run_card.import_card_id')
    .select([
      'import_run_card.page_number as page_number',
      'import_run_card.outcome as outcome',
      'import_run_card.matched_by as matched_by',
      'import_run_card.restored as restored',
      'import_run_card.name as name',
      'import_run_card.file_version_number as file_version_number',
      'deck_import_card.file_id as file_id',
    ])
    .where('import_run_card.run_id', '=', runId)
    // Removed cards carry no page and sort after the pages that were posted.
    .orderBy('import_run_card.page_number', (ob) => ob.asc().nullsLast())
    .orderBy('import_run_card.id', 'asc')
    .execute();

  return { run, cards };
}

interface StartRunPage {
  pageNumber: number;
  title: string | null;
}

export interface StartRunInput {
  id?: string;
  sourceLabel: string | null;
  pages: StartRunPage[];
}

interface RunPlanPage {
  page_number: number;
  title: string | null;
  action: 'add' | 'update';
  matched_by: string | null;
}

interface RunPlan {
  added: number;
  updated: number;
  removed: number;
  pages: RunPlanPage[];
}

export interface StartedRun extends SerializedRun {
  plan: RunPlan;
}

// One card as the mapping holds it when a run starts. `file_live` rather than a
// timestamp because the only question asked of it is whether the card is a
// tombstone -- and a tombstone is what a returning card is found as.
interface MappingRow {
  card_id: string;
  identity_key: string;
  page_number: number;
  added_to_deck_at: Date | string | null;
  file_live: boolean;
}

interface PlannedPage {
  pageNumber: number;
  title: string | null;
  cardId: string;
  matchedBy: 'identity' | 'page_number' | null;
  identityKey: string;
}

// Numbered 1..n, each exactly once. That is what an export is, and it is what
// lets finishing compare a count against the manifest rather than enumerate
// which pages did and did not land.
function orderedManifest(pages: StartRunPage[]): StartRunPage[] {
  const sorted = [...pages].sort((a, b) => a.pageNumber - b.pageNumber);
  for (const [index, page] of sorted.entries()) {
    if (page.pageNumber !== index + 1) {
      throw new AppError(422, `An export's pages are numbered 1 to ${sorted.length}, each once`);
    }
  }
  return sorted;
}

async function readLiveMapping(
  db: Connection,
  importId: string,
  folderId: string
): Promise<MappingRow[]> {
  return await db
    .selectFrom('deck_import_card')
    .innerJoin('file', 'file.id', 'deck_import_card.file_id')
    .select([
      'deck_import_card.id as card_id',
      'deck_import_card.identity_key as identity_key',
      'deck_import_card.page_number as page_number',
      'deck_import_card.added_to_deck_at as added_to_deck_at',
      sql<boolean>`file.deleted_at is null`.as('file_live'),
    ])
    .where('deck_import_card.import_id', '=', importId)
    .where('deck_import_card.detached_at', 'is', null)
    .where('file.folder_id', '=', folderId)
    // The order the page-number probe reads its candidates in, and every part
    // of it is total: a live card before a tombstoned one, because restoring a
    // tombstone while a live card still sits at that number is the worse
    // mistake; then the card that has held the position longest; then the id.
    .orderBy(sql<boolean>`file.deleted_at is null`, 'desc')
    .orderBy('deck_import_card.created_at', 'asc')
    .orderBy('deck_import_card.id', 'asc')
    .execute();
}

/**
 * Assigns every page of an export to a card, in two passes over the manifest.
 *
 * Every page's identity is settled first, and only then does what is left probe
 * by page number. One interleaved walk would let an earlier page's page-number
 * fallback take the card a later page names outright -- an export with a page
 * slid into the middle of it moves every title down one, so the weaker claim
 * would win on nothing but being walked first.
 *
 * Both passes go in page order, so two pages of one export sharing a title
 * settle the same way every time: the lower-numbered one keeps the card, and
 * the other falls to the page number and then to a card that does not exist
 * yet, rather than the export being refused.
 */
function planPages(pages: StartRunPage[], mapping: MappingRow[]): PlannedPage[] {
  const byIdentity = new Map<string, MappingRow>();
  const byPage = new Map<number, MappingRow[]>();
  for (const row of mapping) {
    if (!byIdentity.has(row.identity_key)) byIdentity.set(row.identity_key, row);
    const bucket = byPage.get(row.page_number);
    if (bucket) bucket.push(row);
    else byPage.set(row.page_number, [row]);
  }

  const claimed = new Set<string>();
  const matches = new Map<number, { row: MappingRow; matchedBy: PlannedPage['matchedBy'] }>();
  const keys = pages.map((page) => deckIdentityKey(page.pageNumber, page.title));

  for (const [index, key] of keys.entries()) {
    const row = byIdentity.get(key);
    if (!row || claimed.has(row.card_id)) continue;
    claimed.add(row.card_id);
    matches.set(index, { row, matchedBy: 'identity' });
  }

  for (const [index, page] of pages.entries()) {
    if (matches.has(index)) continue;
    const row = (byPage.get(page.pageNumber) ?? []).find(
      (candidate) => !claimed.has(candidate.card_id)
    );
    if (!row) continue;
    claimed.add(row.card_id);
    matches.set(index, { row, matchedBy: 'page_number' });
  }

  const planned: PlannedPage[] = pages.map((page, index) => {
    const match = matches.get(index);
    return {
      pageNumber: page.pageNumber,
      title: page.title,
      cardId: match?.row.card_id ?? newId(),
      matchedBy: match?.matchedBy ?? null,
      identityKey: keys[index],
    };
  });

  // The keys that will still be spoken for once this plan has been applied: a
  // card the plan did not claim keeps the key it has, and a card it did claim
  // gives that key up. Walked in page order, so the lowest-numbered page of a
  // repeated title is the one that keeps it and the rest take a key derived
  // from their own card id, which nothing else can hold.
  const taken = new Set(
    mapping.filter((row) => !claimed.has(row.card_id)).map((row) => row.identity_key)
  );
  for (const page of planned) {
    if (taken.has(page.identityKey)) page.identityKey = `p:${page.cardId}`;
    taken.add(page.identityKey);
  }
  return planned;
}

function summarizePlan(planned: PlannedPage[], mapping: MappingRow[]): RunPlan {
  const claimed = new Set(planned.map((page) => page.cardId));
  const added = planned.filter((page) => page.matchedBy === null).length;
  return {
    added,
    updated: planned.length - added,
    removed: mapping.filter((row) => !claimed.has(row.card_id) && row.file_live).length,
    pages: planned.map((page) => ({
      page_number: page.pageNumber,
      title: page.title,
      action: page.matchedBy === null ? 'add' : 'update',
      matched_by: page.matchedBy,
    })),
  };
}

function cardCapError(total: number): AppError {
  return new AppError(
    422,
    `This import would leave the deck holding ${total} cards, and a deck holds at most ${MAX_DECK_CARDS}`,
    { cards: total, limit: MAX_DECK_CARDS }
  );
}

async function countDeckCards(db: Connection, deckId: string): Promise<number> {
  const row = await db
    .selectFrom('deck_card')
    .select((eb) => eb.fn.countAll<string>().as('count'))
    .where('deck_card.deck_id', '=', deckId)
    .executeTakeFirst();
  return Number(row?.count ?? 0);
}

// PUT /api/decks/:deckId/cards caps a deck, and it is the only other writer of
// deck_card: a deck the import has pushed past that bound is one the deck
// editor can never save again, because every hand edit then fails validation on
// a list the import wrote. Refused here rather than only at finish so a person
// learns it before uploading the export instead of after.
async function assertPlanWithinCap(
  db: Connection,
  deckId: string,
  mapping: MappingRow[],
  planned: PlannedPage[]
): Promise<void> {
  const claimed = new Set(planned.map((page) => page.cardId));
  const additions =
    planned.filter((page) => page.matchedBy === null).length +
    mapping.filter((row) => claimed.has(row.card_id) && row.added_to_deck_at === null).length;
  const removals = mapping.filter(
    (row) => !claimed.has(row.card_id) && row.file_live && row.added_to_deck_at !== null
  ).length;

  const projected = (await countDeckCards(db, deckId)) - removals + additions;
  if (projected > MAX_DECK_CARDS) throw cardCapError(projected);
}

// Every file this import owns, locked in id order and before any mapping row is
// touched. Ascending id is the order every bulk file lock in the repo takes --
// a folder purge's and a project delete's -- and both of those then reach
// deck_import_card through the cascade, so taking the mapping first here is
// what would leave the two waiting on each other.
//
// One cycle is left open, and it is older than this file rather than something
// the ordering above closes: finishing writes deck_card while holding these
// locks, whereas replacing a deck's cards by hand rewrites deck_card first and
// only then takes the key-share its foreign key needs on each file. A purge
// contends with that hand edit exactly the same way. Postgres breaks it and one
// of the two transactions retries; closing it means locking the files a deck's
// cards name from routes/decks.ts, which is a change to that route.
async function lockImportFiles(db: Connection, importId: string): Promise<void> {
  await db
    .selectFrom('deck_import_card')
    .innerJoin('file', 'file.id', 'deck_import_card.file_id')
    .select(['file.id as id'])
    .where('deck_import_card.import_id', '=', importId)
    .forUpdate('file')
    .orderBy('file.id')
    .execute();
}

export async function startRun(
  c: Ctx,
  access: ImportAccess,
  input: StartRunInput
): Promise<StartedRun> {
  const db = c.get('db');
  const folderId = assertBoundFolder(access.folderId);
  await assertFolderVisible(db, folderId);
  await assertNoOpenRun(db, access.importId);

  const pages = orderedManifest(input.pages);
  await lockImportFiles(db, access.importId);
  // Before the mapping is read, so what the plan sees and what the partial
  // unique index constrains cannot disagree: a row whose file has left the
  // folder is invisible to matching while it still holds its key.
  await detachMovedCards(db, access.importId, folderId);

  const mapping = await readLiveMapping(db, access.importId, folderId);
  const planned = planPages(pages, mapping);
  await assertPlanWithinCap(db, access.deckId, mapping, planned);

  const id = input.id ?? newId();
  try {
    await db
      .insertInto('import_run')
      .values({
        id,
        import_id: access.importId,
        status: 'open',
        source_label: input.sourceLabel,
        page_count: pages.length,
        started_by: c.get('user').id,
      })
      .execute();
  } catch (error) {
    // Either the client-supplied id or the one-open-run index. The pre-check
    // above cannot cover the second: two starts can pass it together.
    if (isUniqueViolation(error)) {
      throw new AppError(409, 'That run id is taken, or a run is already open for this deck');
    }
    throw error;
  }

  await db
    .insertInto('import_run_page')
    .values(
      planned.map((page) => ({
        id: newId(),
        run_id: id,
        page_number: page.pageNumber,
        card_id: page.cardId,
        matched_by: page.matchedBy,
        identity_key: page.identityKey,
      }))
    )
    .execute();

  publishAfterCommit(c.get('postCommitHooks'), c.get('user').id, 'deck_import_started', {
    project_id: access.projectId,
    deck_id: access.deckId,
    run_id: id,
  });
  return { ...(await readRun(c, id)), plan: summarizePlan(planned, mapping) };
}

async function lockRun(db: Connection, runId: string) {
  return await db
    .selectFrom('import_run')
    .select([
      'import_run.status as status',
      'import_run.page_count as page_count',
      'import_run.source_label as source_label',
    ])
    .where('import_run.id', '=', runId)
    .forUpdate()
    .executeTakeFirstOrThrow();
}

export async function abandonRun(c: Ctx, access: ImportRunAccess): Promise<SerializedRun> {
  const db = c.get('db');
  const run = await lockRun(db, access.runId);
  assertOpenRun(run.status);

  // Nothing already imported is undone and nothing is tombstoned. The pages
  // that landed keep their files and their mapping rows, and the next run
  // either matches them or removes them -- whichever the export says.
  const counts = await runCounts(db, access.runId);
  await db
    .updateTable('import_run')
    .set({ status: 'abandoned', finished_at: new Date(), summary: counts })
    .where('import_run.id', '=', access.runId)
    .execute();

  publishAfterCommit(c.get('postCommitHooks'), c.get('user').id, 'deck_import_finished', {
    project_id: access.projectId,
    deck_id: access.deckId,
    run_id: access.runId,
  });
  return await readRun(c, access.runId);
}

// --- one page ---------------------------------------------------------------

interface OpenRun {
  runId: string;
  importId: string;
  deckId: string;
  projectId: string;
  folderId: string;
}

interface CardFile {
  id: string;
  project_id: string;
  folder_id: string | null;
  filename: string;
  name_locked: boolean;
  deleted_at: Date | string | null;
}

const CARD_FILE_COLUMNS = [
  'file.id as id',
  'file.project_id as project_id',
  'file.folder_id as folder_id',
  'file.filename as filename',
  'file.name_locked as name_locked',
  'file.deleted_at as deleted_at',
] as const;

// A name a person typed is not this import's to overwrite.
function nameForCard(file: CardFile, derived: string): string {
  if (file.name_locked) return file.filename;
  return derived;
}

interface Memo {
  page_number: number;
  outcome: string;
  matched_by: string | null;
  restored: boolean;
  name: string;
  file_version_number: number | null;
  file_id: string | null;
}

async function readMemo(
  db: Connection,
  runId: string,
  pageNumber: number
): Promise<Memo | undefined> {
  const row = await db
    .selectFrom('import_run_card')
    .leftJoin('deck_import_card', 'deck_import_card.id', 'import_run_card.import_card_id')
    .select([
      'import_run_card.outcome as outcome',
      'import_run_card.matched_by as matched_by',
      'import_run_card.restored as restored',
      'import_run_card.name as name',
      'import_run_card.file_version_number as file_version_number',
      'deck_import_card.file_id as file_id',
    ])
    .where('import_run_card.run_id', '=', runId)
    .where('import_run_card.page_number', '=', pageNumber)
    .executeTakeFirst();
  return row === undefined ? undefined : { ...row, page_number: pageNumber };
}

// What happened the first time, and nothing worked out a second time: a retry
// of a page that landed as a restore would otherwise find nothing left to
// restore and overwrite the row that says it did.
function replayResult(memo: Memo): ImportPageResult {
  return {
    page_number: memo.page_number,
    outcome: memo.outcome,
    matched_by: memo.matched_by,
    restored: memo.restored,
    replayed: true,
    file_id: memo.file_id,
    file_version_number: memo.file_version_number,
    name: memo.name,
  };
}

interface PlannedCard {
  card_id: string;
  matched_by: string | null;
  identity_key: string;
}

async function readPlannedPage(
  db: Connection,
  runId: string,
  pageNumber: number
): Promise<PlannedCard | undefined> {
  return await db
    .selectFrom('import_run_page')
    .select([
      'import_run_page.card_id as card_id',
      'import_run_page.matched_by as matched_by',
      'import_run_page.identity_key as identity_key',
    ])
    .where('import_run_page.run_id', '=', runId)
    .where('import_run_page.page_number', '=', pageNumber)
    .executeTakeFirst();
}

// The card the plan named, if it is there yet. It may not be: the plan calls a
// page new precisely when no row answers to it, and a purge during the run can
// take one away. Either way the page inserts the row under the planned id.
//
// Deliberately not filtered by file.deleted_at. Finding the tombstone is what
// makes a card that came back a restore rather than a second card.
async function lockPlannedCard(db: Connection, cardId: string): Promise<CardFile | undefined> {
  return await db
    .selectFrom('deck_import_card')
    .innerJoin('file', 'file.id', 'deck_import_card.file_id')
    .select(CARD_FILE_COLUMNS)
    .where('deck_import_card.id', '=', cardId)
    .forUpdate('file')
    .executeTakeFirst();
}

/**
 * Imports one page: one request, one transaction, one image.
 *
 * A run that dies half way therefore leaves every page that landed durably
 * imported, and re-posting one answers with what happened the first time.
 */
export async function importPage(
  c: Ctx,
  access: ImportRunAccess,
  input: ImportPageInput
): Promise<ImportPageOutcome> {
  const db = c.get('db');
  const folderId = assertBoundFolder(access.folderId);

  // Every refusal that can be made before a byte moves is made here. The full
  // ancestor walk is not among them: it is up to 64 queries, it runs at the
  // start of the run and again at finish, and per page it would be the cost of
  // the import.
  const declared = await db
    .selectFrom('import_run')
    .select(['import_run.status as status', 'import_run.page_count as page_count'])
    .where('import_run.id', '=', access.runId)
    .executeTakeFirstOrThrow();
  assertOpenRun(declared.status);

  // Which card this page becomes was settled when the run started, so all this
  // does is read the row that says so. A page the plan never named is not one
  // this run can take.
  const planned = await readPlannedPage(db, access.runId, input.pageNumber);
  if (!planned) {
    throw new AppError(
      409,
      `This run planned ${declared.page_count} pages, and page ${input.pageNumber} is not one of them`
    );
  }

  const folder = await db
    .selectFrom('folder')
    .select(['folder.name as name', 'folder.deleted_at as deleted_at'])
    .where('folder.id', '=', folderId)
    .executeTakeFirst();
  if (!folder) throw new AppError(409, NOT_BOUND);
  if (folder.deleted_at !== null) {
    throw new AppError(409, blockedMessage({ id: folderId, name: folder.name }, 'This import'));
  }

  if (input.declaredLength > 0) await assertQuota(c, access.projectId, input.declaredLength);

  const stored = await storeUpload(input.body, MAX_UPLOAD_BYTES, input.declaredContentType);
  const run: OpenRun = {
    runId: access.runId,
    importId: access.importId,
    deckId: access.deckId,
    projectId: access.projectId,
    folderId,
  };

  try {
    return await landPage(c, run, input, stored, planned);
  } catch (error) {
    await reclaim(stored.storageKey);
    throw error;
  }
}

async function landPage(
  c: Ctx,
  run: OpenRun,
  input: ImportPageInput,
  stored: StoredUpload,
  planned: PlannedCard
): Promise<ImportPageOutcome> {
  const db = c.get('db');
  await assertQuota(c, run.projectId, stored.byteSize);

  // storeUpload calls anything unrecognised an octet stream. Without this gate
  // that becomes a card every screen downstream tries to draw.
  if (!(ALLOWED_IMAGE_TYPES as readonly string[]).includes(stored.contentType)) {
    throw new AppError(422, 'That page is not an image');
  }

  // Taken now that no network transfer is left to hold it, and it is what
  // serialises the pages of one import against each other and against its
  // finish.
  const locked = await db
    .selectFrom('import_run')
    .select(['import_run.status as status'])
    .where('import_run.id', '=', run.runId)
    .forUpdate()
    .executeTakeFirstOrThrow();
  // A finish that was queued ahead of this page closed the run while it waited.
  assertOpenRun(locked.status);

  const memo = await readMemo(db, run.runId, input.pageNumber);
  if (memo) {
    // The bytes just stored are an orphan; the answer belongs to the ledger.
    deleteStoredObjectsAfterCommit(c.get('postCommitHooks'), [stored.storageKey]);
    return { result: replayResult(memo), created: false };
  }

  // The title decides what the card is called; which card it is was settled
  // when the run started.
  const derivedName = deckPageFilename(
    input.pageNumber,
    input.title,
    extensionForImageType(stored.contentType)
  );

  const matched = await lockPlannedCard(db, planned.card_id);
  let file: CardFile;
  let createdFile = false;
  if (matched) {
    file = matched;
  } else {
    file = await createCard(c, run, {
      cardId: planned.card_id,
      identityKey: planned.identity_key,
      pageNumber: input.pageNumber,
      derivedName,
      stored,
    });
    createdFile = true;
  }

  // Before the append, not after: appendFileVersion refuses a tombstone, and it
  // is the only writer, so there is no way round it.
  let restored = false;
  if (file.deleted_at !== null) {
    const wanted = nameForCard(file, derivedName);
    const filename = await freeFilename(db, run.projectId, file.folder_id, wanted);
    await restoreFile(c, file.id, { filename, lockName: false, notify: false });
    file = { ...file, filename, deleted_at: null };
    restored = true;
  }

  const appended = await appendFileVersion(c, file.id, {
    storageKey: stored.storageKey,
    contentType: stored.contentType,
    byteSize: stored.byteSize,
    checksum: stored.checksum,
  });

  const previousName = file.filename;
  const finalName = createdFile
    ? previousName
    : await renamedTo(db, run, file, input.title, derivedName);

  const outcome =
    createdFile || restored
      ? 'added'
      : !appended.created && finalName === previousName
        ? 'unchanged'
        : 'updated';
  // Null whatever the plan said when the card had to be created after all: the
  // plan can name a card a purge has taken away since.
  const matchedBy = matched ? planned.matched_by : null;

  await db
    .insertInto('import_run_card')
    .values({
      id: newId(),
      run_id: run.runId,
      import_card_id: planned.card_id,
      outcome,
      matched_by: matchedBy,
      restored,
      page_number: input.pageNumber,
      name: finalName,
      file_version_number: appended.version.version_number,
    })
    .execute();

  // The last statement of the handler on purpose: a caught 23505 leaves the
  // transaction aborted, so nothing may follow it. Rolling the page back whole
  // is what makes the 409 worth retrying.
  if (finalName !== previousName) {
    try {
      await db
        .updateTable('file')
        .set({ filename: finalName, updated_at: new Date() })
        .where('file.id', '=', file.id)
        .execute();
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new AppError(409, 'A file with that name already exists here');
      }
      throw error;
    }
  }

  // One event per page, whatever combination of create, restore, version and
  // rename this page turned out to be.
  if (createdFile) {
    publishAfterCommit(c.get('postCommitHooks'), c.get('user').id, 'file_uploaded', {
      project_id: run.projectId,
      file_id: file.id,
    });
  } else if (appended.created) {
    publishAfterCommit(c.get('postCommitHooks'), c.get('user').id, 'file_version_created', {
      project_id: run.projectId,
      file_id: file.id,
    });
  } else if (restored || finalName !== previousName) {
    publishAfterCommit(c.get('postCommitHooks'), c.get('user').id, 'file_updated', {
      project_id: run.projectId,
      file_id: file.id,
    });
  }

  return {
    result: {
      page_number: input.pageNumber,
      outcome,
      matched_by: matchedBy,
      restored,
      replayed: false,
      file_id: file.id,
      file_version_number: appended.version.version_number,
      name: finalName,
    },
    created: createdFile || appended.created,
  };
}

interface NewCard {
  cardId: string;
  identityKey: string;
  pageNumber: number;
  derivedName: string;
  stored: StoredUpload;
}

// The key the new mapping row can take right now, which is not always the one
// it ends with: the plan deconflicted against the mapping as it will stand once
// the run has finished, and until then a card the plan claimed still holds the
// key it had. Decided by a select rather than by catching the violation, which
// would leave the transaction aborted with the whole page still to write. `p:`
// is derived from the row's own id, so it terminates rather than colliding
// again, and finish rewrites it to whatever the plan intended.
async function resolveInsertKey(
  db: Connection,
  importId: string,
  identityKey: string,
  cardId: string
): Promise<string> {
  const held = await db
    .selectFrom('deck_import_card')
    .select(['deck_import_card.id as id'])
    .where('deck_import_card.import_id', '=', importId)
    .where('deck_import_card.detached_at', 'is', null)
    .where('deck_import_card.identity_key', '=', identityKey)
    .executeTakeFirst();
  return held ? `p:${cardId}` : identityKey;
}

async function createCard(c: Ctx, run: OpenRun, card: NewCard): Promise<CardFile> {
  const db = c.get('db');
  const filename = await freeFilename(db, run.projectId, run.folderId, card.derivedName);
  const identityKey = await resolveInsertKey(db, run.importId, card.identityKey, card.cardId);

  let file: CardFile;
  try {
    file = await db
      .insertInto('file')
      .values({
        id: newId(),
        project_id: run.projectId,
        folder_id: run.folderId,
        filename,
        // The key appendFileVersion is about to be handed, so it recognises the
        // row as one just inserted rather than adopting a mirror as version 1.
        storage_key: card.stored.storageKey,
        content_type: card.stored.contentType,
        byte_size: String(card.stored.byteSize),
        checksum: card.stored.checksum,
        uploaded_by: c.get('user').id,
      })
      .returning(CARD_FILE_COLUMNS)
      .executeTakeFirstOrThrow();
  } catch (error) {
    // Its own catch: the mapping insert below cannot produce a name conflict,
    // and calling one of its violations that would be a lie.
    if (isUniqueViolation(error)) {
      throw new AppError(409, 'A file with that name already exists here');
    }
    throw error;
  }

  // No catch. Both indexes here are ruled out before the write -- the key by
  // resolveInsertKey, the file by its being one row old.
  await db
    .insertInto('deck_import_card')
    .values({
      id: card.cardId,
      import_id: run.importId,
      file_id: file.id,
      identity_key: identityKey,
      page_number: card.pageNumber,
    })
    .execute();

  return file;
}

// The name the card ends the page with. A taken name is not worth refusing a
// page over -- the card is identified by its mapping row, not by what it is
// called -- so the old one stays and nothing is said about it.
//
// An untitled page never renames anything: its key is its page number, so every
// card in a reordered untitled deck would be reaching for a name another live
// card still holds.
async function renamedTo(
  db: Connection,
  run: OpenRun,
  file: CardFile,
  title: string | null,
  derivedName: string
): Promise<string> {
  if (title === null || title.trim().length === 0) return file.filename;
  const wanted = nameForCard(file, derivedName);
  if (wanted === file.filename) return file.filename;
  const free = await freeFilename(db, run.projectId, file.folder_id, wanted);
  return free === wanted ? wanted : file.filename;
}

// --- finishing --------------------------------------------------------------

interface TombstonedCard {
  card_id: string;
  file_id: string;
  filename: string;
  version_number: number | null;
}

export async function finishRun(c: Ctx, access: ImportRunAccess): Promise<RunDetail> {
  const db = c.get('db');
  const run = await lockRun(db, access.runId);
  assertOpenRun(run.status);

  const folderId = assertBoundFolder(access.folderId);
  // The whole walk here, unlike per page: this is the step that deletes things,
  // and reporting a clean import into a folder nobody can see is worse than
  // refusing to do it.
  await assertFolderVisible(db, folderId);

  const imported = await countImportedPages(db, access.runId);
  if (imported !== run.page_count) {
    throw new AppError(
      409,
      `This run has imported ${imported} of ${run.page_count} pages. Post the rest, or abandon it.`
    );
  }

  // Ahead of everything below that writes a mapping row, which is the whole of
  // why it is a step of its own.
  await lockImportFiles(db, access.importId);
  // Again here, for a move made while the run was open.
  await detachMovedCards(db, access.importId, folderId);
  await applyPlannedIdentities(db, access.runId);
  const removed = await tombstoneUnmatched(c, access);
  await syncDeckMembership(c, access, removed);

  // The backstop for the check the run start already made: a hand edit can add
  // cards while the run is open, and past the cap the deck editor can never
  // save again.
  const total = await countDeckCards(db, access.deckId);
  if (total > MAX_DECK_CARDS) throw cardCapError(total);

  const counts = await runCounts(db, access.runId);
  await db
    .updateTable('import_run')
    .set({ status: 'finished', finished_at: new Date(), summary: counts })
    .where('import_run.id', '=', access.runId)
    .execute();
  await db
    .updateTable('deck_import')
    .set({ source_label: run.source_label, updated_at: new Date() })
    .where('deck_import.id', '=', access.importId)
    .execute();

  const hooks = c.get('postCommitHooks');
  const actor = c.get('user').id;
  publishAfterCommit(hooks, actor, 'deck_import_finished', {
    project_id: access.projectId,
    deck_id: access.deckId,
    run_id: access.runId,
  });
  publishAfterCommit(hooks, actor, 'deck_updated', {
    project_id: access.projectId,
    deck_id: access.deckId,
  });

  return await readRunDetail(c, access.runId);
}

// Every page the run planned has to have landed. The plan is numbered 1..n and
// the unique on (run_id, page_number) admits each of them once, so equality
// with the count means exactly that set and nothing has to be enumerated.
async function countImportedPages(db: Connection, runId: string): Promise<number> {
  const row = await db
    .selectFrom('import_run_card')
    .select((eb) => eb.fn.countAll<string>().as('count'))
    .where('import_run_card.run_id', '=', runId)
    .where('import_run_card.page_number', 'is not', null)
    .executeTakeFirst();
  return Number(row?.count ?? 0);
}

// Derived rather than stamped when a file is moved, which also catches a move
// made by a pod on the previous release. Runs both when a run starts and when
// it finishes, and before the re-key below either way, so a detached row has
// already left the partial unique index.
async function detachMovedCards(db: Connection, importId: string, folderId: string): Promise<void> {
  await db
    .updateTable('deck_import_card')
    .from('file')
    .set({ detached_at: new Date() })
    .whereRef('file.id', '=', 'deck_import_card.file_id')
    .where('deck_import_card.import_id', '=', importId)
    .where('deck_import_card.detached_at', 'is', null)
    .where(sql<boolean>`file.folder_id is distinct from ${folderId}::uuid`)
    .execute();
}

// Two statements, in this order. The first parks every card this run planned
// under a key derived from its own id, which nothing else can hold; the second
// then has an empty index to write into, so it cannot violate whatever the plan
// decided. Nowhere else does a run rewrite a mapping row it did not create.
async function applyPlannedIdentities(db: Connection, runId: string): Promise<void> {
  await db
    .updateTable('deck_import_card')
    .from('import_run_page')
    .set({ identity_key: sql<string>`'p:' || deck_import_card.id::text` })
    .whereRef('import_run_page.card_id', '=', 'deck_import_card.id')
    .where('import_run_page.run_id', '=', runId)
    .execute();

  await db
    .updateTable('deck_import_card')
    .from('import_run_page')
    .set({
      identity_key: (eb) => eb.ref('import_run_page.identity_key'),
      page_number: (eb) => eb.ref('import_run_page.page_number'),
    })
    .whereRef('import_run_page.card_id', '=', 'deck_import_card.id')
    .where('import_run_page.run_id', '=', runId)
    .execute();
}

async function tombstoneUnmatched(c: Ctx, access: ImportRunAccess): Promise<TombstonedCard[]> {
  const db = c.get('db');
  const rows: TombstonedCard[] = await db
    .selectFrom('deck_import_card')
    .innerJoin('file', 'file.id', 'deck_import_card.file_id')
    .select((eb) => [
      'deck_import_card.id as card_id',
      'deck_import_card.file_id as file_id',
      'file.filename as filename',
      eb
        .selectFrom('file_version')
        .whereRef('file_version.file_id', '=', 'file.id')
        .select((inner) => inner.fn.max('file_version.version_number').as('n'))
        .as('version_number'),
    ])
    .where('deck_import_card.import_id', '=', access.importId)
    .where('deck_import_card.detached_at', 'is', null)
    // A card tombstoned before this run started was not removed by this run.
    .where('file.deleted_at', 'is', null)
    // The plan, not the ledger: a card no page of this export was planned onto
    // is what the export stopped having.
    .where((eb) =>
      eb.not(
        eb.exists(
          eb
            .selectFrom('import_run_page as claim')
            .select(eb.lit(1).as('matched'))
            .where('claim.run_id', '=', access.runId)
            .whereRef('claim.card_id', '=', 'deck_import_card.id')
        )
      )
    )
    // No lock taken here: lockImportFiles already holds every one of these.
    .execute();

  if (rows.length === 0) return [];

  const goneIds = rows.map((row) => row.file_id);
  await db
    .updateTable('file')
    .set({ deleted_at: new Date(), deleted_by: c.get('user').id })
    .where('file.id', 'in', goneIds)
    .where('file.deleted_at', 'is', null)
    .execute();

  await db
    .insertInto('import_run_card')
    .values(
      rows.map((row) => ({
        id: newId(),
        run_id: access.runId,
        import_card_id: row.card_id,
        outcome: 'removed',
        matched_by: null,
        restored: false,
        page_number: null,
        // Copied off the file: purging the image nulls the link and this is
        // then all the row has left to say which card it was.
        name: row.filename,
        file_version_number: row.version_number ?? 1,
      }))
    )
    .execute();

  // The mapping row is kept, neither detached nor deleted. Keeping it reserves
  // the identity key, and the reserved key is what lets the card come back as a
  // restore rather than as a duplicate three runs later.
  for (const row of rows) {
    publishAfterCommit(c.get('postCommitHooks'), c.get('user').id, 'file_deleted', {
      project_id: access.projectId,
      file_id: row.file_id,
    });
  }

  return rows;
}

// The import owns membership only where it created it: it hands over a card it
// has never handed over, and takes back one it has just tombstoned. It never
// reorders, never touches a copy count, and never puts back a card somebody
// took out of the deck by hand.
async function syncDeckMembership(
  c: Ctx,
  access: ImportRunAccess,
  removed: TombstonedCard[]
): Promise<void> {
  const db = c.get('db');

  if (removed.length > 0) {
    await db
      .deleteFrom('deck_card')
      .where('deck_card.deck_id', '=', access.deckId)
      .where(
        'deck_card.file_id',
        'in',
        removed.map((row) => row.file_id)
      )
      .execute();
    await db
      .updateTable('deck_import_card')
      .set({ added_to_deck_at: null })
      .where(
        'deck_import_card.id',
        'in',
        removed.map((row) => row.card_id)
      )
      .execute();
  }

  const pending = await db
    .selectFrom('deck_import_card')
    .innerJoin('file', 'file.id', 'deck_import_card.file_id')
    .select(['deck_import_card.id as card_id', 'deck_import_card.file_id as file_id'])
    .where('deck_import_card.import_id', '=', access.importId)
    .where('deck_import_card.detached_at', 'is', null)
    .where('deck_import_card.added_to_deck_at', 'is', null)
    .where('file.deleted_at', 'is', null)
    .orderBy('deck_import_card.page_number', 'asc')
    .orderBy('deck_import_card.id', 'asc')
    .execute();
  if (pending.length === 0) return;

  const top = await db
    .selectFrom('deck_card')
    .select((eb) => eb.fn.max('deck_card.position').as('position'))
    .where('deck_card.deck_id', '=', access.deckId)
    .executeTakeFirst();
  const base = top?.position ?? -1;

  await db
    .insertInto('deck_card')
    .values(
      pending.map((card, index) => ({
        id: newId(),
        deck_id: access.deckId,
        file_id: card.file_id,
        quantity: 1,
        position: base + 1 + index,
      }))
    )
    // One statement, so a hand edit landing at the same moment cannot turn this
    // into a unique violation with five statements still to run.
    .onConflict((oc) => oc.columns(['deck_id', 'file_id']).doNothing())
    .execute();

  await db
    .updateTable('deck_import_card')
    .set({ added_to_deck_at: new Date() })
    .where(
      'deck_import_card.id',
      'in',
      pending.map((card) => card.card_id)
    )
    .execute();
}
