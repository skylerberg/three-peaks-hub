import { Readable } from 'node:stream';
import { Hono } from 'hono';
import { describeRoute, resolver } from 'hono-openapi';
import { MAX_UPLOAD_BYTES, PROJECT_STORAGE_QUOTA_BYTES } from '@three-peaks/shared';
import {
  assertFileAccess,
  assertFolderAccess,
  assertProjectAccess,
  assertProjectWrite,
} from '../services/authorization.ts';
import {
  appendFileVersion,
  assertQuota,
  projectStorageUsed,
  storeUpload,
} from '../services/files.ts';
import { deleteStoredObjectsAfterCommit, storage } from '../services/storage/index.ts';
import { publishAfterCommit } from '../services/realtime/index.ts';
import { jsonValidator, queryValidator } from '../middleware/validators.ts';
import { AppError, isUniqueViolation } from '../utils/errors.ts';
import { newId } from '../utils/uuid.ts';
import {
  createFolderRequestSchema,
  directoryListingSchema,
  directoryQuerySchema,
  fileSchema,
  fileVersionListSchema,
  fileVersionResultSchema,
  folderSchema,
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
import type { AppHono, Connection } from '../types/index.ts';

export const filesRouter: AppHono = new Hono();

const standardErrors = {
  ...unauthorizedErrorResponse,
  ...notFoundErrorResponse,
  ...internalServerErrorResponse,
};

// transactionMiddleware rethrows from inside the transaction, so a request that
// fails never reaches its post-commit hooks. Bytes already written therefore
// have to be reclaimed here and now, and a cleanup failure is swallowed rather
// than replacing the real response.
async function reclaim(storageKey: string): Promise<void> {
  await storage()
    .delete(storageKey)
    .catch(() => {});
}

type FolderRow = {
  id: string;
  project_id: string;
  parent_id: string | null;
  name: string;
  created_at: Date | string;
  updated_at: Date | string;
};

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

function serializeFile(row: {
  id: string;
  project_id: string;
  folder_id: string | null;
  filename: string;
  content_type: string;
  byte_size: string | number;
  image_width: number | null;
  image_height: number | null;
  uploaded_by: string;
  created_at: Date | string;
  updated_at: Date | string;
}) {
  return {
    id: row.id,
    project_id: row.project_id,
    folder_id: row.folder_id,
    filename: row.filename,
    content_type: row.content_type,
    // bigint arrives as a string from pg; the wire type is a number.
    byte_size: Number(row.byte_size),
    image_width: row.image_width,
    image_height: row.image_height,
    uploaded_by: row.uploaded_by,
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

function serializeVersion(row: VersionRow, currentNumber: number) {
  return {
    file_id: row.file_id,
    version_number: row.version_number,
    content_type: row.content_type,
    byte_size: Number(row.byte_size),
    checksum: row.checksum,
    image_width: row.image_width,
    image_height: row.image_height,
    created_by: row.created_by,
    created_at: new Date(row.created_at).toISOString(),
    is_current: row.version_number === currentNumber,
  };
}

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

// Walks parent_id up to the root. Bounded, because a cycle would otherwise be
// an infinite loop in a request handler — moves are checked for cycles, but a
// read must not depend on that having worked.
const MAX_BREADCRUMB_DEPTH = 64;

async function breadcrumb(db: Connection, folderId: string): Promise<FolderRow[]> {
  const trail: FolderRow[] = [];
  let cursor: string | null = folderId;
  for (let depth = 0; cursor && depth < MAX_BREADCRUMB_DEPTH; depth += 1) {
    const row: FolderRow | undefined = await db
      .selectFrom('folder')
      .select([
        'folder.id as id',
        'folder.project_id as project_id',
        'folder.parent_id as parent_id',
        'folder.name as name',
        'folder.created_at as created_at',
        'folder.updated_at as updated_at',
      ])
      .where('folder.id', '=', cursor)
      .executeTakeFirst();
    if (!row) break;
    trail.unshift(row);
    cursor = row.parent_id;
  }
  return trail;
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
        .select([
          'folder.id as id',
          'folder.project_id as project_id',
          'folder.parent_id as parent_id',
          'folder.name as name',
          'folder.created_at as created_at',
          'folder.updated_at as updated_at',
        ])
        .where('folder.id', '=', folderId)
        .where('folder.project_id', '=', projectId)
        .executeTakeFirst();
      if (!row) throw new AppError(404, 'Folder not found');
      current = row;
    }

    const [folders, files, trail, used] = await Promise.all([
      db
        .selectFrom('folder')
        .select([
          'folder.id as id',
          'folder.project_id as project_id',
          'folder.parent_id as parent_id',
          'folder.name as name',
          'folder.created_at as created_at',
          'folder.updated_at as updated_at',
        ])
        .where('folder.project_id', '=', projectId)
        .$if(folderId === null, (qb) => qb.where('folder.parent_id', 'is', null))
        .$if(folderId !== null, (qb) => qb.where('folder.parent_id', '=', folderId))
        .orderBy('folder.name', 'asc')
        .execute(),
      db
        .selectFrom('file')
        .select([
          'file.id as id',
          'file.project_id as project_id',
          'file.folder_id as folder_id',
          'file.filename as filename',
          'file.content_type as content_type',
          'file.byte_size as byte_size',
          'file.image_width as image_width',
          'file.image_height as image_height',
          'file.uploaded_by as uploaded_by',
          'file.created_at as created_at',
          'file.updated_at as updated_at',
        ])
        .where('file.project_id', '=', projectId)
        .$if(folderId === null, (qb) => qb.where('file.folder_id', 'is', null))
        .$if(folderId !== null, (qb) => qb.where('file.folder_id', '=', folderId))
        .orderBy('file.filename', 'asc')
        .execute(),
      folderId ? breadcrumb(db, folderId) : Promise.resolve([] as FolderRow[]),
      projectStorageUsed(c, projectId),
    ]);

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
        .returning(['id', 'project_id', 'parent_id', 'name', 'created_at', 'updated_at'])
        .executeTakeFirstOrThrow();
      publishAfterCommit(c.get('postCommitHooks'), c.get('user').id, 'folder_created', {
        project_id: body.project_id,
        folder_id: row.id,
      });
      return c.json(serializeFolder(row), 201);
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
        .returning(['id', 'project_id', 'parent_id', 'name', 'created_at', 'updated_at'])
        .executeTakeFirstOrThrow();
      publishAfterCommit(c.get('postCommitHooks'), c.get('user').id, 'folder_updated', {
        project_id: access.projectId,
        folder_id: id,
      });
      return c.json(serializeFolder(row));
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
    description: 'Cascades to everything inside it. Stored objects go after commit.',
    security: [{ bearerAuth: [] }],
    responses: {
      204: { description: 'Deleted' },
      ...forbiddenErrorResponse,
      ...standardErrors,
    },
  }),
  async (c) => {
    const id = c.req.param('id');
    const access = await assertFolderAccess(c, id, 'write');
    const db = c.get('db');

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

    await db.deleteFrom('folder').where('folder.id', '=', id).execute();

    const keys = new Set<string>();
    for (const row of descendants) {
      keys.add(row.storage_key);
      if (row.version_storage_key !== null) keys.add(row.version_storage_key);
    }

    deleteStoredObjectsAfterCommit(c.get('postCommitHooks'), [...keys]);
    publishAfterCommit(c.get('postCommitHooks'), c.get('user').id, 'folder_deleted', {
      project_id: access.projectId,
      folder_id: id,
    });

    return c.body(null, 204);
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
    }

    // Checked before the transfer on what the client claims, and again below on
    // what actually arrived — the header is a hint, not a guarantee.
    const declaredLength = Number(c.req.header('content-length') ?? 0);
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
        .returning([
          'id',
          'project_id',
          'folder_id',
          'filename',
          'content_type',
          'byte_size',
          'image_width',
          'image_height',
          'uploaded_by',
          'created_at',
          'updated_at',
        ])
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

    publishAfterCommit(c.get('postCommitHooks'), c.get('user').id, 'file_uploaded', {
      project_id: projectId,
      file_id: row.id,
    });
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

    publishAfterCommit(c.get('postCommitHooks'), c.get('user').id, 'file_version_created', {
      project_id: access.projectId,
      file_id: id,
    });
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
      ...forbiddenErrorResponse,
      ...payloadTooLargeErrorResponse,
      ...standardErrors,
    },
  }),
  async (c) => {
    const id = c.req.param('id');
    const access = await assertFileAccess(c, id, 'write');
    const db = c.get('db');

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

    publishAfterCommit(c.get('postCommitHooks'), c.get('user').id, 'file_version_created', {
      project_id: access.projectId,
      file_id: id,
    });
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
      .select([
        'file.id as id',
        'file.project_id as project_id',
        'file.folder_id as folder_id',
        'file.filename as filename',
        'file.content_type as content_type',
        'file.byte_size as byte_size',
        'file.image_width as image_width',
        'file.image_height as image_height',
        'file.uploaded_by as uploaded_by',
        'file.created_at as created_at',
        'file.updated_at as updated_at',
      ])
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
    const body = c.req.valid('json') as { filename?: string; folder_id?: string | null };
    const db = c.get('db');

    if (body.folder_id !== undefined && body.folder_id !== null) {
      const folder = await db
        .selectFrom('folder')
        .select(['folder.id as id'])
        .where('folder.id', '=', body.folder_id)
        .where('folder.project_id', '=', access.projectId)
        .executeTakeFirst();
      if (!folder) throw new AppError(404, 'Folder not found');
    }

    try {
      const row = await db
        .updateTable('file')
        .set({
          ...(body.filename !== undefined ? { filename: body.filename } : {}),
          ...(body.folder_id !== undefined ? { folder_id: body.folder_id } : {}),
          updated_at: new Date(),
        })
        .where('file.id', '=', id)
        .returning([
          'id',
          'project_id',
          'folder_id',
          'filename',
          'content_type',
          'byte_size',
          'image_width',
          'image_height',
          'uploaded_by',
          'created_at',
          'updated_at',
        ])
        .executeTakeFirstOrThrow();
      publishAfterCommit(c.get('postCommitHooks'), c.get('user').id, 'file_updated', {
        project_id: access.projectId,
        file_id: id,
      });
      return c.json(serializeFile(row));
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
    security: [{ bearerAuth: [] }],
    responses: {
      204: { description: 'Deleted' },
      ...forbiddenErrorResponse,
      ...standardErrors,
    },
  }),
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

    // Read before the delete: the foreign key cascade takes these rows with the
    // file, and nothing else names the objects they point at.
    const versions = await db
      .selectFrom('file_version')
      .select(['file_version.storage_key as storage_key'])
      .where('file_version.file_id', '=', id)
      .execute();

    const row = await db
      .deleteFrom('file')
      .where('file.id', '=', id)
      .returning(['file.storage_key as storage_key'])
      .executeTakeFirst();

    if (row) {
      const keys = new Set<string>([row.storage_key, ...versions.map((v) => v.storage_key)]);
      deleteStoredObjectsAfterCommit(c.get('postCommitHooks'), [...keys]);
      publishAfterCommit(c.get('postCommitHooks'), c.get('user').id, 'file_deleted', {
        project_id: access.projectId,
        file_id: id,
      });
    }
    return c.body(null, 204);
  }
);
