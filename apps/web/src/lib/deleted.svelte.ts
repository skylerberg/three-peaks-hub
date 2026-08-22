import type { components } from '@three-peaks/shared/api';
import { api, assertOk } from '../api/client.ts';

// An entry only ever appears nested in the listing, so the spec has no named
// component for one; derived rather than restated.
export type DeletedEntry = components['schemas']['DeletedListing']['entries'][number];

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
