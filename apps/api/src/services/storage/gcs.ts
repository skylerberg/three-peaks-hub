import type { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { Storage } from '@google-cloud/storage';
import { env } from '../../config/env.ts';
import { isValidUuid } from '../../utils/uuid.ts';
import type { StorageProvider, StoredObject } from './types.ts';

// No key file: the pod runs as a Kubernetes service account bound to a GCP
// service account through Workload Identity, and Application Default
// Credentials picks that up.
let storage: Storage | null = null;

function bucket() {
  storage ??= new Storage();
  return storage.bucket(env.storage.gcsBucket);
}

function fileFor(key: string) {
  if (!isValidUuid(key)) throw new Error(`Refusing to use a non-uuid storage key: ${key}`);
  return bucket().file(key);
}

export const gcsStorage: StorageProvider = {
  async put(key, data, contentType) {
    await fileFor(key).save(data, { contentType, resumable: false });
  },

  async putStream(key, data, contentType) {
    await pipeline(data, fileFor(key).createWriteStream({ contentType, resumable: false }));
  },

  async get(key) {
    try {
      const [buffer] = await fileFor(key).download();
      return buffer;
    } catch {
      return null;
    }
  },

  async getStream(key): Promise<StoredObject | null> {
    const file = fileFor(key);
    let metadata;
    try {
      [metadata] = await file.getMetadata();
    } catch {
      return null;
    }

    // Pinned to the generation the metadata described. Without it a concurrent
    // overwrite would have the stream serving one object's bytes under
    // another's length. The generation belongs on the file handle; the read
    // stream has no option for it.
    const pinned = bucket().file(key, { generation: Number(metadata.generation) });
    const stream = pinned.createReadStream() as unknown as Readable;

    return {
      stream,
      contentType: metadata.contentType ?? 'application/octet-stream',
      byteSize: Number(metadata.size ?? 0),
    };
  },

  async copy(sourceKey, destKey) {
    await fileFor(sourceKey).copy(fileFor(destKey));
  },

  async delete(key) {
    await fileFor(key).delete({ ignoreNotFound: true });
  },
};
