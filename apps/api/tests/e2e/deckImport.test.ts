import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { IMPORT_TITLE_MAX_LENGTH, MAX_DECK_CARDS, cardPreset } from '@three-peaks/shared';
import { db } from '../../src/db/index.ts';
import { createUser, deleteUser, type TestUser } from '../setup/testContext.ts';

// A PNG signature and then the artwork, so two pages that look different hash
// differently. Content type is decided by the magic bytes, never by the header.
function png(artwork: string): Buffer {
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    Buffer.from(`IHDR ${artwork}`, 'utf8'),
  ]);
}

const poker = cardPreset('poker')!;

interface Page {
  title?: string | null;
  bytes: Buffer;
}

interface PageResult {
  page_number: number;
  outcome: string;
  matched_by: string | null;
  restored: boolean;
  replayed: boolean;
  file_id: string | null;
  file_version_number: number | null;
  name: string;
}

interface RunCounts {
  pages: number;
  added: number;
  updated: number;
  unchanged: number;
  removed: number;
  restored: number;
}

interface Run {
  id: string;
  import_id: string;
  status: string;
  source_label: string | null;
  page_count: number;
  started_by: string;
  started_at: string;
  finished_at: string | null;
  counts: RunCounts;
}

interface RunCard {
  page_number: number | null;
  outcome: string;
  matched_by: string | null;
  restored: boolean;
  name: string;
  file_id: string | null;
  file_version_number: number | null;
}

describe('deck imports', () => {
  let owner: TestUser;
  let viewer: TestUser;
  let stranger: TestUser;
  let projectId: string;

  beforeAll(async () => {
    [owner, viewer, stranger] = await Promise.all([
      createUser('import-owner'),
      createUser('import-viewer'),
      createUser('import-stranger'),
    ]);

    projectId = (await (await owner.api.post('/api/projects', { name: 'Canva' })).json()).id;
    await owner.api.put(`/api/projects/${projectId}/members`, {
      email: viewer.email,
      role: 'viewer',
    });
  });

  // import_run.started_by is RESTRICT and every run here was started inside the
  // owner's project, so the project has to go before any of the accounts do.
  afterAll(async () => {
    for (const user of [owner, viewer, stranger]) await deleteUser(user);
  });

  async function makeFolder(name: string, parentId?: string): Promise<string> {
    const res = await owner.api.post('/api/files/folders', {
      project_id: projectId,
      name,
      ...(parentId ? { parent_id: parentId } : {}),
    });
    expect(res.status).toBe(201);
    return (await res.json()).id as string;
  }

  async function makeDeck(name: string): Promise<string> {
    const res = await owner.api.post('/api/decks', {
      project_id: projectId,
      name,
      card_width_mm: poker.width_mm,
      card_height_mm: poker.height_mm,
    });
    expect(res.status).toBe(201);
    return (await res.json()).id as string;
  }

  function bind(deckId: string, folderId: string, label?: string, user: TestUser = owner) {
    return user.api.put(`/api/decks/${deckId}/import`, {
      folder_id: folderId,
      ...(label === undefined ? {} : { source_label: label }),
    });
  }

  async function scenario(name: string) {
    const [folderId, deckId] = await Promise.all([makeFolder(name), makeDeck(name)]);
    expect((await bind(deckId, folderId, name)).status).toBe(201);
    return { folderId, deckId };
  }

  // Two spellings of one request: the page count the run route reads, and the
  // manifest of page numbers and titles a run that plans its matching up front
  // is computed from. Undeclared keys are stripped by the validator, so
  // whichever half the server does not know about costs nothing to send.
  function startRun(deckId: string, pageCount: number, user: TestUser = owner, pages: Page[] = []) {
    return user.api.post(`/api/decks/${deckId}/import/runs`, {
      page_count: pageCount,
      pages: Array.from({ length: pageCount }, (_, index) => {
        const title = pages[index]?.title;
        return {
          page_number: index + 1,
          ...(title === undefined || title === null ? {} : { title }),
        };
      }),
    });
  }

  async function openRun(deckId: string, pageCount: number, pages: Page[] = []): Promise<Run> {
    const res = await startRun(deckId, pageCount, owner, pages);
    expect(res.status).toBe(201);
    return (await res.json()) as Run;
  }

  function postPage(
    runId: string,
    pageNumber: number,
    bytes: Buffer,
    title?: string | null,
    user: TestUser = owner
  ) {
    const query = new URLSearchParams({ page_number: String(pageNumber) });
    if (title !== undefined && title !== null) query.set('title', title);
    return user.api.postBytes(
      `/api/decks/import/runs/${runId}/pages?${query}`,
      bytes as unknown as BodyInit,
      'image/png'
    );
  }

  async function landPage(runId: string, pageNumber: number, page: Page): Promise<PageResult> {
    const res = await postPage(runId, pageNumber, page.bytes, page.title);
    expect([200, 201]).toContain(res.status);
    return (await res.json()) as PageResult;
  }

  function finish(runId: string, user: TestUser = owner) {
    return user.api.post(`/api/decks/import/runs/${runId}/finish`);
  }

  function abandon(runId: string, user: TestUser = owner) {
    return user.api.post(`/api/decks/import/runs/${runId}/abandon`);
  }

  interface Import {
    run: Run;
    pages: Map<number, PageResult>;
    detail: { run: Run; cards: RunCard[] };
  }

  // One whole export: start, post every page, finish. `reverse` posts the last
  // page first, which is the only difference between the two orders a client
  // could walk a ZIP in.
  async function importPages(
    deckId: string,
    pages: Page[],
    opts: { reverse?: boolean } = {}
  ): Promise<Import> {
    const run = await openRun(deckId, pages.length, pages);
    const order = pages.map((_, index) => index + 1);
    if (opts.reverse) order.reverse();

    const results = new Map<number, PageResult>();
    for (const number of order) {
      results.set(number, await landPage(run.id, number, pages[number - 1]));
    }

    const done = await finish(run.id);
    expect(done.status).toBe(200);
    // The run as finishing left it, not as starting it did: the counts on the
    // start response are all zero and would make every count assertion vacuous.
    const detail = (await done.json()) as { run: Run; cards: RunCard[] };
    return { run: detail.run, pages: results, detail };
  }

  async function readDeck(deckId: string) {
    const res = await owner.api.get(`/api/decks/${deckId}`);
    expect(res.status).toBe(200);
    return (await res.json()) as {
      deck: { id: string };
      cards: {
        file_id: string;
        quantity: number;
        position: number;
        file: { filename: string; name_locked: boolean };
      }[];
    };
  }

  async function readImport(deckId: string, user: TestUser = owner) {
    const res = await user.api.get(`/api/decks/${deckId}/import`);
    return { status: res.status, body: await res.json() };
  }

  async function timeline(deckId: string): Promise<Run[]> {
    const res = await owner.api.get(`/api/decks/${deckId}/import/runs`);
    expect(res.status).toBe(200);
    return (await res.json()).runs as Run[];
  }

  async function runDetail(runId: string): Promise<{ run: Run; cards: RunCard[] }> {
    const res = await owner.api.get(`/api/decks/import/runs/${runId}`);
    expect(res.status).toBe(200);
    return (await res.json()) as { run: Run; cards: RunCard[] };
  }

  async function readFile(fileId: string) {
    const res = await owner.api.get(`/api/files/${fileId}`);
    return { status: res.status, body: await res.json() };
  }

  async function versionCount(fileId: string): Promise<number> {
    const res = await owner.api.get(`/api/files/${fileId}/versions`);
    expect(res.status).toBe(200);
    return ((await res.json()).versions as unknown[]).length;
  }

  async function filenamesIn(folderId: string): Promise<string[]> {
    const res = await owner.api.get(
      `/api/files/directory?project_id=${projectId}&folder_id=${folderId}`
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { files: { filename: string }[] };
    return body.files.map((file) => file.filename).sort();
  }

  async function uploadByHand(folderId: string, filename: string, bytes: Buffer): Promise<string> {
    const query = new URLSearchParams({ project_id: projectId, filename, folder_id: folderId });
    const res = await owner.api.postBytes(
      `/api/files/upload?${query}`,
      bytes as unknown as BodyInit,
      'image/png'
    );
    expect(res.status).toBe(201);
    return (await res.json()).id as string;
  }

  const outcomes = (pages: Map<number, PageResult>) =>
    [...pages.entries()].sort(([a], [b]) => a - b).map(([, result]) => result.outcome);

  describe('binding a deck to a folder', () => {
    it('binds once and then only updates the label', async () => {
      const folderId = await makeFolder('bind-target');
      const deckId = await makeDeck('Bind me');

      const first = await bind(deckId, folderId, 'Draft deck');
      expect(first.status).toBe(201);
      expect((await first.json()).folder_id).toBe(folderId);
      expect((await readImport(deckId)).body.open_run_id).toBeNull();

      const again = await bind(deckId, folderId, 'Draft deck v2');
      expect(again.status).toBe(200);
      expect((await again.json()).source_label).toBe('Draft deck v2');
    });

    it('refuses a folder inside a deleted one, the way a stranger is refused', async () => {
      const parentId = await makeFolder('doomed-parent');
      const childId = await makeFolder('live-child', parentId);
      expect((await owner.api.delete(`/api/files/folders/${parentId}`)).status).toBe(204);

      const deckId = await makeDeck('Into the dark');
      const res = await bind(deckId, childId);
      expect(res.status).toBe(404);
      expect((await res.json()).error).toBe('Folder not found');
    });

    it('refuses to move the binding while its cards are still in the old folder', async () => {
      const { deckId, folderId } = await scenario('rebind-guard');
      await importPages(deckId, [{ title: 'Only', bytes: png('only') }]);

      const elsewhere = await makeFolder('rebind-elsewhere');
      const res = await bind(deckId, elsewhere);
      expect(res.status).toBe(409);
      expect((await readImport(deckId)).body.folder_id).toBe(folderId);
    });

    it('unbinds without losing the timeline, and resumes when the folder is bound back', async () => {
      const { deckId, folderId } = await scenario('unbind-resume');
      const pages = [
        { title: 'One', bytes: png('one') },
        { title: 'Two', bytes: png('two') },
      ];
      const first = await importPages(deckId, pages);

      expect((await owner.api.delete(`/api/decks/${deckId}/import`)).status).toBe(204);
      const unbound = await readImport(deckId);
      expect(unbound.body.folder_id).toBeNull();
      expect(await timeline(deckId)).toHaveLength(1);
      expect((await startRun(deckId, 1)).status).toBe(409);

      expect((await bind(deckId, folderId)).status).toBe(200);
      const second = await importPages(deckId, pages);
      expect(outcomes(second.pages)).toEqual(['unchanged', 'unchanged']);
      expect(second.pages.get(1)!.file_id).toBe(first.pages.get(1)!.file_id);
      expect(second.run.counts.added).toBe(0);
      expect(await timeline(deckId)).toHaveLength(2);
    });

    it('keeps the binding and the timeline when the folder is purged', async () => {
      const { deckId, folderId } = await scenario('purged-folder');
      await importPages(deckId, [{ title: 'Doomed', bytes: png('doomed') }]);

      expect((await owner.api.delete(`/api/files/folders/${folderId}`)).status).toBe(204);
      expect((await owner.api.delete(`/api/files/folders/${folderId}?purge=true`)).status).toBe(
        204
      );

      const binding = await readImport(deckId);
      expect(binding.status).toBe(200);
      expect(binding.body.folder_id).toBeNull();
      expect(await timeline(deckId)).toHaveLength(1);
      expect((await startRun(deckId, 1)).status).toBe(409);
    });
  });

  describe('a first export', () => {
    let deckId: string;
    let folderId: string;
    let first: Import;

    beforeAll(async () => {
      ({ deckId, folderId } = await scenario('first-export'));
      first = await importPages(deckId, [
        { bytes: png('untitled front') },
        { title: 'Goblin', bytes: png('goblin') },
        { title: 'Dragon', bytes: png('dragon') },
      ]);
    });

    it('names each card after the page it came from', async () => {
      expect(await filenamesIn(folderId)).toEqual(['1.png', '2 - Goblin.png', '3 - Dragon.png']);
      expect(outcomes(first.pages)).toEqual(['added', 'added', 'added']);
      expect(first.pages.get(2)!.matched_by).toBeNull();
      expect(first.pages.get(2)!.file_version_number).toBe(1);
    });

    it('adds every card it created to the deck, in page order', async () => {
      const deck = await readDeck(deckId);
      expect(deck.cards.map((card) => card.position)).toEqual([0, 1, 2]);
      expect(deck.cards.map((card) => card.file_id)).toEqual([
        first.pages.get(1)!.file_id,
        first.pages.get(2)!.file_id,
        first.pages.get(3)!.file_id,
      ]);
      expect(deck.cards.every((card) => card.quantity === 1)).toBe(true);
    });

    it('reports the same counts on the run as its own rows do', async () => {
      const run = (await timeline(deckId))[0];
      expect(run.counts).toEqual({
        pages: 3,
        added: 3,
        updated: 0,
        unchanged: 0,
        removed: 0,
        restored: 0,
      });
      const cached = await db
        .selectFrom('import_run')
        .select(['import_run.summary as summary'])
        .where('import_run.id', '=', run.id)
        .executeTakeFirstOrThrow();
      expect(cached.summary).toEqual(run.counts);
    });
  });

  describe('re-importing', () => {
    it('writes no versions when nothing changed, and says so', async () => {
      const { deckId } = await scenario('unchanged-reimport');
      const pages = [
        { title: 'Alpha', bytes: png('alpha') },
        { title: 'Beta', bytes: png('beta') },
      ];
      const first = await importPages(deckId, pages);
      const second = await importPages(deckId, pages);

      expect(outcomes(second.pages)).toEqual(['unchanged', 'unchanged']);
      expect(second.run.counts).toMatchObject({ unchanged: 2, added: 0, updated: 0, removed: 0 });
      for (const number of [1, 2]) {
        const fileId = first.pages.get(number)!.file_id!;
        expect(second.pages.get(number)!.file_id).toBe(fileId);
        expect(await versionCount(fileId)).toBe(1);
      }
    });

    it('versions only the card whose artwork changed', async () => {
      const { deckId } = await scenario('one-card-changed');
      const first = await importPages(deckId, [
        { title: 'Alpha', bytes: png('alpha') },
        { title: 'Beta', bytes: png('beta') },
      ]);
      const second = await importPages(deckId, [
        { title: 'Alpha', bytes: png('alpha') },
        { title: 'Beta', bytes: png('beta redrawn') },
      ]);

      expect(outcomes(second.pages)).toEqual(['unchanged', 'updated']);
      expect(second.pages.get(2)!.file_version_number).toBe(2);
      expect(await versionCount(first.pages.get(1)!.file_id!)).toBe(1);
      expect(await versionCount(first.pages.get(2)!.file_id!)).toBe(2);
    });

    it('matches a reordered export by title rather than by page number', async () => {
      const { deckId } = await scenario('reordered-titles');
      const first = await importPages(deckId, [
        { title: 'Alpha', bytes: png('alpha') },
        { title: 'Beta', bytes: png('beta') },
        { title: 'Gamma', bytes: png('gamma') },
      ]);
      const second = await importPages(deckId, [
        { title: 'Gamma', bytes: png('gamma') },
        { title: 'Alpha', bytes: png('alpha') },
        { title: 'Beta', bytes: png('beta') },
      ]);

      expect([...second.pages.values()].every((page) => page.matched_by === 'identity')).toBe(true);
      expect(second.pages.get(1)!.file_id).toBe(first.pages.get(3)!.file_id);
      expect(second.pages.get(2)!.file_id).toBe(first.pages.get(1)!.file_id);
      expect(second.pages.get(3)!.file_id).toBe(first.pages.get(2)!.file_id);
      expect(second.run.counts.removed).toBe(0);
      expect(second.run.counts.added).toBe(0);
    });

    it('gives the same deck whichever order the pages are posted in', async () => {
      const original = [
        { title: 'Alpha', bytes: png('alpha') },
        { title: 'Beta', bytes: png('beta') },
        { title: 'Gamma', bytes: png('gamma') },
      ];
      const reordered = [
        { title: 'Gamma', bytes: png('gamma redrawn') },
        { title: 'Alpha', bytes: png('alpha') },
        { title: 'Beta', bytes: png('beta') },
      ];

      const forwards = await scenario('order-forwards');
      const backwards = await scenario('order-backwards');
      const firstForwards = await importPages(forwards.deckId, original);
      const firstBackwards = await importPages(backwards.deckId, original);

      const secondForwards = await importPages(forwards.deckId, reordered);
      const secondBackwards = await importPages(backwards.deckId, reordered, { reverse: true });

      // The same shape told two ways: which page of the first export each page
      // of the second landed on, what the card ended up called, and how it was
      // matched. Nothing in it may depend on the order the pages arrived in.
      const shape = (before: Import, after: Import) =>
        [1, 2, 3].map((number) => ({
          page: number,
          from: [...before.pages].find(
            ([, page]) => page.file_id === after.pages.get(number)!.file_id
          )![0],
          name: after.pages.get(number)!.name,
          outcome: after.pages.get(number)!.outcome,
          matched_by: after.pages.get(number)!.matched_by,
          version: after.pages.get(number)!.file_version_number,
        }));

      expect(shape(firstBackwards, secondBackwards)).toEqual(shape(firstForwards, secondForwards));
      expect(secondBackwards.run.counts).toEqual(secondForwards.run.counts);
      expect(await filenamesIn(backwards.folderId)).toEqual(await filenamesIn(forwards.folderId));
    });

    it('falls back to the page number when a title changed, and re-anchors on it', async () => {
      const { deckId } = await scenario('retitled-card');
      const first = await importPages(deckId, [
        { title: 'Alpha', bytes: png('alpha') },
        { title: 'Beta', bytes: png('beta') },
      ]);
      const second = await importPages(deckId, [
        { title: 'Alpha', bytes: png('alpha') },
        { title: 'Beta the Bold', bytes: png('beta') },
      ]);

      expect(second.pages.get(2)!.matched_by).toBe('page_number');
      expect(second.pages.get(2)!.file_id).toBe(first.pages.get(2)!.file_id);
      expect(second.pages.get(2)!.name).toBe('2 - Beta the Bold.png');
      expect(second.run.counts.removed).toBe(0);

      // Finish wrote the new key onto the mapping row, so the export that keeps
      // the new title matches by identity from here on rather than by position.
      const third = await importPages(deckId, [
        { title: 'Alpha', bytes: png('alpha') },
        { title: 'Beta the Bold', bytes: png('beta') },
      ]);
      expect(third.pages.get(2)!.matched_by).toBe('identity');
      expect(third.pages.get(2)!.file_id).toBe(first.pages.get(2)!.file_id);
    });
  });

  describe('two pages with one title', () => {
    it('imports both rather than refusing the deck', async () => {
      const { deckId, folderId } = await scenario('duplicate-titles');
      const pages = [
        { title: 'Back', bytes: png('back one') },
        { title: 'Back', bytes: png('back two') },
      ];
      const first = await importPages(deckId, pages);

      expect(outcomes(first.pages)).toEqual(['added', 'added']);
      expect(first.pages.get(1)!.file_id).not.toBe(first.pages.get(2)!.file_id);
      expect(await filenamesIn(folderId)).toEqual(['1 - Back.png', '2 - Back.png']);
      expect((await readDeck(deckId)).cards).toHaveLength(2);

      // And the next import finds both again: the loser of the collision took a
      // key of its own at finish rather than being left to collide forever.
      const second = await importPages(deckId, pages);
      expect(second.pages.get(1)!.file_id).toBe(first.pages.get(1)!.file_id);
      expect(second.pages.get(2)!.file_id).toBe(first.pages.get(2)!.file_id);
      expect(second.run.counts.added).toBe(0);
      expect(second.run.counts.removed).toBe(0);
    });

    it('keeps a page titled "2" apart from the untitled page 2', async () => {
      const { deckId } = await scenario('titled-two');
      const pages = [
        { title: '2', bytes: png('a page called two') },
        { bytes: png('the second page') },
      ];
      const first = await importPages(deckId, pages);
      const second = await importPages(deckId, pages);

      // Both keys would read "2" without the prefix that says which kind they
      // are, and the untitled card would then be reachable only by its number.
      expect(second.pages.get(1)!.matched_by).toBe('identity');
      expect(second.pages.get(2)!.matched_by).toBe('identity');
      expect(second.pages.get(1)!.file_id).toBe(first.pages.get(1)!.file_id);
      expect(second.pages.get(2)!.file_id).toBe(first.pages.get(2)!.file_id);
      expect(second.run.counts.removed).toBe(0);
    });
  });

  describe('posting a page twice', () => {
    it('answers with what happened the first time', async () => {
      const { deckId } = await scenario('replayed-page');
      const run = await openRun(deckId, 2);

      const first = await landPage(run.id, 1, { title: 'Alpha', bytes: png('alpha') });
      expect(first.replayed).toBe(false);
      expect(first.outcome).toBe('added');

      // Different artwork under the same page number: the ledger row is the
      // answer, so nothing is worked out again and no version is written.
      const res = await postPage(run.id, 1, png('alpha redrawn'), 'Alpha');
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ ...first, replayed: true });

      await landPage(run.id, 2, { title: 'Beta', bytes: png('beta') });
      expect((await finish(run.id)).status).toBe(200);

      expect(await versionCount(first.file_id!)).toBe(1);
      const detail = await runDetail(run.id);
      expect(detail.cards.filter((card) => card.page_number === 1)).toHaveLength(1);
    });
  });

  describe('a page that stops being exported', () => {
    it('tombstones only the card no page matched, and takes it out of the deck', async () => {
      const { deckId } = await scenario('dropped-page');
      const first = await importPages(deckId, [
        { title: 'Alpha', bytes: png('alpha') },
        { title: 'Beta', bytes: png('beta') },
        { title: 'Gamma', bytes: png('gamma') },
      ]);

      const second = await importPages(deckId, [
        { title: 'Alpha', bytes: png('alpha') },
        { title: 'Beta', bytes: png('beta') },
      ]);
      expect(second.run.counts.removed).toBe(1);

      const gone = first.pages.get(3)!.file_id!;
      expect((await readFile(gone)).body.deleted_at).not.toBeNull();
      expect((await readFile(first.pages.get(1)!.file_id!)).body.deleted_at).toBeNull();

      const removed = second.detail.cards.find((card) => card.outcome === 'removed')!;
      expect(removed.name).toBe('3 - Gamma.png');
      expect(removed.page_number).toBeNull();

      const deck = await readDeck(deckId);
      expect(deck.cards.map((card) => card.file_id)).toEqual([
        first.pages.get(1)!.file_id,
        first.pages.get(2)!.file_id,
      ]);
    });

    it('restores the card when it comes back instead of adding a second one', async () => {
      const { deckId } = await scenario('returning-card');
      const first = await importPages(deckId, [
        { title: 'Alpha', bytes: png('alpha') },
        { title: 'Gamma', bytes: png('gamma') },
      ]);
      await importPages(deckId, [{ title: 'Alpha', bytes: png('alpha') }]);

      const back = await importPages(deckId, [
        { title: 'Alpha', bytes: png('alpha') },
        { title: 'Gamma', bytes: png('gamma') },
      ]);

      const returned = back.pages.get(2)!;
      expect(returned.file_id).toBe(first.pages.get(2)!.file_id);
      expect(returned.restored).toBe(true);
      expect(returned.outcome).toBe('added');
      // Found by its key, not by the page number happening to line up again:
      // the identity probe is what has to keep reaching a tombstone.
      expect(returned.matched_by).toBe('identity');
      expect(back.run.counts.restored).toBe(1);
      expect(await versionCount(returned.file_id!)).toBe(1);
      expect((await readFile(returned.file_id!)).body.deleted_at).toBeNull();
      expect((await readDeck(deckId)).cards.map((card) => card.file_id)).toContain(
        returned.file_id
      );
    });

    it('restores it under a suffix when its name has been taken meanwhile', async () => {
      const { deckId, folderId } = await scenario('returning-under-suffix');
      const first = await importPages(deckId, [
        { title: 'Alpha', bytes: png('alpha') },
        { title: 'Gamma', bytes: png('gamma') },
      ]);
      await importPages(deckId, [{ title: 'Alpha', bytes: png('alpha') }]);
      await uploadByHand(folderId, '2 - Gamma.png', png('by hand'));

      const back = await importPages(deckId, [
        { title: 'Alpha', bytes: png('alpha') },
        { title: 'Gamma', bytes: png('gamma') },
      ]);
      const returned = back.pages.get(2)!;
      expect(returned.file_id).toBe(first.pages.get(2)!.file_id);
      expect(returned.name).toBe('2 - Gamma (2).png');
      expect((await readFile(returned.file_id!)).body.name_locked).toBe(false);
    });

    it('leaves a file somebody put in the folder by hand alone', async () => {
      const { deckId, folderId } = await scenario('hand-placed-file');
      await importPages(deckId, [{ title: 'Alpha', bytes: png('alpha') }]);
      const byHand = await uploadByHand(folderId, 'notes.png', png('notes'));

      await importPages(deckId, [{ title: 'Alpha', bytes: png('alpha') }]);
      expect((await readFile(byHand)).body.deleted_at).toBeNull();
    });
  });

  describe('a name a person typed', () => {
    it('survives an import that still versions the artwork', async () => {
      const { deckId } = await scenario('locked-name');
      const first = await importPages(deckId, [{ title: 'Goblin', bytes: png('goblin') }]);
      const fileId = first.pages.get(1)!.file_id!;

      const renamed = await owner.api.patch(`/api/files/${fileId}`, { filename: 'Chosen.png' });
      expect(renamed.status).toBe(200);
      expect((await renamed.json()).name_locked).toBe(true);

      const second = await importPages(deckId, [{ title: 'Goblin', bytes: png('goblin v2') }]);
      expect(second.pages.get(1)!.name).toBe('Chosen.png');
      expect(second.pages.get(1)!.outcome).toBe('updated');
      expect(second.pages.get(1)!.file_version_number).toBe(2);
      expect((await readFile(fileId)).body.filename).toBe('Chosen.png');
    });

    it('gives the name back to the export once the lock is cleared', async () => {
      const { deckId } = await scenario('unlocked-name');
      const first = await importPages(deckId, [{ title: 'Goblin', bytes: png('goblin') }]);
      const fileId = first.pages.get(1)!.file_id!;

      await owner.api.patch(`/api/files/${fileId}`, { filename: 'Chosen.png' });
      const cleared = await owner.api.patch(`/api/files/${fileId}`, { name_locked: false });
      expect(cleared.status).toBe(200);
      expect((await cleared.json()).name_locked).toBe(false);

      await importPages(deckId, [{ title: 'Goblin', bytes: png('goblin') }]);
      expect((await readFile(fileId)).body.filename).toBe('1 - Goblin.png');
    });
  });

  describe('a deck somebody has arranged by hand', () => {
    it('keeps a hand-set order and copy count through the next import', async () => {
      const { deckId } = await scenario('hand-arranged');
      const first = await importPages(deckId, [
        { title: 'Alpha', bytes: png('alpha') },
        { title: 'Beta', bytes: png('beta') },
        { title: 'Gamma', bytes: png('gamma') },
      ]);
      const [alpha, beta, gamma] = [1, 2, 3].map((number) => first.pages.get(number)!.file_id!);

      const arranged = await owner.api.put(`/api/decks/${deckId}/cards`, {
        cards: [
          { file_id: gamma, quantity: 5 },
          { file_id: alpha, quantity: 2 },
          { file_id: beta, quantity: 1 },
        ],
      });
      expect(arranged.status).toBe(200);

      await importPages(deckId, [
        { title: 'Alpha', bytes: png('alpha') },
        { title: 'Beta', bytes: png('beta') },
        { title: 'Gamma', bytes: png('gamma redrawn') },
      ]);

      const deck = await readDeck(deckId);
      expect(deck.cards.map((card) => card.file_id)).toEqual([gamma, alpha, beta]);
      expect(deck.cards.map((card) => card.quantity)).toEqual([5, 2, 1]);
    });

    it('does not put back a card somebody took out of the deck', async () => {
      const { deckId } = await scenario('hand-removed');
      const first = await importPages(deckId, [
        { title: 'Alpha', bytes: png('alpha') },
        { title: 'Beta', bytes: png('beta') },
      ]);
      const [alpha, beta] = [1, 2].map((number) => first.pages.get(number)!.file_id!);

      const trimmed = await owner.api.put(`/api/decks/${deckId}/cards`, {
        cards: [{ file_id: alpha, quantity: 1 }],
      });
      expect(trimmed.status).toBe(200);

      await importPages(deckId, [
        { title: 'Alpha', bytes: png('alpha') },
        { title: 'Beta', bytes: png('beta redrawn') },
      ]);

      const deck = await readDeck(deckId);
      expect(deck.cards.map((card) => card.file_id)).toEqual([alpha]);
      // Still imported and still versioned: only its place in the deck was the
      // person's to decide.
      expect(await versionCount(beta)).toBe(2);
      expect((await readFile(beta)).body.deleted_at).toBeNull();
    });
  });

  describe('a run that does not finish', () => {
    it('refuses to finish before every page it declared has landed', async () => {
      const { deckId } = await scenario('half-a-run');
      const run = await openRun(deckId, 3);
      await landPage(run.id, 1, { title: 'Alpha', bytes: png('alpha') });

      const res = await finish(run.id);
      expect(res.status).toBe(409);
      expect((await res.json()).error).toMatch(/imported 1 of 3 pages/);
      expect((await readImport(deckId)).body.open_run_id).toBe(run.id);
      expect((await readDeck(deckId)).cards).toEqual([]);
      expect((await abandon(run.id)).status).toBe(200);
    });

    it('refuses a page past the count the run declared', async () => {
      const { deckId } = await scenario('past-the-count');
      const run = await openRun(deckId, 2);
      expect((await postPage(run.id, 3, png('overflow'), 'Extra')).status).toBe(409);
      expect((await abandon(run.id)).status).toBe(200);
    });

    it('refuses a second run and names the open one', async () => {
      const { deckId } = await scenario('one-run-at-a-time');
      const run = await openRun(deckId, 1);

      const res = await startRun(deckId, 1);
      expect(res.status).toBe(409);
      const body = await res.json();
      expect(body.run_id).toBe(run.id);
      expect(typeof body.started_at).toBe('string');
      expect((await abandon(run.id)).status).toBe(200);
    });

    it('abandons half way and leaves every page that landed imported', async () => {
      const { deckId, folderId } = await scenario('abandoned-run');
      const run = await openRun(deckId, 4);
      await landPage(run.id, 1, { title: 'Alpha', bytes: png('alpha') });
      await landPage(run.id, 2, { title: 'Beta', bytes: png('beta') });

      const res = await abandon(run.id);
      expect(res.status).toBe(200);
      expect((await res.json()).status).toBe('abandoned');
      expect(await filenamesIn(folderId)).toEqual(['1 - Alpha.png', '2 - Beta.png']);
      // An abandon tombstones nothing and hands the deck nothing.
      expect((await readDeck(deckId)).cards).toEqual([]);
    });

    it('re-runs after an abandon with no duplicates and no wasted versions', async () => {
      const { deckId, folderId } = await scenario('rerun-after-abandon');
      const pages = [
        { title: 'Alpha', bytes: png('alpha') },
        { title: 'Beta', bytes: png('beta') },
        { title: 'Gamma', bytes: png('gamma') },
      ];

      const abandoned = await openRun(deckId, 3);
      const landed = [
        await landPage(abandoned.id, 1, pages[0]),
        await landPage(abandoned.id, 2, pages[1]),
      ];
      expect((await abandon(abandoned.id)).status).toBe(200);

      const complete = await importPages(deckId, pages);
      expect(outcomes(complete.pages)).toEqual(['unchanged', 'unchanged', 'added']);
      expect(complete.pages.get(1)!.file_id).toBe(landed[0].file_id);
      expect(complete.pages.get(2)!.file_id).toBe(landed[1].file_id);
      expect(complete.run.counts.removed).toBe(0);
      expect(await filenamesIn(folderId)).toEqual([
        '1 - Alpha.png',
        '2 - Beta.png',
        '3 - Gamma.png',
      ]);

      // The two that landed under the abandoned run had never been handed to
      // the deck, so this finish is what puts all three of them in it.
      const deck = await readDeck(deckId);
      expect(deck.cards.map((card) => card.file_id)).toEqual([
        landed[0].file_id,
        landed[1].file_id,
        complete.pages.get(3)!.file_id,
      ]);
      for (const card of deck.cards) expect(await versionCount(card.file_id)).toBe(1);
    });
  });

  describe('a card that leaves the folder', () => {
    it('stops being imported without being tombstoned, and stays in its past runs', async () => {
      const { deckId } = await scenario('moved-out');
      const elsewhere = await makeFolder('moved-out-destination');
      const first = await importPages(deckId, [
        { title: 'Alpha', bytes: png('alpha') },
        { title: 'Beta', bytes: png('beta') },
      ]);
      const moved = first.pages.get(2)!.file_id!;

      expect((await owner.api.patch(`/api/files/${moved}`, { folder_id: elsewhere })).status).toBe(
        200
      );

      const second = await importPages(deckId, [{ title: 'Alpha', bytes: png('alpha') }]);
      expect(second.run.counts.removed).toBe(0);
      expect((await readFile(moved)).body.deleted_at).toBeNull();
      expect((await readFile(moved)).body.folder_id).toBe(elsewhere);

      const past = await runDetail(first.run.id);
      expect(past.cards.find((card) => card.page_number === 2)!.file_id).toBe(moved);
    });

    it('keeps a past run readable after its image is purged', async () => {
      const { deckId } = await scenario('purged-card');
      const first = await importPages(deckId, [{ title: 'One', bytes: png('one') }]);
      const fileId = first.pages.get(1)!.file_id!;

      expect((await owner.api.delete(`/api/files/${fileId}`)).status).toBe(204);
      expect((await owner.api.delete(`/api/files/${fileId}?purge=true`)).status).toBe(204);

      const past = await runDetail(first.run.id);
      expect(past.cards).toHaveLength(1);
      expect(past.cards[0].file_id).toBeNull();
      expect(past.cards[0].name).toBe('1 - One.png');
      expect(past.cards[0].page_number).toBe(1);
    });
  });

  describe('bytes that are not an image', () => {
    it('refuses the page and keeps nothing', async () => {
      const { deckId, folderId } = await scenario('not-an-image');
      const run = await openRun(deckId, 1);

      const res = await postPage(run.id, 1, Buffer.from('this is a spreadsheet'), 'Alpha');
      expect(res.status).toBe(422);
      expect(await filenamesIn(folderId)).toEqual([]);
      expect((await abandon(run.id)).status).toBe(200);
    });
  });

  describe('two pages contending for one card', () => {
    // Alpha and Beta are already imported. The next export renames nothing and
    // shifts everything up a page: page 1 is Beta, page 2 is a card called
    // Gamma that the deck has never seen. Beta's card is claimed by its title,
    // Gamma finds no free card at page 2 once that has happened, and Alpha's
    // card is what the export stopped having. Which page the client uploaded
    // first is not one of the facts that decides any of it.
    const original: Page[] = [
      { title: 'Alpha', bytes: png('alpha') },
      { title: 'Beta', bytes: png('beta') },
    ];
    const shifted: Page[] = [
      { title: 'Beta', bytes: png('beta') },
      { title: 'Gamma', bytes: png('gamma') },
    ];

    it.each([
      ['in page order', false],
      ['backwards', true],
    ])(
      'resolves a contended card the same way with the pages posted %s',
      async (label, reverse) => {
        const { deckId } = await scenario(`contended-${label.replace(/ /gu, '-')}`);
        const first = await importPages(deckId, original);
        const second = await importPages(deckId, shifted, { reverse });

        expect(second.pages.get(1)!.matched_by).toBe('identity');
        expect(second.pages.get(1)!.file_id).toBe(first.pages.get(2)!.file_id);
        expect(second.pages.get(2)!.matched_by).toBeNull();
        expect(second.pages.get(2)!.outcome).toBe('added');
        expect(second.run.counts).toEqual({
          pages: 2,
          added: 1,
          updated: 1,
          unchanged: 0,
          removed: 1,
          restored: 0,
        });

        expect((await readFile(first.pages.get(1)!.file_id!)).body.deleted_at).not.toBeNull();
        expect((await readDeck(deckId)).cards.map((card) => card.file_id)).toEqual([
          first.pages.get(2)!.file_id,
          second.pages.get(2)!.file_id,
        ]);
      }
    );
  });

  describe('a page inserted in the middle of an export', () => {
    it('is itself the new card, and leaves the pages it shifted on their own', async () => {
      const { deckId } = await scenario('inserted-page');
      const first = await importPages(deckId, [
        { title: 'Alpha', bytes: png('alpha') },
        { title: 'Beta', bytes: png('beta') },
      ]);

      // Gamma is slid in between them, so Beta arrives a page later than the
      // card that answers to its title. Gamma is the page with nothing to
      // answer to, and it is the one that becomes a card.
      const pages: Page[] = [
        { title: 'Alpha', bytes: png('alpha') },
        { title: 'Gamma', bytes: png('gamma') },
        { title: 'Beta', bytes: png('beta') },
      ];
      const run = await openRun(deckId, pages.length, pages);
      await landPage(run.id, 1, pages[0]);

      const inserted = await postPage(run.id, 2, pages[1].bytes, pages[1].title);
      expect({ status: inserted.status, body: await inserted.json() }).toMatchObject({
        status: 201,
        body: { outcome: 'added', matched_by: null },
      });

      const shifted = await landPage(run.id, 3, pages[2]);
      expect(shifted.matched_by).toBe('identity');
      expect(shifted.file_id).toBe(first.pages.get(2)!.file_id);
      expect(shifted.name).toBe('3 - Beta.png');

      expect((await finish(run.id)).status).toBe(200);
      expect((await runDetail(run.id)).run.counts.removed).toBe(0);
      expect((await readFile(first.pages.get(1)!.file_id!)).body.deleted_at).toBeNull();
      expect((await readFile(first.pages.get(2)!.file_id!)).body.deleted_at).toBeNull();
      expect((await readDeck(deckId)).cards).toHaveLength(3);
    });
  });

  describe('a title naming a card an earlier page would have taken by number', () => {
    it('gives that card to the page that names it, not to the page walked first', async () => {
      const { deckId } = await scenario('identity-beats-position');
      const first = await importPages(deckId, [
        { title: 'Alpha', bytes: png('alpha') },
        { title: 'Beta', bytes: png('beta') },
      ]);

      // Page 1 has lost its title and page 2 has picked up the one page 1 used
      // to carry. Matched in one interleaved walk, page 1's page-number probe
      // takes Alpha's card before page 2 ever asks for it by name — a weaker
      // claim beating an exact one on nothing but being walked first.
      const second = await importPages(deckId, [
        { bytes: png('an untitled cover') },
        { title: 'Alpha', bytes: png('alpha') },
      ]);

      expect(second.pages.get(2)!.matched_by).toBe('identity');
      expect(second.pages.get(2)!.file_id).toBe(first.pages.get(1)!.file_id);
      expect(second.pages.get(1)!.matched_by).toBeNull();
      expect(second.pages.get(1)!.outcome).toBe('added');
      expect(second.pages.get(1)!.file_id).not.toBe(first.pages.get(1)!.file_id);

      // Beta is what this export stopped having, and Alpha's artwork was never
      // versioned over with the untitled page's.
      expect((await readFile(first.pages.get(2)!.file_id!)).body.deleted_at).not.toBeNull();
      expect(await versionCount(first.pages.get(1)!.file_id!)).toBe(1);
      expect(second.run.counts).toEqual({
        pages: 2,
        added: 1,
        updated: 1,
        unchanged: 0,
        removed: 1,
        restored: 0,
      });
    });
  });

  describe('a page title the manifest and the upload have to agree on', () => {
    const limit = 'x'.repeat(IMPORT_TITLE_MAX_LENGTH);

    // The manifest truncated at the bound where posting the page rejects, so an
    // over-long title was planned and then refused by the page carrying it —
    // and a run that can never reach its page count can never finish, which
    // left abandoning it the only way out.
    it.each([
      ['one character past the limit', `${limit}x`, false],
      ['a control character', 'Back\u0007Two', false],
      ['nothing but spaces', '   ', false],
      ['exactly the limit', limit, true],
    ])('takes or refuses %s in both', async (label, title, allowed) => {
      const { deckId } = await scenario(`title-${label.replace(/ /gu, '-')}`);

      const manifest = await owner.api.post(`/api/decks/${deckId}/import/runs`, {
        pages: [{ page_number: 1, title }],
      });
      expect(manifest.status).toBe(allowed ? 201 : 422);

      let run: Run;
      if (allowed) {
        run = (await manifest.json()) as Run;
      } else {
        // Nothing was opened, so there is no wedged run to abandon.
        expect(await timeline(deckId)).toEqual([]);
        run = await openRun(deckId, 1, [{ title: 'Fits', bytes: png('fits') }]);
      }

      // 400 rather than 422 because this half of the pair is a query parameter,
      // which is the one thing about the two that does not match.
      const page = await postPage(run.id, 1, png('page'), title);
      expect(page.status).toBe(allowed ? 201 : 400);
      expect((await abandon(run.id)).status).toBe(200);
    });
  });

  describe('a card whose file was moved out between runs', () => {
    it('imports its page again rather than on the key the moved row still holds', async () => {
      const { deckId } = await scenario('moved-out-then-re-exported');
      const elsewhere = await makeFolder('moved-out-then-re-exported-destination');
      const pages: Page[] = [
        { title: 'Alpha', bytes: png('alpha') },
        { title: 'Beta', bytes: png('beta') },
      ];
      const first = await importPages(deckId, pages);
      const moved = first.pages.get(2)!.file_id!;
      expect((await owner.api.patch(`/api/files/${moved}`, { folder_id: elsewhere })).status).toBe(
        200
      );

      // Nothing has finished since the move, so the mapping row for the moved
      // file is still attached and still holding Beta's key.
      const run = await openRun(deckId, pages.length, pages);
      await landPage(run.id, 1, pages[0]);
      const again = await postPage(run.id, 2, pages[1].bytes, pages[1].title);
      expect({ status: again.status, body: await again.json() }).toMatchObject({
        status: 201,
        body: { outcome: 'added', matched_by: null },
      });

      expect((await finish(run.id)).status).toBe(200);
      expect((await readFile(moved)).body.deleted_at).toBeNull();
      expect((await readFile(moved)).body.folder_id).toBe(elsewhere);
      expect((await readDeck(deckId)).cards).toHaveLength(3);
    });
  });

  describe('a deck at its card cap', () => {
    let filler = 0;

    // Cards without an upload each: the cap is five hundred of them and what
    // this is measuring is the number, not the bytes.
    async function fillDeck(deckId: string, count: number): Promise<void> {
      const rows = Array.from({ length: count }, () => {
        filler += 1;
        return { id: randomUUID(), filename: `filler-${filler}.png`, position: filler };
      });

      await db
        .insertInto('file')
        .values(
          rows.map((row) => ({
            id: row.id,
            project_id: projectId,
            folder_id: null,
            filename: row.filename,
            storage_key: randomUUID(),
            content_type: 'image/png',
            byte_size: '0',
            uploaded_by: owner.id,
          }))
        )
        .execute();

      await db
        .insertInto('deck_card')
        .values(
          rows.map((row) => ({
            id: randomUUID(),
            deck_id: deckId,
            file_id: row.id,
            quantity: 1,
            position: row.position,
          }))
        )
        .execute();
    }

    it('refuses the run before a single page is uploaded', async () => {
      const { deckId } = await scenario('deck-at-the-cap');
      await fillDeck(deckId, MAX_DECK_CARDS);

      const page: Page = { title: 'One too many', bytes: png('spill') };
      const res = await startRun(deckId, 1, owner, [page]);
      expect({ status: res.status, body: await res.json() }).toMatchObject({ status: 422 });

      expect((await readImport(deckId)).body.open_run_id).toBeNull();
      expect((await readDeck(deckId)).cards).toHaveLength(MAX_DECK_CARDS);
    });

    it('refuses to finish a run a hand edit has pushed past the cap', async () => {
      const { deckId } = await scenario('deck-filled-during-a-run');
      await fillDeck(deckId, MAX_DECK_CARDS - 1);

      const page: Page = { title: 'One too many', bytes: png('spill') };
      const run = await openRun(deckId, 1, [page]);
      // The last free place, taken by hand while the run was open.
      await fillDeck(deckId, 1);
      await landPage(run.id, 1, page);

      const res = await finish(run.id);
      expect({ status: res.status, body: await res.json() }).toMatchObject({ status: 422 });
      // A deck the editor can still save: one card past the cap and every hand
      // edit fails validation on a list the import wrote.
      expect((await readDeck(deckId)).cards).toHaveLength(MAX_DECK_CARDS);
      expect((await abandon(run.id)).status).toBe(200);
    });
  });

  describe("the file embedded in a deck's cards", () => {
    it('says whether a person has named it', async () => {
      const { deckId } = await scenario('deck-card-file-fields');
      const first = await importPages(deckId, [{ title: 'Goblin', bytes: png('goblin') }]);
      const fileId = first.pages.get(1)!.file_id!;

      expect((await readDeck(deckId)).cards[0].file.name_locked).toBe(false);
      expect(
        (await owner.api.patch(`/api/files/${fileId}`, { filename: 'Chosen.png' })).status
      ).toBe(200);
      expect((await readDeck(deckId)).cards[0].file.name_locked).toBe(true);
    });
  });

  describe('authorization', () => {
    let deckId: string;
    let folderId: string;
    let runId: string;

    beforeAll(async () => {
      ({ deckId, folderId } = await scenario('guarded-import'));
      runId = (await openRun(deckId, 1)).id;
    });

    afterAll(async () => {
      await abandon(runId);
    });

    it('lets a viewer read the binding and the timeline', async () => {
      expect((await readImport(deckId, viewer)).status).toBe(200);
      expect((await viewer.api.get(`/api/decks/${deckId}/import/runs`)).status).toBe(200);
      expect((await viewer.api.get(`/api/decks/import/runs/${runId}`)).status).toBe(200);
    });

    it.each([
      ['binding', (user: TestUser) => bind(deckId, folderId, undefined, user)],
      ['unbinding', (user: TestUser) => user.api.delete(`/api/decks/${deckId}/import`)],
      ['starting a run', (user: TestUser) => startRun(deckId, 1, user)],
      ['importing a page', (user: TestUser) => postPage(runId, 1, png('viewer'), 'Alpha', user)],
      ['finishing a run', (user: TestUser) => finish(runId, user)],
      ['abandoning a run', (user: TestUser) => abandon(runId, user)],
    ])('refuses a viewer %s with 403', async (_name, act) => {
      expect((await act(viewer)).status).toBe(403);
    });

    // 403 would tell an outsider that this deck exists and is being imported.
    it.each([
      ['reading the binding', (user: TestUser) => user.api.get(`/api/decks/${deckId}/import`)],
      ['binding', (user: TestUser) => bind(deckId, folderId, undefined, user)],
      ['starting a run', (user: TestUser) => startRun(deckId, 1, user)],
      ['reading a run', (user: TestUser) => user.api.get(`/api/decks/import/runs/${runId}`)],
      ['importing a page', (user: TestUser) => postPage(runId, 1, png('stranger'), 'Alpha', user)],
      ['finishing a run', (user: TestUser) => finish(runId, user)],
    ])('answers a stranger %s with 404', async (_name, act) => {
      expect((await act(stranger)).status).toBe(404);
    });

    it('answers 404 for a deck nobody has bound', async () => {
      const lonely = await makeDeck('Never imported');
      const res = await owner.api.get(`/api/decks/${lonely}/import`);
      expect(res.status).toBe(404);
      expect((await res.json()).error).toBe('This deck has no import');
    });
  });
});
