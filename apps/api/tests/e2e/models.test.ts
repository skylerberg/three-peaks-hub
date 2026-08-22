import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DEFAULT_CARD_SETTINGS, DEFAULT_WOOD_SETTINGS } from '@three-peaks/shared';
import { createUser, deleteUser, type TestUser } from '../setup/testContext.ts';

const PNG = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
]);

describe('component model settings', () => {
  let owner: TestUser;
  let viewer: TestUser;
  let stranger: TestUser;
  let projectId: string;
  let fileId: string;
  let otherProjectFileId: string;

  async function uploadTo(user: TestUser, project: string, filename: string) {
    const query = new URLSearchParams({ project_id: project, filename });
    const res = await user.api.postBytes(
      `/api/files/upload?${query}`,
      PNG as unknown as BodyInit,
      'image/png'
    );
    return (await res.json()).id as string;
  }

  beforeAll(async () => {
    [owner, viewer, stranger] = await Promise.all([
      createUser('model-owner'),
      createUser('model-viewer'),
      createUser('model-stranger'),
    ]);

    projectId = (await (await owner.api.post('/api/projects', { name: 'Deck' })).json()).id;
    await owner.api.put(`/api/projects/${projectId}/members`, {
      email: viewer.email,
      role: 'viewer',
    });
    fileId = await uploadTo(owner, projectId, 'front.png');

    const otherProject = (
      await (await stranger.api.post('/api/projects', { name: 'Elsewhere' })).json()
    ).id;
    otherProjectFileId = await uploadTo(stranger, otherProject, 'foreign.png');
  });

  afterAll(async () => {
    for (const user of [owner, viewer, stranger]) await deleteUser(user);
  });

  // 404 rather than an empty body: the studio starts from the shared defaults,
  // and "never dialled in" is a different answer from "dialled in to nothing".
  it('answers 404 before an image has ever been dialled in', async () => {
    expect((await owner.api.get(`/api/models/${fileId}`)).status).toBe(404);
  });

  it('saves settings and reads them back', async () => {
    const saved = await owner.api.put(`/api/models/${fileId}`, {
      settings: DEFAULT_CARD_SETTINGS,
    });
    expect(saved.status).toBe(200);
    const body = await saved.json();
    expect(body.source_file_id).toBe(fileId);
    expect(body.project_id).toBe(projectId);
    expect(body.settings).toEqual(DEFAULT_CARD_SETTINGS);

    const read = await owner.api.get(`/api/models/${fileId}`);
    expect(read.status).toBe(200);
    expect((await read.json()).settings).toEqual(DEFAULT_CARD_SETTINGS);
  });

  // One row per image is the addressing scheme, so a second save replaces the
  // first rather than earning the 409 a client-supplied id would.
  it('replaces the settings on a second save rather than conflicting', async () => {
    const second = await owner.api.put(`/api/models/${fileId}`, {
      settings: DEFAULT_WOOD_SETTINGS,
    });
    expect(second.status).toBe(200);
    expect((await second.json()).settings.kind).toBe('wood');

    const read = await (await owner.api.get(`/api/models/${fileId}`)).json();
    expect(read.settings).toEqual(DEFAULT_WOOD_SETTINGS);
  });

  describe('access', () => {
    it('answers 404 to a caller who cannot see the image at all', async () => {
      expect((await stranger.api.get(`/api/models/${fileId}`)).status).toBe(404);
      const write = await stranger.api.put(`/api/models/${fileId}`, {
        settings: DEFAULT_CARD_SETTINGS,
      });
      expect(write.status).toBe(404);
    });

    it('lets a viewer read the settings', async () => {
      expect((await viewer.api.get(`/api/models/${fileId}`)).status).toBe(200);
    });

    // Not the 404 a stranger gets: src/services/authorization.ts owns why.
    it('a viewer is refused with 403', async () => {
      const res = await viewer.api.put(`/api/models/${fileId}`, {
        settings: DEFAULT_CARD_SETTINGS,
      });
      expect(res.status).toBe(403);
    });

    it('answers 404 for an image id that does not exist', async () => {
      const missing = '00000000-0000-4000-8000-000000000000';
      expect((await owner.api.get(`/api/models/${missing}`)).status).toBe(404);
    });
  });

  describe('validation', () => {
    it('refuses a thickness outside the range the sliders offer', async () => {
      const res = await owner.api.put(`/api/models/${fileId}`, {
        settings: { ...DEFAULT_CARD_SETTINGS, thickness_mm: 1e9 },
      });
      expect(res.status).toBe(422);
    });

    it('refuses a colour that is not a six-digit hex', async () => {
      const res = await owner.api.put(`/api/models/${fileId}`, {
        settings: { ...DEFAULT_WOOD_SETTINGS, wood_color: 'burlywood' },
      });
      expect(res.status).toBe(422);
    });

    // The discriminant is what decides which builder runs, so a wood field on a
    // card is a mistake worth reporting rather than one to silently drop.
    it('refuses settings whose kind is not one of the two', async () => {
      const res = await owner.api.put(`/api/models/${fileId}`, {
        settings: { ...DEFAULT_CARD_SETTINGS, kind: 'metal' },
      });
      expect(res.status).toBe(422);
    });

    it('strips a field the schema does not declare', async () => {
      const res = await owner.api.put(`/api/models/${fileId}`, {
        settings: { ...DEFAULT_CARD_SETTINGS, grain_scale: 9 },
      });
      expect(res.status).toBe(200);
      expect((await res.json()).settings).not.toHaveProperty('grain_scale');
    });

    // The id is stored rather than dereferenced, so nothing else would notice a
    // card whose reverse names a file in a project the caller cannot see.
    it('refuses a card back from another project', async () => {
      const res = await owner.api.put(`/api/models/${fileId}`, {
        settings: { ...DEFAULT_CARD_SETTINGS, back_file_id: otherProjectFileId },
      });
      expect(res.status).toBe(422);
    });

    it('accepts a card back from this project', async () => {
      const back = await uploadTo(owner, projectId, 'back.png');
      const res = await owner.api.put(`/api/models/${fileId}`, {
        settings: { ...DEFAULT_CARD_SETTINGS, back_file_id: back },
      });
      expect(res.status).toBe(200);
      expect((await res.json()).settings.back_file_id).toBe(back);
    });
  });
});
