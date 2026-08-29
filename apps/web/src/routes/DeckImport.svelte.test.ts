import '../api/testUtils.ts';
import { fetchMock, jsonResponse } from '../api/testUtils.ts';
import { fireEvent, render, screen } from '@testing-library/svelte';
import { beforeEach, describe, expect, it } from 'vitest';
import DeckImport from './DeckImport.svelte';
import { buildZip, zipBlob } from '../lib/canva/testZip.ts';
import { deckImports } from '../lib/deckImports.svelte.ts';
import { decks } from '../lib/decks.svelte.ts';
import { toasts } from '../lib/toasts.svelte.ts';

const PROJECT = '2f1c9e5a-8b3d-4f1e-9c2a-7d6b5e4f3a21';
const DECK = '3c7f1b2e-9a4d-4c6b-8e1f-2a3b4c5d6e7f';
const FOLDER = '9e8d7c6b-5a4f-4e3d-2c1b-0a9f8e7d6c5b';
const RUN = '5d4c3b2a-1f0e-4d9c-8b7a-6f5e4d3c2b1a';
const OTHER_DECK = '7a6b5c4d-3e2f-4a1b-9c8d-7e6f5a4b3c2d';

const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

async function settle(): Promise<void> {
  for (let tick = 0; tick < 30; tick += 1) await new Promise((resolve) => setTimeout(resolve, 0));
}

function png(fill: number): Uint8Array {
  const bytes = new Uint8Array(24).fill(fill);
  bytes.set(PNG_MAGIC, 0);
  return bytes;
}

async function exportFile(): Promise<File> {
  const bytes = await buildZip([
    { name: '1.png', bytes: png(1) },
    { name: '2 - Ace of coins.png', bytes: png(2) },
    { name: '3.png', bytes: png(3) },
  ]);
  return new File([zipBlob(bytes)], 'export.zip', { type: 'application/zip' });
}

const DECK_ROW = {
  id: DECK,
  project_id: PROJECT,
  name: 'Base game',
  card_width_mm: 63,
  card_height_mm: 88,
  back_file_id: null,
  created_by: 'someone',
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-01-01T00:00:00.000Z',
  card_count: 0,
  total_copies: 0,
};

const RUN_ROW = {
  id: RUN,
  import_id: 'import-1',
  status: 'open',
  source_label: 'export.zip',
  page_count: 3,
  started_by: 'someone',
  started_at: '2026-02-02T10:00:00.000Z',
  finished_at: null,
  counts: { pages: 1, added: 0, updated: 0, unchanged: 0, removed: 0, restored: 0 },
};

interface Stubs {
  bound?: boolean;
  openRun?: boolean;
  onPage?: (url: string) => void;
  holdPages?: Promise<void>;
  deckIds?: string[];
}

const DECK_ID_PATTERN = /\/api\/decks\/([0-9a-f-]{36})/u;

function stubApi(stubs: Stubs = {}): void {
  const { bound = true, openRun = false, onPage, holdPages, deckIds = [DECK] } = stubs;

  fetchMock.mockImplementation(async (input) => {
    const url = typeof input === 'string' ? input : (input as Request).url;

    if (url.includes('/abandon')) {
      return jsonResponse(200, { ...RUN_ROW, status: 'abandoned' });
    }
    if (url.includes('/pages?')) {
      onPage?.(url);
      if (holdPages) await holdPages;
      return jsonResponse(201, { page_number: 1, outcome: 'added' });
    }
    if (url.includes('/finish')) {
      return jsonResponse(200, { run: { ...RUN_ROW, status: 'finished' }, cards: [] });
    }
    if (url.includes('/api/files/directory')) {
      return jsonResponse(200, {
        project_id: PROJECT,
        folder: {
          id: FOLDER,
          project_id: PROJECT,
          parent_id: null,
          name: 'Cards',
          created_at: '2026-01-01T00:00:00.000Z',
          updated_at: '2026-01-01T00:00:00.000Z',
        },
        breadcrumb: [],
        folders: [],
        files: [],
        storage: { used_bytes: 0, quota_bytes: 1 },
      });
    }

    const deckId = DECK_ID_PATTERN.exec(url)?.[1] ?? null;
    if (deckId !== null && deckIds.includes(deckId)) {
      if (url.includes('/import/runs')) {
        return jsonResponse(200, { runs: openRun ? [RUN_ROW] : [] });
      }
      if (url.includes('/import')) {
        if (!bound) return jsonResponse(404, { error: 'This deck has no import' });
        return jsonResponse(200, {
          id: 'import-1',
          deck_id: deckId,
          folder_id: FOLDER,
          source_kind: 'zip',
          source_label: null,
          open_run_id: openRun ? RUN : null,
          created_at: '2026-01-01T00:00:00.000Z',
          updated_at: '2026-01-01T00:00:00.000Z',
        });
      }
      return jsonResponse(200, { deck: { ...DECK_ROW, id: deckId }, cards: [] });
    }

    if (url.includes(`/api/projects/${PROJECT}`)) {
      return jsonResponse(200, {
        id: PROJECT,
        name: 'Colori',
        description: null,
        role: 'editor',
        created_at: '2026-01-01T00:00:00.000Z',
        updated_at: '2026-01-01T00:00:00.000Z',
      });
    }
    return jsonResponse(404, { error: `nothing stubbed for ${url}` });
  });
}

type PlanPage = {
  page_number: number;
  title: string | null;
  action: 'add' | 'update';
  matched_by: string | null;
  name: string | null;
};

const NEW_PAGES: PlanPage[] = [
  { page_number: 1, title: null, action: 'add', matched_by: null, name: null },
  { page_number: 2, title: 'Ace of coins', action: 'add', matched_by: null, name: null },
  { page_number: 3, title: null, action: 'add', matched_by: null, name: null },
];

interface Planned {
  removed?: { file_id: string; name: string }[];
  pages?: PlanPage[];
  added?: number;
  updated?: number;
}

function planResponse(planned: Planned): Response {
  const pages = planned.pages ?? NEW_PAGES;
  return jsonResponse(201, {
    ...RUN_ROW,
    counts: { pages: 0, added: 0, updated: 0, unchanged: 0, removed: 0, restored: 0 },
    plan: {
      added: planned.added ?? pages.filter((page) => page.action === 'add').length,
      updated: planned.updated ?? pages.filter((page) => page.action === 'update').length,
      removed: planned.removed ?? [],
      pages,
    },
  });
}

async function offerTheExport(planned: Planned = {}): Promise<void> {
  const input = screen.getByLabelText('Canva export (.zip)');
  const plan = planResponse(planned);
  const previous = fetchMock.getMockImplementation();
  // The manifest POST and the timeline GET share a path, so the method is what
  // tells them apart -- and openapi-fetch hands fetch a Request, not an init.
  fetchMock.mockImplementation(async (url, init) => {
    const request = typeof url === 'string' ? null : (url as Request);
    const target = request?.url ?? (url as string);
    const method = request?.method ?? init?.method ?? 'GET';
    if (/\/api\/decks\/[0-9a-f-]{36}\/import\/runs$/u.test(target) && method === 'POST') {
      return plan;
    }
    return previous!(url, init);
  });

  await fireEvent.change(input, { target: { files: [await exportFile()] } });
  await settle();
}

function requested(fragment: string): string[] {
  return fetchMock.mock.calls
    .map(([input]) => (typeof input === 'string' ? input : (input as Request).url))
    .filter((url) => url.includes(fragment));
}

describe('Deck import screen', () => {
  beforeEach(() => {
    deckImports.reset();
    decks.reset();
    toasts.clear();
    fetchMock.mockReset();
  });

  // 404 on the import row is "never imported into", not "set something up
  // first": the artwork lands in the deck, so there is nowhere else to choose
  // and nothing standing between a fresh deck and its first export.
  it('offers a ZIP straight away on a deck nothing has been imported into', async () => {
    stubApi({ bound: false });

    render(DeckImport, { projectId: PROJECT, deckId: DECK });
    await settle();

    expect(screen.getByLabelText('Canva export (.zip)')).toBeInTheDocument();
  });

  it('shows the plan and uploads nothing until Import is pressed', async () => {
    const posted: string[] = [];
    stubApi({ onPage: (url) => posted.push(url) });

    render(DeckImport, { projectId: PROJECT, deckId: DECK });
    await settle();
    await offerTheExport();

    expect(screen.getByText('3 new · 0 updated · 0 removed')).toBeInTheDocument();
    expect(posted).toHaveLength(0);

    await fireEvent.click(screen.getByRole('button', { name: 'Import 3 pages' }));
    await settle();

    expect(posted).toHaveLength(3);
  });

  it('names every card the import is about to move to Deleted', async () => {
    stubApi();

    render(DeckImport, { projectId: PROJECT, deckId: DECK });
    await settle();
    await offerTheExport({
      removed: [
        { file_id: 'f1', name: '3 - Gamma.png' },
        { file_id: 'f2', name: '4 - Delta.png' },
      ],
    });

    expect(screen.getByText('3 new · 0 updated · 2 removed')).toBeInTheDocument();
    expect(screen.getByText('3 - Gamma.png')).toBeInTheDocument();
    expect(screen.getByText('4 - Delta.png')).toBeInTheDocument();
  });

  it('names the card each page will write a new version of', async () => {
    stubApi();

    render(DeckImport, { projectId: PROJECT, deckId: DECK });
    await settle();
    await offerTheExport({
      pages: [
        { page_number: 1, title: null, action: 'update', matched_by: 'page_number', name: '1.png' },
        {
          page_number: 2,
          title: 'Ace of coins',
          action: 'update',
          matched_by: 'identity',
          name: '2 - Ace of coins.png',
        },
        { page_number: 3, title: null, action: 'add', matched_by: null, name: null },
      ],
    });

    expect(screen.getByText('Updates 1.png')).toBeInTheDocument();
    expect(screen.getByText('Updates 2 - Ace of coins.png')).toBeInTheDocument();
  });

  // Nothing on the binding names the run this session has just started, so the
  // only id that can be discarded is the one the store is holding.
  it('discards the run this session has just started', async () => {
    stubApi();

    render(DeckImport, { projectId: PROJECT, deckId: DECK });
    await settle();
    await offerTheExport();

    await fireEvent.click(screen.getByRole('button', { name: 'Cancel and discard this run' }));
    await settle();

    expect(requested('/abandon')).toEqual([
      `http://localhost/api/decks/import/runs/${RUN}/abandon`,
    ]);
    expect(screen.queryByRole('button', { name: 'Import 3 pages' })).not.toBeInTheDocument();
    expect(screen.getByLabelText('Canva export (.zip)')).toBeInTheDocument();
  });

  // The store outlives the screen on purpose, so a plan nobody confirmed is
  // still sitting in it when the next deck's import screen mounts.
  it('does not offer one deck’s unconfirmed plan on another deck', async () => {
    stubApi({ deckIds: [DECK, OTHER_DECK] });

    const first = render(DeckImport, { projectId: PROJECT, deckId: DECK });
    await settle();
    await offerTheExport();
    expect(screen.getByRole('button', { name: 'Import 3 pages' })).toBeInTheDocument();
    first.unmount();

    render(DeckImport, { projectId: PROJECT, deckId: OTHER_DECK });
    await settle();

    expect(screen.queryByRole('button', { name: 'Import 3 pages' })).not.toBeInTheDocument();
    expect(screen.getByLabelText('Canva export (.zip)')).toBeInTheDocument();
  });

  it('takes the export picker away while pages are going up', async () => {
    let release: (() => void) | null = null;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    stubApi({ holdPages: held });

    render(DeckImport, { projectId: PROJECT, deckId: DECK });
    await settle();
    expect(screen.getByLabelText('Canva export (.zip)')).toBeInTheDocument();

    await offerTheExport();
    void fireEvent.click(screen.getByRole('button', { name: 'Import 3 pages' }));
    await settle();

    expect(screen.queryByLabelText('Canva export (.zip)')).not.toBeInTheDocument();
    release!();
    await settle();
  });

  // The same handler the picker uses, reached the other way: the guard added to
  // it must refuse a drop during an upload without refusing an ordinary one.
  it('plans a ZIP dropped on the zone', async () => {
    stubApi();

    render(DeckImport, { projectId: PROJECT, deckId: DECK });
    await settle();

    const zone = screen.getByText(/Drop the ZIP here/u).closest('section')!;
    const plan = planResponse({});
    const previous = fetchMock.getMockImplementation();
    fetchMock.mockImplementation(async (url, init) => {
      const request = typeof url === 'string' ? null : (url as Request);
      const target = request?.url ?? (url as string);
      const method = request?.method ?? init?.method ?? 'GET';
      if (/\/api\/decks\/[0-9a-f-]{36}\/import\/runs$/u.test(target) && method === 'POST') {
        return plan;
      }
      return previous!(url, init);
    });

    await fireEvent.drop(zone, { dataTransfer: { files: [await exportFile()] } });
    await settle();

    expect(screen.getByRole('button', { name: 'Import 3 pages' })).toBeInTheDocument();
  });

  // The route block is not keyed, so moving from one deck's import screen to
  // another changes the props on the screen already mounted: nothing unmounts,
  // nothing resets, and the store still holds the first deck's binding.
  it('does not offer the run of the deck just left while the next binding loads', async () => {
    let release: (() => void) | null = null;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    stubApi({ openRun: true, deckIds: [DECK, OTHER_DECK] });
    const previous = fetchMock.getMockImplementation();
    fetchMock.mockImplementation(async (input, init) => {
      const request = typeof input === 'string' ? null : (input as Request);
      const target = request?.url ?? (input as string);
      if (target.endsWith(`/api/decks/${OTHER_DECK}/import`)) {
        await held;
        return jsonResponse(200, {
          id: 'import-2',
          deck_id: OTHER_DECK,
          folder_id: FOLDER,
          source_kind: 'zip',
          source_label: null,
          open_run_id: null,
          created_at: '2026-01-01T00:00:00.000Z',
          updated_at: '2026-01-01T00:00:00.000Z',
        });
      }
      return previous!(input, init);
    });

    const view = render(DeckImport, { projectId: PROJECT, deckId: DECK });
    await settle();
    expect(screen.getByRole('button', { name: 'Discard this import' })).toBeInTheDocument();

    await view.rerender({ projectId: PROJECT, deckId: OTHER_DECK });
    await settle();

    expect(screen.queryByRole('button', { name: 'Discard this import' })).not.toBeInTheDocument();

    release!();
    await settle();

    expect(screen.queryByRole('button', { name: 'Discard this import' })).not.toBeInTheDocument();
  });

  it('offers Resume and Discard for a run that was already open', async () => {
    stubApi({ openRun: true });

    render(DeckImport, { projectId: PROJECT, deckId: DECK });
    await settle();

    expect(screen.getByRole('button', { name: 'Resume this import' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Discard this import' })).toBeInTheDocument();
    expect(screen.getByText(/1 of 3 pages have landed/)).toBeInTheDocument();

    await fireEvent.click(screen.getByRole('button', { name: 'Resume this import' }));
    expect(screen.getByLabelText('Choose the same export again')).toBeInTheDocument();
  });
});
