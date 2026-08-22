import { readdir } from 'node:fs/promises';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { env } from '../../src/config/env.ts';
import { db } from '../../src/db/index.ts';
import { storage } from '../../src/services/storage/index.ts';
import { createUser, deleteUser, type TestUser } from '../setup/testContext.ts';

const PNG = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
]);

interface VersionEntry {
  file_id: string;
  version_number: number;
  content_type: string;
  byte_size: number;
  checksum: string | null;
  created_by: string;
  created_at: string;
  is_current: boolean;
}

async function storedObjectNames(): Promise<Set<string>> {
  return new Set(await readdir(env.storage.diskRoot).catch(() => []));
}

function versionKeys(fileId: string) {
  return db
    .selectFrom('file_version')
    .select([
      'file_version.version_number as version_number',
      'file_version.storage_key as storage_key',
    ])
    .where('file_version.file_id', '=', fileId)
    .orderBy('file_version.version_number', 'asc')
    .execute();
}

describe('file versions', () => {
  let owner: TestUser;
  let viewer: TestUser;
  let stranger: TestUser;
  let projectId: string;

  beforeAll(async () => {
    [owner, viewer, stranger] = await Promise.all([
      createUser('versions-owner'),
      createUser('versions-viewer'),
      createUser('versions-stranger'),
    ]);

    projectId = (await (await owner.api.post('/api/projects', { name: 'Deck' })).json()).id;
    await owner.api.put(`/api/projects/${projectId}/members`, {
      email: viewer.email,
      role: 'viewer',
    });
  });

  afterAll(async () => {
    for (const user of [owner, viewer, stranger]) await deleteUser(user);
  });

  async function upload(filename: string, body: Buffer | string, folderId?: string) {
    const query = new URLSearchParams({ project_id: projectId, filename });
    if (folderId) query.set('folder_id', folderId);
    const res = await owner.api.postBytes(
      `/api/files/upload?${query}`,
      body as unknown as BodyInit
    );
    expect(res.status).toBe(201);
    return (await res.json()) as { id: string };
  }

  function append(fileId: string, body: Buffer | string) {
    return owner.api.postBytes(`/api/files/${fileId}/versions`, body as unknown as BodyInit);
  }

  async function history(fileId: string): Promise<VersionEntry[]> {
    const res = await owner.api.get(`/api/files/${fileId}/versions`);
    expect(res.status).toBe(200);
    return (await res.json()).versions;
  }

  it('appends a version and moves the directory listing with it', async () => {
    const file = await upload('rules.txt', 'first draft');

    const res = await append(file.id, 'second draft, rather longer');
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.created).toBe(true);
    expect(body.version.version_number).toBe(2);
    expect(body.version.is_current).toBe(true);

    const listing = await (
      await owner.api.get(`/api/files/directory?project_id=${projectId}`)
    ).json();
    const listed = listing.files.find((f: { id: string }) => f.id === file.id);
    expect(listed.byte_size).toBe('second draft, rather longer'.length);

    const download = await owner.api.get(`/api/files/${file.id}/download`);
    expect(await download.text()).toBe('second draft, rather longer');

    const versions = await history(file.id);
    expect(versions.map((v) => v.version_number)).toEqual([2, 1]);
    expect(versions.map((v) => v.is_current)).toEqual([true, false]);
  });

  // The key, the length and the type all have to come from the version asked
  // for. Swapping only the key serves old bytes under the current version's
  // length and type.
  it('serves an older version after a newer one has landed', async () => {
    const file = await upload('art.png', PNG);
    expect((await append(file.id, 'replaced by a note about the art')).status).toBe(201);

    const res = await owner.api.get(`/api/files/${file.id}/download?version=1`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('image/png');
    expect(res.headers.get('content-length')).toBe(String(PNG.length));
    expect(res.headers.get('content-disposition')).toContain('art.png.v1');
    expect(Buffer.from(await res.arrayBuffer()).equals(PNG)).toBe(true);

    const current = await owner.api.get(`/api/files/${file.id}/download`);
    expect(await current.text()).toBe('replaced by a note about the art');
  });

  it('restores an older version by appending a copy', async () => {
    const file = await upload('deck.txt', 'the first cut');
    expect((await append(file.id, 'the second cut, revised')).status).toBe(201);
    expect((await append(file.id, 'the third cut, revised again')).status).toBe(201);

    const res = await owner.api.post(`/api/files/${file.id}/versions/1/restore`);
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.created).toBe(true);
    // Forward, never back: history only grows.
    expect(body.version.version_number).toBe(4);

    const versions = await history(file.id);
    expect(versions.map((v) => v.version_number)).toEqual([4, 3, 2, 1]);

    const current = await owner.api.get(`/api/files/${file.id}/download`);
    expect(await current.text()).toBe('the first cut');

    const keys = await versionKeys(file.id);
    expect(keys.map((k) => k.storage_key)).toHaveLength(
      new Set(keys.map((k) => k.storage_key)).size
    );
    expect(keys[3].storage_key).not.toBe(keys[0].storage_key);

    // The copy is a second object, and the original is still readable at its
    // own number.
    const original = await owner.api.get(`/api/files/${file.id}/download?version=1`);
    expect(await original.text()).toBe('the first cut');
  });

  it('restoring the version that is already current creates nothing', async () => {
    const file = await upload('steady.txt', 'unchanged');
    expect((await append(file.id, 'changed once')).status).toBe(201);

    const res = await owner.api.post(`/api/files/${file.id}/versions/2/restore`);
    expect(res.status).toBe(200);
    expect((await res.json()).created).toBe(false);
    expect(await history(file.id)).toHaveLength(2);
  });

  it('re-uploading identical bytes creates nothing', async () => {
    const file = await upload('same.txt', 'byte for byte identical');

    const res = await append(file.id, 'byte for byte identical');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.created).toBe(false);
    expect(body.version.version_number).toBe(1);
    expect(await history(file.id)).toHaveLength(1);
  });

  // Sizes chosen so three of the largest does not equal their sum: summing the
  // joined `file` rows instead would otherwise land on the same number.
  it('counts every version against the project quota', async () => {
    const own = (await (await owner.api.post('/api/projects', { name: 'Metered' })).json()).id;
    const created = await owner.api.postBytes(
      `/api/files/upload?project_id=${own}&filename=meter.bin`,
      'a'.repeat(10) as unknown as BodyInit
    );
    expect(created.status).toBe(201);
    const fileId = (await created.json()).id;

    expect(
      (await owner.api.postBytes(`/api/files/${fileId}/versions`, 'b'.repeat(20))).status
    ).toBe(201);
    expect(
      (await owner.api.postBytes(`/api/files/${fileId}/versions`, 'c'.repeat(40))).status
    ).toBe(201);

    const listing = await (await owner.api.get(`/api/files/directory?project_id=${own}`)).json();
    expect(listing.storage_used_bytes).toBe(70);
  });

  it('refuses a viewer a new version with 403', async () => {
    const file = await upload('read-only.txt', 'owner bytes');

    expect(
      (await viewer.api.postBytes(`/api/files/${file.id}/versions`, 'viewer bytes')).status
    ).toBe(403);
    expect((await viewer.api.post(`/api/files/${file.id}/versions/1/restore`)).status).toBe(403);
    // Reading the history is not a write: a viewer may see it.
    expect((await viewer.api.get(`/api/files/${file.id}/versions`)).status).toBe(200);
  });

  it('answers 404 to a stranger asking for versions', async () => {
    const file = await upload('secret.txt', 'not for you');

    expect((await stranger.api.get(`/api/files/${file.id}/versions`)).status).toBe(404);
    expect(
      (await stranger.api.postBytes(`/api/files/${file.id}/versions`, 'mine now')).status
    ).toBe(404);
    expect((await stranger.api.post(`/api/files/${file.id}/versions/1/restore`)).status).toBe(404);
  });

  it('answers 404 for a version number that does not exist', async () => {
    const file = await upload('lonely.txt', 'only ever one');

    expect((await owner.api.get(`/api/files/${file.id}/download?version=2`)).status).toBe(404);
    expect((await owner.api.post(`/api/files/${file.id}/versions/2/restore`)).status).toBe(404);
  });

  it('leaves nothing in storage when a file with three versions is purged', async () => {
    const file = await upload('doomed.txt', 'one');
    expect((await append(file.id, 'two of them')).status).toBe(201);
    expect((await append(file.id, 'three of them now')).status).toBe(201);

    const keys = await versionKeys(file.id);
    expect(keys).toHaveLength(3);

    expect((await owner.api.delete(`/api/files/${file.id}?purge=true`)).status).toBe(204);
    for (const key of keys) {
      expect(await storage().get(key.storage_key)).toBeNull();
    }
  });

  it('leaves nothing in storage when a folder holding a versioned file is purged', async () => {
    const folder = await (
      await owner.api.post('/api/files/folders', { project_id: projectId, name: 'Condemned' })
    ).json();
    const file = await upload('inside.txt', 'inside, first', folder.id);
    expect((await append(file.id, 'inside, second')).status).toBe(201);

    const keys = await versionKeys(file.id);
    expect(keys).toHaveLength(2);

    expect((await owner.api.delete(`/api/files/folders/${folder.id}?purge=true`)).status).toBe(204);
    for (const key of keys) {
      expect(await storage().get(key.storage_key)).toBeNull();
    }
  });

  // The widest of the three delete paths: the cascade takes every folder and
  // file in the project at once, so nothing is left to say which objects the
  // rows had named.
  it('leaves nothing in storage when a project holding a versioned file is deleted', async () => {
    const doomed = (await (await owner.api.post('/api/projects', { name: 'Doomed' })).json()).id;
    const created = await owner.api.postBytes(
      `/api/files/upload?project_id=${doomed}&filename=whole-project.txt`,
      'the project, first' as unknown as BodyInit
    );
    expect(created.status).toBe(201);
    const fileId = (await created.json()).id;
    expect((await append(fileId, 'the project, second')).status).toBe(201);
    expect((await append(fileId, 'the project, third and last')).status).toBe(201);

    const keys = await versionKeys(fileId);
    expect(keys).toHaveLength(3);

    expect((await owner.api.delete(`/api/projects/${doomed}`)).status).toBe(204);
    for (const key of keys) {
      expect(await storage().get(key.storage_key)).toBeNull();
    }
  });

  // Reading history is a read. A viewer who may see the current bytes may see
  // what they used to be.
  it('lets a viewer download a version that is no longer current', async () => {
    const file = await upload('shared-history.txt', 'what it said at first');
    expect((await append(file.id, 'what it says now')).status).toBe(201);

    const older = await viewer.api.get(`/api/files/${file.id}/download?version=1`);
    expect(older.status).toBe(200);
    expect(await older.text()).toBe('what it said at first');

    const current = await viewer.api.get(`/api/files/${file.id}/download`);
    expect(await current.text()).toBe('what it says now');
  });

  it('records a checksum on a plain upload', async () => {
    const file = await upload('checked.txt', 'bytes worth hashing');
    const versions = await history(file.id);
    expect(versions).toHaveLength(1);
    expect(versions[0].checksum).toMatch(/^[0-9a-f]{64}$/);
  });

  // What a pod running the release before file_version existed leaves behind:
  // bytes, mirror columns, no rows and no checksum.
  async function stripVersions(fileId: string) {
    await db.deleteFrom('file_version').where('file_version.file_id', '=', fileId).execute();
    await db.updateTable('file').set({ checksum: null }).where('file.id', '=', fileId).execute();
  }

  it('reads a file that predates the version table as its own version 1', async () => {
    const file = await upload('legacy.txt', 'written before the table existed');
    await stripVersions(file.id);

    const versions = await history(file.id);
    expect(versions).toHaveLength(1);
    expect(versions[0].version_number).toBe(1);
    expect(versions[0].is_current).toBe(true);
    expect(versions[0].checksum).toBeNull();

    const res = await owner.api.get(`/api/files/${file.id}/download?version=1`);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('written before the table existed');

    // Already the newest, so there is nothing to restore it over.
    const restore = await owner.api.post(`/api/files/${file.id}/versions/1/restore`);
    expect(restore.status).toBe(200);
    expect((await restore.json()).created).toBe(false);
  });

  // Without the adoption the append overwrites the only reference to the
  // original object and it is orphaned in storage.
  it('adopts the mirror as version 1 when a file predates the version table', async () => {
    const file = await upload('inherited.txt', 'the original bytes');
    const [original] = await versionKeys(file.id);
    await stripVersions(file.id);

    const res = await append(file.id, 'bytes appended afterwards');
    expect(res.status).toBe(201);
    expect((await res.json()).version.version_number).toBe(2);

    const keys = await versionKeys(file.id);
    expect(keys.map((k) => k.version_number)).toEqual([1, 2]);
    expect(keys[0].storage_key).toBe(original.storage_key);

    const first = await owner.api.get(`/api/files/${file.id}/download?version=1`);
    expect(await first.text()).toBe('the original bytes');
  });

  // A failed mutation never reaches its post-commit hooks, so the reclaim has
  // to happen on the failure path itself.
  it('leaves nothing in storage when a duplicate name is refused', async () => {
    await upload('taken.txt', 'the first one');

    const before = await storedObjectNames();
    const res = await owner.api.postBytes(
      `/api/files/upload?project_id=${projectId}&filename=taken.txt`,
      'the second one' as unknown as BodyInit
    );
    expect(res.status).toBe(409);

    const after = await storedObjectNames();
    expect([...after].filter((name) => !before.has(name))).toEqual([]);
  });
});
