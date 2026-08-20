import '../api/testUtils.ts';
import { describe, expect, it } from 'vitest';
import { matchRoute } from './router.svelte.ts';
import { session } from './session.svelte.ts';

// Drives the real guard against the real store, rather than reimplementing the
// route sets in the test.
function guard(status: 'anon' | 'authed', path: string) {
  session.status = status;
  const [pathname, search = ''] = path.split('?');
  return session.guardRoute(matchRoute(pathname, search), path);
}

const PROJECT = '/projects/2f1c9e5a-8b3d-4f1e-9c2a-7d6b5e4f3a21';

describe('session.guardRoute', () => {
  it('sends a signed-out visitor to login and remembers where they meant to go', () => {
    expect(guard('anon', PROJECT)).toBe('/login');
    expect(session.consumeIntendedPath()).toBe(PROJECT);
  });

  // not-found is deliberately auth-optional: an unknown URL should say so
  // rather than bouncing to a sign-in page that will then not know where to
  // send anyone afterwards.
  it('leaves a signed-out visitor on an unknown path', () => {
    expect(guard('anon', '/nonsense')).toBeUndefined();
  });

  it('consumes the intended path only once', () => {
    guard('anon', '/account');
    expect(session.consumeIntendedPath()).toBe('/account');
    expect(session.consumeIntendedPath()).toBe('/');
  });

  it.each([['/login'], ['/signup'], ['/forgot-password'], ['/reset-password']])(
    'leaves a signed-out visitor on %s',
    (path) => {
      expect(guard('anon', path)).toBeUndefined();
    }
  );

  it('bounces a signed-in visitor away from the sign-in pages', () => {
    expect(guard('authed', '/login')).toBe('/');
    expect(guard('authed', '/signup')).toBe('/');
  });

  it('leaves a signed-in visitor on the app', () => {
    expect(guard('authed', '/projects')).toBeUndefined();
    expect(guard('authed', '/account')).toBeUndefined();
  });
});
