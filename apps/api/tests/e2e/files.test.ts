import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createUser, deleteUser, type TestUser } from '../setup/testContext.ts';

const PNG = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
]);

describe('project files', () => {
  let owner: TestUser;
  let projectId: string;

  beforeAll(async () => {
    owner = await createUser('files');
    projectId = (await (await owner.api.post('/api/projects', { name: 'Art' })).json()).id;
  });

  afterAll(async () => {
    await deleteUser(owner);
  });

  async function upload(filename: string, body: Buffer | string, folderId?: string) {
    const query = new URLSearchParams({ project_id: projectId, filename });
    if (folderId) query.set('folder_id', folderId);
    return owner.api.postBytes(`/api/files/upload?${query}`, body as unknown as BodyInit);
  }

  describe('uploads', () => {
    it('stores a file and lists it in the project root', async () => {
      const res = await upload('rules.txt', 'How to play');
      expect(res.status).toBe(201);
      const file = await res.json();
      expect(file.filename).toBe('rules.txt');
      expect(file.byte_size).toBe('How to play'.length);
      expect(file.folder_id).toBeNull();

      const listing = await (
        await owner.api.get(`/api/files/directory?project_id=${projectId}`)
      ).json();
      expect(listing.files.map((f: { id: string }) => f.id)).toContain(file.id);
      expect(listing.storage_used_bytes).toBeGreaterThan(0);
    });

    it('serves the bytes back', async () => {
      const uploaded = await (await upload('card.txt', 'ace of spades')).json();
      const res = await owner.api.get(`/api/files/${uploaded.id}/download`);
      expect(res.status).toBe(200);
      expect(await res.text()).toBe('ace of spades');
      // attachment, never inline: user-supplied bytes rendered inline on this
      // origin would be same-origin script.
      expect(res.headers.get('content-disposition')).toContain('attachment');
    });

    // The declared Content-Type is ignored; what the bytes actually are is what
    // gets recorded and what any later download serves.
    it('decides the content type by magic bytes, not by what the client claims', async () => {
      const lying = await owner.api.postBytes(
        `/api/files/upload?project_id=${projectId}&filename=trap.png`,
        '<script>alert(1)</script>' as unknown as BodyInit,
        'image/png'
      );
      expect(lying.status).toBe(201);
      expect((await lying.json()).content_type).toBe('application/octet-stream');

      const real = await owner.api.postBytes(
        `/api/files/upload?project_id=${projectId}&filename=real.png`,
        PNG as unknown as BodyInit,
        'application/octet-stream'
      );
      expect((await real.json()).content_type).toBe('image/png');
    });

    // SVG is the one source format with no fixed byte prefix, so it is the one
    // the sniffer can get wrong in both directions.
    it('recognises an svg behind its xml declaration', async () => {
      const svg =
        '<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 8 8"><rect width="8" height="8" /></svg>';
      const res = await owner.api.postBytes(
        `/api/files/upload?project_id=${projectId}&filename=meeple.svg`,
        svg as unknown as BodyInit,
        'text/plain'
      );
      expect(res.status).toBe(201);
      expect((await res.json()).content_type).toBe('image/svg+xml');
    });

    it('does not recognise an html page that happens to contain an svg', async () => {
      const html = '<!DOCTYPE html>\n<html><body><svg><circle r="1" /></svg></body></html>';
      const res = await owner.api.postBytes(
        `/api/files/upload?project_id=${projectId}&filename=trap.svg`,
        html as unknown as BodyInit,
        'image/svg+xml'
      );
      expect((await res.json()).content_type).toBe('application/octet-stream');
    });

    it('reads one file row by id', async () => {
      const uploaded = await (await upload('single.txt', 'one')).json();
      const res = await owner.api.get(`/api/files/${uploaded.id}`);
      expect(res.status).toBe(200);
      expect((await res.json()).filename).toBe('single.txt');
    });

    // /directory and /:id are both GETs one segment deep, and the listing is
    // the one that stops working if the parameter route wins.
    it('still routes the directory listing rather than reading a file called directory', async () => {
      const res = await owner.api.get(`/api/files/directory?project_id=${projectId}`);
      expect(res.status).toBe(200);
      expect(await res.json()).toHaveProperty('files');
    });

    it('refuses a second file with the same name in the same folder', async () => {
      await upload('dup.txt', 'first');
      const second = await upload('dup.txt', 'second');
      expect(second.status).toBe(409);
    });

    it('refuses an upload to a project the caller cannot write', async () => {
      const stranger = await createUser('nope');
      const res = await stranger.api.postBytes(
        `/api/files/upload?project_id=${projectId}&filename=evil.txt`,
        'x' as unknown as BodyInit
      );
      expect(res.status).toBe(404);
      await deleteUser(stranger);
    });
  });

  describe('folders', () => {
    it('nests, lists and builds a breadcrumb', async () => {
      const art = await (
        await owner.api.post('/api/files/folders', { project_id: projectId, name: 'Artwork' })
      ).json();
      const cards = await (
        await owner.api.post('/api/files/folders', {
          project_id: projectId,
          parent_id: art.id,
          name: 'Cards',
        })
      ).json();

      await upload('front.png', PNG, cards.id);

      const listing = await (
        await owner.api.get(`/api/files/directory?project_id=${projectId}&folder_id=${cards.id}`)
      ).json();

      expect(listing.folder.id).toBe(cards.id);
      expect(listing.breadcrumb.map((f: { name: string }) => f.name)).toEqual(['Artwork', 'Cards']);
      expect(listing.files).toHaveLength(1);

      // The root listing shows only what is directly in it.
      const root = await (
        await owner.api.get(`/api/files/directory?project_id=${projectId}`)
      ).json();
      expect(root.folders.map((f: { name: string }) => f.name)).toContain('Artwork');
      expect(root.folders.map((f: { name: string }) => f.name)).not.toContain('Cards');
    });

    it('refuses two folders with the same name in one parent, ignoring case', async () => {
      await owner.api.post('/api/files/folders', { project_id: projectId, name: 'Rules' });
      const clash = await owner.api.post('/api/files/folders', {
        project_id: projectId,
        name: 'RULES',
      });
      expect(clash.status).toBe(409);
    });

    // A cycle here would be an unterminating walk in every later read.
    it('refuses a move that would put a folder inside itself', async () => {
      const outer = await (
        await owner.api.post('/api/files/folders', { project_id: projectId, name: 'Outer' })
      ).json();
      const inner = await (
        await owner.api.post('/api/files/folders', {
          project_id: projectId,
          parent_id: outer.id,
          name: 'Inner',
        })
      ).json();

      expect(
        (await owner.api.patch(`/api/files/folders/${outer.id}`, { parent_id: outer.id })).status
      ).toBe(409);
      expect(
        (await owner.api.patch(`/api/files/folders/${outer.id}`, { parent_id: inner.id })).status
      ).toBe(409);
    });

    it('deletes its whole subtree', async () => {
      const box = await (
        await owner.api.post('/api/files/folders', { project_id: projectId, name: 'Box' })
      ).json();
      const lid = await (
        await owner.api.post('/api/files/folders', {
          project_id: projectId,
          parent_id: box.id,
          name: 'Lid',
        })
      ).json();
      const doomed = await (await upload('inside.txt', 'gone soon', lid.id)).json();

      expect((await owner.api.delete(`/api/files/folders/${box.id}?purge=true`)).status).toBe(204);
      expect((await owner.api.get(`/api/files/${doomed.id}/download`)).status).toBe(404);
      expect(
        (await owner.api.get(`/api/files/directory?project_id=${projectId}&folder_id=${lid.id}`))
          .status
      ).toBe(404);
    });
  });

  describe('renaming and moving', () => {
    it('renames a file', async () => {
      const file = await (await upload('before.txt', 'x')).json();
      const res = await owner.api.patch(`/api/files/${file.id}`, { filename: 'after.txt' });
      expect(res.status).toBe(200);
      expect((await res.json()).filename).toBe('after.txt');
    });

    it('moves a file into a folder', async () => {
      const folder = await (
        await owner.api.post('/api/files/folders', { project_id: projectId, name: 'Moved' })
      ).json();
      const file = await (await upload('travels.txt', 'x')).json();

      const res = await owner.api.patch(`/api/files/${file.id}`, { folder_id: folder.id });
      expect(res.status).toBe(200);
      expect((await res.json()).folder_id).toBe(folder.id);
    });

    it('refuses a move into another project', async () => {
      const otherProject = await (
        await owner.api.post('/api/projects', { name: 'Elsewhere' })
      ).json();
      const otherFolder = await (
        await owner.api.post('/api/files/folders', {
          project_id: otherProject.id,
          name: 'Foreign',
        })
      ).json();
      const file = await (await upload('stay.txt', 'x')).json();

      const res = await owner.api.patch(`/api/files/${file.id}`, { folder_id: otherFolder.id });
      expect(res.status).toBe(404);
    });
  });

  it('stops listing a deleted file but keeps serving its bytes', async () => {
    const file = await (await upload('temporary.txt', 'briefly')).json();
    expect((await owner.api.delete(`/api/files/${file.id}`)).status).toBe(204);

    const listing = await (
      await owner.api.get(`/api/files/directory?project_id=${projectId}`)
    ).json();
    expect(listing.files.map((f: { id: string }) => f.id)).not.toContain(file.id);
    expect((await owner.api.get(`/api/files/${file.id}/download`)).status).toBe(200);

    expect((await owner.api.delete(`/api/files/${file.id}?purge=true`)).status).toBe(204);
    expect((await owner.api.get(`/api/files/${file.id}/download`)).status).toBe(404);
  });
});
