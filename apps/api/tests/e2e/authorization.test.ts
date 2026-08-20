import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createUser, deleteUser, type TestUser } from '../setup/testContext.ts';

// Exercises the visibility rule that src/services/authorization.ts states and
// implements. Every no-access case below asserts 404 specifically rather than
// "not 2xx", because the distinction is the whole point.
describe('project authorization', () => {
  let owner: TestUser;
  let editor: TestUser;
  let viewer: TestUser;
  let stranger: TestUser;
  let projectId: string;

  beforeAll(async () => {
    [owner, editor, viewer, stranger] = await Promise.all([
      createUser('owner'),
      createUser('editor'),
      createUser('viewer'),
      createUser('stranger'),
    ]);

    const created = await owner.api.post('/api/projects', { name: 'Deck Builder' });
    projectId = (await created.json()).id;

    await owner.api.put(`/api/projects/${projectId}/members`, {
      email: editor.email,
      role: 'editor',
    });
    await owner.api.put(`/api/projects/${projectId}/members`, {
      email: viewer.email,
      role: 'viewer',
    });
  });

  afterAll(async () => {
    for (const user of [owner, editor, viewer, stranger]) await deleteUser(user);
  });

  describe('a caller with no access', () => {
    it('sees 404, not 403, when reading', async () => {
      expect((await stranger.api.get(`/api/projects/${projectId}`)).status).toBe(404);
    });

    it('sees 404, not 403, when writing', async () => {
      const res = await stranger.api.patch(`/api/projects/${projectId}`, { name: 'Mine now' });
      expect(res.status).toBe(404);
    });

    it('sees 404 when listing the directory', async () => {
      const res = await stranger.api.get(`/api/files/directory?project_id=${projectId}`);
      expect(res.status).toBe(404);
    });

    it('does not see the project in their own list', async () => {
      const { projects } = await (await stranger.api.get('/api/projects')).json();
      expect(projects.map((p: { id: string }) => p.id)).not.toContain(projectId);
    });
  });

  describe('a viewer', () => {
    it('can read the project, and is told their role', async () => {
      const res = await viewer.api.get(`/api/projects/${projectId}`);
      expect(res.status).toBe(200);
      expect((await res.json()).role).toBe('viewer');
    });

    // 403 is correct here and only here: this caller can already read the row,
    // so refusing with 404 would be a lie they can disprove.
    it('is refused writes with 403', async () => {
      const res = await viewer.api.patch(`/api/projects/${projectId}`, { name: 'Renamed' });
      expect(res.status).toBe(403);
    });

    it('cannot create a folder', async () => {
      const res = await viewer.api.post('/api/files/folders', {
        project_id: projectId,
        name: 'Art',
      });
      expect(res.status).toBe(403);
    });

    it('cannot delete the project', async () => {
      expect((await viewer.api.delete(`/api/projects/${projectId}`)).status).toBe(403);
    });

    it('may remove themselves and nobody else', async () => {
      const other = await createUser('leaver');
      await owner.api.put(`/api/projects/${projectId}/members`, {
        email: other.email,
        role: 'viewer',
      });

      expect(
        (await viewer.api.delete(`/api/projects/${projectId}/members/${other.id}`)).status
      ).toBe(403);
      expect((await other.api.get(`/api/projects/${projectId}`)).status).toBe(200);

      expect(
        (await other.api.delete(`/api/projects/${projectId}/members/${other.id}`)).status
      ).toBe(204);
      expect((await other.api.get(`/api/projects/${projectId}`)).status).toBe(404);

      await deleteUser(other);
    });
  });

  describe('an editor', () => {
    it('can write but is not the owner', async () => {
      expect(
        (await editor.api.patch(`/api/projects/${projectId}`, { name: 'Deck Builder' })).status
      ).toBe(200);
      expect((await editor.api.delete(`/api/projects/${projectId}`)).status).toBe(403);
    });

    it('cannot change membership', async () => {
      const res = await editor.api.put(`/api/projects/${projectId}/members`, {
        email: stranger.email,
        role: 'editor',
      });
      expect(res.status).toBe(403);
    });
  });

  describe('the owner', () => {
    it('is an implicit editor with no member row', async () => {
      const { members } = await (await owner.api.get(`/api/projects/${projectId}/members`)).json();
      const self = members.find((m: { user_id: string }) => m.user_id === owner.id);
      expect(self).toMatchObject({ role: 'editor', is_creator: true });
    });

    it('cannot be added as a member of their own project', async () => {
      const res = await owner.api.put(`/api/projects/${projectId}/members`, {
        email: owner.email,
        role: 'viewer',
      });
      expect(res.status).toBe(409);
    });

    // Fail-closed normalization: anything that is not exactly 'editor' is a
    // viewer, so a role the schema does not know is a refusal, not an escape.
    it('cannot grant a role the schema does not define', async () => {
      const res = await owner.api.put(`/api/projects/${projectId}/members`, {
        email: stranger.email,
        role: 'admin',
      });
      expect(res.status).toBe(422);
      expect((await stranger.api.get(`/api/projects/${projectId}`)).status).toBe(404);
    });
  });

  it('answers 404 for a project id that does not exist at all', async () => {
    const res = await owner.api.get('/api/projects/00000000-0000-4000-8000-000000000000');
    expect(res.status).toBe(404);
  });
});
