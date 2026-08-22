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

// jsdom's WebSocket really connects, and the realtime store answers a failed
// connection by reconnecting on a backoff -- so a test that merely renders a
// signed-in app leaves timers reopening a socket after it has finished, and the
// run hangs instead of failing. Stubbed for every test rather than by the ones
// that remember, and drivable so the tests that mean to exercise realtime can.
export class FakeWebSocket {
  static readonly OPEN = 1;
  static instances: FakeWebSocket[] = [];

  readyState = 0;
  sent: string[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onclose: ((event: { code: number }) => void) | null = null;
  onerror: (() => void) | null = null;

  constructor(readonly url: string) {
    FakeWebSocket.instances.push(this);
  }

  send(data: string): void {
    this.sent.push(data);
  }

  close(code = 1000): void {
    if (this.readyState === 3) return;
    this.readyState = 3;
    this.onclose?.({ code });
  }

  // The half a real socket drives from the other end.
  open(): void {
    this.readyState = 1;
    this.onopen?.();
  }

  receive(frame: unknown): void {
    this.onmessage?.({ data: JSON.stringify(frame) });
  }

  // Verbatim, which is the only way to reach the guards the store opens with:
  // a frame that is not JSON, or one whose type is not a string.
  receiveRaw(data: unknown): void {
    this.onmessage?.({ data });
  }

  serverClose(code: number): void {
    this.readyState = 3;
    this.onclose?.({ code });
  }

  messages(): Record<string, unknown>[] {
    return this.sent.map((raw) => JSON.parse(raw) as Record<string, unknown>);
  }

  static last(): FakeWebSocket {
    const socket = FakeWebSocket.instances.at(-1);
    if (!socket) throw new Error('no socket has been opened');
    return socket;
  }

  static reset(): void {
    FakeWebSocket.instances = [];
  }
}

export const fetchMock = vi.fn<typeof fetch>();

vi.stubGlobal('Request', RelativeRequest);
vi.stubGlobal('fetch', fetchMock);
vi.stubGlobal('localStorage', new MemoryStorage());
vi.stubGlobal('sessionStorage', new MemoryStorage());
vi.stubGlobal('WebSocket', FakeWebSocket);

export function jsonResponse(status: number, body?: unknown): Response {
  return new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
