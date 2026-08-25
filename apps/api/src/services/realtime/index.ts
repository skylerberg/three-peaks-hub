import type { PostCommitHook } from '../../types/index.ts';
import { publish } from './bus.ts';
import type { RealtimeEventType } from './eventCatalog.ts';
import type { CallerPayload, RealtimeEnvelope } from './payloads.ts';

export { startBus } from './bus.ts';
export { attachRealtime } from './transport.ts';
export { realtimeEventsDocument } from './document.ts';

// Publishes AFTER the transaction commits, so nothing is announced for a
// request that rolled back. Generic over the event type, so a payload that
// disagrees with its row in payloads.ts is a type error here at the publish
// site rather than a mismatch a client discovers. The project id is named
// rather than read back out of the payload: it decides who receives this, and
// a row that does not happen to carry one would reach nobody.
export function publishAfterCommit<T extends RealtimeEventType>(
  hooks: PostCommitHook[],
  actorUserId: string,
  type: T,
  projectId: string,
  data: CallerPayload<T>
): void {
  hooks.push(async () => {
    await publish({
      type,
      project_id: projectId,
      data: { ...data, actor_user_id: actorUserId },
    } as RealtimeEnvelope<T>);
  });
}
