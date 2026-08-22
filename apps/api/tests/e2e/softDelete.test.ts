import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DEFAULT_CARD_SETTINGS } from '@three-peaks/shared';
import { db } from '../../src/db/index.ts';
import { storage } from '../../src/services/storage/index.ts';
import { newId } from '../../src/utils/uuid.ts';
import { createUser, deleteUser, type TestUser } from '../setup/testContext.ts';

const PNG = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
]);

interface DeletedEntry {
  kind: 'file' | 'folder';
  id: string;
  project_id: string;
  name: string;
  path: string;
  content_type: string | null;
  byte_size: number | null;
  deleted_at: string;
  deleted_by: string | null;
  blocked_by: string | null;
}

describe('soft delete', () => {
  let owner: TestUser;
  let viewer: TestUser;
  let stranger: TestUser;
  let projectId: string;

  beforeAll(async () => {
    [owner, viewer, stranger] = await Promise.all([
      createUser('trash-owner'),
      createUser('trash-viewer'),
      createUser('trash-stranger'),
    ]);

    projectId = (await (await owner.api.post('/api/projects', { name: 'Trash' })).json()).id;
    await owner.api.put(`/api/projects/${projectId}/members`, {
      email: viewer.email,
      role: 'viewer',
    });
  });

  afterAll(async () => {
    for (const user of [owner, viewer, stranger]) await deleteUser(user);
  });

  function sendUpload(
    filename: string,
    body: Buffer | string,
    folderId?: string,
    project?: string
  ) {
    const query = new URLSearchParams({ project_id: project ?? projectId, filename });
    if (folderId) query.set('folder_id', folderId);
    return owner.api.postBytes(`/api/files/upload?${query}`, body as unknown as BodyInit);
  }

  async function upload(filename: string, body: Buffer | string, folderId?: string) {
    const res = await sendUpload(filename, body, folderId);
    expect(res.status).toBe(201);
    return (await res.json()) as { id: string; filename: string };
  }

  async function folder(name: string, parentId?: string) {
    const res = await owner.api.post('/api/files/folders', {
      project_id: projectId,
      name,
      ...(parentId ? { parent_id: parentId } : {}),
    });
    expect(res.status).toBe(201);
    return (await res.json()) as { id: string; name: string };
  }

  function append(fileId: string, body: Buffer | string) {
    return owner.api.postBytes(`/api/files/${fileId}/versions`, body as unknown as BodyInit);
  }

  function versionKeys(fileId: string) {
    return db
      .selectFrom('file_version')
      .select(['file_version.storage_key as storage_key'])
      .where('file_version.file_id', '=', fileId)
      .execute();
  }

  async function directory(folderId?: string) {
    const query = new URLSearchParams({ project_id: projectId });
    if (folderId) query.set('folder_id', folderId);
    return owner.api.get(`/api/files/directory?${query}`);
  }

  async function listing(folderId?: string) {
    const res = await directory(folderId);
    expect(res.status).toBe(200);
    return (await res.json()) as {
      folders: { id: string }[];
      files: { id: string }[];
      storage_used_bytes: number;
    };
  }

  async function deletedEntries(
    user: TestUser = owner,
    project: string = projectId
  ): Promise<DeletedEntry[]> {
    const res = await user.api.get(`/api/files/deleted?project_id=${project}`);
    expect(res.status).toBe(200);
    return (await res.json()).entries;
  }

  it('keeps every version and every stored object when a file is deleted', async () => {
    const file = await upload('kept.txt', 'the first cut');
    expect((await append(file.id, 'the second cut, revised')).status).toBe(201);

    const keys = await versionKeys(file.id);
    expect(keys).toHaveLength(2);

    expect((await owner.api.delete(`/api/files/${file.id}`)).status).toBe(204);

    for (const key of keys) {
      expect(await storage().get(key.storage_key)).not.toBeNull();
    }
    const versions = await (await owner.api.get(`/api/files/${file.id}/versions`)).json();
    expect(versions.versions.map((v: { version_number: number }) => v.version_number)).toEqual([
      2, 1,
    ]);
  });

  it('hides a soft-deleted file from the directory listing', async () => {
    const file = await upload('hidden.txt', 'briefly visible');
    expect((await listing()).files.map((f) => f.id)).toContain(file.id);

    expect((await owner.api.delete(`/api/files/${file.id}`)).status).toBe(204);

    expect((await listing()).files.map((f) => f.id)).not.toContain(file.id);
  });

  it('hides a soft-deleted folder, and its whole subtree with it', async () => {
    const outer = await folder('Hidden Outer');
    const inner = await folder('Hidden Inner', outer.id);
    const file = await upload('deep.txt', 'still here', inner.id);

    expect((await listing()).folders.map((f) => f.id)).toContain(outer.id);

    expect((await owner.api.delete(`/api/files/folders/${outer.id}`)).status).toBe(204);

    expect((await listing()).folders.map((f) => f.id)).not.toContain(outer.id);
    expect((await directory(outer.id)).status).toBe(404);
    // The rule is the ancestor chain, not one column: this folder was never
    // deleted itself and must still be unreachable.
    expect((await directory(inner.id)).status).toBe(404);

    // Nothing inside was marked, which is what makes the restore exact.
    const row = await (await owner.api.get(`/api/files/${file.id}`)).json();
    expect(row.deleted_at).toBeNull();
  });

  it('still serves the bytes and the history of a deleted file', async () => {
    const file = await upload('served.txt', 'what it said at first');
    expect((await append(file.id, 'what it says now')).status).toBe(201);
    expect((await owner.api.delete(`/api/files/${file.id}`)).status).toBe(204);

    const current = await owner.api.get(`/api/files/${file.id}/download`);
    expect(current.status).toBe(200);
    expect(await current.text()).toBe('what it says now');

    const older = await owner.api.get(`/api/files/${file.id}/download?version=1`);
    expect(await older.text()).toBe('what it said at first');

    const versions = await owner.api.get(`/api/files/${file.id}/versions`);
    expect(versions.status).toBe(200);
    expect((await versions.json()).versions).toHaveLength(2);

    // The row carries the fact, so a screen holding it can say so.
    expect((await (await owner.api.get(`/api/files/${file.id}`)).json()).deleted_at).not.toBeNull();
  });

  it('refuses a new version for a deleted file', async () => {
    const file = await upload('frozen.txt', 'the only cut');
    expect((await append(file.id, 'a second cut, longer')).status).toBe(201);
    expect((await owner.api.delete(`/api/files/${file.id}`)).status).toBe(204);

    expect((await append(file.id, 'a third cut, longer again')).status).toBe(409);
    expect((await owner.api.post(`/api/files/${file.id}/versions/1/restore`)).status).toBe(409);
  });

  it("lets a new file take a deleted file's name", async () => {
    const box = await folder('Reused Box');
    const first = await upload('reused.txt', 'the first one');
    const nested = await upload('reused-nested.txt', 'the first one, nested', box.id);

    expect((await owner.api.delete(`/api/files/${first.id}`)).status).toBe(204);
    expect((await owner.api.delete(`/api/files/${nested.id}`)).status).toBe(204);
    expect((await owner.api.delete(`/api/files/folders/${box.id}`)).status).toBe(204);

    const second = await upload('reused.txt', 'the second one');
    expect(second.id).not.toBe(first.id);

    const boxAgain = await folder('Reused Box');
    expect(boxAgain.id).not.toBe(box.id);
    await upload('reused-nested.txt', 'the second one, nested', boxAgain.id);
  });

  it('refuses to restore into a name that has been taken, and restores under another', async () => {
    const original = await upload('contested.txt', 'the original');
    expect((await owner.api.delete(`/api/files/${original.id}`)).status).toBe(204);
    await upload('contested.txt', 'the replacement');

    const refused = await owner.api.post(`/api/files/${original.id}/restore`);
    expect(refused.status).toBe(409);
    // How it opens is what the web reads to tell this refusal from the one a
    // deleted folder gives, and only this one is worth offering a rename for.
    expect((await refused.json()).error).toMatch(/^A file named "contested\.txt"/);

    const restored = await owner.api.post(
      `/api/files/${original.id}/restore?filename=contested-old.txt`
    );
    expect(restored.status).toBe(200);
    const body = await restored.json();
    expect(body.filename).toBe('contested-old.txt');
    expect(body.deleted_at).toBeNull();
    expect((await listing()).files.map((f) => f.id)).toContain(original.id);
  });

  it('refuses to restore a file whose folder is deleted, naming the folder', async () => {
    const box = await folder('In The Way');
    const file = await upload('blocked.txt', 'waiting');

    expect((await owner.api.patch(`/api/files/${file.id}`, { folder_id: box.id })).status).toBe(
      200
    );
    expect((await owner.api.delete(`/api/files/${file.id}`)).status).toBe(204);
    expect((await owner.api.delete(`/api/files/folders/${box.id}`)).status).toBe(204);

    const refused = await owner.api.post(`/api/files/${file.id}/restore`);
    expect(refused.status).toBe(409);
    expect((await refused.json()).error).toContain('In The Way');

    expect((await owner.api.post(`/api/files/folders/${box.id}/restore`)).status).toBe(200);
    expect((await owner.api.post(`/api/files/${file.id}/restore`)).status).toBe(200);
    expect((await listing(box.id)).files.map((f) => f.id)).toContain(file.id);
  });

  it('restores a folder without resurrecting what was deleted inside it', async () => {
    const box = await folder('Survivor');
    const kept = await upload('kept-inside.txt', 'stays', box.id);
    const gone = await upload('gone-inside.txt', 'goes', box.id);

    expect((await owner.api.delete(`/api/files/${gone.id}`)).status).toBe(204);
    expect((await owner.api.delete(`/api/files/folders/${box.id}`)).status).toBe(204);
    expect((await owner.api.post(`/api/files/folders/${box.id}/restore`)).status).toBe(200);

    const inside = (await listing(box.id)).files.map((f) => f.id);
    expect(inside).toContain(kept.id);
    expect(inside).not.toContain(gone.id);
  });

  it('counts a tombstone against the quota and reclaims it only on a purge', async () => {
    const own = (await (await owner.api.post('/api/projects', { name: 'Metered Trash' })).json())
      .id;
    const created = await sendUpload('meter.bin', 'a'.repeat(10), undefined, own);
    expect(created.status).toBe(201);
    const fileId = (await created.json()).id;
    expect(
      (await owner.api.postBytes(`/api/files/${fileId}/versions`, 'b'.repeat(20))).status
    ).toBe(201);

    async function used() {
      const res = await owner.api.get(`/api/files/directory?project_id=${own}`);
      return (await res.json()).storage_used_bytes;
    }

    expect(await used()).toBe(30);

    expect((await owner.api.delete(`/api/files/${fileId}`)).status).toBe(204);
    // Still stored, so still paid for.
    expect(await used()).toBe(30);

    expect((await owner.api.delete(`/api/files/${fileId}?purge=true`)).status).toBe(204);
    expect(await used()).toBe(0);
  });

  it('purging a folder reclaims the objects of a tombstone inside it', async () => {
    const box = await folder('Reclaimed');
    const doomed = await upload('doomed-inside.txt', 'one of them', box.id);
    expect((await append(doomed.id, 'two of them now')).status).toBe(201);

    // A deleted folder in the middle of the subtree. The cascade takes what is
    // under it either way, so a walk that stops here leaves those objects in
    // the bucket with nothing left naming them.
    const buried = await folder('Reclaimed Inner', box.id);
    const hidden = await upload('hidden-inside.txt', 'the first cut', buried.id);
    expect((await append(hidden.id, 'the second cut, revised')).status).toBe(201);
    expect((await owner.api.delete(`/api/files/folders/${buried.id}`)).status).toBe(204);

    const keys = [...(await versionKeys(doomed.id)), ...(await versionKeys(hidden.id))];
    expect(keys).toHaveLength(4);

    expect((await owner.api.delete(`/api/files/${doomed.id}`)).status).toBe(204);
    expect((await owner.api.delete(`/api/files/folders/${box.id}?purge=true`)).status).toBe(204);

    for (const key of keys) {
      expect(await storage().get(key.storage_key)).toBeNull();
    }
  });

  it("reports every version's bytes as what purging an entry reclaims", async () => {
    const own = (await (await owner.api.post('/api/projects', { name: 'Sized Trash' })).json()).id;
    const created = await sendUpload('sized.bin', 'a'.repeat(10), undefined, own);
    expect(created.status).toBe(201);
    const fileId = (await created.json()).id;
    expect((await append(fileId, 'b'.repeat(25))).status).toBe(201);
    expect((await owner.api.delete(`/api/files/${fileId}`)).status).toBe(204);

    const entry = (await deletedEntries(owner, own)).find((e) => e.id === fileId);
    // Not the 25 bytes of the current version: the number is the one the screen
    // offers as the space a purge gives back, which is the quota's own total.
    expect(entry?.byte_size).toBe(35);
    const directoryRes = await owner.api.get(`/api/files/directory?project_id=${own}`);
    expect((await directoryRes.json()).storage_used_bytes).toBe(entry?.byte_size);
  });

  it('lists what was deleted with the path it came from', async () => {
    const art = await folder('Listed Art');
    const cards = await folder('Listed Cards', art.id);
    const nested = await upload('listed.png', PNG, cards.id);
    const root = await upload('listed-root.txt', 'at the top');

    expect((await owner.api.delete(`/api/files/${nested.id}`)).status).toBe(204);
    expect((await owner.api.delete(`/api/files/${root.id}`)).status).toBe(204);
    expect((await owner.api.delete(`/api/files/folders/${cards.id}`)).status).toBe(204);

    const entries = await deletedEntries();

    const nestedEntry = entries.find((e) => e.id === nested.id);
    expect(nestedEntry?.kind).toBe('file');
    expect(nestedEntry?.name).toBe('listed.png');
    expect(nestedEntry?.path).toBe('Listed Art/Listed Cards');
    expect(nestedEntry?.content_type).toBe('image/png');
    expect(nestedEntry?.byte_size).toBe(PNG.length);
    expect(nestedEntry?.deleted_by).toBe(owner.id);

    const rootEntry = entries.find((e) => e.id === root.id);
    expect(rootEntry?.path).toBe('');

    const folderEntry = entries.find((e) => e.id === cards.id);
    expect(folderEntry?.kind).toBe('folder');
    expect(folderEntry?.name).toBe('Listed Cards');
    // Its own parent, never itself.
    expect(folderEntry?.path).toBe('Listed Art');
    expect(folderEntry?.byte_size).toBeNull();
    expect(folderEntry?.blocked_by).toBeNull();

    // A folder's tombstone does not drag its contents into the listing.
    expect(entries.some((e) => e.id === art.id)).toBe(false);
  });

  it('marks an entry that cannot be restored yet, naming the folder in the way', async () => {
    const box = await folder('Standing In The Way');
    const file = await upload('waiting.txt', 'until the folder comes back', box.id);

    expect((await owner.api.delete(`/api/files/${file.id}`)).status).toBe(204);
    expect((await owner.api.delete(`/api/files/folders/${box.id}`)).status).toBe(204);

    const entries = await deletedEntries();
    expect(entries.find((e) => e.id === file.id)?.blocked_by).toBe('Standing In The Way');
    // The folder itself is not what blocks its own restore.
    expect(entries.find((e) => e.id === box.id)?.blocked_by).toBeNull();
  });

  it('refuses a viewer every mutation and allows the read', async () => {
    const file = await upload('viewer-eyes.txt', 'owner bytes');
    const box = await folder('Viewer Box');

    expect((await viewer.api.delete(`/api/files/${file.id}`)).status).toBe(403);
    expect((await viewer.api.delete(`/api/files/folders/${box.id}`)).status).toBe(403);

    expect((await owner.api.delete(`/api/files/${file.id}`)).status).toBe(204);
    expect((await owner.api.delete(`/api/files/folders/${box.id}`)).status).toBe(204);

    expect((await viewer.api.post(`/api/files/${file.id}/restore`)).status).toBe(403);
    expect((await viewer.api.post(`/api/files/folders/${box.id}/restore`)).status).toBe(403);
    expect((await viewer.api.delete(`/api/files/${file.id}?purge=true`)).status).toBe(403);

    // Seeing what was deleted is a read, and a viewer may do it.
    const entries = await deletedEntries(viewer);
    expect(entries.map((e) => e.id)).toContain(file.id);
  });

  it('answers 404 to a stranger', async () => {
    const file = await upload('not-yours.txt', 'private');
    const box = await folder('Not Yours');

    expect((await stranger.api.get(`/api/files/deleted?project_id=${projectId}`)).status).toBe(404);
    expect((await stranger.api.delete(`/api/files/${file.id}`)).status).toBe(404);
    expect((await stranger.api.delete(`/api/files/folders/${box.id}`)).status).toBe(404);
    expect((await stranger.api.post(`/api/files/${file.id}/restore`)).status).toBe(404);
    expect((await stranger.api.post(`/api/files/folders/${box.id}/restore`)).status).toBe(404);
  });

  // /deleted and /:id are both GETs one segment deep, and the listing is the
  // one that stops working if the parameter route wins.
  it('still routes the deleted listing rather than reading a file called deleted', async () => {
    const res = await owner.api.get(`/api/files/deleted?project_id=${projectId}`);
    expect(res.status).toBe(200);
    expect(await res.json()).toHaveProperty('entries');
  });

  it('keeps the 3D settings across a delete and a restore, and drops them on a purge', async () => {
    const file = await upload('dialled-in.png', PNG);
    expect(
      (await owner.api.put(`/api/models/${file.id}`, { settings: DEFAULT_CARD_SETTINGS })).status
    ).toBe(200);

    expect((await owner.api.delete(`/api/files/${file.id}`)).status).toBe(204);
    const whileDeleted = await owner.api.get(`/api/models/${file.id}`);
    expect(whileDeleted.status).toBe(200);
    expect((await whileDeleted.json()).settings).toEqual(DEFAULT_CARD_SETTINGS);
    // Settings are not the file, so dialling one in is not the write a
    // tombstone refuses.
    expect(
      (await owner.api.put(`/api/models/${file.id}`, { settings: DEFAULT_CARD_SETTINGS })).status
    ).toBe(200);

    expect((await owner.api.post(`/api/files/${file.id}/restore`)).status).toBe(200);
    expect((await (await owner.api.get(`/api/models/${file.id}`)).json()).settings).toEqual(
      DEFAULT_CARD_SETTINGS
    );

    expect((await owner.api.delete(`/api/files/${file.id}?purge=true`)).status).toBe(204);
    expect((await owner.api.get(`/api/models/${file.id}`)).status).toBe(404);
  });

  it("a second delete leaves the first one's record intact", async () => {
    const file = await upload('twice.txt', 'deleted twice');
    const box = await folder('Twice Box');
    expect((await owner.api.delete(`/api/files/${file.id}`)).status).toBe(204);
    expect((await owner.api.delete(`/api/files/folders/${box.id}`)).status).toBe(204);

    // Backdated, so a second delete overwriting it would be unmistakable.
    const marker = new Date('2020-01-01T00:00:00.000Z');
    await db
      .updateTable('file')
      .set({ deleted_at: marker })
      .where('file.id', '=', file.id)
      .execute();
    await db
      .updateTable('folder')
      .set({ deleted_at: marker })
      .where('folder.id', '=', box.id)
      .execute();

    expect((await owner.api.delete(`/api/files/${file.id}`)).status).toBe(204);
    expect((await owner.api.delete(`/api/files/folders/${box.id}`)).status).toBe(204);

    const fileRow = await db
      .selectFrom('file')
      .select(['file.deleted_at as deleted_at'])
      .where('file.id', '=', file.id)
      .executeTakeFirstOrThrow();
    const folderRow = await db
      .selectFrom('folder')
      .select(['folder.deleted_at as deleted_at'])
      .where('folder.id', '=', box.id)
      .executeTakeFirstOrThrow();

    expect(fileRow.deleted_at).toEqual(marker);
    expect(folderRow.deleted_at).toEqual(marker);
  });

  it('refuses a rename or a move of a deleted file', async () => {
    const box = await folder('Move Target');
    const file = await upload('tombstone.txt', 'not to be renamed');
    expect((await owner.api.delete(`/api/files/${file.id}`)).status).toBe(204);

    expect(
      (await owner.api.patch(`/api/files/${file.id}`, { filename: 'renamed.txt' })).status
    ).toBe(409);
    expect((await owner.api.patch(`/api/files/${file.id}`, { folder_id: box.id })).status).toBe(
      409
    );

    const deletedBox = await folder('Tombstone Box');
    expect((await owner.api.delete(`/api/files/folders/${deletedBox.id}`)).status).toBe(204);
    expect(
      (await owner.api.patch(`/api/files/folders/${deletedBox.id}`, { name: 'Renamed Box' })).status
    ).toBe(409);
  });

  it('refuses an upload into a deleted folder', async () => {
    const outer = await folder('Upload Blocked');
    const inner = await folder('Upload Inner', outer.id);
    expect((await owner.api.delete(`/api/files/folders/${outer.id}`)).status).toBe(204);

    expect((await sendUpload('nope.txt', 'x', outer.id)).status).toBe(404);
    // The live folder inside the deleted one is the case a single-column check
    // would let through, and a row planted there no listing could ever show.
    expect((await sendUpload('nope-nested.txt', 'x', inner.id)).status).toBe(404);

    expect(
      (
        await owner.api.post('/api/files/folders', {
          project_id: projectId,
          parent_id: inner.id,
          name: 'Nope',
        })
      ).status
    ).toBe(404);

    const file = await upload('mover.txt', 'stays at the root');
    expect((await owner.api.patch(`/api/files/${file.id}`, { folder_id: inner.id })).status).toBe(
      404
    );
  });

  it('refuses to move a folder into a deleted subtree', async () => {
    const gone = await folder('Move Blocked');
    const live = await folder('Move Blocked Inner', gone.id);
    const moving = await folder('Moving');
    expect((await owner.api.delete(`/api/files/folders/${gone.id}`)).status).toBe(204);

    expect(
      (await owner.api.patch(`/api/files/folders/${moving.id}`, { parent_id: gone.id })).status
    ).toBe(404);
    // The live folder is the worse half: that move takes the whole of the
    // folder being moved out of sight without deleting any of it.
    expect(
      (await owner.api.patch(`/api/files/folders/${moving.id}`, { parent_id: live.id })).status
    ).toBe(404);

    expect((await listing()).folders.map((f) => f.id)).toContain(moving.id);
  });

  // Every ancestor walk stops at MAX_BREADCRUMB_DEPTH, and what it did not
  // reach is unknown rather than clean. Planted through db: no caller is going
  // to be talked into building 66 levels one request at a time.
  it('denies a folder chain too deep to walk, wherever the walk is read', async () => {
    const deep = (await (await owner.api.post('/api/projects', { name: 'Too Deep' })).json()).id;

    const ids = Array.from({ length: 66 }, () => newId());
    await db
      .insertInto('folder')
      .values(
        ids.map((id, index) => ({
          id,
          project_id: deep,
          parent_id: index === 0 ? null : ids[index - 1],
          name: `Level ${index + 1}`,
          created_by: owner.id,
        }))
      )
      .execute();
    const deepest = ids[ids.length - 1];

    const browsed = await owner.api.get(
      `/api/files/directory?project_id=${deep}&folder_id=${deepest}`
    );
    expect(browsed.status).toBe(404);
    expect((await sendUpload('too-deep.txt', 'x', deepest, deep)).status).toBe(404);

    // Deleted while its folder was still shallow and buried afterwards, which
    // is the only way to have something to restore down there at all.
    const created = await owner.api.post('/api/files/folders', { project_id: deep, name: 'Sunk' });
    expect(created.status).toBe(201);
    const sunk = (await created.json()).id;
    const uploaded = await sendUpload('sunk.txt', 'x', sunk, deep);
    expect(uploaded.status).toBe(201);
    const fileId = (await uploaded.json()).id;
    expect((await owner.api.delete(`/api/files/${fileId}`)).status).toBe(204);
    await db
      .updateTable('folder')
      .set({ parent_id: deepest })
      .where('folder.id', '=', sunk)
      .execute();

    const refused = await owner.api.post(`/api/files/${fileId}/restore`);
    expect(refused.status).toBe(409);
    expect((await refused.json()).error).toContain('too deep');
    expect((await deletedEntries(owner, deep)).find((e) => e.id === fileId)?.blocked_by).toBe(
      'a folder too deep to check'
    );
  });

  // The listing's queries are three snapshots, not one, so a purge can take a
  // folder out from under the walk. A parent outside the project stands in for
  // that: either way the chain leaves the set of rows being walked.
  it('names the deleted folder it did find when the chain runs out', async () => {
    const elsewhere = await folder('Elsewhere');
    const half = (await (await owner.api.post('/api/projects', { name: 'Half A Chain' })).json())
      .id;

    const outerRes = await owner.api.post('/api/files/folders', {
      project_id: half,
      name: 'Blocking Outer',
    });
    expect(outerRes.status).toBe(201);
    const outer = (await outerRes.json()).id;
    const innerRes = await owner.api.post('/api/files/folders', {
      project_id: half,
      parent_id: outer,
      name: 'Kept Inner',
    });
    expect(innerRes.status).toBe(201);
    const inner = (await innerRes.json()).id;

    const uploaded = await sendUpload('half-chained.txt', 'x', inner, half);
    expect(uploaded.status).toBe(201);
    const fileId = (await uploaded.json()).id;
    expect((await owner.api.delete(`/api/files/${fileId}`)).status).toBe(204);
    expect((await owner.api.delete(`/api/files/folders/${outer}`)).status).toBe(204);
    await db
      .updateTable('folder')
      .set({ parent_id: elsewhere.id })
      .where('folder.id', '=', outer)
      .execute();

    const entry = (await deletedEntries(owner, half)).find((e) => e.id === fileId);
    expect(entry?.blocked_by).toBe('Blocking Outer');
  });
});
