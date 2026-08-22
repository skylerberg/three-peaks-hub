import { fetchMock, jsonResponse } from './api/testUtils.ts';
import { render } from '@testing-library/svelte';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import App from './App.svelte';
import { projects } from './lib/projects.svelte.ts';
import { toasts } from './lib/toasts.svelte.ts';

// jsdom opens this one for real, and the reconnect backoff behind it then
// outlives the test that opened it.
class InertSocket {
  static readonly OPEN = 1;
  readyState = 0;
  close(): void {}
  send(): void {}
}
vi.stubGlobal('WebSocket', InertSocket);

const USER = { id: 'u1', email: 'a@example.com', name: 'A', email_verified: true };

interface Call {
  path: string;
  authorized: boolean;
}

function record(respond: (path: string) => Response): Call[] {
  const calls: Call[] = [];
  fetchMock.mockImplementation(async (input) => {
    const request = input as Request;
    const path = new URL(request.url).pathname;
    calls.push({ path, authorized: request.headers.has('authorization') });
    return respond(path);
  });
  return calls;
}

async function settle(): Promise<void> {
  for (let tick = 0; tick < 20; tick += 1) await new Promise((resolve) => setTimeout(resolve, 0));
}

describe('the first page load', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    projects.reset();
    toasts.clear();
    history.replaceState({}, '', '/');
    fetchMock.mockReset();
  });

  // The bug this exists for: init() cleared the stored token a microtask before
  // the guard redirected, and the projects screen mounted in between and asked
  // for the list with nothing to present. Two "No token provided" toasts landed
  // on the login page the visitor was then looking at.
  it('does not fetch with a token the session has just cleared', async () => {
    localStorage.setItem('tph.token', 'stale');
    localStorage.setItem('tph.user', JSON.stringify(USER));
    const calls = record((path) =>
      path === '/api/auth/me'
        ? jsonResponse(401, { error: 'Invalid or expired token' })
        : jsonResponse(401, { error: 'No token provided' })
    );

    render(App);
    await settle();

    expect(calls.map((call) => call.path)).toEqual(['/api/auth/me']);
    expect(toasts.toasts).toHaveLength(0);
    expect(location.pathname).toBe('/login');
  });

  it('sends a visitor with no token to login without fetching anything', async () => {
    const calls = record(() => jsonResponse(401, { error: 'No token provided' }));

    render(App);
    await settle();

    expect(calls).toEqual([]);
    expect(toasts.toasts).toHaveLength(0);
    expect(location.pathname).toBe('/login');
  });

  it('lets a signed-in visitor through, and every request carries the token', async () => {
    localStorage.setItem('tph.token', 'good');
    const calls = record((path) =>
      path === '/api/auth/me' ? jsonResponse(200, USER) : jsonResponse(200, { projects: [] })
    );

    render(App);
    await settle();

    expect(calls.map((call) => call.path)).toEqual(['/api/auth/me', '/api/projects']);
    expect(calls.every((call) => call.authorized)).toBe(true);
    expect(toasts.toasts).toHaveLength(0);
    expect(location.pathname).toBe('/');
  });
});
