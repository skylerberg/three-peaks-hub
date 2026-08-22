import '../api/testUtils.ts';
import { fetchMock, jsonResponse } from '../api/testUtils.ts';
import { beforeEach, describe, expect, it } from 'vitest';
import { decks } from './decks.svelte.ts';

const PROJECT = '2f1c9e5a-8b3d-4f1e-9c2a-7d6b5e4f3a21';
const DECK = '3c7f1b2e-9a4d-4c6b-8e1f-2a3b4c5d6e7f';

function deck(overrides: Record<string, unknown> = {}) {
  return {
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
    ...overrides,
  };
}

function card(fileId: string, quantity: number, position: number) {
  return {
    file_id: fileId,
    quantity,
    position,
    file: {
      id: fileId,
      project_id: PROJECT,
      folder_id: null,
      filename: `${fileId}.png`,
      content_type: 'image/png',
      byte_size: 10,
      image_width: 744,
      image_height: 1039,
      uploaded_by: 'someone',
      deleted_at: null,
      created_at: '2026-01-01T00:00:00.000Z',
      updated_at: '2026-01-01T00:00:00.000Z',
    },
  };
}

describe('DeckStore', () => {
  beforeEach(() => {
    decks.reset();
    fetchMock.mockReset();
  });

  it('loads a deck and its cards together', async () => {
    fetchMock.mockImplementationOnce(async () =>
      jsonResponse(200, {
        deck: deck({ card_count: 2, total_copies: 4 }),
        cards: [card('a', 3, 0), card('b', 1, 1)],
      })
    );

    await decks.loadDeck(DECK);
    expect(decks.deck?.total_copies).toBe(4);
    expect(decks.cards.map((entry) => entry.file_id)).toEqual(['a', 'b']);
  });

  // Two loads are routinely in flight at once: the one a screen starts on mount
  // and the one a realtime event starts. Only the newest may assign.
  it('discards a deck response a newer request has superseded', async () => {
    let releaseFirst: (() => void) | null = null;
    const firstArrived = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });

    fetchMock
      .mockImplementationOnce(async () => {
        await firstArrived;
        return jsonResponse(200, { deck: deck({ name: 'Stale' }), cards: [] });
      })
      .mockImplementationOnce(async () =>
        jsonResponse(200, { deck: deck({ name: 'Fresh' }), cards: [card('a', 1, 0)] })
      );

    const stale = decks.loadDeck(DECK);
    const fresh = decks.loadDeck(DECK);

    await fresh;
    expect(decks.deck?.name).toBe('Fresh');

    releaseFirst!();
    await stale;

    expect(decks.deck?.name).toBe('Fresh');
    expect(decks.cards).toHaveLength(1);
  });

  // Reloading the list happens on every realtime event for the project. It must
  // not cancel the deck the editor is showing, which is why the two have
  // generations of their own.
  it('leaves the open deck alone when the list reloads', async () => {
    fetchMock.mockImplementationOnce(async () =>
      jsonResponse(200, { deck: deck({ name: 'Open' }), cards: [card('a', 1, 0)] })
    );
    await decks.loadDeck(DECK);

    fetchMock.mockImplementationOnce(async () => jsonResponse(200, { decks: [deck()] }));
    await decks.loadList(PROJECT);

    expect(decks.deck?.name).toBe('Open');
    expect(decks.cards).toHaveLength(1);
  });

  it('does not assign into a store that was reset mid-flight', async () => {
    let release: (() => void) | null = null;
    const arrived = new Promise<void>((resolve) => {
      release = resolve;
    });

    fetchMock.mockImplementationOnce(async () => {
      await arrived;
      return jsonResponse(200, { deck: deck(), cards: [card('a', 1, 0)] });
    });

    const inFlight = decks.loadDeck(DECK);
    decks.reset();
    release!();
    await inFlight;

    expect(decks.deck).toBeNull();
    expect(decks.cards).toEqual([]);
  });

  // The response is what the screen then shows, so a save that reorders is not
  // followed by a second request to find out what happened.
  it('takes the saved list back from the server rather than keeping its own', async () => {
    fetchMock.mockImplementationOnce(async () =>
      jsonResponse(200, { deck: deck(), cards: [card('a', 1, 0)] })
    );
    await decks.loadDeck(DECK);

    fetchMock.mockImplementationOnce(async () =>
      jsonResponse(200, {
        deck: deck({ card_count: 2, total_copies: 5 }),
        cards: [card('b', 4, 0), card('a', 1, 1)],
      })
    );
    await decks.saveCards(DECK, [
      { file_id: 'b', quantity: 4 },
      { file_id: 'a', quantity: 1 },
    ]);

    expect(decks.cards.map((entry) => entry.file_id)).toEqual(['b', 'a']);
    expect(decks.deck?.total_copies).toBe(5);
  });

  it('sends the cards as plain data rather than a state proxy', async () => {
    fetchMock.mockImplementationOnce(async () =>
      jsonResponse(200, { deck: deck(), cards: [card('a', 2, 0)] })
    );

    await decks.saveCards(DECK, [{ file_id: 'a', quantity: 2 }]);

    const request = fetchMock.mock.calls[0][0] as Request;
    expect(await request.clone().json()).toEqual({ cards: [{ file_id: 'a', quantity: 2 }] });
  });

  it('clears the saving flag when a save is refused', async () => {
    fetchMock.mockImplementationOnce(async () => jsonResponse(422, { error: 'nope' }));
    await expect(decks.saveCards(DECK, [])).rejects.toThrow();
    expect(decks.saving).toBe(false);
  });
});
