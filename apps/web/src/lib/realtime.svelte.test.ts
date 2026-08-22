import { FakeWebSocket } from '../api/testUtils.ts';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { realtime } from './realtime.svelte.ts';

const PROJECT = '2f1c9e5a-8b3d-4f1e-9c2a-7d6b5e4f3a21';

describe('RealtimeStore', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    realtime.stop();
    vi.useRealTimers();
  });

  it('presents the credential as a frame, because a socket carries no headers', () => {
    realtime.start('tok');
    FakeWebSocket.last().open();

    expect(FakeWebSocket.last().messages()).toEqual([{ type: 'auth', token: 'tok' }]);
    expect(realtime.connected).toBe(true);
  });

  // Subscriptions live on the store, not on the socket: a reconnect that did not
  // replay them would leave a board silently not updating, with a connection
  // that looks healthy.
  it('re-subscribes to everything it was watching when it reconnects', () => {
    realtime.start('tok');
    FakeWebSocket.last().open();
    realtime.subscribe(PROJECT);

    FakeWebSocket.last().serverClose(1006);
    vi.advanceTimersByTime(1000);
    FakeWebSocket.last().open();

    expect(FakeWebSocket.instances).toHaveLength(2);
    expect(FakeWebSocket.last().messages()).toEqual([
      { type: 'auth', token: 'tok' },
      { type: 'subscribe', project_id: PROJECT },
    ]);
  });

  // 4401 says the credential is gone. Reconnecting with it is a loop that only
  // ends when the tab closes.
  it('does not reconnect after the server says the credential is gone', () => {
    realtime.start('tok');
    FakeWebSocket.last().open();

    FakeWebSocket.last().serverClose(4401);
    vi.advanceTimersByTime(60_000);

    expect(FakeWebSocket.instances).toHaveLength(1);
    expect(realtime.connected).toBe(false);
  });

  it('ignores a frame that is not an event', () => {
    const seen: unknown[] = [];
    realtime.start('tok');
    FakeWebSocket.last().open();
    realtime.on((event) => seen.push(event));

    FakeWebSocket.last().receiveRaw('not json at all');
    FakeWebSocket.last().receive({ type: 'ready' });
    FakeWebSocket.last().receive({ type: 'file.created', project_id: PROJECT });

    expect(seen).toEqual([{ type: 'file.created', project_id: PROJECT }]);
  });
});
