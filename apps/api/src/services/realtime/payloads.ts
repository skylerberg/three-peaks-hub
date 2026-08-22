import type { RealtimeEventType } from './eventCatalog.ts';

// The payload shape for each type, as a second table pinned to the first: the
// Record is keyed by RealtimeEventType, so a catalog entry with no payload row
// is a compile error rather than a runtime surprise at the publish site.
//
// actor_user_id is merged in below rather than restated on every row, and it is
// required -- which is what forces any publisher outside a request to name
// someone.
interface EventPayloads extends Record<RealtimeEventType, object> {
  project_updated: { project_id: string };
  project_deleted: { project_id: string };
  folder_created: { project_id: string; folder_id: string };
  folder_updated: { project_id: string; folder_id: string };
  folder_deleted: { project_id: string; folder_id: string };
  file_uploaded: { project_id: string; file_id: string };
  file_updated: { project_id: string; file_id: string };
  file_deleted: { project_id: string; file_id: string };
  file_version_created: { project_id: string; file_id: string };
  model_updated: { project_id: string; file_id: string };
  members_changed: { project_id: string };
}

type Actor = { actor_user_id: string };

// What a publisher inside a request supplies: the payload minus the field the
// session fills in.
export type CallerPayload<T extends RealtimeEventType> = EventPayloads[T];

type FullPayload<T extends RealtimeEventType> = EventPayloads[T] & Actor;

export interface RealtimeEnvelope<T extends RealtimeEventType = RealtimeEventType> {
  type: T;
  payload: FullPayload<T>;
}
