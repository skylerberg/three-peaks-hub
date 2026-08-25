import { Readable } from 'node:stream';
import { Hono } from 'hono';
import { describeRoute, resolver } from 'hono-openapi';
import { type NotNull, sql } from 'kysely';
import { MAX_UPLOAD_BYTES, PROJECT_STORAGE_QUOTA_BYTES } from '@three-peaks/shared';
import {
  assertFileAccess,
  assertFolderAccess,
  assertProjectAccess,
  assertProjectWrite,
} from '../services/authorization.ts';
import {
  FILE_COLUMNS,
  appendFileVersion,
  assertQuota,
  assertUploadSize,
  fileWithUsage,
  projectStorageUsed,
  serializeVersion,
  restoreFile,
  serializeFile,
  storeUpload,
} from '../services/files.ts';
import {
  FOLDER_COLUMNS,
  MAX_BREADCRUMB_DEPTH,
  UNKNOWN_ANCESTOR,
  blockedMessage,
  breadcrumb,
  deletedAncestor,
  firstDeletedInTrail,
  type DeletedAncestor,
  type FolderRow,
} from '../services/folderTree.ts';
import { deleteStoredObjectsAfterCommit, reclaim, storage } from '../services/storage/index.ts';
import { publishAfterCommit } from '../services/realtime/index.ts';
import { jsonValidator, queryValidator } from '../middleware/validators.ts';
import { AppError, isUniqueViolation } from '../utils/errors.ts';
import { newId } from '../utils/uuid.ts';
import { projectQuerySchema } from '../schemas/common.ts';
import {
  createFolderRequestSchema,
  deletedListingSchema,
  directoryListingSchema,
  directoryQuerySchema,
  fileSchema,
  fileVersionListSchema,
  fileVersionResultSchema,
  folderSchema,
  purgeQuerySchema,
  restoreFileQuerySchema,
  restoreFolderQuerySchema,
  updateFileRequestSchema,
  uploadQuerySchema,
  updateFolderRequestSchema,
  versionQuerySchema,
} from '../schemas/files.ts';
import {
  conflictErrorResponse,
  forbiddenErrorResponse,
  internalServerErrorResponse,
  notFoundErrorResponse,
  payloadTooLargeErrorResponse,
  unauthorizedErrorResponse,
  validationErrorResponse,
} from '../schemas/errors.ts';
import type { AppContext, AppHono, Connection } from '../types/index.ts';

export const filesRouter: AppHono = new Hono();

const standardErrors = {
  ...unauthorizedErrorResponse,
  ...notFoundErrorResponse,
  ...internalServerErrorResponse,
};

// deleted_at is deliberately not on the wire: nothing reads one folder by id,
// and the deleted listing carries the fact where it is needed.
// A new version moves the file's mirror columns and the project's total as well
// as adding a row, so the event carries all three rather than the one a client
// would then have to read the others back for.
async function versionEventData(
  c: Pick<AppContext, 'get'>,
  projectId: string,
  fileId: string,
  version: ReturnType<typeof serializeVersion>
) {
  const { storage_used_bytes: used, ...file } = await fileWithUsage(c, projectId, fileId);
  return { version, file, storage_used_bytes: used };
}

function serializeFolder(row: FolderRow) {
  return {
    id: row.id,
    project_id: row.project_id,
    parent_id: row.parent_id,
    name: row.name,
    created_at: new Date(row.created_at).toISOString(),
    updated_at: new Date(row.updated_at).toISOString(),
  };
}

interface VersionRow {
  file_id: string;
  version_number: number;
  storage_key: string;
  content_type: string;
  byte_size: string | number;
  checksum: string | null;
  image_width: number | null;
  image_height: number | null;
  created_by: string;
  created_at: Date | string;
}

const VERSION_COLUMNS = [
  'file_version.file_id as file_id',
  'file_version.version_number as version_number',
  'file_version.storage_key as storage_key',
  'file_version.content_type as content_type',
  'file_version.byte_size as byte_size',
  'file_version.checksum as checksum',
  'file_version.image_width as image_width',
  'file_version.image_height as image_height',
  'file_version.created_by as created_by',
  'file_version.created_at as created_at',
] as const;

// A file uploaded by a pod running the release before file_version existed has
// bytes and no rows of its own. Until something appends to it, its mirror
// columns are its version 1 -- so a reader sees one entry rather than a file
// that claims to have no history at all.
async function mirrorAsVersionOne(db: Connection, fileId: string): Promise<VersionRow> {
  const file = await db
    .selectFrom('file')
    .select([
      'file.storage_key as storage_key',
      'file.content_type as content_type',
      'file.byte_size as byte_size',
      'file.checksum as checksum',
      'file.image_width as image_width',
      'file.image_height as image_height',
      'file.uploaded_by as uploaded_by',
      'file.created_at as created_at',
    ])
    .where('file.id', '=', fileId)
    .executeTakeFirstOrThrow();

  return {
    file_id: fileId,
    version_number: 1,
    storage_key: file.storage_key,
    content_type: file.content_type,
    byte_size: file.byte_size,
    checksum: file.checksum,
    image_width: file.image_width,
    image_height: file.image_height,
    created_by: file.uploaded_by,
    created_at: file.created_at,
  };
}

async function hasVersions(db: Connection, fileId: string): Promise<boolean> {
  const row = await db
    .selectFrom('file_version')
    .select(['file_version.id as id'])
    .where('file_version.file_id', '=', fileId)
    .limit(1)
    .executeTakeFirst();
  return row !== undefined;
}

async function currentVersionNumber(db: Connection, fileId: string): Promise<number> {
  const row = await db
    .selectFrom('file_version')
    .select(['file_version.version_number as version_number'])
    .where('file_version.file_id', '=', fileId)
    .orderBy('file_version.version_number', 'desc')
    .limit(1)
    .executeTakeFirst();
  return row?.version_number ?? 1;
}

async function lookupVersion(
  db: Connection,
  fileId: string,
  number: number
): Promise<VersionRow | undefined> {
  const row = await db
    .selectFrom('file_version')
    .select(VERSION_COLUMNS)
    .where('file_version.file_id', '=', fileId)
    .where('file_version.version_number', '=', number)
    .executeTakeFirst();
  if (row) return row;
  if (number !== 1 || (await hasVersions(db, fileId))) return undefined;
  return mirrorAsVersionOne(db, fileId);
}

// Its own function rather than an inline test, so the single line deciding
// between keeping the bytes and reclaiming them has one site.
function purgeRequested(query: { purge?: string }): boolean {
  return query.purge === 'true';
}

filesRouter.get(
  '/directory',
  describeRoute({
    tags: ['Files'],
    summary: 'List one directory',
    description:
      'The folders and files directly inside one directory, plus the breadcrumb to it and the project storage total. One request per screen.',
    security: [{ bearerAuth: [] }],
    responses: {
      200: {
        description: 'Directory listing',
        content: { 'application/json': { schema: resolver(directoryListingSchema) } },
      },
      ...standardErrors,
    },
  }),
  queryValidator(directoryQuerySchema),
  async (c) => {
    const query = c.req.valid('query') as { project_id: string; folder_id?: string };
    const projectId = query.project_id;
    const folderId = query.folder_id ?? null;

    await assertProjectAccess(c, projectId);
    const db = c.get('db');

    let current: FolderRow | null = null;
    if (folderId) {
      const row = await db
        .selectFrom('folder')
        .select(FOLDER_COLUMNS)
        .where('folder.id', '=', folderId)
        .where('folder.project_id', '=', projectId)
        .where('folder.deleted_at', 'is', null)
        .executeTakeFirst();
      if (!row) throw new AppError(404, 'Folder not found');
      current = row;
    }

    const [folders, files, trail, used] = await Promise.all([
      db
        .selectFrom('folder')
        .select(FOLDER_COLUMNS)
        .where('folder.project_id', '=', projectId)
        .where('folder.deleted_at', 'is', null)
        .$if(folderId === null, (qb) => qb.where('folder.parent_id', 'is', null))
        .$if(folderId !== null, (qb) => qb.where('folder.parent_id', '=', folderId))
        .orderBy('folder.name', 'asc')
        .execute(),
      db
        .selectFrom('file')
        .select(FILE_COLUMNS)
        .where('file.project_id', '=', projectId)
        .where('file.deleted_at', 'is', null)
        .$if(folderId === null, (qb) => qb.where('file.folder_id', 'is', null))
        .$if(folderId !== null, (qb) => qb.where('file.folder_id', '=', folderId))
        .orderBy('file.filename', 'asc')
        .execute(),
      folderId ? breadcrumb(db, folderId) : Promise.resolve([] as FolderRow[]),
      projectStorageUsed(c, projectId),
    ]);

    // A live folder inside a deleted one is ordinary, and browsing into it by
    // URL must not work: the answer is the same 404 the folder itself gives.
    if (folderId !== null && firstDeletedInTrail(trail) !== null) {
      throw new AppError(404, 'Folder not found');
    }

    return c.json({
      project_id: projectId,
      folder: current ? serializeFolder(current) : null,
      breadcrumb: trail.map(serializeFolder),
      folders: folders.map(serializeFolder),
      files: files.map(serializeFile),
      storage_used_bytes: used,
      storage_quota_bytes: PROJECT_STORAGE_QUOTA_BYTES,
    });
  }
);

interface FolderNode {
  id: string;
  parent_id: string | null;
  name: string;
  deleted_at: Date | string | null;
}

// The path a deleted row came from, and whatever stands between it and coming
// back. One walk answers both, off a map of every folder in the project rather
// than a query each — a tombstone's ancestors are ordinary rows to this.
function ancestry(
  folders: Map<string, FolderNode>,
  startId: string | null
): { path: string; blockedBy: DeletedAncestor | null } {
  const names: string[] = [];
  let blockedBy: DeletedAncestor | null = null;
  let cursor = startId;
  for (let depth = 0; cursor !== null && depth < MAX_BREADCRUMB_DEPTH; depth += 1) {
    const row = folders.get(cursor);
    // Naming a deleted folder the walk did reach beats reporting the chain
    // unknown: it really is in the way, so restoring it is a step forward even
    // if the part that was never read holds another one.
    if (!row) return { path: names.join('/'), blockedBy: blockedBy ?? UNKNOWN_ANCESTOR };
    names.unshift(row.name);
    if (row.deleted_at !== null) blockedBy = { id: row.id, name: row.name };
    cursor = row.parent_id;
  }
  return {
    path: names.join('/'),
    blockedBy: blockedBy ?? (cursor === null ? null : UNKNOWN_ANCESTOR),
  };
}

filesRouter.get(
  '/deleted',
  describeRoute({
    tags: ['Files'],
    summary: 'List what has been deleted',
    description:
      'Flat, and each entry carries the path it came from — a deleted subtree has no live parent to browse into. A folder that was deleted does not list its contents: those rows were never deleted themselves, and restoring the folder brings them back with it.',
    security: [{ bearerAuth: [] }],
    responses: {
      200: {
        description: 'The deleted files and folders',
        content: { 'application/json': { schema: resolver(deletedListingSchema) } },
      },
      ...standardErrors,
    },
  }),
  queryValidator(projectQuerySchema),
  async (c) => {
    const query = c.req.valid('query') as { project_id: string };
    const projectId = query.project_id;

    await assertProjectAccess(c, projectId);
    const db = c.get('db');

    const [files, folders, everyFolder] = await Promise.all([
      db
        .selectFrom('file')
        .select((eb) => [
          'file.id as id',
          'file.folder_id as folder_id',
          'file.filename as filename',
          'file.content_type as content_type',
          // Every version, because the screen offers this number as what a
          // purge gives back and the quota is summed the same way. The current
          // version alone understates a file with history by all the rest.
          eb
            .selectFrom('file_version')
            .whereRef('file_version.file_id', '=', 'file.id')
            .select((inner) =>
              inner.fn
                .coalesce(inner.fn.sum<string>('file_version.byte_size'), inner.lit(0))
                .as('total')
            )
            .as('byte_size'),
          'file.deleted_at as deleted_at',
          'file.deleted_by as deleted_by',
        ])
        .where('file.project_id', '=', projectId)
        .where('file.deleted_at', 'is not', null)
        .$narrowType<{ deleted_at: NotNull }>()
        .execute(),
      db
        .selectFrom('folder')
        .select([
          'folder.id as id',
          'folder.parent_id as parent_id',
          'folder.name as name',
          'folder.deleted_at as deleted_at',
          'folder.deleted_by as deleted_by',
        ])
        .where('folder.project_id', '=', projectId)
        .where('folder.deleted_at', 'is not', null)
        .$narrowType<{ deleted_at: NotNull }>()
        .execute(),
      // Unfiltered on purpose: the chain above a tombstone is made of rows that
      // may themselves be tombstones, and every one of them has to be walkable.
      db
        .selectFrom('folder')
        .select([
          'folder.id as id',
          'folder.parent_id as parent_id',
          'folder.name as name',
          'folder.deleted_at as deleted_at',
        ])
        .where('folder.project_id', '=', projectId)
        .execute(),
    ]);

    const byId = new Map<string, FolderNode>(everyFolder.map((row) => [row.id, row]));

    const entries = [
      ...files.map((row) => {
        const { path, blockedBy } = ancestry(byId, row.folder_id);
        return {
          kind: 'file' as const,
          id: row.id,
          project_id: projectId,
          name: row.filename,
          path,
          content_type: row.content_type,
          byte_size: Number(row.byte_size),
          deleted_at: new Date(row.deleted_at).toISOString(),
          deleted_by: row.deleted_by,
          blocked_by: blockedBy === null ? null : blockedBy.name,
        };
      }),
      // From the parent, not from itself: a folder is never what blocks its own
      // restore.
      ...folders.map((row) => {
        const { path, blockedBy } = ancestry(byId, row.parent_id);
        return {
          kind: 'folder' as const,
          id: row.id,
          project_id: projectId,
          name: row.name,
          path,
          content_type: null,
          byte_size: null,
          deleted_at: new Date(row.deleted_at).toISOString(),
          deleted_by: row.deleted_by,
          blocked_by: blockedBy === null ? null : blockedBy.name,
        };
      }),
    ];

    entries.sort((a, b) => b.deleted_at.localeCompare(a.deleted_at));

    return c.json({ entries });
  }
);

filesRouter.post(
  '/folders',
  describeRoute({
    tags: ['Files'],
    summary: 'Create a folder',
    description: 'Names are unique within a directory, compared case-insensitively.',
    security: [{ bearerAuth: [] }],
    responses: {
      201: {
        description: 'Created',
        content: { 'application/json': { schema: resolver(folderSchema) } },
      },
      ...conflictErrorResponse,
      ...forbiddenErrorResponse,
      ...validationErrorResponse,
      ...standardErrors,
    },
  }),
  jsonValidator(createFolderRequestSchema),
  async (c) => {
    const body = c.req.valid('json') as {
      id?: string;
      project_id: string;
      parent_id?: string | null;
      name: string;
    };
    await assertProjectWrite(c, body.project_id);
    const db = c.get('db');

    if (body.parent_id) {
      const parent = await db
        .selectFrom('folder')
        .select(['folder.id as id'])
        .where('folder.id', '=', body.parent_id)
        .where('folder.project_id', '=', body.project_id)
        .executeTakeFirst();
      if (!parent) throw new AppError(404, 'Parent folder not found');
      if ((await deletedAncestor(db, body.parent_id)) !== null) {
        throw new AppError(404, 'Parent folder not found');
      }
    }

    try {
      const row = await db
        .insertInto('folder')
        .values({
          id: body.id ?? newId(),
          project_id: body.project_id,
          parent_id: body.parent_id ?? null,
          name: body.name,
          created_by: c.get('user').id,
        })
        .returning(FOLDER_COLUMNS)
        .executeTakeFirstOrThrow();
      const created = serializeFolder(row);
      publishAfterCommit(
        c.get('postCommitHooks'),
        c.get('user').id,
        'folder_created',
        body.project_id,
        created
      );
      return c.json(created, 201);
    } catch (error) {
      // Both the id primary key and the case-folded name index land here. The
      // pre-check above cannot cover the name: two creates can pass it together.
      if (isUniqueViolation(error)) {
        throw new AppError(409, 'A folder with that name already exists here');
      }
      throw error;
    }
  }
);

filesRouter.patch(
  '/folders/:id',
  describeRoute({
    tags: ['Files'],
    summary: 'Rename or move a folder',
    description: 'A move that would put a folder inside itself is refused.',
    security: [{ bearerAuth: [] }],
    responses: {
      200: {
        description: 'Updated',
        content: { 'application/json': { schema: resolver(folderSchema) } },
      },
      ...conflictErrorResponse,
      ...forbiddenErrorResponse,
      ...validationErrorResponse,
      ...standardErrors,
    },
  }),
  jsonValidator(updateFolderRequestSchema),
  async (c) => {
    const id = c.req.param('id');
    const access = await assertFolderAccess(c, id, 'write');
    const body = c.req.valid('json') as { name?: string; parent_id?: string | null };
    const db = c.get('db');

    if (body.parent_id !== undefined && body.parent_id !== null) {
      if (body.parent_id === id) throw new AppError(409, 'A folder cannot contain itself');

      // Walk up from the proposed parent. If this folder is on that path, the
      // move would detach the subtree into a cycle — which no later read could
      // terminate on.
      const trail = await breadcrumb(db, body.parent_id);
      if (trail.length === 0) throw new AppError(404, 'Parent folder not found');
      if (trail[0].project_id !== access.projectId) {
        throw new AppError(404, 'Parent folder not found');
      }
      if (trail.some((folder) => folder.id === id)) {
        throw new AppError(409, 'A folder cannot be moved inside itself');
      }
      // The trail is already in hand, so the ancestor rule costs nothing here.
      if (firstDeletedInTrail(trail) !== null) throw new AppError(404, 'Parent folder not found');
    }

    try {
      const row = await db
        .updateTable('folder')
        .set({
          ...(body.name !== undefined ? { name: body.name } : {}),
          ...(body.parent_id !== undefined ? { parent_id: body.parent_id } : {}),
          updated_at: new Date(),
        })
        .where('folder.id', '=', id)
        // A tombstone's name and its place are frozen. Renaming one would take
        // it out from under the name the deleted listing shows, and moving one
        // would make the path that listing reports a lie.
        .where('folder.deleted_at', 'is', null)
        .returning(FOLDER_COLUMNS)
        .executeTakeFirst();
      if (!row) throw new AppError(409, 'That folder is deleted. Restore it first');
      const updated = serializeFolder(row);
      publishAfterCommit(
        c.get('postCommitHooks'),
        c.get('user').id,
        'folder_updated',
        access.projectId,
        updated
      );
      return c.json(updated);
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new AppError(409, 'A folder with that name already exists there');
      }
      throw error;
    }
  }
);

filesRouter.delete(
  '/folders/:id',
  describeRoute({
    tags: ['Files'],
    summary: 'Delete a folder',
    description:
      'Soft by default: the folder is tombstoned and nothing inside it is touched, which is what makes restoring it exact. `purge=true` is the irreversible one — it cascades to the whole subtree, live files included, and reclaims every stored object. Only the literal word is accepted, and repeating the parameter is a 400.',
    security: [{ bearerAuth: [] }],
    responses: {
      204: { description: 'Deleted' },
      ...forbiddenErrorResponse,
      ...standardErrors,
    },
  }),
  queryValidator(purgeQuerySchema),
  async (c) => {
    const id = c.req.param('id');
    const access = await assertFolderAccess(c, id, 'write');
    const db = c.get('db');

    if (!purgeRequested(c.req.valid('query') as { purge?: string })) {
      // Only this row. Marking the subtree would make a restore resurrect
      // whatever had been deleted inside it individually beforehand; visibility
      // is read off the ancestor chain instead.
      const row = await db
        .updateTable('folder')
        .set({ deleted_at: new Date(), deleted_by: c.get('user').id })
        // A repeat delete leaves the first one's record intact.
        .where('folder.id', '=', id)
        .where('folder.deleted_at', 'is', null)
        .returning(FOLDER_COLUMNS)
        .executeTakeFirst();

      if (row) {
        publishAfterCommit(
          c.get('postCommitHooks'),
          c.get('user').id,
          'folder_deleted',
          access.projectId,
          {
            ...serializeFolder(row),
            purged: false,
          }
        );
      }
      return c.body(null, 204);
    }

    // Recursive, because the database cascade removes the rows but nothing
    // removes the objects those rows named. Locked in the same breath:
    // appendFileVersion takes the same row lock, so an append cannot commit in
    // the window between the keys being collected and the delete, which would
    // leave its object named by nothing.
    const locked = await db
      .withRecursive('subtree', (qb) =>
        qb
          .selectFrom('folder')
          .select(['folder.id as id'])
          .where('folder.id', '=', id)
          .unionAll((inner) =>
            inner
              .selectFrom('folder as f')
              .innerJoin('subtree as s', 's.id', 'f.parent_id')
              .select(['f.id as id'])
          )
      )
      .selectFrom('file')
      .innerJoin('subtree', 'subtree.id', 'file.folder_id')
      .select(['file.id as id'])
      // Named, because the only lockable relation in the join is file.
      .forUpdate('file')
      // LockRows sits above the sort, so the rows are locked in id order. An
      // import takes the same locks the same way and before it writes a single
      // mapping row -- which the delete below reaches through the cascade, so
      // the other order would be a cycle rather than a wait.
      .orderBy('file.id')
      .execute();

    const fileIds = locked.map((row) => row.id);
    // Every version's object, not just the current one. The mirror key stays in
    // the set as well, for a file that predates file_version and has no row of
    // its own.
    const descendants =
      fileIds.length === 0
        ? []
        : await db
            .selectFrom('file')
            .leftJoin('file_version', 'file_version.file_id', 'file.id')
            .select([
              'file.storage_key as storage_key',
              'file_version.storage_key as version_storage_key',
            ])
            .where('file.id', 'in', fileIds)
            .execute();

    // Read before the delete: after it there is no row to describe, and a
    // client cannot be told which folder to drop.
    const purgedRow = await db
      .selectFrom('folder')
      .select(FOLDER_COLUMNS)
      .where('folder.id', '=', id)
      .executeTakeFirst();

    await db.deleteFrom('folder').where('folder.id', '=', id).execute();

    const keys = new Set<string>();
    for (const row of descendants) {
      keys.add(row.storage_key);
      if (row.version_storage_key !== null) keys.add(row.version_storage_key);
    }

    deleteStoredObjectsAfterCommit(c.get('postCommitHooks'), [...keys]);
    if (purgedRow) {
      publishAfterCommit(
        c.get('postCommitHooks'),
        c.get('user').id,
        'folder_deleted',
        access.projectId,
        {
          ...serializeFolder(purgedRow),
          purged: true,
        }
      );
    }

    return c.body(null, 204);
  }
);

filesRouter.post(
  '/folders/:id/restore',
  describeRoute({
    tags: ['Files'],
    summary: 'Restore a deleted folder',
    description:
      'Takes an optional `name`, because the old one may have been taken while the folder was gone. Renaming first would leave a window in which the tombstone still held it. Whatever was deleted inside the folder separately stays deleted. Restoring a folder that is not deleted answers 200 and changes nothing.',
    security: [{ bearerAuth: [] }],
    responses: {
      200: {
        description: 'Restored',
        content: { 'application/json': { schema: resolver(folderSchema) } },
      },
      ...conflictErrorResponse,
      ...forbiddenErrorResponse,
      ...standardErrors,
    },
  }),
  queryValidator(restoreFolderQuerySchema),
  async (c) => {
    const id = c.req.param('id');
    const access = await assertFolderAccess(c, id, 'write');
    const query = c.req.valid('query') as { name?: string };
    const db = c.get('db');

    const folder = await db
      .selectFrom('folder')
      .select(FOLDER_COLUMNS)
      .where('folder.id', '=', id)
      .forUpdate()
      .executeTakeFirst();
    if (!folder) throw new AppError(404, 'Folder not found');
    if (folder.deleted_at === null) return c.json(serializeFolder(folder));

    const blocked = await deletedAncestor(db, folder.parent_id);
    if (blocked !== null) throw new AppError(409, blockedMessage(blocked, 'That folder'));

    const parentId = folder.parent_id;
    const name = query.name ?? folder.name;
    const taken = await db
      .selectFrom('folder')
      .select(['folder.id as id'])
      .where('folder.project_id', '=', access.projectId)
      .where('folder.deleted_at', 'is', null)
      .$if(parentId === null, (qb) => qb.where('folder.parent_id', 'is', null))
      .$if(parentId !== null, (qb) => qb.where('folder.parent_id', '=', parentId))
      .where(sql<boolean>`lower(folder.name) = lower(${name})`)
      .executeTakeFirst();
    if (taken) throw new AppError(409, `A folder named "${name}" is already here`);

    try {
      const row = await db
        .updateTable('folder')
        .set({ name, deleted_at: null, deleted_by: null, updated_at: new Date() })
        .where('folder.id', '=', id)
        .returning(FOLDER_COLUMNS)
        .executeTakeFirstOrThrow();
      const restored = serializeFolder(row);
      publishAfterCommit(
        c.get('postCommitHooks'),
        c.get('user').id,
        'folder_updated',
        access.projectId,
        restored
      );
      return c.json(restored);
    } catch (error) {
      // The check above races two restores against each other; the index is
      // what actually decides.
      if (isUniqueViolation(error)) {
        throw new AppError(409, `A folder named "${name}" is already here`);
      }
      throw error;
    }
  }
);

filesRouter.post(
  '/upload',
  describeRoute({
    tags: ['Files'],
    summary: 'Upload a file',
    description:
      'The request body is the file itself; metadata travels in the query string. Serializing the bytes into JSON would read the whole file into memory on both ends.',
    security: [{ bearerAuth: [] }],
    responses: {
      201: {
        description: 'Uploaded',
        content: { 'application/json': { schema: resolver(fileSchema) } },
      },
      ...conflictErrorResponse,
      ...forbiddenErrorResponse,
      ...payloadTooLargeErrorResponse,
      ...validationErrorResponse,
      ...standardErrors,
    },
  }),
  queryValidator(uploadQuerySchema),
  async (c) => {
    const query = c.req.valid('query') as {
      project_id: string;
      filename: string;
      folder_id?: string;
      id?: string;
    };
    const projectId = query.project_id;
    const filename = query.filename;
    const folderId = query.folder_id ?? null;
    const id = query.id ?? newId();

    await assertProjectWrite(c, projectId);
    const db = c.get('db');

    if (folderId) {
      const folder = await db
        .selectFrom('folder')
        .select(['folder.id as id'])
        .where('folder.id', '=', folderId)
        .where('folder.project_id', '=', projectId)
        .executeTakeFirst();
      if (!folder) throw new AppError(404, 'Folder not found');
      if ((await deletedAncestor(db, folderId)) !== null) {
        throw new AppError(404, 'Folder not found');
      }
    }

    // Checked before the transfer on what the client claims, and again below on
    // what actually arrived — the header is a hint, not a guarantee.
    const declaredLength = Number(c.req.header('content-length') ?? 0);
    assertUploadSize(declaredLength);
    if (declaredLength > 0) await assertQuota(c, projectId, declaredLength);

    const body = c.req.raw.body;
    if (!body) throw new AppError(400, 'Request body is required');

    const stored = await storeUpload(
      Readable.fromWeb(body as Parameters<typeof Readable.fromWeb>[0]),
      MAX_UPLOAD_BYTES,
      c.req.header('content-type') ?? 'application/octet-stream'
    );

    try {
      await assertQuota(c, projectId, stored.byteSize);
    } catch (error) {
      await reclaim(stored.storageKey);
      throw error;
    }

    let row;
    try {
      row = await db
        .insertInto('file')
        .values({
          id,
          project_id: projectId,
          folder_id: folderId,
          filename,
          storage_key: stored.storageKey,
          content_type: stored.contentType,
          byte_size: String(stored.byteSize),
          checksum: stored.checksum,
          uploaded_by: c.get('user').id,
        })
        .returning(FILE_COLUMNS)
        .executeTakeFirstOrThrow();
    } catch (error) {
      await reclaim(stored.storageKey);
      if (isUniqueViolation(error)) {
        throw new AppError(409, 'A file with that name already exists here');
      }
      throw error;
    }

    // Its own try: the catch above maps every unique violation to a filename
    // conflict, and a collision coming from file_version is not one.
    try {
      await appendFileVersion(c, row.id, {
        storageKey: stored.storageKey,
        contentType: stored.contentType,
        byteSize: stored.byteSize,
        checksum: stored.checksum,
      });
    } catch (error) {
      await reclaim(stored.storageKey);
      throw error;
    }

    publishAfterCommit(
      c.get('postCommitHooks'),
      c.get('user').id,
      'file_uploaded',
      projectId,
      await fileWithUsage(c, projectId, row.id)
    );
    return c.json(serializeFile(row), 201);
  }
);

filesRouter.get(
  '/:id/download',
  describeRoute({
    tags: ['Files'],
    summary: 'Download a file',
    description:
      'Served through the API rather than from a public bucket, because who may read the bytes depends on project membership. `version` selects one entry of the history; absent means the current one. Repeating the parameter is a 400 rather than a silent choice between the two values.',
    security: [{ bearerAuth: [] }],
    responses: {
      200: { description: 'The file bytes' },
      ...standardErrors,
    },
  }),
  queryValidator(versionQuerySchema),
  async (c) => {
    const id = c.req.param('id');
    await assertFileAccess(c, id);
    const db = c.get('db');
    const query = c.req.valid('query') as { version?: string };

    const row = await db
      .selectFrom('file')
      .select([
        'file.storage_key as storage_key',
        'file.filename as filename',
        'file.content_type as content_type',
        'file.byte_size as byte_size',
      ])
      .where('file.id', '=', id)
      .executeTakeFirstOrThrow();

    // The key, the type and the length all belong to whichever version is being
    // served. Swapping only the key streams old bytes under the current
    // version's length, which truncates them.
    let source: { storage_key: string; content_type: string; byte_size: string | number } = row;
    let suffix = '';
    if (query.version !== undefined) {
      const number = Number(query.version);
      const version = await lookupVersion(db, id, number);
      if (!version) throw new AppError(404, 'Version not found');
      source = version;
      suffix = `.v${number}`;
    }

    const object = await storage().getStream(source.storage_key);
    // A row whose object is gone is a 404, not a truncated 200. getStream
    // returns null before any byte is written for exactly this reason.
    if (!object) throw new AppError(404, 'File contents are unavailable');

    c.header('Content-Type', source.content_type);
    c.header('Content-Length', String(source.byte_size));
    // attachment, always. An inline Content-Disposition on user-supplied bytes
    // is how a stored file becomes same-origin script.
    c.header(
      'Content-Disposition',
      `attachment; filename*=UTF-8''${encodeURIComponent(`${row.filename}${suffix}`)}`
    );
    c.header('Cache-Control', 'private, max-age=0, must-revalidate');

    return c.body(Readable.toWeb(object.stream) as ReadableStream);
  }
);

filesRouter.get(
  '/:id/versions',
  describeRoute({
    tags: ['Files'],
    summary: "List a file's versions",
    description: 'Newest first. The current version is the highest number, flagged as is_current.',
    security: [{ bearerAuth: [] }],
    responses: {
      200: {
        description: 'The versions',
        content: { 'application/json': { schema: resolver(fileVersionListSchema) } },
      },
      ...standardErrors,
    },
  }),
  async (c) => {
    const id = c.req.param('id');
    await assertFileAccess(c, id, 'read');
    const db = c.get('db');

    const rows = await db
      .selectFrom('file_version')
      .select(VERSION_COLUMNS)
      .where('file_version.file_id', '=', id)
      .orderBy('file_version.version_number', 'desc')
      .execute();

    const versions = rows.length > 0 ? rows : [await mirrorAsVersionOne(db, id)];
    const currentNumber = versions[0].version_number;

    return c.json({ versions: versions.map((row) => serializeVersion(row, currentNumber)) });
  }
);

filesRouter.post(
  '/:id/versions',
  describeRoute({
    tags: ['Files'],
    summary: 'Append a version',
    description:
      'The request body is the bytes, as the upload route does it. Bytes identical to the current version answer 200 and create nothing.',
    security: [{ bearerAuth: [] }],
    responses: {
      200: {
        description: 'The bytes were already the current version',
        content: { 'application/json': { schema: resolver(fileVersionResultSchema) } },
      },
      201: {
        description: 'Created',
        content: { 'application/json': { schema: resolver(fileVersionResultSchema) } },
      },
      ...conflictErrorResponse,
      ...forbiddenErrorResponse,
      ...payloadTooLargeErrorResponse,
      ...standardErrors,
    },
  }),
  async (c) => {
    const id = c.req.param('id');
    const access = await assertFileAccess(c, id, 'write');

    // Checked before the transfer on what the client claims, and again below on
    // what actually arrived.
    const declaredLength = Number(c.req.header('content-length') ?? 0);
    assertUploadSize(declaredLength);
    if (declaredLength > 0) await assertQuota(c, access.projectId, declaredLength);

    const body = c.req.raw.body;
    if (!body) throw new AppError(400, 'Request body is required');

    const stored = await storeUpload(
      Readable.fromWeb(body as Parameters<typeof Readable.fromWeb>[0]),
      MAX_UPLOAD_BYTES,
      c.req.header('content-type') ?? 'application/octet-stream'
    );

    let result;
    try {
      await assertQuota(c, access.projectId, stored.byteSize);
      result = await appendFileVersion(c, id, {
        storageKey: stored.storageKey,
        contentType: stored.contentType,
        byteSize: stored.byteSize,
        checksum: stored.checksum,
      });
    } catch (error) {
      await reclaim(stored.storageKey);
      throw error;
    }

    const version = serializeVersion(result.version, result.version.version_number);
    if (!result.created) {
      return c.json({ created: false, version }, 200);
    }

    publishAfterCommit(
      c.get('postCommitHooks'),
      c.get('user').id,
      'file_version_created',
      access.projectId,
      await versionEventData(c, access.projectId, id, version)
    );
    return c.json({ created: true, version }, 201);
  }
);

filesRouter.post(
  '/:id/versions/:number/restore',
  describeRoute({
    tags: ['Files'],
    summary: 'Restore a version',
    description:
      'Copies that version forward as a new one. History only ever grows, so the number goes up rather than back. Restoring the version that is already current creates nothing.',
    security: [{ bearerAuth: [] }],
    responses: {
      200: {
        description: 'That version was already current',
        content: { 'application/json': { schema: resolver(fileVersionResultSchema) } },
      },
      201: {
        description: 'Restored',
        content: { 'application/json': { schema: resolver(fileVersionResultSchema) } },
      },
      ...conflictErrorResponse,
      ...forbiddenErrorResponse,
      ...payloadTooLargeErrorResponse,
      ...standardErrors,
    },
  }),
  async (c) => {
    const id = c.req.param('id');
    const access = await assertFileAccess(c, id, 'write');
    const db = c.get('db');

    // Refused up here rather than left to the append below, so no object is
    // copied for a row that is going to refuse it anyway.
    const target = await db
      .selectFrom('file')
      .select(['file.deleted_at as deleted_at'])
      .where('file.id', '=', id)
      .executeTakeFirst();
    if (target?.deleted_at != null) {
      throw new AppError(409, 'That file is deleted. Restore it before adding a version');
    }

    // A number this path could never address is a 404 rather than a 400: the
    // URL names a resource that does not exist.
    const number = Number(c.req.param('number'));
    if (!Number.isInteger(number) || number < 1) throw new AppError(404, 'Version not found');

    const source = await lookupVersion(db, id, number);
    if (!source) throw new AppError(404, 'Version not found');

    const currentNumber = await currentVersionNumber(db, id);
    if (source.version_number === currentNumber) {
      return c.json({ created: false, version: serializeVersion(source, currentNumber) }, 200);
    }

    // A restore adds bytes to the project like any other append, so it is
    // metered like one.
    await assertQuota(c, access.projectId, Number(source.byte_size));

    const destinationKey = newId();
    try {
      await storage().copy(source.storage_key, destinationKey);
    } catch {
      // A copy can fail after writing part of the destination -- fs.copyFile
      // and a resumable GCS copy both can -- and nothing will ever name those
      // bytes.
      await reclaim(destinationKey);
      throw new AppError(404, 'File contents are unavailable');
    }

    let result;
    try {
      result = await appendFileVersion(c, id, {
        storageKey: destinationKey,
        contentType: source.content_type,
        byteSize: Number(source.byte_size),
        checksum: source.checksum,
        imageWidth: source.image_width,
        imageHeight: source.image_height,
      });
    } catch (error) {
      await reclaim(destinationKey);
      throw error;
    }

    const version = serializeVersion(result.version, result.version.version_number);
    if (!result.created) {
      return c.json({ created: false, version }, 200);
    }

    publishAfterCommit(
      c.get('postCommitHooks'),
      c.get('user').id,
      'file_version_created',
      access.projectId,
      await versionEventData(c, access.projectId, id, version)
    );
    return c.json({ created: true, version }, 201);
  }
);

filesRouter.get(
  '/:id',
  describeRoute({
    tags: ['Files'],
    summary: 'Read one file row',
    description:
      'A screen addressed by file id -- the 3D studio -- has to resolve the row on a cold load, before it knows which folder the file is in.',
    security: [{ bearerAuth: [] }],
    responses: {
      200: {
        description: 'The file',
        content: { 'application/json': { schema: resolver(fileSchema) } },
      },
      ...standardErrors,
    },
  }),
  async (c) => {
    const id = c.req.param('id');
    await assertFileAccess(c, id, 'read');

    const row = await c
      .get('db')
      .selectFrom('file')
      .select(FILE_COLUMNS)
      .where('file.id', '=', id)
      .executeTakeFirstOrThrow();

    return c.json(serializeFile(row));
  }
);

filesRouter.patch(
  '/:id',
  describeRoute({
    tags: ['Files'],
    summary: 'Rename or move a file',
    security: [{ bearerAuth: [] }],
    responses: {
      200: {
        description: 'Updated',
        content: { 'application/json': { schema: resolver(fileSchema) } },
      },
      ...conflictErrorResponse,
      ...forbiddenErrorResponse,
      ...validationErrorResponse,
      ...standardErrors,
    },
  }),
  jsonValidator(updateFileRequestSchema),
  async (c) => {
    const id = c.req.param('id');
    const access = await assertFileAccess(c, id, 'write');
    const body = c.req.valid('json') as {
      filename?: string;
      folder_id?: string | null;
      name_locked?: boolean;
    };
    const db = c.get('db');

    if (body.folder_id !== undefined && body.folder_id !== null) {
      const folder = await db
        .selectFrom('folder')
        .select(['folder.id as id'])
        .where('folder.id', '=', body.folder_id)
        .where('folder.project_id', '=', access.projectId)
        .executeTakeFirst();
      if (!folder) throw new AppError(404, 'Folder not found');
      if ((await deletedAncestor(db, body.folder_id)) !== null) {
        throw new AppError(404, 'Folder not found');
      }
    }

    try {
      const row = await db
        .updateTable('file')
        .set({
          ...(body.filename !== undefined ? { filename: body.filename } : {}),
          ...(body.folder_id !== undefined ? { folder_id: body.folder_id } : {}),
          // A rename here is a person naming the file, which is what an import
          // must not overwrite. Sent explicitly, it is the way back out.
          ...(body.name_locked !== undefined
            ? { name_locked: body.name_locked }
            : body.filename !== undefined
              ? { name_locked: true }
              : {}),
          updated_at: new Date(),
        })
        .where('file.id', '=', id)
        // A tombstone no longer holds its name in the index, so renaming one
        // could take any name at all; moving one would make the path the
        // deleted listing reports a lie.
        .where('file.deleted_at', 'is', null)
        .returning(FILE_COLUMNS)
        .executeTakeFirst();
      if (!row) throw new AppError(409, 'That file is deleted. Restore it first');
      const updated = serializeFile(row);
      publishAfterCommit(
        c.get('postCommitHooks'),
        c.get('user').id,
        'file_updated',
        access.projectId,
        updated
      );
      return c.json(updated);
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new AppError(409, 'A file with that name already exists there');
      }
      throw error;
    }
  }
);

filesRouter.delete(
  '/:id',
  describeRoute({
    tags: ['Files'],
    summary: 'Delete a file',
    description:
      'Soft by default: the row is tombstoned and every version keeps its bytes, so a restore is exact. `purge=true` is the irreversible one and the only path that reclaims storage. Only the literal word is accepted, and repeating the parameter is a 400. A repeat delete answers 204 either way.',
    security: [{ bearerAuth: [] }],
    responses: {
      204: { description: 'Deleted' },
      ...forbiddenErrorResponse,
      ...standardErrors,
    },
  }),
  queryValidator(purgeQuerySchema),
  async (c) => {
    const id = c.req.param('id');
    const access = await assertFileAccess(c, id, 'write');
    const db = c.get('db');

    // Locked before anything is read: appendFileVersion takes the same row
    // lock, so an append cannot commit in the window between the keys being
    // collected and the delete, which would leave its object named by nothing.
    await db
      .selectFrom('file')
      .select(['file.id as id'])
      .where('file.id', '=', id)
      .forUpdate()
      .execute();

    if (!purgeRequested(c.req.valid('query') as { purge?: string })) {
      const marked = await db
        .updateTable('file')
        .set({ deleted_at: new Date(), deleted_by: c.get('user').id })
        // A repeat delete leaves the first one's record intact.
        .where('file.id', '=', id)
        .where('file.deleted_at', 'is', null)
        .returning(['file.id as id'])
        .executeTakeFirst();

      if (marked) {
        publishAfterCommit(
          c.get('postCommitHooks'),
          c.get('user').id,
          'file_deleted',
          access.projectId,
          {
            ...(await fileWithUsage(c, access.projectId, id)),
            purged: false,
          }
        );
      }
      return c.body(null, 204);
    }

    // Read before the delete: the foreign key cascade takes these rows with the
    // file, and nothing else names the objects they point at.
    const versions = await db
      .selectFrom('file_version')
      .select(['file_version.storage_key as storage_key'])
      .where('file_version.file_id', '=', id)
      .execute();

    // Before the delete: afterwards there is no row left to describe.
    const doomed = await fileWithUsage(c, access.projectId, id);

    const row = await db
      .deleteFrom('file')
      .where('file.id', '=', id)
      .returning(['file.storage_key as storage_key'])
      .executeTakeFirst();

    if (row) {
      const keys = new Set<string>([row.storage_key, ...versions.map((v) => v.storage_key)]);
      deleteStoredObjectsAfterCommit(c.get('postCommitHooks'), [...keys]);
      publishAfterCommit(
        c.get('postCommitHooks'),
        c.get('user').id,
        'file_deleted',
        access.projectId,
        {
          ...doomed,
          // The sum is taken before the rows go, so it still counts this file.
          storage_used_bytes: await projectStorageUsed(c, access.projectId),
          purged: true,
        }
      );
    }
    return c.body(null, 204);
  }
);

filesRouter.post(
  '/:id/restore',
  describeRoute({
    tags: ['Files'],
    summary: 'Restore a deleted file',
    description:
      'Takes an optional `filename`, because the old one may have been taken while the file was gone. Renaming first would leave a window in which the tombstone still held it. Restoring a file that is not deleted answers 200 and changes nothing.',
    security: [{ bearerAuth: [] }],
    responses: {
      200: {
        description: 'Restored',
        content: { 'application/json': { schema: resolver(fileSchema) } },
      },
      ...conflictErrorResponse,
      ...forbiddenErrorResponse,
      ...standardErrors,
    },
  }),
  queryValidator(restoreFileQuerySchema),
  async (c) => {
    const id = c.req.param('id');
    await assertFileAccess(c, id, 'write');
    const query = c.req.valid('query') as { filename?: string };

    // A name typed into the Deleted view is a name a person chose, so it locks.
    const restored = await restoreFile(c, id, {
      filename: query.filename,
      lockName: query.filename !== undefined,
    });
    return c.json(restored);
  }
);
