import { CLOSE_CODES, CLOSE_CODE_REASONS } from './closeCodes.ts';
import { EVENT_CATALOG, type RealtimeEventType } from './eventCatalog.ts';

// The field names payloads.ts gives each type, as a value: this document is
// dumped at runtime, where an interface no longer exists. Keyed by
// RealtimeEventType so a catalog entry missing here is a compile error --
// widened to `string` it published an empty payload instead, and an event whose
// generated client type has lost its fields still type-checks on both sides.
const PAYLOAD_FIELDS: Record<RealtimeEventType, readonly string[]> = {
  project_updated: ['project_id'],
  project_deleted: ['project_id'],
  folder_created: ['project_id', 'folder_id'],
  folder_updated: ['project_id', 'folder_id'],
  folder_deleted: ['project_id', 'folder_id'],
  file_uploaded: ['project_id', 'file_id'],
  file_updated: ['project_id', 'file_id'],
  file_deleted: ['project_id', 'file_id'],
  file_version_created: ['project_id', 'file_id'],
  model_updated: ['project_id', 'file_id'],
  deck_created: ['project_id', 'deck_id'],
  deck_updated: ['project_id', 'deck_id'],
  deck_deleted: ['project_id', 'deck_id'],
  members_changed: ['project_id'],
};

export function realtimeEventsDocument() {
  const events = Object.fromEntries(
    Object.entries(EVENT_CATALOG).map(([type, entry]) => [
      type,
      {
        // actor_user_id is merged in from the catalog rather than restated on
        // every row, and it is required.
        payload: [
          ...PAYLOAD_FIELDS[type as RealtimeEventType],
          ...(entry.carriesActor ? ['actor_user_id'] : []),
        ],
      },
    ])
  );

  return {
    version: 1,
    events,
    closeCodes: Object.fromEntries(
      Object.entries(CLOSE_CODES).map(([name, code]) => [
        code,
        { name, reason: CLOSE_CODE_REASONS[code] },
      ])
    ),
  };
}
