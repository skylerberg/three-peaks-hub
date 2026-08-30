import type { paths } from '@three-peaks/shared/api';
import createClient from 'openapi-fetch';

// Absolute, unlike the web app's client. That one is same-origin because Vite
// proxies /api in development and the load balancer routes it in production;
// this one runs inside Canva's iframe, so every request is cross-origin and the
// host has to be named. `canva apps build` substitutes it from
// CANVA_BACKEND_HOST, which is why it is a bare global rather than an import.
export const api = createClient<paths>({ baseUrl: BACKEND_HOST });

class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

interface ErrorBody {
  error?: string;
}

// The session the exchange handed us. Held in memory only: it outlives nothing,
// because getCanvaUserToken can mint a fresh Canva token whenever this is gone
// and the exchange will hand back another. Storing it would be keeping a
// credential for no reason anybody could name.
let token: string | null = null;

export function setToken(next: string | null): void {
  token = next;
}

// A middleware rather than a header passed at each call site, so a request
// added later cannot forget it. The exchange itself carries no token and needs
// none -- it authenticates with Canva's.
api.use({
  onRequest({ request }) {
    if (token !== null) request.headers.set('Authorization', `Bearer ${token}`);
    return request;
  },
});

export function apiMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Something went wrong';
}

// openapi-fetch answers with { data } or { error }, and every call site here
// wants the first or a throw.
export function assertOk<T>(result: { data?: T; error?: unknown; response: Response }): T {
  if (result.data !== undefined) return result.data;
  const body = result.error as ErrorBody | undefined;
  throw new ApiError(
    result.response.status,
    body?.error ?? `Request failed with ${result.response.status}`
  );
}
