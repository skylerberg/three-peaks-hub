import '../api/testUtils.ts';
import { FakeWebSocket, fetchMock, jsonResponse } from '../api/testUtils.ts';
import { render, screen } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Deck from './Deck.svelte';
import { deckImports } from '../lib/deckImports.svelte.ts';
import { decks } from '../lib/decks.svelte.ts';
import { realtime } from '../lib/realtime.svelte.ts';

const PROJECT = '2f1c9e5a-8b3d-4f1e-9c2a-7d6b5e4f3a21';
const DECK = '3c7f1b2e-9a4d-4c6b-8e1f-2a3b4c5d6e7f';

// Longer than the screen's own coalesce window, on real timers: the render and
// the events both go through microtasks the fake clock does not drive.
const AFTER_THE_WINDOW_MS = 600;

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

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function stubApi(): void {
  fetchMock.mockImplementation(async (input) => {
    const url = typeof input === 'string' ? input : (input as Request).url;
    if (url.includes(`/api/decks/${DECK}/import`)) {
      return jsonResponse(404, { error: 'This deck has no import' });
    }
    if (url.includes(`/api/decks/${DECK}`)) {
      return jsonResponse(200, { deck: DECK_ROW, cards: [] });
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

describe('Deck editor', () => {
  beforeEach(() => {
    decks.reset();
    deckImports.reset();
    fetchMock.mockReset();
    FakeWebSocket.reset();
    stubApi();
  });

  afterEach(() => {
    realtime.stop();
  });

  // An import publishes one file event per page, so a fifty-page run would
  // otherwise reload the whole deck fifty times for everyone watching it.
  it('reloads the deck once for a burst of realtime events, not once each', async () => {
    realtime.start('tok');
    FakeWebSocket.last().open();

    render(Deck, { projectId: PROJECT, deckId: DECK });
    await wait(AFTER_THE_WINDOW_MS);

    const refresh = vi.spyOn(decks, 'refreshDeck').mockResolvedValue();
    for (let page = 1; page <= 20; page += 1) {
      FakeWebSocket.last().receive({
        type: 'file.updated',
        project_id: PROJECT,
        file_id: `file-${page}`,
      });
    }
    await wait(AFTER_THE_WINDOW_MS);

    expect(refresh).toHaveBeenCalledTimes(1);
    refresh.mockRestore();
  });

  // The history screen is read-only, so it is offered outside the editor-only
  // section the Canva import sits in -- and it costs this screen no request.
  it('links to the import history whether or not this account may edit', async () => {
    for (const role of ['editor', 'viewer']) {
      fetchMock.mockReset();
      decks.reset();
      fetchMock.mockImplementation(async (input) => {
        const url = typeof input === 'string' ? input : (input as Request).url;
        if (url.includes(`/api/decks/${DECK}/import`)) {
          return jsonResponse(404, { error: 'This deck has no import' });
        }
        if (url.includes(`/api/decks/${DECK}`)) {
          return jsonResponse(200, { deck: DECK_ROW, cards: [] });
        }
        return jsonResponse(200, {
          id: PROJECT,
          name: 'Colori',
          description: null,
          role,
          created_at: '2026-01-01T00:00:00.000Z',
          updated_at: '2026-01-01T00:00:00.000Z',
        });
      });

      const view = render(Deck, { projectId: PROJECT, deckId: DECK });
      const link = await screen.findByRole('link', { name: 'Import history' });
      expect(link).toHaveAttribute('href', `/projects/${PROJECT}/decks/${DECK}/history`);

      const asked = fetchMock.mock.calls.map((call) =>
        typeof call[0] === 'string' ? call[0] : (call[0] as Request).url
      );
      expect(asked.some((url) => url.includes('/import/runs'))).toBe(false);
      view.unmount();
    }
  });
});
