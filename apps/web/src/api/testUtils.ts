import { vi } from 'vitest';

// openapi-fetch captures globalThis.fetch when createClient() runs at module
// init, so whoever installs a stub after that point is talking to nobody. This
// module is imported first from vitest-setup.ts for that reason.

class RelativeRequest extends Request {
  constructor(input: RequestInfo | URL, init?: RequestInit) {
    // jsdom has no origin for a bare /path, and the client builds relative URLs
    // because the app is same-origin with its API.
    if (typeof input === 'string' && input.startsWith('/')) {
      super(`http://localhost${input}`, init);
      return;
    }
    super(input, init);
  }
}

class MemoryStorage implements Storage {
  #entries = new Map<string, string>();

  get length(): number {
    return this.#entries.size;
  }
  clear(): void {
    this.#entries.clear();
  }
  getItem(key: string): string | null {
    return this.#entries.get(key) ?? null;
  }
  key(index: number): string | null {
    return [...this.#entries.keys()][index] ?? null;
  }
  removeItem(key: string): void {
    this.#entries.delete(key);
  }
  setItem(key: string, value: string): void {
    this.#entries.set(key, String(value));
  }
}

export const fetchMock = vi.fn<typeof fetch>();

vi.stubGlobal('Request', RelativeRequest);
vi.stubGlobal('fetch', fetchMock);
vi.stubGlobal('localStorage', new MemoryStorage());
vi.stubGlobal('sessionStorage', new MemoryStorage());

export function jsonResponse(status: number, body?: unknown): Response {
  return new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
