import { type } from 'arktype';
import type { Type } from 'arktype';
import {
  componentModelSchema,
  deckCardSchema,
  deckImportSchema,
  deckSchema,
  fileSchema,
  fileVersionSchema,
  folderSchema,
  importRunSchema,
  projectMemberSchema,
  projectSchema,
} from '../../schemas/index.ts';
import { EVENT_CATALOG, type ActorEventType, type RealtimeEventType } from './eventCatalog.ts';

// What each event carries, as arktype schemas rather than TypeScript types --
// which is the whole reason an event can carry a row at all. An interface is
// gone by the time the document is dumped, so a payload described by one could
// only ever be published as a list of field names, and a list of names can only
// describe strings. Every row below is the schema its REST route already
// answers with, so the two clients cannot describe one row two different ways.
//
// Deliberately not re-exported from schemas/index.ts: the OpenAPI name registry
// hashes everything in that barrel and refuses two schemas with one shape,
// which the bare id payloads here would be.

const actorField = { actor_user_id: 'string' } as const;
type ActorField = { actor_user_id: string };

type PayloadRows = Record<RealtimeEventType, { infer: unknown }>;

type WithActor<T extends PayloadRows> = {
  [K in keyof T]: K extends ActorEventType ? Type<T[K]['infer'] & ActorField> : T[K];
};

// Merged from the catalog rather than restated on every row: the row that says
// a type names its actor is the same row publishAfterCommit reads to fill it
// in, so a type cannot get one without the other.
function withActor<T extends PayloadRows>(rows: T): WithActor<T> {
  return Object.fromEntries(
    Object.entries(rows).map(([eventType, schema]) => [
      eventType,
      EVENT_CATALOG[eventType as RealtimeEventType].carriesActor
        ? (schema as unknown as Type<object>).merge(actorField)
        : schema,
    ])
  ) as WithActor<T>;
}

// The project-wide total the explorer draws its meter from. A row on its own
// cannot move it, and a screen that applied the row and left the meter alone
// would be reporting a number it can see is wrong.
const withUsage = { storage_used_bytes: 'number' } as const;

export const REALTIME_PAYLOAD_SCHEMAS = withActor({
  // Without `role`: that field is the caller's own, and one broadcast cannot
  // hold a different answer for each recipient.
  project_updated: projectSchema.omit('role'),
  // The row is gone; its id is the whole of what is left to say.
  project_deleted: type({ id: 'string' }),
  members_changed: type({ members: projectMemberSchema.array() }),

  folder_created: folderSchema,
  folder_updated: folderSchema,
  // The row as it was, because a purge leaves nothing to describe afterwards.
  // `purged` is what separates the two deletes: a tombstone leaves the folder
  // in the deleted listing, a purge takes it out of existence, and a client
  // holding it has to do different things with each.
  folder_deleted: folderSchema.merge({ purged: 'boolean' }),

  file_uploaded: fileSchema.merge(withUsage),
  file_updated: fileSchema,
  // Soft by default and the row survives it, so this carries the tombstone.
  // `purged` is what separates the two: after one, the row is gone for good and
  // a client holding it has to drop it rather than grey it out.
  file_deleted: fileSchema.merge(withUsage).merge({ purged: 'boolean' }),
  // Both halves: the version that was appended, and the file row whose mirror
  // columns it just moved.
  file_version_created: type({ version: fileVersionSchema, file: fileSchema }).merge(withUsage),

  model_updated: componentModelSchema,

  deck_created: deckSchema,
  // Always both, even where the edit was to the deck's own row: one fixed shape
  // is worth the read, and a client that has to test which half arrived is back
  // to not knowing what changed.
  deck_updated: type({ deck: deckSchema, cards: deckCardSchema.array() }),
  deck_deleted: type({ id: 'string' }),

  // Binding a deck to a folder moves neither the deck nor its cards, so it is
  // not a deck_updated -- one published for it would carry a payload saying
  // nothing changed, which is the shape of event this whole table exists to
  // stop. Null is the deck being unbound.
  deck_import_binding_changed: type({
    deck_id: 'string',
    binding: deckImportSchema.or('null'),
    // The name the screen prints. The binding names the folder by id only, and
    // resolving it is the one request applying this would otherwise still cost.
    folder_name: 'string | null',
  }),
  deck_import_started: type({ deck_id: 'string', run: importRunSchema }),
  deck_import_finished: type({ deck_id: 'string', run: importRunSchema }),
} satisfies Record<RealtimeEventType, unknown>);

type RealtimePayloads = {
  [K in RealtimeEventType]: (typeof REALTIME_PAYLOAD_SCHEMAS)[K]['infer'];
};

// What a publisher inside a request supplies: the payload minus the field the
// session fills in.
export type CallerPayload<T extends RealtimeEventType> = T extends ActorEventType
  ? Omit<RealtimePayloads[T], 'actor_user_id'>
  : RealtimePayloads[T];

export interface RealtimeEnvelope<T extends RealtimeEventType = RealtimeEventType> {
  type: T;
  project_id: string;
  data: RealtimePayloads[T];
}
