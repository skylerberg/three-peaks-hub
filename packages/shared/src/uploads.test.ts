import { describe, expect, it } from 'vitest';
import { MAX_UPLOAD_BYTES, formatBytes, uploadTooLargeMessage } from './uploads.ts';

describe('formatBytes', () => {
  it.each([
    [0, '0 B'],
    [512, '512 B'],
    [1024, '1.0 KB'],
    [1536, '1.5 KB'],
    [10 * 1024, '10 KB'],
    [1024 * 1024, '1.0 MB'],
    [1024 * 1024 * 1024, '1.0 GB'],
  ])('formats %i as %s', (bytes, expected) => {
    expect(formatBytes(bytes)).toBe(expected);
  });

  // Stops at TB rather than running off the end of the unit list.
  it('caps at the largest unit', () => {
    expect(formatBytes(1024 ** 5)).toBe('1024 TB');
  });
});

describe('uploadTooLargeMessage', () => {
  it('names the size and the limit when both are known', () => {
    expect(uploadTooLargeMessage(MAX_UPLOAD_BYTES, 620 * 1024 * 1024)).toBe(
      'That file is 620 MB, over the 500 MB limit for one upload.'
    );
  });

  // What a body that overran the cap mid-stream can say: the transfer was cut
  // off, so its total was never counted.
  it('names the limit alone when the size is not known', () => {
    expect(uploadTooLargeMessage(MAX_UPLOAD_BYTES)).toBe(
      'That file is over the 500 MB limit for one upload.'
    );
  });

  it('drops a size that rounds to the limit rather than contradicting itself', () => {
    expect(uploadTooLargeMessage(MAX_UPLOAD_BYTES, MAX_UPLOAD_BYTES + 1)).toBe(
      'That file is over the 500 MB limit for one upload.'
    );
  });
});
