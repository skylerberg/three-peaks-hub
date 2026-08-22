import type { components } from '@three-peaks/shared/api';
import { api, assertOk } from '../api/client.ts';
import { newId } from './ids.ts';

export type Deck = components['schemas']['Deck'];
export type DeckCard = components['schemas']['DeckWithCards']['cards'][number];

interface DeckCardInput {
  file_id: string;
  quantity: number;
}

class DeckStore {
  decks = $state<Deck[]>([]);
  // The deck currently open in the editor, and its cards. One request fills
  // both, so they are never half a deck apart.
  deck = $state<Deck | null>(null);
  cards = $state<DeckCard[]>([]);
  loadingList = $state(false);
  loadingDeck = $state(false);
  saving = $state(false);

  #projectId: string | null = null;
  // Two loads are routinely in flight at once when a screen mounts and a
  // realtime event lands; only the newest may assign. One counter per kind, so
  // reloading the list cannot cancel the open deck.
  #listGeneration = 0;
  #deckGeneration = 0;

  async loadList(projectId: string): Promise<void> {
    this.#listGeneration += 1;
    const generation = this.#listGeneration;
    this.#projectId = projectId;
    this.loadingList = true;

    try {
      const data = assertOk(
        await api.GET('/api/decks', { params: { query: { project_id: projectId } } })
      );
      if (generation !== this.#listGeneration) return;
      this.decks = data.decks;
    } finally {
      if (generation === this.#listGeneration) this.loadingList = false;
    }
  }

  async refreshList(): Promise<void> {
    if (this.#projectId) await this.loadList(this.#projectId);
  }

  async loadDeck(deckId: string): Promise<void> {
    this.#deckGeneration += 1;
    const generation = this.#deckGeneration;
    this.loadingDeck = true;

    try {
      const data = assertOk(await api.GET('/api/decks/{deckId}', { params: { path: { deckId } } }));
      if (generation !== this.#deckGeneration) return;
      this.deck = data.deck;
      this.cards = data.cards;
    } finally {
      if (generation === this.#deckGeneration) this.loadingDeck = false;
    }
  }

  async refreshDeck(): Promise<void> {
    if (this.deck) await this.loadDeck(this.deck.id);
  }

  // Reads one deck without touching the open one, which is what the print
  // builder needs: it wants several decks' cards at once and is not editing any
  // of them.
  async readDeck(deckId: string): Promise<{ deck: Deck; cards: DeckCard[] }> {
    return assertOk(await api.GET('/api/decks/{deckId}', { params: { path: { deckId } } }));
  }

  async create(
    projectId: string,
    fields: { name: string; card_width_mm: number; card_height_mm: number }
  ): Promise<Deck> {
    return assertOk(
      await api.POST('/api/decks', { body: { id: newId(), project_id: projectId, ...fields } })
    );
  }

  async update(
    deckId: string,
    patch: Partial<Pick<Deck, 'name' | 'card_width_mm' | 'card_height_mm' | 'back_file_id'>>
  ): Promise<void> {
    this.saving = true;
    try {
      const updated = assertOk(
        await api.PATCH('/api/decks/{deckId}', { params: { path: { deckId } }, body: patch })
      );
      if (this.deck?.id === deckId) this.deck = updated;
    } finally {
      this.saving = false;
    }
  }

  async remove(deckId: string): Promise<void> {
    assertOk(await api.DELETE('/api/decks/{deckId}', { params: { path: { deckId } } }));
    this.decks = this.decks.filter((deck) => deck.id !== deckId);
  }

  // The whole list every time. Reordering, adding and removing are one request,
  // and the response is what the screen then shows -- so a rejected save leaves
  // nothing half-applied to unpick.
  async saveCards(deckId: string, cards: readonly DeckCardInput[]): Promise<void> {
    this.saving = true;
    try {
      const saved = assertOk(
        await api.PUT('/api/decks/{deckId}/cards', {
          params: { path: { deckId } },
          // Snapshotted for the reason model3d.svelte.ts spells out at its own
          // save.
          body: { cards: $state.snapshot(cards) as DeckCardInput[] },
        })
      );
      if (this.deck?.id === deckId) {
        this.deck = saved.deck;
        this.cards = saved.cards;
      }
    } finally {
      this.saving = false;
    }
  }

  reset(): void {
    // Generations first, so a response still in flight when someone signs out
    // cannot assign one account's decks into the next one's store.
    this.#listGeneration += 1;
    this.#deckGeneration += 1;
    this.#projectId = null;
    this.decks = [];
    this.deck = null;
    this.cards = [];
    this.loadingList = false;
    this.loadingDeck = false;
    this.saving = false;
  }
}

export const decks = new DeckStore();
