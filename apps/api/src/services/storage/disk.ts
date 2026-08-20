import { createWriteStream, promises as fs } from 'node:fs';
import { join } from 'node:path';
import type { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { env } from '../../config/env.ts';
import { isValidUuid } from '../../utils/uuid.ts';
import type { StorageProvider, StoredObject } from './types.ts';

// Keys are server-generated uuids, and this re-checks that before touching the
// filesystem. Defence in depth: the key never comes from a client, and if a bug
// ever makes it so, `../..` must not be a path.
function resolveKey(key: string): string {
  if (!isValidUuid(key)) throw new Error(`Refusing to use a non-uuid storage key: ${key}`);
  return join(env.storage.diskRoot, key);
}

async function ensureRoot(): Promise<void> {
  await fs.mkdir(env.storage.diskRoot, { recursive: true });
}

const CONTENT_TYPE_SUFFIX = '.content-type';

export const diskStorage: StorageProvider = {
  async put(key, data, contentType) {
    await ensureRoot();
    const path = resolveKey(key);
    await fs.writeFile(path, data);
    await fs.writeFile(`${path}${CONTENT_TYPE_SUFFIX}`, contentType, 'utf8');
  },

  async putStream(key, data, contentType) {
    await ensureRoot();
    const path = resolveKey(key);
    await pipeline(data, createWriteStream(path));
    await fs.writeFile(`${path}${CONTENT_TYPE_SUFFIX}`, contentType, 'utf8');
  },

  async get(key) {
    try {
      return await fs.readFile(resolveKey(key));
    } catch {
      return null;
    }
  },

  async getStream(key): Promise<StoredObject | null> {
    const path = resolveKey(key);
    let handle;
    try {
      handle = await fs.open(path, 'r');
    } catch {
      return null;
    }
    // Stat the open descriptor rather than the path: between a path stat and
    // the open, the file can be replaced, and the size would then describe a
    // different object than the one being streamed.
    const stat = await handle.stat();
    const contentType = await fs
      .readFile(`${path}${CONTENT_TYPE_SUFFIX}`, 'utf8')
      .catch(() => 'application/octet-stream');
    const stream = handle.createReadStream() as unknown as Readable;
    return { stream, contentType, byteSize: stat.size };
  },

  async copy(sourceKey, destKey) {
    await ensureRoot();
    const source = resolveKey(sourceKey);
    const dest = resolveKey(destKey);
    await fs.copyFile(source, dest);
    await fs
      .copyFile(`${source}${CONTENT_TYPE_SUFFIX}`, `${dest}${CONTENT_TYPE_SUFFIX}`)
      .catch(() => {});
  },

  async delete(key) {
    const path = resolveKey(key);
    await fs.rm(path, { force: true });
    await fs.rm(`${path}${CONTENT_TYPE_SUFFIX}`, { force: true });
  },
};
