import type { components } from '@three-peaks/shared/api';
import { api, assertOk } from '../api/client.ts';
import { newId } from './ids.ts';

type Folder = components['schemas']['Folder'];
type DirectoryListing = components['schemas']['DirectoryListing'];

interface PendingUpload {
  key: string;
  filename: string;
}

class FileStore {
  listing = $state<DirectoryListing | null>(null);
  loading = $state(false);
  // Rows drawn before the server has answered, so a large upload is visible the
  // moment it starts rather than when it finishes.
  pending = $state<PendingUpload[]>([]);

  // Two loads are routinely in flight at once: the one a component starts on
  // mount, and the one a refresh starts after an upload. Responses can arrive in
  // either order, and without this the older one overwrites the newer -- which
  // showed up as an explorer listing the file it had just uploaded while the
  // storage meter still read 0 B. Only the newest request may assign.
  #generation = 0;

  async load(projectId: string, folderId: string | null): Promise<void> {
    this.#generation += 1;
    const generation = this.#generation;
    this.loading = true;

    try {
      const data = assertOk(
        await api.GET('/api/files/directory', {
          params: {
            query: { project_id: projectId, ...(folderId ? { folder_id: folderId } : {}) },
          },
        })
      );
      if (generation !== this.#generation) return;
      this.listing = data;
    } finally {
      // Guarded too: a superseded request finishing must not clear the spinner
      // that the request replacing it is still showing.
      if (generation === this.#generation) this.loading = false;
    }
  }

  async refresh(): Promise<void> {
    if (!this.listing) return;
    await this.load(this.listing.project_id, this.listing.folder?.id ?? null);
  }

  async upload(projectId: string, folderId: string | null, file: File): Promise<void> {
    const key = `${file.name}-${crypto.randomUUID()}`;
    this.pending = [...this.pending, { key, filename: file.name }];

    try {
      // eslint-disable-next-line svelte/prefer-svelte-reactivity -- built to make one URL and discarded
      const query = new URLSearchParams({ project_id: projectId, filename: file.name });
      if (folderId) query.set('folder_id', folderId);

      // The file IS the body. Serializing it into JSON would read the whole
      // thing into memory on both ends, which is exactly what the streaming
      // upload path on the server exists to avoid.
      const response = await fetch(`/api/files/upload?${query}`, {
        method: 'POST',
        headers: {
          'Content-Type': file.type || 'application/octet-stream',
          ...authHeader(),
        },
        body: file,
      });

      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body.error ?? `Upload failed with status ${response.status}`);
      }
    } finally {
      this.pending = this.pending.filter((entry) => entry.key !== key);
    }
  }

  async createFolder(projectId: string, parentId: string | null, name: string): Promise<Folder> {
    return assertOk(
      await api.POST('/api/files/folders', {
        body: { id: newId(), project_id: projectId, parent_id: parentId, name },
      })
    );
  }

  async renameFolder(id: string, name: string): Promise<void> {
    assertOk(
      await api.PATCH('/api/files/folders/{id}', { params: { path: { id } }, body: { name } })
    );
  }

  async deleteFolder(id: string): Promise<void> {
    assertOk(await api.DELETE('/api/files/folders/{id}', { params: { path: { id } } }));
  }

  async renameFile(id: string, filename: string): Promise<void> {
    assertOk(await api.PATCH('/api/files/{id}', { params: { path: { id } }, body: { filename } }));
  }

  async moveFile(id: string, folderId: string | null): Promise<void> {
    assertOk(
      await api.PATCH('/api/files/{id}', {
        params: { path: { id } },
        body: { folder_id: folderId },
      })
    );
  }

  async deleteFile(id: string): Promise<void> {
    assertOk(await api.DELETE('/api/files/{id}', { params: { path: { id } } }));
  }

  reset(): void {
    // Moves the generation on, so a response still in flight when someone signs
    // out cannot assign one account's listing into the next one's store.
    this.#generation += 1;
    this.listing = null;
    this.pending = [];
    this.loading = false;
  }
}

// The upload goes through fetch rather than the generated client, so it has to
// attach the token itself.
function authHeader(): Record<string, string> {
  const token = localStorage.getItem('tph.token');
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export const files = new FileStore();
