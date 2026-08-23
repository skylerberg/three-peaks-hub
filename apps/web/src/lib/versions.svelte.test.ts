import '../api/testUtils.ts';
import { fetchMock, jsonResponse } from '../api/testUtils.ts';
import { beforeEach, describe, expect, it } from 'vitest';
import { MAX_UPLOAD_BYTES, formatBytes } from '@three-peaks/shared';
import { versions } from './versions.svelte.ts';

const PROJECT = '2f1c9e5a-8b3d-4f1e-9c2a-7d6b5e4f3a21';
const FILE = '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d';

const fileRow = {
  id: FILE,
  project_id: PROJECT,
  folder_id: null,
  filename: 'card.png',
  content_type: 'image/png',
  byte_size: 20,
  image_width: null,
  image_height: null,
  uploaded_by: 'someone',
  deleted_at: null,
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-01-01T00:00:00.000Z',
};

function version(versionNumber: number, byteSize: number, isCurrent: boolean) {
  return {
    file_id: FILE,
    version_number: versionNumber,
    content_type: 'image/png',
    byte_size: byteSize,
    checksum: null,
    image_width: null,
    image_height: null,
    created_by: 'someone',
    created_at: '2026-01-01T00:00:00.000Z',
    is_current: isCurrent,
  };
}

function bytes(): File {
  return new File(['ace of coins'], 'card.png', { type: 'image/png' });
}

describe('VersionStore.load', () => {
  beforeEach(() => {
    versions.reset();
    fetchMock.mockReset();
  });

  // Opening the screen and a file_version_created event landing put two loads in
  // flight at once, and the answers can arrive in either order.
  it('discards a response that a newer request has already superseded', async () => {
    let release = () => {};
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    let holdTheFirst = true;

    fetchMock.mockImplementation(async (input) => {
      const url = String((input as Request).url);
      if (!url.includes('/versions')) return jsonResponse(200, fileRow);
      if (holdTheFirst) {
        holdTheFirst = false;
        await held;
        return jsonResponse(200, { versions: [version(1, 10, true)] });
      }
      return jsonResponse(200, { versions: [version(2, 20, true), version(1, 10, false)] });
    });

    const stale = versions.load(FILE);
    await versions.load(FILE);
    expect(versions.versions).toHaveLength(2);

    release();
    await stale;

    expect(versions.versions).toHaveLength(2);
    expect(versions.versions[0].version_number).toBe(2);
    expect(versions.loading).toBe(false);
  });

  // Signing out empties the store; an answer already on the wire must not refill
  // it with the departing account's history.
  it('does not assign into a store that was reset mid-flight', async () => {
    let release = () => {};
    const arrived = new Promise<void>((resolve) => {
      release = resolve;
    });

    fetchMock.mockImplementation(async (input) => {
      const url = String((input as Request).url);
      if (!url.includes('/versions')) return jsonResponse(200, fileRow);
      await arrived;
      return jsonResponse(200, { versions: [version(1, 10, true)] });
    });

    const inFlight = versions.load(FILE);
    versions.reset();
    release();
    await inFlight;

    expect(versions.file).toBeNull();
    expect(versions.versions).toHaveLength(0);
    expect(versions.loading).toBe(false);
  });
});

describe('VersionStore.upload', () => {
  beforeEach(() => {
    versions.reset();
    fetchMock.mockReset();
  });

  // The server answers 200 and changes nothing when the bytes match the current
  // version, and the screen has to be able to say so rather than claiming a
  // version that does not exist.
  it('reports that identical bytes created nothing', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, { created: false, version: version(1, 10, true) })
    );
    expect(await versions.upload(FILE, bytes())).toBe(false);

    fetchMock.mockResolvedValueOnce(
      jsonResponse(201, { created: true, version: version(2, 12, true) })
    );
    expect(await versions.upload(FILE, bytes())).toBe(true);
  });

  it('surfaces a failed upload as an error', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(413, { error: 'That would exceed the project storage quota.' })
    );

    await expect(versions.upload(FILE, bytes())).rejects.toThrow(
      'That would exceed the project storage quota.'
    );
  });

  // Appending a version is the second way to put bytes on a file, and the API
  // caps it exactly as the first one does -- after the transfer.
  it('refuses a file over the limit without sending it', async () => {
    const oversized = bytes();
    Object.defineProperty(oversized, 'size', { value: MAX_UPLOAD_BYTES * 2 });

    await expect(versions.upload(FILE, oversized)).rejects.toThrow(
      `That file is ${formatBytes(MAX_UPLOAD_BYTES * 2)}, over the ` +
        `${formatBytes(MAX_UPLOAD_BYTES)} limit for one upload.`
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('VersionStore.restore', () => {
  beforeEach(() => {
    versions.reset();
    fetchMock.mockReset();
  });

  it('addresses a version by its number and reports whether one was created', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(201, { created: true, version: version(4, 10, true) })
    );

    expect(await versions.restore(FILE, 1)).toBe(true);
    const request = fetchMock.mock.calls[0][0] as Request;
    expect(new URL(request.url).pathname).toBe(`/api/files/${FILE}/versions/1/restore`);
  });
});
