import '../api/testUtils.ts';
import { fetchMock, jsonResponse } from '../api/testUtils.ts';
import { render, screen, waitFor } from '@testing-library/svelte';
import { beforeEach, describe, expect, it } from 'vitest';
import DeckHistory from './DeckHistory.svelte';
import { deckHistory } from '../lib/deckHistory.svelte.ts';
import { decks } from '../lib/decks.svelte.ts';

const PROJECT = '2f1c9e5a-8b3d-4f1e-9c2a-7d6b5e4f3a21';
const DECK = '3c7f1b2e-9a4d-4c6b-8e1f-2a3b4c5d6e7f';
const FINISHED = '5d4c3b2a-1f0e-4d9c-8b7a-6f5e4d3c2b1a';
const ABANDONED = '1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d';
const OPEN = '2b3c4d5e-6f7a-4b8c-9d0e-1f2a3b4c5d6e';
const MEMBER = 'aa11bb22-cc33-4d44-8e55-ff66aa77bb88';

const DECK_ROW = {
  id: DECK,
  project_id: PROJECT,
  name: 'Base game',
  card_width_mm: 63,
  card_height_mm: 88,
  back_file_id: null,
  created_by: MEMBER,
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-01-01T00:00:00.000Z',
  card_count: 0,
  total_copies: 0,
};

function run(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    import_id: 'import-1',
    status: 'finished',
    source_label: 'Deck export.zip',
    page_count: 3,
    started_by: MEMBER,
    started_at: '2026-02-01T09:00:00.000Z',
    finished_at: '2026-02-01T09:01:00.000Z',
    counts: { pages: 3, added: 3, updated: 5, unchanged: 1, removed: 2, restored: 0 },
    ...overrides,
  };
}

let runs: ReturnType<typeof run>[] = [];
let members: { user_id: string; name: string }[] = [];

function stubApi(): void {
  fetchMock.mockImplementation(async (input) => {
    const url = typeof input === 'string' ? input : (input as Request).url;
    if (url.includes(`/api/decks/${DECK}/import/runs`)) return jsonResponse(200, { runs });
    if (url.includes(`/api/decks/${DECK}`)) {
      return jsonResponse(200, { deck: DECK_ROW, cards: [] });
    }
    if (url.includes(`/api/projects/${PROJECT}/members`)) {
      return jsonResponse(200, {
        members: members.map((member) => ({
          ...member,
          email: 'x@example.com',
          role: 'editor',
          is_creator: true,
        })),
      });
    }
    return jsonResponse(404, { error: `nothing stubbed for ${url}` });
  });
}

beforeEach(() => {
  fetchMock.mockReset();
  decks.reset();
  deckHistory.reset();
  runs = [];
  members = [{ user_id: MEMBER, name: 'Skyler' }];
  stubApi();
});

describe('Deck import history', () => {
  it('lists every run newest first with what it did', async () => {
    runs = [
      run(FINISHED, { started_at: '2026-02-02T09:00:00.000Z' }),
      run(ABANDONED, { started_at: '2026-02-01T09:00:00.000Z' }),
    ];
    render(DeckHistory, { projectId: PROJECT, deckId: DECK });

    await waitFor(() => expect(screen.getAllByRole('listitem')).toHaveLength(2));
    expect(screen.getAllByText('3 added, 5 updated, 2 removed')).toHaveLength(2);
    expect(screen.getAllByText(/Deck export\.zip/u)).toHaveLength(2);
    expect(screen.getAllByText('Skyler', { exact: false })).not.toHaveLength(0);

    const entries = screen.getAllByRole('listitem');
    const first = entries[0].querySelector('a[href$="/deck"]');
    expect(first).not.toBeNull();
  });

  it('says an abandoned run changed nothing when no page of it landed', async () => {
    runs = [
      run(ABANDONED, {
        status: 'abandoned',
        finished_at: null,
        counts: { pages: 0, added: 0, updated: 0, unchanged: 0, removed: 0, restored: 0 },
      }),
    ];
    render(DeckHistory, { projectId: PROJECT, deckId: DECK });

    await waitFor(() =>
      expect(screen.getByText(/Abandoned — nothing was changed\./u)).toBeInTheDocument()
    );
  });

  // Abandoning undoes nothing: the pages that landed keep their versions, and
  // the counts beside this sentence are the proof of it.
  it('does not call an abandoned run a no-op beside pages that landed', async () => {
    runs = [
      run(ABANDONED, {
        status: 'abandoned',
        finished_at: null,
        counts: { pages: 2, added: 1, updated: 1, unchanged: 0, removed: 0, restored: 0 },
      }),
    ];
    render(DeckHistory, { projectId: PROJECT, deckId: DECK });

    await waitFor(() => expect(screen.getByRole('listitem')).toBeInTheDocument());
    expect(screen.queryByText(/nothing was changed/u)).not.toBeInTheDocument();
    expect(
      screen.getByText(/Abandoned — 2 pages had already landed and were kept\./u)
    ).toBeInTheDocument();
  });

  it('counts one landed page of an abandoned run in the singular', async () => {
    runs = [
      run(ABANDONED, {
        status: 'abandoned',
        finished_at: null,
        counts: { pages: 1, added: 1, updated: 0, unchanged: 0, removed: 0, restored: 0 },
      }),
    ];
    render(DeckHistory, { projectId: PROJECT, deckId: DECK });

    await waitFor(() =>
      expect(
        screen.getByText(/Abandoned — 1 page had already landed and was kept\./u)
      ).toBeInTheDocument()
    );
  });

  // A run with no honest answer must not be offered a link that 409s.
  it('offers the deck as it stood only for a finished run', async () => {
    runs = [
      run(FINISHED, { started_at: '2026-02-03T09:00:00.000Z' }),
      run(OPEN, { status: 'open', finished_at: null, started_at: '2026-02-02T09:00:00.000Z' }),
      run(ABANDONED, { status: 'abandoned', finished_at: null }),
    ];
    render(DeckHistory, { projectId: PROJECT, deckId: DECK });

    await waitFor(() => expect(screen.getAllByRole('listitem')).toHaveLength(3));
    expect(screen.getAllByRole('link', { name: 'What changed' })).toHaveLength(3);
    const asOf = screen.getAllByRole('link', { name: 'The deck as it stood' });
    expect(asOf).toHaveLength(1);
    expect(asOf[0]).toHaveAttribute(
      'href',
      `/projects/${PROJECT}/decks/${DECK}/runs/${FINISHED}/deck`
    );
  });

  it('names someone no longer on this project rather than a raw id', async () => {
    members = [];
    runs = [run(FINISHED)];
    render(DeckHistory, { projectId: PROJECT, deckId: DECK });

    await waitFor(() =>
      expect(screen.getByText(/Someone no longer on this project/u)).toBeInTheDocument()
    );
    expect(screen.queryByText(new RegExp(MEMBER, 'u'))).not.toBeInTheDocument();
  });

  it('says so when the deck has never been imported', async () => {
    fetchMock.mockImplementation(async (input) => {
      const url = typeof input === 'string' ? input : (input as Request).url;
      if (url.includes(`/api/decks/${DECK}/import/runs`)) {
        return jsonResponse(404, { error: 'This deck has no import' });
      }
      if (url.includes(`/api/decks/${DECK}`)) {
        return jsonResponse(200, { deck: DECK_ROW, cards: [] });
      }
      return jsonResponse(200, { members: [] });
    });

    render(DeckHistory, { projectId: PROJECT, deckId: DECK });

    await waitFor(() =>
      expect(screen.getByText('This deck has never been imported from Canva.')).toBeInTheDocument()
    );
  });
});
