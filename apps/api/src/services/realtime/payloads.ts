import type { deckCardSchema, deckSchema } from '../../schemas/decks.ts';
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
  deck_created: { project_id: string; deck_id: string };
  // The only event that carries what changed rather than only what changed.
  // Both rows are optional and a client that gets neither reloads, which is
  // what a pod on the previous release leaves it doing; `cards` is absent when
  // the edit was to the deck's own row and left its contents alone.
  deck_updated: {
    project_id: string;
    deck_id: string;
    deck?: typeof deckSchema.infer;
    cards?: (typeof deckCardSchema.infer)[];
  };
  deck_deleted: { project_id: string; deck_id: string };
  deck_import_started: { project_id: string; deck_id: string; run_id: string };
  // Fires when a run is abandoned as well as when it finishes; the payload does
  // not say which, and a client that cares reads the run back.
  deck_import_finished: { project_id: string; deck_id: string; run_id: string };
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
