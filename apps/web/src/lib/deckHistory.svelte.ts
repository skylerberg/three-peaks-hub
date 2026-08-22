import type { components } from '@three-peaks/shared/api';
import { ApiError, api, apiMessage, assertOk } from '../api/client.ts';

type ImportRun = components['schemas']['ImportRun'];
type ImportRunDetail = components['schemas']['ImportRunDetail'];
type ImportRunDeck = components['schemas']['ImportRunDeck'];

// Reading history is its own store rather than more of deckImports: that one is
// scoped to a run in flight and is reset by the import screen's teardown, which
// would empty a timeline the moment somebody walked back from it.
class DeckHistoryStore {
  runs = $state<ImportRun[]>([]);
  // Which deck each answer above belongs to. The route block is not keyed, so
  // moving between two decks' history screens swaps props on a screen already
  // mounted and nothing unmounts.
  runsDeckId = $state<string | null>(null);
  bound = $state(true);
  loadingRuns = $state(false);

  detail = $state<ImportRunDetail | null>(null);
  detailKey = $state<string | null>(null);
  loadingDetail = $state(false);

  asOf = $state<ImportRunDeck | null>(null);
  asOfKey = $state<string | null>(null);
  // A run with no honest answer refuses in the server's own words, and the two
  // refusals differ -- so the message is kept rather than restated here.
  asOfRefusal = $state<string | null>(null);
  loadingAsOf = $state(false);

  // One counter per kind, so opening a run cannot cancel a timeline still on
  // the wire and the other way round.
  #runsGeneration = 0;
  #detailGeneration = 0;
  #asOfGeneration = 0;

  async loadRuns(deckId: string): Promise<void> {
    this.#runsGeneration += 1;
    const generation = this.#runsGeneration;
    this.runsDeckId = null;
    this.runs = [];
    this.loadingRuns = true;

    try {
      const runs = await this.#readRuns(deckId);
      if (generation !== this.#runsGeneration) return;
      this.runs = runs ?? [];
      this.bound = runs !== null;
      this.runsDeckId = deckId;
    } finally {
      if (generation === this.#runsGeneration) this.loadingRuns = false;
    }
  }

  async loadRun(deckId: string, runId: string): Promise<void> {
    this.#detailGeneration += 1;
    const generation = this.#detailGeneration;
    this.detailKey = null;
    this.detail = null;
    this.loadingDetail = true;

    try {
      const detail = assertOk(
        await api.GET('/api/decks/{deckId}/import/runs/{runId}', {
          params: { path: { deckId, runId } },
        })
      );
      if (generation !== this.#detailGeneration) return;
      this.detail = detail;
      this.detailKey = `${deckId}:${runId}`;
    } finally {
      if (generation === this.#detailGeneration) this.loadingDetail = false;
    }
  }

  async loadAsOf(deckId: string, runId: string): Promise<void> {
    this.#asOfGeneration += 1;
    const generation = this.#asOfGeneration;
    this.asOfKey = null;
    this.asOf = null;
    this.asOfRefusal = null;
    this.loadingAsOf = true;

    try {
      const asOf = assertOk(
        await api.GET('/api/decks/{deckId}/import/runs/{runId}/deck', {
          params: { path: { deckId, runId } },
        })
      );
      if (generation !== this.#asOfGeneration) return;
      this.asOf = asOf;
      this.asOfKey = `${deckId}:${runId}`;
    } catch (caught) {
      if (generation !== this.#asOfGeneration) return;
      // A 409 is an answer, not a failure: the run is still open, or it was
      // abandoned and handed the deck nothing.
      if (!(caught instanceof ApiError) || caught.status !== 409) throw caught;
      this.asOfRefusal = apiMessage(caught);
      this.asOfKey = `${deckId}:${runId}`;
    } finally {
      if (generation === this.#asOfGeneration) this.loadingAsOf = false;
    }
  }

  reset(): void {
    // Every counter first: a request still in flight must not refill this.
    this.#runsGeneration += 1;
    this.#detailGeneration += 1;
    this.#asOfGeneration += 1;
    this.runs = [];
    this.runsDeckId = null;
    this.bound = true;
    this.loadingRuns = false;
    this.detail = null;
    this.detailKey = null;
    this.loadingDetail = false;
    this.asOf = null;
    this.asOfKey = null;
    this.asOfRefusal = null;
    this.loadingAsOf = false;
  }

  // Null for a deck that has never been bound: that 404 is the absence of an
  // import rather than an error worth putting on the screen.
  async #readRuns(deckId: string): Promise<ImportRun[] | null> {
    try {
      const data = assertOk(
        await api.GET('/api/decks/{deckId}/import/runs', { params: { path: { deckId } } })
      );
      return data.runs;
    } catch (caught) {
      if (caught instanceof ApiError && caught.status === 404) return null;
      throw caught;
    }
  }
}

export const deckHistory = new DeckHistoryStore();
