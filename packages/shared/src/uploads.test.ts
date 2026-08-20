import { describe, expect, it } from 'vitest';
import { formatBytes } from './uploads.ts';

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
