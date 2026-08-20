import { CLOSE_CODES, CLOSE_CODE_REASONS } from './closeCodes.ts';
import { EVENT_CATALOG } from './eventCatalog.ts';

const PAYLOAD_FIELDS: Record<string, string[]> = {
  project_updated: ['project_id'],
  project_deleted: ['project_id'],
  folder_created: ['project_id', 'folder_id'],
  folder_updated: ['project_id', 'folder_id'],
  folder_deleted: ['project_id', 'folder_id'],
  file_uploaded: ['project_id', 'file_id'],
  file_updated: ['project_id', 'file_id'],
  file_deleted: ['project_id', 'file_id'],
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
          ...(PAYLOAD_FIELDS[type] ?? []),
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
