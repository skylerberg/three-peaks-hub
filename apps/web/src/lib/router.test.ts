import { describe, expect, it } from 'vitest';
import { matchRoute } from './router.svelte.ts';

const UUID = '2f1c9e5a-8b3d-4f1e-9c2a-7d6b5e4f3a21';

describe('matchRoute', () => {
  it.each([
    ['/', 'projects'],
    ['/projects', 'projects'],
    ['/projects/', 'projects'],
    ['/account', 'account'],
    ['/login', 'login'],
    ['/signup', 'signup'],
    ['/forgot-password', 'forgot-password'],
    ['/nope', 'not-found'],
  ])('maps %s to %s', (path, name) => {
    expect(matchRoute(path).name).toBe(name);
  });

  it('reads the project id and the folder query', () => {
    const route = matchRoute(`/projects/${UUID}`, 'folder=abc');
    expect(route).toEqual({
      name: 'project',
      params: { projectId: UUID, folderId: 'abc' },
    });
  });

  it('treats an empty folder query as the project root', () => {
    expect(matchRoute(`/projects/${UUID}`, 'folder=')).toMatchObject({
      params: { folderId: null },
    });
  });

  it('does not match a project path whose id is not a uuid', () => {
    expect(matchRoute('/projects/not-a-uuid').name).toBe('not-found');
  });

  it('matches the members page', () => {
    expect(matchRoute(`/projects/${UUID}/members`)).toEqual({
      name: 'members',
      params: { projectId: UUID },
    });
  });

  it('matches the deleted view', () => {
    expect(matchRoute(`/projects/${UUID}/deleted`)).toEqual({
      name: 'deleted',
      params: { projectId: UUID },
    });
  });

  describe('the 3D studio', () => {
    const FILE = '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d';

    it('reads the project and the file id', () => {
      expect(matchRoute(`/projects/${UUID}/files/${FILE}/3d`)).toEqual({
        name: 'model',
        params: { projectId: UUID, fileId: FILE },
      });
    });

    it('does not match when either id is not a uuid', () => {
      expect(matchRoute(`/projects/${UUID}/files/nope/3d`).name).toBe('not-found');
      expect(matchRoute(`/projects/nope/files/${FILE}/3d`).name).toBe('not-found');
    });

    // The project route is a prefix of this one, and it is declared first.
    it('does not fall through to the project screen', () => {
      expect(matchRoute(`/projects/${UUID}/files/${FILE}/3d`).name).not.toBe('project');
    });
  });

  describe('the version history screen', () => {
    const FILE = '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d';

    it('reads the project and the file id', () => {
      expect(matchRoute(`/projects/${UUID}/files/${FILE}/versions`)).toEqual({
        name: 'versions',
        params: { projectId: UUID, fileId: FILE },
      });
    });

    it('does not match when either id is not a uuid', () => {
      expect(matchRoute(`/projects/${UUID}/files/nope/versions`).name).toBe('not-found');
      expect(matchRoute(`/projects/nope/files/${FILE}/versions`).name).toBe('not-found');
    });
  });

  // The server builds every mailed link from these paths (see the API's
  // services/webLinks.ts). Pinning them here is what keeps a route rename from
  // quietly turning already-sent mail into a not-found page.
  describe('paths the server mails links to', () => {
    it('routes the password reset link, carrying its token', () => {
      const route = matchRoute('/reset-password', 'token=abc.def');
      expect(route).toEqual({ name: 'reset-password', params: { token: 'abc.def' } });
    });

    it('routes a reset link with no token to the same screen', () => {
      // The screen tells the visitor the link is broken; a not-found page would
      // not.
      expect(matchRoute('/reset-password').name).toBe('reset-password');
    });
  });
});
