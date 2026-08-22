import '../api/testUtils.ts';
import { fetchMock, jsonResponse } from '../api/testUtils.ts';
import { beforeEach, describe, expect, it } from 'vitest';
import { ApiError } from '../api/client.ts';
import { deleted, isNameConflict } from './deleted.svelte.ts';

const PROJECT = '2f1c9e5a-8b3d-4f1e-9c2a-7d6b5e4f3a21';
const FILE = '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d';
const FOLDER = '4c3b2a19-8e7d-4c6b-9a5f-3e2d1c0b9a87';

function entry(name: string) {
  return {
    kind: 'file',
    id: FILE,
    project_id: PROJECT,
    name,
    path: 'Decks',
    content_type: 'image/png',
    byte_size: 20,
    deleted_at: '2026-01-01T00:00:00.000Z',
    deleted_by: 'someone',
    blocked_by: null,
  };
}

function requestAt(index: number): URL {
  return new URL((fetchMock.mock.calls[index][0] as Request).url);
}

describe('DeletedStore.load', () => {
  beforeEach(() => {
    deleted.reset();
    fetchMock.mockReset();
  });

  // Mounting the screen and a file_deleted event arriving each start a load, and
  // the two answers come back in whatever order the network gives them.
  it('discards a response that a newer request has already superseded', async () => {
    let release = () => {};
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    let holdTheFirst = true;

    fetchMock.mockImplementation(async () => {
      if (holdTheFirst) {
        holdTheFirst = false;
        await held;
        return jsonResponse(200, { entries: [entry('stale.png')] });
      }
      return jsonResponse(200, { entries: [entry('fresh.png'), entry('later.png')] });
    });

    const stale = deleted.load(PROJECT);
    await deleted.load(PROJECT);
    expect(deleted.entries).toHaveLength(2);

    release();
    await stale;

    expect(deleted.entries).toHaveLength(2);
    expect(deleted.entries[0].name).toBe('fresh.png');
    expect(deleted.loading).toBe(false);
  });

  // Signing out empties this; a listing already on the wire must not put one
  // account's tombstones in front of the next.
  it('does not assign into a store that was reset mid-flight', async () => {
    let release = () => {};
    const arrived = new Promise<void>((resolve) => {
      release = resolve;
    });

    fetchMock.mockImplementation(async () => {
      await arrived;
      return jsonResponse(200, { entries: [entry('card.png')] });
    });

    const inFlight = deleted.load(PROJECT);
    deleted.reset();
    release();
    await inFlight;

    expect(deleted.entries).toHaveLength(0);
    expect(deleted.loading).toBe(false);
  });
});

describe('DeletedStore restore', () => {
  beforeEach(() => {
    deleted.reset();
    fetchMock.mockReset();
  });

  // The name is how a restore gets past a sibling that has taken the old one,
  // and a file and a folder spell that parameter differently.
  it('sends the new name as a query parameter when restoring under one', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, {}));
    await deleted.restoreFile(FILE, 'card (restored).png');
    expect(requestAt(0).pathname).toBe(`/api/files/${FILE}/restore`);
    expect(requestAt(0).searchParams.get('filename')).toBe('card (restored).png');

    fetchMock.mockResolvedValueOnce(jsonResponse(200, {}));
    await deleted.restoreFolder(FOLDER, 'Decks (restored)');
    expect(requestAt(1).pathname).toBe(`/api/files/folders/${FOLDER}/restore`);
    expect(requestAt(1).searchParams.get('name')).toBe('Decks (restored)');

    fetchMock.mockResolvedValueOnce(jsonResponse(200, {}));
    await deleted.restoreFile(FILE);
    expect(requestAt(2).search).toBe('');
  });

  // Whether the screen offers a new name turns on this, and a folder deleted
  // after the listing loaded is how the wrong branch is reached.
  it('tells a taken name apart from a folder standing in the way', () => {
    expect(isNameConflict(new ApiError(409, 'A file named "card.png" is already there'))).toBe(
      true
    );
    expect(isNameConflict(new ApiError(409, 'A folder named "Decks" is already here'))).toBe(true);
    expect(
      isNameConflict(
        new ApiError(409, 'That file is inside the deleted folder "Decks". Restore that first')
      )
    ).toBe(false);
    expect(
      isNameConflict(new ApiError(409, 'That file sits too deep for its folders to be checked'))
    ).toBe(false);
    expect(isNameConflict(new ApiError(404, 'File not found'))).toBe(false);
  });

  it('surfaces a refused restore as an error naming the folder in the way', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(409, {
        error: 'That file is inside the deleted folder "Decks". Restore that first',
      })
    );

    const failure = await deleted.restoreFile(FILE).catch((caught: unknown) => caught);
    expect(failure).toBeInstanceOf(ApiError);
    expect((failure as ApiError).status).toBe(409);
    expect((failure as ApiError).message).toContain('the deleted folder "Decks"');
  });
});
