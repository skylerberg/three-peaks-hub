import { afterEach, describe, expect, it } from 'vitest';
import { publish, resetBusForTests, subscribeToBus } from '../../src/services/realtime/bus.ts';
import { publishAfterCommit } from '../../src/services/realtime/index.ts';
import type { RealtimeEnvelope } from '../../src/services/realtime/payloads.ts';

afterEach(() => resetBusForTests());

describe('the realtime bus', () => {
  it('delivers to every subscriber', async () => {
    const seen: RealtimeEnvelope[] = [];
    subscribeToBus((entry) => seen.push(entry));
    subscribeToBus((entry) => seen.push(entry));

    await publish({
      type: 'file_uploaded',
      payload: { project_id: 'p1', file_id: 'f1', actor_user_id: 'u1' },
    });

    expect(seen).toHaveLength(2);
    expect(seen[0].type).toBe('file_uploaded');
  });

  // One bad subscriber must not stop delivery to the others; a listener that
  // throws is a bug in that listener, not an outage for everyone else.
  it('keeps delivering when one subscriber throws', async () => {
    const seen: string[] = [];
    subscribeToBus(() => {
      throw new Error('bad subscriber');
    });
    subscribeToBus((entry) => seen.push(entry.type));

    await publish({
      type: 'project_updated',
      payload: { project_id: 'p1', actor_user_id: 'u1' },
    });

    expect(seen).toEqual(['project_updated']);
  });

  it('stops delivering once unsubscribed', async () => {
    const seen: string[] = [];
    const off = subscribeToBus((entry) => seen.push(entry.type));
    off();

    await publish({ type: 'project_deleted', payload: { project_id: 'p1', actor_user_id: 'u1' } });
    expect(seen).toEqual([]);
  });
});

describe('publishAfterCommit', () => {
  it('publishes nothing until the hook it queued is run', async () => {
    const seen: RealtimeEnvelope[] = [];
    subscribeToBus((entry) => seen.push(entry));

    const hooks: (() => void | Promise<void>)[] = [];
    publishAfterCommit(hooks, 'actor-1', 'members_changed', { project_id: 'p1' });

    // Queued, not sent: a request that rolls back never runs its hooks, which
    // is what stops an announcement for a write that did not happen.
    expect(seen).toHaveLength(0);
    expect(hooks).toHaveLength(1);

    await hooks[0]();
    expect(seen).toHaveLength(1);
  });

  it('merges the acting user into the payload', async () => {
    const seen: RealtimeEnvelope[] = [];
    subscribeToBus((entry) => seen.push(entry));

    const hooks: (() => void | Promise<void>)[] = [];
    publishAfterCommit(hooks, 'actor-1', 'file_deleted', { project_id: 'p1', file_id: 'f1' });
    await hooks[0]();

    expect(seen[0].payload).toEqual({
      project_id: 'p1',
      file_id: 'f1',
      actor_user_id: 'actor-1',
    });
  });
});
