import { createHash } from 'node:crypto';
import { Readable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { storeUpload } from './files.ts';
import { storage } from './storage/index.ts';

const BYTES = Buffer.from('a deck of sixty cards, front and back');
const EXPECTED = createHash('sha256').update(BYTES).digest('hex');

async function store(chunks: Buffer[]) {
  const stored = await storeUpload(Readable.from(chunks), 1024, 'application/octet-stream');
  await storage().delete(stored.storageKey);
  return stored;
}

describe('storeUpload', () => {
  it('records the sha-256 of the bytes it streamed', async () => {
    expect((await store([BYTES])).checksum).toBe(EXPECTED);
  });

  // The hash rides the same Transform the size cap does, so it sees whatever
  // chunking the socket produced rather than one buffer.
  it('computes the same checksum however the body is chunked', async () => {
    const chunks = [BYTES.subarray(0, 1), BYTES.subarray(1, 7), BYTES.subarray(7)];
    expect((await store(chunks)).checksum).toBe(EXPECTED);
  });
});
