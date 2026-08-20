import { api, apiMessage, assertOk, setAuthHooks } from '../api/client.ts';
import type { Route } from './router.svelte.ts';

interface SessionUser {
  id: string;
  email: string;
  name: string;
  email_verified: boolean;
}

// Four states, and the third is the one that matters. `offline` is a signed-in
// session whose token could not be *checked* because the server was
// unreachable. Collapsing it into `anon` is what makes launching without a
// network land on the login screen with every store reset.
export type SessionStatus = 'unknown' | 'authed' | 'offline' | 'anon';

export function isSignedIn(status: SessionStatus): boolean {
  return status === 'authed' || status === 'offline';
}

const TOKEN_KEY = 'tph.token';
const USER_KEY = 'tph.user';
const INTENDED_PATH_KEY = 'tph.intendedPath';

// Signed-out only: a signed-in visitor is bounced to the app.
const PUBLIC_ROUTES = new Set<Route['name']>([
  'login',
  'signup',
  'forgot-password',
  'reset-password',
]);

// Reachable either way.
const AUTH_OPTIONAL_ROUTES = new Set<Route['name']>(['not-found']);

function readStoredUser(): SessionUser | null {
  try {
    const raw = localStorage.getItem(USER_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<SessionUser>;
    // Checked rather than trusted: this is the one path that produces a user
    // without the server having said so.
    if (typeof parsed.id !== 'string' || typeof parsed.email !== 'string') return null;
    return {
      id: parsed.id,
      email: parsed.email,
      name: typeof parsed.name === 'string' ? parsed.name : parsed.email,
      email_verified: parsed.email_verified === true,
    };
  } catch {
    return null;
  }
}

class SessionStore {
  status = $state<SessionStatus>('unknown');
  user = $state<SessionUser | null>(null);
  #token: string | null = null;

  constructor() {
    setAuthHooks({
      getToken: () => this.#token,
      onUnauthorized: () => this.#clear(),
    });
  }

  // Read-only, and only for the realtime socket: a WebSocket cannot carry an
  // Authorization header, so the credential has to travel in the handshake
  // frame. Nothing else should reach for this.
  get token(): string | null {
    return this.#token;
  }

  async init(): Promise<void> {
    this.#token = localStorage.getItem(TOKEN_KEY);
    if (!this.#token) {
      this.#clear();
      return;
    }

    try {
      const me = assertOk(await api.GET('/api/auth/me'));
      this.#adopt(this.#token, me as SessionUser);
    } catch (error) {
      if (error instanceof Error && error.name === 'ApiError' && 'status' in error) {
        const status = (error as { status: number }).status;
        if (status === 401) {
          this.#clear();
          return;
        }
      }
      // Unreachable, not rejected. Keep the stored user and say so.
      const stored = readStoredUser();
      if (stored) {
        this.user = stored;
        this.status = 'offline';
      } else {
        this.#clear();
      }
    }
  }

  async login(email: string, password: string): Promise<void> {
    const result = assertOk(await api.POST('/api/auth/login', { body: { email, password } })) as {
      token: string;
      user: SessionUser;
    };
    this.#adopt(result.token, result.user);
  }

  async signup(email: string, password: string, name: string): Promise<void> {
    const result = assertOk(
      await api.POST('/api/auth/signup', { body: { email, password, name } })
    ) as { token: string; user: SessionUser };
    this.#adopt(result.token, result.user);
  }

  async logout(): Promise<void> {
    try {
      await api.POST('/api/auth/logout');
    } catch {
      // The local session goes either way: a network failure must not leave
      // someone apparently signed in on a shared machine.
    }
    this.#clear();
  }

  #adopt(token: string, user: SessionUser): void {
    this.#token = token;
    this.user = user;
    this.status = 'authed';
    localStorage.setItem(TOKEN_KEY, token);
    localStorage.setItem(USER_KEY, JSON.stringify(user));
  }

  #clear(): void {
    this.#token = null;
    this.user = null;
    this.status = 'anon';
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
  }

  rememberIntendedPath(path: string): void {
    sessionStorage.setItem(INTENDED_PATH_KEY, path);
  }

  consumeIntendedPath(): string {
    const path = sessionStorage.getItem(INTENDED_PATH_KEY);
    sessionStorage.removeItem(INTENDED_PATH_KEY);
    return path ?? '/';
  }

  guardRoute = (to: Route, path: string): string | undefined => {
    if (AUTH_OPTIONAL_ROUTES.has(to.name)) return undefined;
    const isPublic = PUBLIC_ROUTES.has(to.name);

    if (isSignedIn(this.status) && isPublic) return '/';
    if (this.status === 'anon' && !isPublic) {
      this.rememberIntendedPath(path);
      return '/login';
    }
    return undefined;
  };
}

export const session = new SessionStore();
export { apiMessage };
