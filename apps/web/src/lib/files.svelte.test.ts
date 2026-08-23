import '../api/testUtils.ts';
import { fetchMock, jsonResponse } from '../api/testUtils.ts';
import { beforeEach, describe, expect, it } from 'vitest';
import { MAX_UPLOAD_BYTES, formatBytes } from '@three-peaks/shared';
import { apiMessage } from '../api/client.ts';
import { files } from './files.svelte.ts';

const PROJECT = '2f1c9e5a-8b3d-4f1e-9c2a-7d6b5e4f3a21';

function listing(fileCount: number, usedBytes: number) {
  return {
    project_id: PROJECT,
    folder: null,
    breadcrumb: [],
    folders: [],
    files: Array.from({ length: fileCount }, (_, index) => ({
      id: `file-${index}`,
      project_id: PROJECT,
      folder_id: null,
      filename: `f${index}.txt`,
      content_type: 'text/plain',
      byte_size: usedBytes,
      image_width: null,
      image_height: null,
      uploaded_by: 'someone',
      deleted_at: null,
      created_at: '2026-01-01T00:00:00.000Z',
      updated_at: '2026-01-01T00:00:00.000Z',
    })),
    storage_used_bytes: usedBytes,
    storage_quota_bytes: 1024,
  };
}

describe('FileStore.load', () => {
  beforeEach(() => {
    files.reset();
    fetchMock.mockReset();
  });

  // Two loads are routinely in flight: the one a component starts on mount and
  // the one a refresh starts after an upload. Before the generation guard, the
  // slower earlier response won -- which showed as an explorer listing the file
  // it had just uploaded while the storage meter still read 0 B.
  it('discards a response that a newer request has already superseded', async () => {
    let releaseFirst: (() => void) | null = null;
    const firstArrived = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });

    fetchMock
      .mockImplementationOnce(async () => {
        await firstArrived;
        return jsonResponse(200, listing(0, 0));
      })
      .mockImplementationOnce(async () => jsonResponse(200, listing(1, 58)));

    const stale = files.load(PROJECT, null);
    const fresh = files.load(PROJECT, null);

    await fresh;
    expect(files.listing?.storage_used_bytes).toBe(58);

    // Now let the older request finish. It must not assign.
    releaseFirst!();
    await stale;

    expect(files.listing?.storage_used_bytes).toBe(58);
    expect(files.listing?.files).toHaveLength(1);
  });

  it('leaves the spinner to whichever request is still current', async () => {
    let releaseFirst: (() => void) | null = null;
    const firstArrived = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });

    fetchMock
      .mockImplementationOnce(async () => {
        await firstArrived;
        return jsonResponse(200, listing(0, 0));
      })
      .mockImplementationOnce(async () => jsonResponse(200, listing(1, 58)));

    const stale = files.load(PROJECT, null);
    const fresh = files.load(PROJECT, null);
    await fresh;
    expect(files.loading).toBe(false);

    releaseFirst!();
    await stale;
    expect(files.loading).toBe(false);
  });

  // Signing out empties the store; a response already on the wire must not
  // refill it with the departing account's data.
  it('does not assign into a store that was reset mid-flight', async () => {
    let release: (() => void) | null = null;
    const arrived = new Promise<void>((resolve) => {
      release = resolve;
    });

    fetchMock.mockImplementationOnce(async () => {
      await arrived;
      return jsonResponse(200, listing(3, 99));
    });

    const inFlight = files.load(PROJECT, null);
    files.reset();
    release!();
    await inFlight;

    expect(files.listing).toBeNull();
  });
});

// A File of the size claimed, without allocating it: only `size` is read before
// the request, and half a gigabyte of zeroes in jsdom is not worth the seconds.
function fileOf(name: string, size: number): File {
  const file = new File(['x'], name, { type: 'application/zip' });
  Object.defineProperty(file, 'size', { value: size });
  return file;
}

describe('FileStore.upload', () => {
  beforeEach(() => {
    files.reset();
    fetchMock.mockReset();
  });

  it('refuses a file over the limit without sending it', async () => {
    const oversized = fileOf('export.zip', MAX_UPLOAD_BYTES * 2);
    const caught = await files.upload(PROJECT, null, oversized).catch((error: unknown) => error);

    expect(apiMessage(caught)).toBe(
      `That file is ${formatBytes(MAX_UPLOAD_BYTES * 2)}, over the ` +
        `${formatBytes(MAX_UPLOAD_BYTES)} limit for one upload.`
    );
    expect(fetchMock).not.toHaveBeenCalled();
    // The row the explorer draws while a transfer is in flight: nothing was
    // ever in flight.
    expect(files.pending).toHaveLength(0);
  });

  // apiMessage shows an ApiError and nothing else, so a plain Error thrown here
  // reached the toast as "could not reach the server" -- for a refusal the
  // server had taken the trouble to explain.
  it('carries the refusal the API wrote out to the caller', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(413, { error: 'Project storage quota exceeded' }));

    const caught = await files
      .upload(PROJECT, null, fileOf('card.png', 8))
      .catch((error: unknown) => error);

    expect(apiMessage(caught)).toBe('Project storage quota exceeded');
    expect(files.pending).toHaveLength(0);
  });
});
