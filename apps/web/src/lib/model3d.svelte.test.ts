import '../api/testUtils.ts';
import { fetchMock, jsonResponse } from '../api/testUtils.ts';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_CARD_SETTINGS, DEFAULT_WOOD_SETTINGS } from '@three-peaks/shared';
import { models } from './model3d.svelte.ts';

const PROJECT = '2f1c9e5a-8b3d-4f1e-9c2a-7d6b5e4f3a21';
const FILE = '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d';

const fileRow = {
  id: FILE,
  project_id: PROJECT,
  folder_id: null,
  filename: 'meeple.png',
  content_type: 'image/png',
  byte_size: 10,
  image_width: null,
  image_height: null,
  uploaded_by: 'someone',
  deleted_at: null,
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-01-01T00:00:00.000Z',
};

function savedModel(settings: unknown) {
  return {
    source_file_id: FILE,
    project_id: PROJECT,
    settings,
    updated_by: 'someone',
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
  };
}

function answer(url: string, settingsResponse: Response): Response {
  return url.includes('/api/models/') ? settingsResponse : jsonResponse(200, fileRow);
}

describe('ModelStore.load', () => {
  beforeEach(() => {
    models.reset();
    fetchMock.mockReset();
  });

  it('reads the file row and the saved settings', async () => {
    fetchMock.mockImplementation((input) =>
      Promise.resolve(
        answer(String((input as Request).url), jsonResponse(200, savedModel(DEFAULT_WOOD_SETTINGS)))
      )
    );

    await models.load(FILE);
    expect(models.file?.filename).toBe('meeple.png');
    expect(models.settings).toEqual(DEFAULT_WOOD_SETTINGS);
  });

  // 404 is the ordinary answer for an image nobody has dialled in, and the
  // studio is supposed to open on the defaults rather than on an error.
  it('falls back to the card defaults when nothing has been saved', async () => {
    fetchMock.mockImplementation((input) =>
      Promise.resolve(
        answer(String((input as Request).url), jsonResponse(404, { error: 'not yet' }))
      )
    );

    await models.load(FILE);
    expect(models.settings).toEqual(DEFAULT_CARD_SETTINGS);
  });

  it('reports a failure that is not a 404', async () => {
    fetchMock.mockImplementation((input) =>
      Promise.resolve(answer(String((input as Request).url), jsonResponse(500, { error: 'boom' })))
    );

    await expect(models.load(FILE)).rejects.toThrow();
  });

  // Opening the studio and a realtime event landing put two loads in flight at
  // once. Without the guard the older answer overwrites the newer.
  it('discards a response that a newer request has already superseded', async () => {
    let release = () => {};
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    let holdTheFirst = true;

    fetchMock.mockImplementation(async (input) => {
      const url = String((input as Request).url);
      if (!url.includes('/api/models/')) return jsonResponse(200, fileRow);
      if (holdTheFirst) {
        holdTheFirst = false;
        await held;
        return jsonResponse(200, savedModel(DEFAULT_WOOD_SETTINGS));
      }
      return jsonResponse(200, savedModel(DEFAULT_CARD_SETTINGS));
    });

    const slow = models.load(FILE);
    await models.load(FILE);

    release();
    await slow;

    expect(models.settings).toEqual(DEFAULT_CARD_SETTINGS);
  });
});

describe('ModelStore editing', () => {
  beforeEach(() => {
    models.reset();
    fetchMock.mockReset();
  });

  it('applies a patch to the current settings', () => {
    models.update({ width_mm: 70 });
    expect(models.settings).toMatchObject({ kind: 'card', width_mm: 70 });
  });

  // Switching kind and back is a thing people do to compare, and losing every
  // dial they had set on the way makes it useless.
  it('remembers each kind while switching between them', () => {
    models.update({ width_mm: 70 });
    models.setKind('wood');
    models.update({ thickness_mm: 12 });
    models.setKind('card');

    expect(models.settings).toMatchObject({ kind: 'card', width_mm: 70 });
    models.setKind('wood');
    expect(models.settings).toMatchObject({ kind: 'wood', thickness_mm: 12 });
  });

  it('starts a kind it has never seen from that kind’s defaults', () => {
    models.setKind('wood');
    expect(models.settings).toEqual(DEFAULT_WOOD_SETTINGS);
  });
});

describe('ModelStore.save', () => {
  beforeEach(async () => {
    models.reset();
    fetchMock.mockReset();
    fetchMock.mockImplementation((input) =>
      Promise.resolve(
        answer(String((input as Request).url), jsonResponse(200, savedModel(DEFAULT_CARD_SETTINGS)))
      )
    );
    await models.load(FILE);
    fetchMock.mockClear();
  });

  it('does nothing when no file is loaded', async () => {
    models.reset();
    await models.save();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  // Dragging a slider fires sixty times a second; one request per frame would
  // be a denial of service written by the person using it.
  it('collapses a burst of edits into one request', async () => {
    vi.useFakeTimers();
    try {
      models.scheduleSave();
      models.scheduleSave();
      models.scheduleSave();
      await vi.runAllTimersAsync();
    } finally {
      vi.useRealTimers();
    }

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('sends the settings as a plain object rather than the state proxy', async () => {
    models.update({ width_mm: 70 });
    await models.save();

    const request = fetchMock.mock.calls[0][0] as Request;
    expect(await request.clone().json()).toEqual({
      settings: expect.objectContaining({ kind: 'card', width_mm: 70 }),
    });
  });
});
