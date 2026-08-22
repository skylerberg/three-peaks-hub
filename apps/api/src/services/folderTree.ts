import type { Connection } from '../types/index.ts';

// Visibility is derived from the chain of folders above a row rather than
// copied onto it, so every writer needs the same walk. It lives here because a
// route module is not somewhere another service can import from.

export type FolderRow = {
  id: string;
  project_id: string;
  parent_id: string | null;
  name: string;
  created_at: Date | string;
  updated_at: Date | string;
  deleted_at: Date | string | null;
};

export const FOLDER_COLUMNS = [
  'folder.id as id',
  'folder.project_id as project_id',
  'folder.parent_id as parent_id',
  'folder.name as name',
  'folder.created_at as created_at',
  'folder.updated_at as updated_at',
  'folder.deleted_at as deleted_at',
] as const;

// Walks parent_id up to the root. Bounded, because a cycle would otherwise be
// an infinite loop in a request handler — moves are checked for cycles, but a
// read must not depend on that having worked.
export const MAX_BREADCRUMB_DEPTH = 64;

// Never filtered by deleted_at: the trail is what the ancestor rule is read
// off, and a truncated trail would let a move into a deleted subtree past the
// cycle check.
export async function breadcrumb(db: Connection, folderId: string): Promise<FolderRow[]> {
  const trail: FolderRow[] = [];
  let cursor: string | null = folderId;
  for (let depth = 0; cursor && depth < MAX_BREADCRUMB_DEPTH; depth += 1) {
    const row: FolderRow | undefined = await db
      .selectFrom('folder')
      .select(FOLDER_COLUMNS)
      .where('folder.id', '=', cursor)
      .executeTakeFirst();
    if (!row) break;
    trail.unshift(row);
    cursor = row.parent_id;
  }
  return trail;
}

// The deleted folder that stands between something and being visible again.
// `id` is null for the one case the walk cannot answer.
export interface DeletedAncestor {
  id: string | null;
  name: string;
}

// A walk that ran out of depth, or off a row that is no longer there, leaves
// the rest of the chain unknown — and unknown denies. Admitting it instead
// would put a row inside a tombstone nothing lists and nothing can reach.
export const UNKNOWN_ANCESTOR: DeletedAncestor = { id: null, name: 'a folder too deep to check' };

// Outermost first, so what is named is the one to restore first.
export function firstDeletedInTrail(trail: FolderRow[]): DeletedAncestor | null {
  const deleted = trail.find((folder) => folder.deleted_at !== null);
  if (deleted) return { id: deleted.id, name: deleted.name };
  if (trail.length === 0 || trail[0].parent_id !== null) return UNKNOWN_ANCESTOR;
  return null;
}

// The check every write target goes through. A one-level `deleted_at is null`
// would not do: a live folder inside a deleted one is ordinary, and a row
// planted there is invisible to every listing and recoverable by no route.
export async function deletedAncestor(
  db: Connection,
  folderId: string | null
): Promise<DeletedAncestor | null> {
  if (folderId === null) return null;
  return firstDeletedInTrail(await breadcrumb(db, folderId));
}

export function blockedMessage(ancestor: DeletedAncestor, what: string): string {
  return ancestor.id === null
    ? `${what} sits too deep for its folders to be checked`
    : `${what} is inside the deleted folder "${ancestor.name}". Restore that first`;
}
