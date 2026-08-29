import type { components } from '@three-peaks/shared/api';
import { ApiError, api, assertOk } from '../api/client.ts';

// An entry only ever appears nested in the listing, so the spec has no named
// component for one; derived rather than restated.
export type DeletedEntry = components['schemas']['DeletedListing']['entries'][number];

// A restore is refused with 409 for two unrelated reasons, and only one of them
// is a person's to answer: a sibling has taken the name back. The other is a
// deleted folder above the row, which no name gets past. The wire carries them
// apart only in their opening words, so an API test pins that shape.
export function isNameConflict(error: unknown): error is ApiError {
  return (
    error instanceof ApiError &&
    error.status === 409 &&
    /^A (?:file|folder) named /.test(error.message)
  );
}

class DeletedStore {
  entries = $state<DeletedEntry[]>([]);
  loading = $state(false);

  // A realtime event and the screen's own mount routinely have two loads on the
  // wire at once, and the answers can arrive in either order. Only the newest
  // may assign; see files.svelte.ts for what the older one used to overwrite.
  #generation = 0;

  // Plain, not $state: nothing renders from it, and a rune written while a
  // component is tearing down does not survive.
  #projectId: string | null = null;

  async load(projectId: string): Promise<void> {
    this.#generation += 1;
    const generation = this.#generation;
    this.#projectId = projectId;
    this.loading = true;

    try {
      const data = assertOk(
        await api.GET('/api/files/deleted', { params: { query: { project_id: projectId } } })
      );
      if (generation !== this.#generation) return;
      this.entries = data.entries;
    } finally {
      // Guarded too, or a superseded request finishing clears the spinner that
      // the request replacing it is still showing.
      if (generation === this.#generation) this.loading = false;
    }
  }

  async refresh(): Promise<void> {
    const projectId = this.#projectId;
    if (!projectId) return;
    await this.load(projectId);
  }

  // `filename` and `name` are the rename-on-restore the API takes, for when the
  // old name was claimed while the row was gone.
  async restoreFile(id: string, filename?: string): Promise<void> {
    assertOk(
      await api.POST('/api/files/{id}/restore', {
        params: { path: { id }, query: filename ? { filename } : {} },
      })
    );
  }

  async restoreFolder(id: string, name?: string): Promise<void> {
    assertOk(
      await api.POST('/api/files/folders/{id}/restore', {
        params: { path: { id }, query: name ? { name } : {} },
      })
    );
  }

  // A deck and a component take no new name: neither is renamed on the way
  // back, because a name clash on one is refused rather than worked around --
  // there is no second name a person could be offered that means the same deck.
  async restoreDeck(id: string): Promise<void> {
    assertOk(await api.POST('/api/decks/{deckId}/restore', { params: { path: { deckId: id } } }));
  }

  async restoreComponent(id: string): Promise<void> {
    assertOk(
      await api.POST('/api/components/{componentId}/restore', {
        params: { path: { componentId: id } },
      })
    );
  }

  async purgeDeck(id: string): Promise<void> {
    assertOk(
      await api.DELETE('/api/decks/{deckId}', {
        params: { path: { deckId: id }, query: { purge: 'true' } },
      })
    );
  }

  async purgeComponent(id: string): Promise<void> {
    assertOk(
      await api.DELETE('/api/components/{componentId}', {
        params: { path: { componentId: id }, query: { purge: 'true' } },
      })
    );
  }

  async purgeFile(id: string): Promise<void> {
    assertOk(
      await api.DELETE('/api/files/{id}', {
        params: { path: { id }, query: { purge: 'true' } },
      })
    );
  }

  async purgeFolder(id: string): Promise<void> {
    assertOk(
      await api.DELETE('/api/files/folders/{id}', {
        params: { path: { id }, query: { purge: 'true' } },
      })
    );
  }

  reset(): void {
    // Bumped before anything is cleared, so a listing mid-flight is stale.
    this.#generation += 1;
    this.#projectId = null;
    this.entries = [];
    this.loading = false;
  }
}

export const deleted = new DeletedStore();
