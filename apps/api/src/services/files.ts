import { Transform, type Readable } from 'node:stream';
import { PROJECT_STORAGE_QUOTA_BYTES } from '@three-peaks/shared';
import { AppError } from '../utils/errors.ts';
import { newId } from '../utils/uuid.ts';
import { SNIFF_BYTES, sniffImageType } from './imageSniff.ts';
import { storage } from './storage/index.ts';
import type { AppContext } from '../types/index.ts';

export async function projectStorageUsed(
  c: Pick<AppContext, 'get'>,
  projectId: string
): Promise<number> {
  const db = c.get('db');
  const row = await db
    .selectFrom('file')
    .select((eb) => eb.fn.coalesce(eb.fn.sum<string>('file.byte_size'), eb.lit(0)).as('total'))
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

  const sniffed = sniffImageType(Buffer.concat(head));
  return {
    storageKey,
    byteSize,
    // A non-image is stored as an opaque stream regardless of what it claimed.
    // Serving a client-declared type back is how a stored .html becomes XSS.
    contentType: sniffed ?? 'application/octet-stream',
  };
}
