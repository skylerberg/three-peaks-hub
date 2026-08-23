import { createHash } from 'node:crypto';
import { Readable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { MAX_UPLOAD_BYTES, formatBytes } from '@three-peaks/shared';
import { AppError } from '../utils/errors.ts';
import { assertUploadSize, storeUpload } from './files.ts';
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

describe('storeUpload cap', () => {
  // The cap trips partway through a body that is still arriving, so the number
  // it can name is the limit and not the size.
  it('refuses a body past the cap, naming the limit', async () => {
    const over = Readable.from([Buffer.alloc(600), Buffer.alloc(600)]);
    await expect(storeUpload(over, 1024, 'application/octet-stream')).rejects.toMatchObject({
      statusCode: 413,
      message: 'That file is over the 1.0 KB limit for one upload.',
    });
  });

  // The bytes that got as far as storage before the cap tripped are the ones
  // nothing will ever point at again.
  it('leaves nothing stored behind a refused body', async () => {
    const keys: string[] = [];
    const provider = storage();
    const original = provider.putStream.bind(provider);
    provider.putStream = async (key, data, contentType) => {
      keys.push(key);
      return original(key, data, contentType);
    };

    try {
      await expect(
        storeUpload(Readable.from([Buffer.alloc(2048)]), 1024, 'application/octet-stream')
      ).rejects.toThrow();
    } finally {
      provider.putStream = original;
    }

    expect(keys).toHaveLength(1);
    expect(await provider.get(keys[0])).toBeNull();
  });
});

describe('assertUploadSize', () => {
  it('refuses a declared length past the cap, naming both numbers', () => {
    const declared = MAX_UPLOAD_BYTES * 2;
    expect(() => assertUploadSize(declared)).toThrow(
      new AppError(
        413,
        `That file is ${formatBytes(declared)}, over the ` +
          `${formatBytes(MAX_UPLOAD_BYTES)} limit for one upload.`
      )
    );
  });

  // One byte over is still over.
  it('refuses a declared length one byte past the cap', () => {
    expect(() => assertUploadSize(MAX_UPLOAD_BYTES + 1)).toThrow(AppError);
  });

  // A request with no content-length declares nothing, and the cap in
  // storeUpload is what holds it.
  it.each([0, MAX_UPLOAD_BYTES])('allows a declared length of %i', (declared) => {
    expect(() => assertUploadSize(declared)).not.toThrow();
  });
});
