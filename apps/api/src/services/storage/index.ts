import { env } from '../../config/env.ts';
import { diskStorage } from './disk.ts';
import { gcsStorage } from './gcs.ts';
import type { StorageProvider } from './types.ts';

export type { StorageProvider } from './types.ts';

export function storage(): StorageProvider {
  return env.storage.driver === 'gcs' ? gcsStorage : diskStorage;
}

// Deleting the stored object is a post-commit hook, never part of the
// transaction: a rollback after the object is gone leaves a row pointing at
// nothing, which is worse than an orphaned object nothing points at.
export function deleteStoredObjectsAfterCommit(
  hooks: (() => void | Promise<void>)[],
  keys: string[]
): void {
  if (keys.length === 0) return;
  hooks.push(async () => {
    const provider = storage();
    await Promise.all(keys.map((key) => provider.delete(key).catch(() => {})));
  });
}
