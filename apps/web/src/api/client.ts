import createClient, { type Middleware } from 'openapi-fetch';
import type { paths } from '@three-peaks/shared/api';

// Same origin, always. Vite proxies /api to the API in development and the load
// balancer routes it in production, so there is no base URL to configure and no
// environment variable that could point a build at the wrong server.
export const api = createClient<paths>({ baseUrl: '' });

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly body?: unknown
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

interface AuthHooks {
  getToken(): string | null;
  onUnauthorized(): void;
}

// Injected by the session store rather than imported, because the store imports
// this module and a direct import would be a cycle.
let authHooks: AuthHooks | null = null;

export function setAuthHooks(hooks: AuthHooks): void {
  authHooks = hooks;
}

// Routes where a 401 is an answer rather than a dead session: both check a
// password the caller just typed, and getting it wrong must not sign them out.
const SESSION_SAFE_401 = new Set(['POST /api/auth/change-password']);

const bearerAuth: Middleware = {
  onRequest({ request }) {
    const token = authHooks?.getToken();
    if (token) request.headers.set('Authorization', `Bearer ${token}`);
    return request;
  },
  onResponse({ request, response }) {
    if (
      response.status === 401 &&
      request.headers.has('Authorization') &&
      !SESSION_SAFE_401.has(`${request.method} ${new URL(request.url).pathname}`)
    ) {
      authHooks?.onUnauthorized();
    }
    return response;
  },
};

api.use(bearerAuth);

interface ApiResult<T> {
  data?: T;
  error?: unknown;
  response: Response;
}

function errorMessage(error: unknown, response: Response): string {
  if (error && typeof error === 'object') {
    const body = error as { error?: unknown; details?: { path: string; message: string }[] };
    if (Array.isArray(body.details) && body.details.length > 0) {
      return `Validation failed: ${body.details
        .map((detail) => (detail.path ? `${detail.path}: ${detail.message}` : detail.message))
        .join(', ')}`;
    }
    if (typeof body.error === 'string') return body.error;
  }
  return `Request failed with status ${response.status}`;
}

export function assertOk<T>(result: ApiResult<T>): T {
  if (result.response.ok) return result.data as T;
  throw new ApiError(
    result.response.status,
    errorMessage(result.error, result.response),
    result.error
  );
}

export function apiMessage(
  error: unknown,
  fallback = 'Could not reach the server. Check your connection and try again.'
): string {
  return error instanceof ApiError ? error.message : fallback;
}
