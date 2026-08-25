import { CLOSE_CODES, CLOSE_CODE_REASONS } from './closeCodes.ts';
import { EVENT_CATALOG, type RealtimeEventType } from './eventCatalog.ts';

// The shape payloads.ts gives each type, as a value: this document is dumped at
// runtime, where an interface no longer exists. Keyed by RealtimeEventType so a
// catalog entry missing here is a compile error -- widened to `string` it
// published an empty payload instead, and an event whose generated client type
// has lost its fields still type-checks on both sides.
//
// A field is either an id, or the shape of a schema the API already names in
// its OpenAPI components -- `field` reaches one level in, for a component that
// holds the row list rather than being it. The generator turns those into the
// component types the REST client already exports, so the two documents cannot
// describe one row two ways, and it fails if a name here resolves to nothing.
type PayloadField = 'string' | { component: string; field?: string; optional?: true };

const PAYLOAD_FIELDS: Record<RealtimeEventType, Readonly<Record<string, PayloadField>>> = {
  project_updated: { project_id: 'string' },
  project_deleted: { project_id: 'string' },
  folder_created: { project_id: 'string', folder_id: 'string' },
  folder_updated: { project_id: 'string', folder_id: 'string' },
  folder_deleted: { project_id: 'string', folder_id: 'string' },
  file_uploaded: { project_id: 'string', file_id: 'string' },
  file_updated: { project_id: 'string', file_id: 'string' },
  file_deleted: { project_id: 'string', file_id: 'string' },
  file_version_created: { project_id: 'string', file_id: 'string' },
  model_updated: { project_id: 'string', file_id: 'string' },
  deck_created: { project_id: 'string', deck_id: 'string' },
  deck_updated: {
    project_id: 'string',
    deck_id: 'string',
    deck: { component: 'Deck', optional: true },
    cards: { component: 'DeckWithCards', field: 'cards', optional: true },
  },
  deck_deleted: { project_id: 'string', deck_id: 'string' },
  deck_import_started: { project_id: 'string', deck_id: 'string', run_id: 'string' },
  deck_import_finished: { project_id: 'string', deck_id: 'string', run_id: 'string' },
  members_changed: { project_id: 'string' },
};

export function realtimeEventsDocument() {
  const events = Object.fromEntries(
    Object.entries(EVENT_CATALOG).map(([type, entry]) => [
      type,
      {
        // actor_user_id is merged in from the catalog rather than restated on
        // every row, and it is required.
        payload: {
          ...PAYLOAD_FIELDS[type as RealtimeEventType],
          ...(entry.carriesActor ? { actor_user_id: 'string' as const } : {}),
        },
      },
    ])
  );

  return {
    // 2 since a payload became a map of field to shape rather than a list of
    // names. Nothing reads this document at runtime -- it is generated from at
    // build time -- so the bump is a marker rather than a compatibility branch.
    version: 2,
    events,
    closeCodes: Object.fromEntries(
      Object.entries(CLOSE_CODES).map(([name, code]) => [
        code,
        { name, reason: CLOSE_CODE_REASONS[code] },
      ])
    ),
  };
}
