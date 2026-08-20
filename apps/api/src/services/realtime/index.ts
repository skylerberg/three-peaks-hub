import type { PostCommitHook } from '../../types/index.ts';
import { publish } from './bus.ts';
import type { RealtimeEventType } from './eventCatalog.ts';
import type { CallerPayload } from './payloads.ts';

export { startBus } from './bus.ts';
export { attachRealtime } from './transport.ts';
export { realtimeEventsDocument } from './document.ts';

// Publishes AFTER the transaction commits, so nothing is announced for a
// request that rolled back. Generic over the event type, so a payload that
// disagrees with its row in payloads.ts is a type error here at the publish
// site rather than a mismatch a client discovers.
export function publishAfterCommit<T extends RealtimeEventType>(
  hooks: PostCommitHook[],
  actorUserId: string,
  type: T,
  payload: CallerPayload<T>
): void {
  hooks.push(async () => {
    await publish({ type, payload: { ...payload, actor_user_id: actorUserId } });
  });
}
