import type { components } from '@three-peaks/shared/api';
import { api, assertOk, authHeader } from '../api/client.ts';
import { assertUploadSize, readUploadResponse } from './upload.ts';

type FileRow = components['schemas']['File'];
// A version only ever appears nested in a response, so the spec has no named
// component for it; derived rather than restated.
type FileVersion = components['schemas']['FileVersionList']['versions'][number];

class VersionStore {
  file = $state<FileRow | null>(null);
  versions = $state<FileVersion[]>([]);
  loading = $state(false);

  // Two loads are routinely in flight: the one the screen starts on mount and
  // the one a realtime event or a finished upload starts. Only the newest may
  // assign; see files.svelte.ts for what the older one overwrote before this.
  #generation = 0;

  async load(fileId: string): Promise<void> {
    this.#generation += 1;
    const generation = this.#generation;
    this.loading = true;

    try {
      const [rowResult, historyResult] = await Promise.all([
        api.GET('/api/files/{id}', { params: { path: { id: fileId } } }),
        api.GET('/api/files/{id}/versions', { params: { path: { id: fileId } } }),
      ]);
      const file = assertOk(rowResult);
      const history = assertOk(historyResult).versions;

      if (generation !== this.#generation) return;
      this.file = file;
      this.versions = history;
    } finally {
      if (generation === this.#generation) this.loading = false;
    }
  }

  async refresh(): Promise<void> {
    const current = this.file;
    if (!current) return;
    await this.load(current.id);
  }

  // The row this screen is showing, changed under it -- a rename, or a
  // tombstone somebody else stamped.
  applyFile(row: FileRow): void {
    if (this.file?.id !== row.id) return;
    this.file = row;
  }

  // A version appended elsewhere. History only grows and the newest number is
  // the current one, so this goes on the front and takes the flag with it.
  applyVersion(row: FileRow, version: FileVersion): void {
    if (this.file?.id !== row.id) return;
    this.file = row;
    if (this.versions.some((entry) => entry.version_number === version.version_number)) return;
    this.versions = [
      version,
      ...this.versions.map((entry) => (entry.is_current ? { ...entry, is_current: false } : entry)),
    ];
  }

  // Answers whether a version was created: identical bytes are a 200 that
  // changed nothing, which the caller has to be able to say out loud.
  async upload(fileId: string, file: File): Promise<boolean> {
    assertUploadSize(file.size);
    // The file IS the body, as the upload route wants it, so this cannot go
    // through the generated client and asks for the credential by hand.
    const response = await fetch(`/api/files/${fileId}/versions`, {
      method: 'POST',
      headers: {
        'Content-Type': file.type || 'application/octet-stream',
        ...authHeader(),
      },
      body: file,
    });

    const body = await readUploadResponse<{ created?: boolean }>(
      response,
      `Upload failed (${response.status})`
    );
    return body.created === true;
  }

  async restore(fileId: string, versionNumber: number): Promise<boolean> {
    const result = assertOk(
      await api.POST('/api/files/{id}/versions/{number}/restore', {
        params: { path: { id: fileId, number: String(versionNumber) } },
      })
    );
    return result.created;
  }

  reset(): void {
    // Generation first, so nothing still on the wire can refill this.
    this.#generation += 1;
    this.file = null;
    this.versions = [];
    this.loading = false;
  }
}

export const versions = new VersionStore();
