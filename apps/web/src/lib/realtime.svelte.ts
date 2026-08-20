import type { RealtimeCloseCode, RealtimeEvent } from '@three-peaks/shared/realtime';

// The socket is same-origin with the API -- the load balancer routes /ws to the
// same backend service -- so there is no URL to configure.

const RECONNECT_MIN_MS = 1000;
const RECONNECT_MAX_MS = 30_000;

// Exhaustively keyed off the generated union, so a close code added on the
// server fails to compile here until it is routed.
const CLOSE_ACTIONS: Record<RealtimeCloseCode, 'revalidate' | 'yield'> = {
  4401: 'revalidate',
  4429: 'yield',
};

type Listener = (event: RealtimeEvent) => void;

class RealtimeStore {
  connected = $state(false);

  #socket: WebSocket | null = null;
  #listeners = new Set<Listener>();
  #projects = new Set<string>();
  #backoff = RECONNECT_MIN_MS;
  #timer: ReturnType<typeof setTimeout> | null = null;
  #token: string | null = null;
  // Bumped by stop(); a reconnect scheduled by a previous session must not
  // reopen a socket after the account it belonged to has gone.
  #generation = 0;

  start(token: string): void {
    this.#token = token;
    this.#generation += 1;
    this.#open(this.#generation);
  }

  stop(): void {
    this.#generation += 1;
    if (this.#timer) clearTimeout(this.#timer);
    this.#timer = null;
    this.#socket?.close();
    this.#socket = null;
    this.#projects.clear();
    this.connected = false;
  }

  subscribe(projectId: string): void {
    this.#projects.add(projectId);
    this.#send({ type: 'subscribe', project_id: projectId });
  }

  unsubscribe(projectId: string): void {
    this.#projects.delete(projectId);
    this.#send({ type: 'unsubscribe', project_id: projectId });
  }

  on(listener: Listener): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  #send(frame: Record<string, unknown>): void {
    if (this.#socket?.readyState === WebSocket.OPEN) {
      this.#socket.send(JSON.stringify(frame));
    }
  }

  #open(generation: number): void {
    if (generation !== this.#generation || !this.#token) return;

    const socket = new WebSocket(`${location.origin.replace(/^http/, 'ws')}/ws`);
    this.#socket = socket;

    socket.onopen = () => {
      // WebSockets carry no request headers a browser can set, so the
      // credential is an application-level frame rather than an Authorization
      // header.
      socket.send(JSON.stringify({ type: 'auth', token: this.#token }));
      for (const projectId of this.#projects) {
        socket.send(JSON.stringify({ type: 'subscribe', project_id: projectId }));
      }
      this.#backoff = RECONNECT_MIN_MS;
      this.connected = true;
    };

    socket.onmessage = (message) => {
      let frame: { type?: string };
      try {
        frame = JSON.parse(String(message.data));
      } catch {
        return;
      }
      if (!frame.type || frame.type === 'ready') return;

      // The single assertion in the whole client, at the frame boundary. The
      // payload is deliberately not validated: the generated union describes
      // what the server sends, and a pod predating a field is a coalescing
      // problem at the read site, not a reason to reject the event.
      for (const listener of this.#listeners) listener(frame as unknown as RealtimeEvent);
    };

    socket.onclose = (event) => {
      this.connected = false;
      if (generation !== this.#generation) return;

      const action = CLOSE_ACTIONS[event.code as RealtimeCloseCode];
      // 4401 means the credential is gone; reconnecting with it would loop.
      if (action === 'revalidate') return;

      this.#timer = setTimeout(() => this.#open(generation), this.#backoff);
      this.#backoff = Math.min(this.#backoff * 2, RECONNECT_MAX_MS);
    };
  }
}

export const realtime = new RealtimeStore();
