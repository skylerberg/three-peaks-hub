import '../api/testUtils.ts';
import { fetchMock, jsonResponse } from '../api/testUtils.ts';
import { IMPORT_TITLE_MAX_LENGTH } from '@three-peaks/shared';
import { beforeEach, describe, expect, it } from 'vitest';
import { buildZip, zipBlob } from './canva/testZip.ts';
import { deckImports } from './deckImports.svelte.ts';

const PROJECT = '2f1c9e5a-8b3d-4f1e-9c2a-7d6b5e4f3a21';
const DECK = '3c7f1b2e-9a4d-4c6b-8e1f-2a3b4c5d6e7f';
const FOLDER = '9e8d7c6b-5a4f-4e3d-2c1b-0a9f8e7d6c5b';
const RUN = '5d4c3b2a-1f0e-4d9c-8b7a-6f5e4d3c2b1a';
const OTHER_DECK = '7a6b5c4d-3e2f-4a1b-9c8d-7e6f5a4b3c2d';

const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

function png(fill: number): Uint8Array {
  const bytes = new Uint8Array(24).fill(fill);
  bytes.set(PNG_MAGIC, 0);
  return bytes;
}

function binding(overrides: Record<string, unknown> = {}) {
  return {
    id: 'import-1',
    deck_id: DECK,
    folder_id: FOLDER,
    source_kind: 'zip',
    source_label: null,
    open_run_id: null,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function listing(name: string) {
  return {
    project_id: PROJECT,
    folder: {
      id: FOLDER,
      project_id: PROJECT,
      parent_id: null,
      name,
      created_at: '2026-01-01T00:00:00.000Z',
      updated_at: '2026-01-01T00:00:00.000Z',
    },
    breadcrumb: [],
    folders: [],
    files: [],
    storage: { used_bytes: 0, quota_bytes: 1 },
  };
}

function run(overrides: Record<string, unknown> = {}) {
  return {
    id: RUN,
    import_id: 'import-1',
    status: 'open',
    source_label: 'export.zip',
    page_count: 3,
    started_by: 'someone',
    started_at: '2026-02-02T10:00:00.000Z',
    finished_at: null,
    counts: { pages: 0, added: 0, updated: 0, unchanged: 0, removed: 0, restored: 0 },
    ...overrides,
  };
}

function plan(pages: number) {
  return {
    added: pages,
    updated: 0,
    removed: [],
    pages: Array.from({ length: pages }, (_unused, index) => ({
      page_number: index + 1,
      title: null,
      action: 'add',
      matched_by: null,
      name: null,
    })),
  };
}

async function exportFile(names: string[], fileName = 'export.zip'): Promise<File> {
  const bytes = await buildZip(names.map((name, index) => ({ name, bytes: png(index + 1) })));
  return new File([zipBlob(bytes)], fileName, { type: 'application/zip' });
}

// The page POST is a raw fetch, so its URL arrives relative.
function query(url: string): URLSearchParams {
  return new URL(url, 'http://localhost').searchParams;
}

function calls(): { url: string; init: RequestInit }[] {
  return fetchMock.mock.calls.map(([input, init]) => ({
    url: typeof input === 'string' ? input : (input as Request).url,
    init: (init ?? {}) as RequestInit,
  }));
}

describe('DeckImportStore', () => {
  beforeEach(() => {
    deckImports.reset();
    fetchMock.mockReset();
  });

  // The route answers 404 both for a deck that is not bound and for a deck that
  // does not exist, and the screen has already proved the deck exists.
  it('treats a 404 from the binding route as a deck that is not bound yet', async () => {
    fetchMock.mockImplementation(async () =>
      jsonResponse(404, { error: 'This deck has no import' })
    );

    await deckImports.loadBinding(PROJECT, DECK);

    expect(deckImports.binding).toBeNull();
    expect(deckImports.loadingBinding).toBe(false);
  });

  it('lets any other failure from the binding route through', async () => {
    fetchMock.mockImplementation(async () => jsonResponse(500, { error: 'Internal error' }));

    await expect(deckImports.loadBinding(PROJECT, DECK)).rejects.toThrow('Internal error');
  });

  it('discards a binding response that a newer request has already superseded', async () => {
    let releaseFirst: (() => void) | null = null;
    const firstArrived = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    let bindings = 0;
    let directories = 0;

    fetchMock.mockImplementation(async (input) => {
      const url = typeof input === 'string' ? input : (input as Request).url;
      if (url.includes('/directory')) {
        directories += 1;
        // The newer load reaches this first; the older one arrives second and
        // must not assign what it read.
        return jsonResponse(200, listing(directories === 1 ? 'Fresh folder' : 'Stale folder'));
      }
      bindings += 1;
      if (bindings === 1) {
        await firstArrived;
        return jsonResponse(200, binding({ source_label: 'stale' }));
      }
      return jsonResponse(200, binding({ source_label: 'fresh' }));
    });

    const stale = deckImports.loadBinding(PROJECT, DECK);
    await deckImports.loadBinding(PROJECT, DECK);
    releaseFirst!();
    await stale;

    expect(deckImports.binding?.source_label).toBe('fresh');
  });

  it('posts the pages one at a time, in page order', async () => {
    let inFlight = 0;
    let overlapped = false;
    const posted: string[] = [];

    fetchMock.mockImplementation(async (input) => {
      const url = typeof input === 'string' ? input : (input as Request).url;
      if (!url.includes('/pages?')) return jsonResponse(200, run({ status: 'closed' }));
      inFlight += 1;
      if (inFlight > 1) overlapped = true;
      await new Promise((resolve) => setTimeout(resolve, 0));
      inFlight -= 1;
      posted.push(url);
      return jsonResponse(201, { page_number: 1, outcome: 'added' });
    });

    await deckImports.readExport(await exportFile(['1.png', '2.png', '3.png']));
    await startedRun(3);
    await deckImports.confirm(DECK);

    expect(overlapped).toBe(false);
    expect(posted.map((url) => query(url).get('page_number'))).toEqual(['1', '2', '3']);
  });

  it('sends the page number in the query string and the bytes as the body', async () => {
    stubPages();

    await deckImports.readExport(await exportFile(['1 - Ace of coins.png']));
    await startedRun(1);
    await deckImports.confirm(DECK);

    const page = calls().find((call) => call.url.includes('/pages?'));
    const parameters = query(page?.url ?? '');
    expect(parameters.get('page_number')).toBe('1');
    expect(parameters.get('title')).toBe('Ace of coins');
    const body = page?.init.body as Blob;
    const bytes = new Uint8Array(await body.arrayBuffer());
    expect([...bytes.slice(0, 8)]).toEqual(PNG_MAGIC);
  });

  it('omits the title from the query string for an untitled page', async () => {
    stubPages();

    await deckImports.readExport(await exportFile(['1.png']));
    await startedRun(1);
    await deckImports.confirm(DECK);

    const page = calls().find((call) => call.url.includes('/pages?'));
    expect(query(page?.url ?? '').has('title')).toBe(false);
  });

  it('reads the open run out of a 409 body so the screen can offer to resume it', async () => {
    fetchMock.mockImplementation(async () =>
      jsonResponse(409, {
        error: 'An import run is open for this deck. Finish or abandon it first',
        run_id: RUN,
        started_at: '2026-02-02T10:00:00.000Z',
      })
    );

    await deckImports.readExport(await exportFile(['1.png']));
    await deckImports.startRun(DECK);

    expect(deckImports.openRun).toEqual({ run_id: RUN, started_at: '2026-02-02T10:00:00.000Z' });
    expect(deckImports.status).toBe('idle');
  });

  it('stops posting after a cancel and abandons the run', async () => {
    const seen: string[] = [];
    fetchMock.mockImplementation(async (input) => {
      const url = typeof input === 'string' ? input : (input as Request).url;
      seen.push(url);
      if (url.includes('/pages?')) {
        deckImports.cancel();
        return jsonResponse(201, { page_number: 1, outcome: 'added' });
      }
      if (url.includes('/abandon')) return jsonResponse(200, run({ status: 'abandoned' }));
      return jsonResponse(404, { error: 'This deck has no import' });
    });

    await deckImports.readExport(await exportFile(['1.png', '2.png', '3.png']));
    await startedRun(3);
    await deckImports.confirm(DECK);

    expect(seen.filter((url) => url.includes('/pages?'))).toHaveLength(1);
    expect(seen.some((url) => url.includes('/abandon'))).toBe(true);
    expect(seen.some((url) => url.includes('/finish'))).toBe(false);
    expect(deckImports.run).toBeNull();
  });

  it('skips the pages a resumed run has already imported', async () => {
    const posted: string[] = [];
    fetchMock.mockImplementation(async (input) => {
      const url = typeof input === 'string' ? input : (input as Request).url;
      if (url.endsWith(`/runs/${RUN}`)) {
        return jsonResponse(200, {
          run: run(),
          cards: [
            {
              page_number: 1,
              outcome: 'added',
              matched_by: null,
              restored: false,
              name: '1.png',
              file_id: 'f1',
              file_version_number: 1,
            },
          ],
        });
      }
      if (url.includes('/pages?')) {
        posted.push(url);
        return jsonResponse(201, { page_number: 2, outcome: 'added' });
      }
      if (url.includes('/finish'))
        return jsonResponse(200, { run: run({ status: 'finished' }), cards: [] });
      return jsonResponse(404, { error: 'This deck has no import' });
    });

    await deckImports.resume(DECK, RUN, await exportFile(['1.png', '2.png', '3.png']));

    expect(posted.map((url) => query(url).get('page_number'))).toEqual(['2', '3']);
    expect(deckImports.status).toBe('done');
  });

  // A replay is what makes resuming work at all, so it has to move the counter
  // exactly as a first landing does.
  it('counts a replayed page as progress', async () => {
    fetchMock.mockImplementation(async (input) => {
      const url = typeof input === 'string' ? input : (input as Request).url;
      if (url.includes('/pages?')) {
        return jsonResponse(200, { page_number: 1, outcome: 'unchanged', replayed: true });
      }
      if (url.includes('/finish'))
        return jsonResponse(200, { run: run({ status: 'finished' }), cards: [] });
      return jsonResponse(404, { error: 'This deck has no import' });
    });

    await deckImports.readExport(await exportFile(['1.png', '2.png']));
    await startedRun(2);
    await deckImports.confirm(DECK);

    expect(deckImports.posted).toBe(2);
  });

  it('reports the message the server gave when a page is refused', async () => {
    fetchMock.mockImplementation(async (input) => {
      const url = typeof input === 'string' ? input : (input as Request).url;
      if (url.includes('/pages?')) return jsonResponse(413, { error: 'That page is too large' });
      return jsonResponse(404, { error: 'This deck has no import' });
    });

    await deckImports.readExport(await exportFile(['1.png']));
    await startedRun(1);
    await deckImports.confirm(DECK);

    expect(deckImports.error).toBe('That page is too large');
    expect(deckImports.status).toBe('idle');
  });

  // The run's pages are numbered by the manifest it was started from, so a
  // different export resumed into it writes its artwork onto these cards.
  it('refuses to resume a run with an export that is not the one it started from', async () => {
    const seen: string[] = [];
    fetchMock.mockImplementation(async (input) => {
      const url = typeof input === 'string' ? input : (input as Request).url;
      seen.push(url);
      if (url.endsWith(`/runs/${RUN}`)) {
        return jsonResponse(200, { run: run({ source_label: 'Deck export.zip' }), cards: [] });
      }
      return jsonResponse(404, { error: 'This deck has no import' });
    });

    await deckImports.resume(DECK, RUN, await exportFile(['1.png', '2.png']));

    expect(seen.some((url) => url.includes('/pages?'))).toBe(false);
    expect(deckImports.error).toContain('Deck export.zip');
    expect(deckImports.error).toContain('export.zip');
  });

  it('resumes when the file is the one the run names', async () => {
    stubPages();
    fetchMock.mockImplementationOnce(async () =>
      jsonResponse(200, { run: run({ source_label: 'export.zip', page_count: 1 }), cards: [] })
    );

    await deckImports.resume(DECK, RUN, await exportFile(['1.png']));

    expect(deckImports.error).toBeNull();
    expect(calls().some((call) => call.url.includes('/pages?'))).toBe(true);
  });

  // One store, one run: a plan left unconfirmed on one deck must not be the
  // thing another deck's screen uploads.
  it('will not confirm a plan that belongs to another deck', async () => {
    stubPages();

    await deckImports.readExport(await exportFile(['1.png']));
    await startedRun(1);
    await deckImports.confirm('9f8e7d6c-5b4a-4392-8172-6f5e4d3c2b1a');

    expect(calls().some((call) => call.url.includes('/pages?'))).toBe(false);
    expect(deckImports.runDeckId).toBe(DECK);
  });

  it('forgets a run in flight when the store is reset', async () => {
    let releasePage: (() => void) | null = null;
    const pageArrived = new Promise<void>((resolve) => {
      releasePage = resolve;
    });
    const posted: string[] = [];

    fetchMock.mockImplementation(async (input) => {
      const url = typeof input === 'string' ? input : (input as Request).url;
      if (url.includes('/pages?')) {
        posted.push(url);
        await pageArrived;
        return jsonResponse(201, { page_number: 1, outcome: 'added' });
      }
      return jsonResponse(404, { error: 'This deck has no import' });
    });

    await deckImports.readExport(await exportFile(['1.png', '2.png']));
    await startedRun(2);
    const importing = deckImports.confirm(DECK);
    deckImports.reset();
    releasePage!();
    await importing;

    expect(posted).toHaveLength(1);
    expect(deckImports.posted).toBe(0);
    expect(deckImports.status).toBe('idle');
  });

  // One store, one binding, and the deck just left is the one it holds until
  // the next deck's read lands -- open run and all, which is the id Discard
  // would then abandon.
  it('drops the previous deck’s binding before the next deck’s is read', async () => {
    let release: (() => void) | null = null;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    let bindings = 0;

    fetchMock.mockImplementation(async (input) => {
      const url = typeof input === 'string' ? input : (input as Request).url;
      if (url.includes('/directory')) return jsonResponse(200, listing('Cards'));
      bindings += 1;
      if (bindings === 1) return jsonResponse(200, binding({ open_run_id: RUN }));
      await held;
      return jsonResponse(200, binding({ deck_id: OTHER_DECK }));
    });

    await deckImports.loadBinding(PROJECT, DECK);
    expect(deckImports.binding?.open_run_id).toBe(RUN);
    expect(deckImports.bindingDeckId).toBe(DECK);

    const next = deckImports.loadBinding(PROJECT, OTHER_DECK);
    expect(deckImports.binding).toBeNull();
    expect(deckImports.bindingDeckId).toBeNull();

    release!();
    await next;

    expect(deckImports.bindingDeckId).toBe(OTHER_DECK);
    expect(deckImports.binding?.deck_id).toBe(OTHER_DECK);
  });

  // Canva names an export after the design, so an export taken again after an
  // edit is a different ZIP under the same name.
  it('refuses to resume an export that is not the length the run planned for', async () => {
    const seen: string[] = [];
    fetchMock.mockImplementation(async (input) => {
      const url = typeof input === 'string' ? input : (input as Request).url;
      seen.push(url);
      if (url.endsWith(`/runs/${RUN}`)) {
        return jsonResponse(200, { run: run({ page_count: 3 }), cards: [] });
      }
      return jsonResponse(404, { error: 'This deck has no import' });
    });

    await deckImports.resume(DECK, RUN, await exportFile(['1.png', '2.png']));

    expect(seen.some((url) => url.includes('/pages?'))).toBe(false);
    expect(deckImports.error).toContain('3 pages');
    expect(deckImports.error).toContain('2 pages');
  });

  // The label is stored through the same rule every other text field is, and a
  // design title long enough to be cut is the ordinary case, not a corner.
  it('resumes when the run holds this file’s name as the server stored it', async () => {
    const fileName = `${'Long design title '.repeat(20)}.zip`;
    stubPages();
    fetchMock.mockImplementationOnce(async () =>
      jsonResponse(200, {
        run: run({ page_count: 1, source_label: fileName.slice(0, IMPORT_TITLE_MAX_LENGTH) }),
        cards: [],
      })
    );

    await deckImports.resume(DECK, RUN, await exportFile(['1.png'], fileName));

    expect(deckImports.error).toBeNull();
    expect(calls().some((call) => call.url.includes('/pages?'))).toBe(true);
  });

  it('starts the run with the label the server will keep, not the raw name', async () => {
    const fileName = `  ${'a'.repeat(IMPORT_TITLE_MAX_LENGTH + 40)}.zip  `;
    stubPages();

    await deckImports.readExport(await exportFile(['1.png'], fileName));
    await startedRun(1);

    const manifest = fetchMock.mock.calls
      .map(([input]) => input)
      .find(
        (input): input is Request =>
          typeof input !== 'string' && (input as Request).method === 'POST'
      );
    const body = (await manifest!.json()) as { source_label: string | null };
    expect(body.source_label).toBe(fileName.trim().slice(0, IMPORT_TITLE_MAX_LENGTH));
  });
});

// Starts a run against a stubbed manifest response, leaving the store on the
// plan the way pressing "Read the export" then waiting does.
async function startedRun(pages: number): Promise<void> {
  fetchMock.mockImplementationOnce(async () =>
    jsonResponse(201, { ...run({ page_count: pages }), plan: plan(pages) })
  );
  await deckImports.startRun(DECK);
}

// Every page lands, the run finishes, and anything else is the unbound binding.
function stubPages(): void {
  fetchMock.mockImplementation(async (input) => {
    const url = typeof input === 'string' ? input : (input as Request).url;
    if (url.includes('/pages?')) return jsonResponse(201, { page_number: 1, outcome: 'added' });
    if (url.includes('/finish'))
      return jsonResponse(200, { run: run({ status: 'finished' }), cards: [] });
    return jsonResponse(404, { error: 'This deck has no import' });
  });
}
