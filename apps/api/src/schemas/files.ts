import { type } from 'arktype';
import { stringWithLength, uuid } from './common.ts';

export const folderSchema = type({
  id: 'string',
  project_id: 'string',
  parent_id: 'string | null',
  name: 'string',
  created_at: 'string',
  updated_at: 'string',
});

export const fileSchema = type({
  id: 'string',
  project_id: 'string',
  folder_id: 'string | null',
  filename: 'string',
  content_type: 'string',
  byte_size: 'number',
  image_width: 'number | null',
  image_height: 'number | null',
  uploaded_by: 'string',
  created_at: 'string',
  updated_at: 'string',
});

export const createFolderRequestSchema = type({
  'id?': uuid,
  project_id: uuid,
  'parent_id?': 'string.uuid | null',
  name: stringWithLength(1, 255),
});

export const updateFolderRequestSchema = type({
  'name?': stringWithLength(1, 255),
  'parent_id?': 'string.uuid | null',
});

export const updateFileRequestSchema = type({
  'filename?': stringWithLength(1, 255),
  'folder_id?': 'string.uuid | null',
});

// One request per screen: the folders and files directly inside one directory,
// plus the breadcrumb trail to it.
export const directoryListingSchema = type({
  project_id: 'string',
  folder: folderSchema.or('null'),
  breadcrumb: folderSchema.array(),
  folders: folderSchema.array(),
  files: fileSchema.array(),
  storage_used_bytes: 'number',
  storage_quota_bytes: 'number',
});

export const uploadQuerySchema = type({
  project_id: uuid,
  filename: stringWithLength(1, 255),
  'folder_id?': 'string.uuid',
  'id?': uuid,
});

export const directoryQuerySchema = type({
  project_id: uuid,
  'folder_id?': 'string.uuid',
});

// One entry of a file's history. storage_key is deliberately absent: the name
// of a stored object never crosses the wire.
export const fileVersionSchema = type({
  file_id: 'string',
  version_number: 'number',
  content_type: 'string',
  byte_size: 'number',
  // Null means the checksum is unknown, which is what a row backfilled from
  // before this table existed carries.
  checksum: 'string | null',
  image_width: 'number | null',
  image_height: 'number | null',
  created_by: 'string',
  created_at: 'string',
  is_current: 'boolean',
});

export const fileVersionListSchema = type({
  versions: fileVersionSchema.array(),
});

// One schema for both appending and restoring: two exported schemas with the
// same shape make the $ref the spec writes ambiguous and the dump refuses.
export const fileVersionResultSchema = type({
  created: 'boolean',
  version: fileVersionSchema,
});

// A string rather than a parsed number, because a query parameter is a string
// and the pattern is what the generated client carries.
export const versionQuerySchema = type({
  'version?': '/^[1-9][0-9]{0,8}$/',
});
