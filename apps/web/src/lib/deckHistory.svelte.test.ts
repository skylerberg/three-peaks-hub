import '../api/testUtils.ts';
import { fetchMock, jsonResponse } from '../api/testUtils.ts';
import { beforeEach, describe, expect, it } from 'vitest';
import { deckHistory } from './deckHistory.svelte.ts';

const DECK = '3c7f1b2e-9a4d-4c6b-8e1f-2a3b4c5d6e7f';
const OTHER_DECK = '7a6b5c4d-3e2f-4a1b-9c8d-7e6f5a4b3c2d';
const RUN = '5d4c3b2a-1f0e-4d9c-8b7a-6f5e4d3c2b1a';

function run(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    import_id: 'import-1',
    status: 'finished',
    source_label: 'Deck export.zip',
    page_count: 2,
    started_by: 'someone',
    started_at: '2026-02-01T00:00:00.000Z',
    finished_at: '2026-02-01T00:01:00.000Z',
    counts: { pages: 2, added: 2, updated: 0, unchanged: 0, removed: 0, restored: 0 },
    ...overrides,
  };
}

// A request held open until the test says otherwise, which is how a slower
// answer is made to land after a newer one.
function gate(): { held: Promise<void>; release: () => void } {
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { held, release };
}

function url(input: Parameters<typeof fetch>[0]): string {
  return typeof input === 'string' ? input : (input as Request).url;
}

beforeEach(() => {
  fetchMock.mockReset();
  deckHistory.reset();
});

describe('deckHistory', () => {
  // The route block is not keyed, so this store is asked for a second deck
  // while the first deck's answer is still on the wire.
  it("drops the previous deck's runs before the next deck's answer lands", async () => {
    fetchMock.mockImplementation(async () => jsonResponse(200, { runs: [run(RUN)] }));
    await deckHistory.loadRuns(DECK);
    expect(deckHistory.runs).toHaveLength(1);

    const next = gate();
    fetchMock.mockImplementation(async () => {
      await next.held;
      return jsonResponse(200, { runs: [] });
    });

    const pending = deckHistory.loadRuns(OTHER_DECK);
    await Promise.resolve();

    expect(deckHistory.runsDeckId).toBeNull();
    expect(deckHistory.runs).toHaveLength(0);

    next.release();
    await pending;
  });

  it('discards a run listing a newer request has already superseded', async () => {
    const slow = gate();
    fetchMock.mockImplementation(async (input) => {
      if (url(input).includes(DECK)) {
        await slow.held;
        return jsonResponse(200, { runs: [run(RUN)] });
      }
      return jsonResponse(200, { runs: [run('other-run')] });
    });

    const first = deckHistory.loadRuns(DECK);
    await deckHistory.loadRuns(OTHER_DECK);
    slow.release();
    await first;

    expect(deckHistory.runsDeckId).toBe(OTHER_DECK);
    expect(deckHistory.runs.map((entry) => entry.id)).toEqual(['other-run']);
  });

  // The deck is the scope the server checks, not a cache key this store keeps:
  // reading a run any other way renders another deck's run under this deck's
  // name, and the client is the wrong place to notice.
  it('reads one run through the deck it is being shown under', async () => {
    const asked: string[] = [];
    fetchMock.mockImplementation(async (input) => {
      asked.push(url(input));
      return jsonResponse(200, { run: run(RUN), cards: [] });
    });

    await deckHistory.loadRun(DECK, RUN);

    expect(asked).toHaveLength(1);
    expect(asked[0]).toContain(`/api/decks/${DECK}/import/runs/${RUN}`);
    expect(deckHistory.detailKey).toBe(`${DECK}:${RUN}`);
  });

  it('treats a 404 from the runs route as a deck that has never been imported', async () => {
    fetchMock.mockImplementation(async () =>
      jsonResponse(404, { error: 'This deck has no import' })
    );

    await deckHistory.loadRuns(DECK);

    expect(deckHistory.bound).toBe(false);
    expect(deckHistory.runs).toEqual([]);
    expect(deckHistory.runsDeckId).toBe(DECK);
  });

  // The two refusals differ -- still running, and abandoned -- so the screen
  // renders the server's own words rather than one of its own.
  it('keeps the server’s reason when a run cannot be shown as it stood', async () => {
    fetchMock.mockImplementation(async () =>
      jsonResponse(409, {
        error: 'That import is still running. Finish it before asking what it left',
      })
    );

    await deckHistory.loadAsOf(DECK, RUN);

    expect(deckHistory.asOf).toBeNull();
    expect(deckHistory.asOfRefusal).toContain('still running');
    expect(deckHistory.asOfKey).toBe(`${DECK}:${RUN}`);
  });

  it('rethrows anything that is not a refusal', async () => {
    fetchMock.mockImplementation(async () => jsonResponse(404, { error: 'Import run not found' }));

    await expect(deckHistory.loadAsOf(DECK, RUN)).rejects.toThrow('Import run not found');
    expect(deckHistory.asOfRefusal).toBeNull();
  });

  it("forgets one account's history when the session ends", async () => {
    fetchMock.mockImplementation(async () => jsonResponse(200, { runs: [run(RUN)] }));
    await deckHistory.loadRuns(DECK);

    deckHistory.reset();

    expect(deckHistory.runs).toEqual([]);
    expect(deckHistory.runsDeckId).toBeNull();
    expect(deckHistory.detail).toBeNull();
    expect(deckHistory.asOf).toBeNull();
    expect(deckHistory.asOfRefusal).toBeNull();
  });
});
