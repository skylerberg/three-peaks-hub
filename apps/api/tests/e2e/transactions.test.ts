import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createUser, deleteUser, type TestUser } from '../setup/testContext.ts';

// These are end-to-end checks that a refused request leaves nothing behind.
// They are NOT a test of the rollback itself: every handler in this API
// validates before it writes, so on these paths there is no partial write to
// roll back. The middleware's rethrow is covered directly, on a handler built
// to write and then fail, in tests/unit/transactionMiddleware.test.ts -- a
// mutation guard reported this file as unable to see it.
describe('a refused mutation leaves nothing behind', () => {
  let owner: TestUser;
  let projectId: string;

  beforeAll(async () => {
    owner = await createUser('tx');
    projectId = (await (await owner.api.post('/api/projects', { name: 'Tx' })).json()).id;
  });

  afterAll(async () => {
    await deleteUser(owner);
  });

  it('writes nothing when a later step in the same request fails', async () => {
    const before = await (
      await owner.api.get(`/api/files/directory?project_id=${projectId}`)
    ).json();

    // The parent lookup 404s before any insert, so what this pins is the
    // ordering: validation happens first and no folder is created on the way to
    // the refusal.
    const res = await owner.api.post('/api/files/folders', {
      project_id: projectId,
      parent_id: '00000000-0000-4000-8000-000000000000',
      name: 'Orphan',
    });
    expect(res.status).toBe(404);

    const after = await (
      await owner.api.get(`/api/files/directory?project_id=${projectId}`)
    ).json();
    expect(after.folders).toHaveLength(before.folders.length);
    expect(after.folders.map((f: { name: string }) => f.name)).not.toContain('Orphan');
  });

  it('rolls back a duplicate-name folder without leaving the first attempt', async () => {
    await owner.api.post('/api/files/folders', { project_id: projectId, name: 'Once' });
    const again = await owner.api.post('/api/files/folders', {
      project_id: projectId,
      name: 'Once',
    });
    expect(again.status).toBe(409);

    const listing = await (
      await owner.api.get(`/api/files/directory?project_id=${projectId}`)
    ).json();
    expect(listing.folders.filter((f: { name: string }) => f.name === 'Once')).toHaveLength(1);
  });
});
