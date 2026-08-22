import { createHash } from 'node:crypto';
import { Transform, type Readable } from 'node:stream';
import { PROJECT_STORAGE_QUOTA_BYTES } from '@three-peaks/shared';
import { AppError } from '../utils/errors.ts';
import { newId } from '../utils/uuid.ts';
import { SNIFF_BYTES, sniffContentType } from './imageSniff.ts';
import { deleteStoredObjectsAfterCommit, storage } from './storage/index.ts';
import type { AppContext } from '../types/index.ts';

export async function projectStorageUsed(
  c: Pick<AppContext, 'get'>,
  projectId: string
): Promise<number> {
  const db = c.get('db');
  const row = await db
    .selectFrom('file_version')
    .innerJoin('file', 'file.id', 'file_version.file_id')
    .select((eb) =>
      eb.fn.coalesce(eb.fn.sum<string>('file_version.byte_size'), eb.lit(0)).as('total')
    )
    .where('file.project_id', '=', projectId)
    .executeTakeFirst();
  return Number(row?.total ?? 0);
}

export async function assertQuota(
  c: Pick<AppContext, 'get'>,
  projectId: string,
  incomingBytes: number
): Promise<void> {
  const used = await projectStorageUsed(c, projectId);
  if (used + incomingBytes > PROJECT_STORAGE_QUOTA_BYTES) {
    throw new AppError(413, 'Project storage quota exceeded', {
      used_bytes: used,
      quota_bytes: PROJECT_STORAGE_QUOTA_BYTES,
    });
  }
}

export interface StoredUpload {
  storageKey: string;
  byteSize: number;
  contentType: string;
  checksum: string;
}

// Streams to storage, capping as it goes. Never buffers the whole body: the cap
// exists precisely because the body can be larger than memory, so a check that
// requires reading it first is not a check.
export async function storeUpload(
  body: Readable,
  maxBytes: number,
  declaredContentType: string
): Promise<StoredUpload> {
  const storageKey = newId();
  const provider = storage();

  let byteSize = 0;
  const digest = createHash('sha256');
  const head: Buffer[] = [];
  let headLength = 0;
  let overflowed = false;

  const counted = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      byteSize += chunk.length;
      if (byteSize > maxBytes) {
        overflowed = true;
        callback(new AppError(413, 'File is too large'));
        return;
      }
      if (headLength < SNIFF_BYTES) {
        head.push(chunk.subarray(0, SNIFF_BYTES - headLength));
        headLength += Math.min(chunk.length, SNIFF_BYTES - headLength);
      }
      // After the cap, so bytes that were refused never reach the hash.
      digest.update(chunk);
      callback(null, chunk);
    },
  });

  body.pipe(counted);

  try {
    // The content type written to storage is provisional; the sniffed answer
    // below is what the row records and what any later download serves.
    await provider.putStream(storageKey, counted, declaredContentType);
  } catch (error) {
    // A refused or failed upload can still have written bytes. Reclaim them,
    // and swallow any error doing so — a cleanup failure must not replace the
    // real response with a confusing one.
    await provider.delete(storageKey).catch(() => {});
    if (overflowed) throw new AppError(413, 'File is too large');
    throw error;
  }

  const sniffed = sniffContentType(Buffer.concat(head));
  return {
    storageKey,
    byteSize,
    checksum: digest.digest('hex'),
    // Anything unrecognised is stored as an opaque stream regardless of what it
    // claimed. Serving a client-declared type back is how a stored .html
    // becomes XSS.
    contentType: sniffed ?? 'application/octet-stream',
  };
}

interface VersionCandidate {
  storageKey: string;
  contentType: string;
  byteSize: number;
  checksum: string | null;
  imageWidth?: number | null;
  imageHeight?: number | null;
}

interface FileVersionRow {
  id: string;
  file_id: string;
  version_number: number;
  storage_key: string;
  content_type: string;
  byte_size: string;
  checksum: string | null;
  image_width: number | null;
  image_height: number | null;
  created_by: string;
  created_at: Date;
}

interface AppendResult {
  created: boolean;
  version: FileVersionRow;
}

const VERSION_COLUMNS = [
  'file_version.id as id',
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

// A null checksum is unknown, not empty, so two unknowns are never equal.
//
// The branch this answers reclaims candidate.storageKey and never the current
// version's, so what keeps it safe is the precondition documented below: the
// candidate names a freshly written object nothing else references. The one way
// a live object could reach it is a caller handing over the key the file row
// already points at, and the storage_key comparison on the adoption further
// down is what stops that key from becoming the version this then deduplicates
// away.
function sameBytes(current: { checksum: string | null }, candidate: VersionCandidate): boolean {
  return current.checksum !== null && current.checksum === candidate.checksum;
}

/**
 * Appends `candidate` to a file's history and re-points the mirror columns on
 * `file` at it. Every `file_version` row is written here, and so is every change
 * to the mirror bar the initial values `/upload` gives the row it creates.
 *
 * Runs on `c.get('db')` and opens no transaction of its own, so it must be
 * called from a method `transactionMiddleware` wraps — on a GET it would run
 * against the pool and the insert and the mirror update would not be atomic.
 *
 * `candidate.storageKey` must name a freshly written object nothing else
 * references: when the bytes turn out to be identical to the current version's
 * this reclaims that object.
 */
export async function appendFileVersion(
  c: Pick<AppContext, 'get'>,
  fileId: string,
  candidate: VersionCandidate
): Promise<AppendResult> {
  const db = c.get('db');

  // Held for the rest of the transaction, which is what makes
  // max(version_number) + 1 safe: without it two appends read the same number
  // and the second one dies on file_version_unique_number.
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
      'file.deleted_at as deleted_at',
    ])
    .where('file.id', '=', fileId)
    .forUpdate()
    .executeTakeFirst();

  // Gone by the time the lock was granted, which is what a delete that was
  // already waiting on it looks like from here. The row the caller resolved
  // access against no longer exists, so this is a 404 rather than a 500.
  if (!file) throw new AppError(404, 'File not found');

  // Refused here rather than in the routes, because this is the only writer:
  // one check covers the upload, the append, the version restore and every
  // import path that will ever reach them.
  if (file.deleted_at !== null) {
    throw new AppError(409, 'That file is deleted. Restore it before adding a version.');
  }

  let current = await db
    .selectFrom('file_version')
    .select(VERSION_COLUMNS)
    .where('file_version.file_id', '=', fileId)
    .orderBy('file_version.version_number', 'desc')
    .limit(1)
    .executeTakeFirst();

  // A file uploaded by a pod running the release before this table existed has
  // bytes and no version row. Adopt the mirror as version 1 before appending,
  // or this append overwrites the only reference to that object. The key
  // comparison is what tells such a row apart from the one /upload inserted
  // moments ago in this same transaction.
  if (!current && file.storage_key !== candidate.storageKey) {
    current = await db
      .insertInto('file_version')
      .values({
        id: newId(),
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
      })
      .returning(VERSION_COLUMNS)
      .executeTakeFirstOrThrow();
  }

  if (current && sameBytes(current, candidate)) {
    deleteStoredObjectsAfterCommit(c.get('postCommitHooks'), [candidate.storageKey]);
    return { created: false, version: current };
  }

  const inserted = await db
    .insertInto('file_version')
    .values({
      id: newId(),
      file_id: fileId,
      version_number: (current?.version_number ?? 0) + 1,
      storage_key: candidate.storageKey,
      content_type: candidate.contentType,
      byte_size: String(candidate.byteSize),
      checksum: candidate.checksum,
      image_width: candidate.imageWidth ?? null,
      image_height: candidate.imageHeight ?? null,
      created_by: c.get('user').id,
    })
    .returning(VERSION_COLUMNS)
    .executeTakeFirstOrThrow();

  await db
    .updateTable('file')
    .set({
      storage_key: candidate.storageKey,
      content_type: candidate.contentType,
      byte_size: String(candidate.byteSize),
      checksum: candidate.checksum,
      image_width: candidate.imageWidth ?? null,
      image_height: candidate.imageHeight ?? null,
      updated_at: new Date(),
    })
    .where('file.id', '=', fileId)
    .execute();

  return { created: true, version: inserted };
}
