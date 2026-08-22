// Every fact about an event type is one row of this table: that it exists, and
// whether its payload names the acting user.
//
// Adding a row here is what makes a type publishable, so the classification
// cannot be left half-done -- and payloads.ts is pinned to these keys, so a
// type with no payload shape does not compile.
export const EVENT_CATALOG = {
  project_updated: { carriesActor: true },
  project_deleted: { carriesActor: true },
  folder_created: { carriesActor: true },
  folder_updated: { carriesActor: true },
  folder_deleted: { carriesActor: true },
  file_uploaded: { carriesActor: true },
  file_updated: { carriesActor: true },
  file_deleted: { carriesActor: true },
  model_updated: { carriesActor: true },
  members_changed: { carriesActor: true },
} as const;

export type RealtimeEventType = keyof typeof EVENT_CATALOG;
