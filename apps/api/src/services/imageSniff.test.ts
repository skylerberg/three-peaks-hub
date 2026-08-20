import { describe, expect, it } from 'vitest';
import { SNIFF_BYTES, sniffImageType } from './imageSniff.ts';

const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0]);
const gif = Buffer.from('GIF89a......', 'latin1');
const webp = Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBP')]);

describe('sniffImageType', () => {
  it.each([
    ['png', png, 'image/png'],
    ['jpeg', jpeg, 'image/jpeg'],
    ['gif', gif, 'image/gif'],
    ['webp', webp, 'image/webp'],
  ])('identifies %s', (_name, buffer, expected) => {
    expect(sniffImageType(buffer)).toBe(expected);
  });

  it('rejects a buffer shorter than the signature it would match', () => {
    expect(sniffImageType(Buffer.from([0x89, 0x50]))).toBeNull();
  });

  // The whole point: a RIFF container that is not WebP (a .wav, say) must not
  // pass as an image because its first four bytes match.
  it('does not accept RIFF without the WEBP tag', () => {
    const wav = Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WAVE')]);
    expect(sniffImageType(wav)).toBeNull();
  });

  it('does not accept HTML that claims to be an image', () => {
    expect(sniffImageType(Buffer.from('<!doctype html'))).toBeNull();
  });

  it('reads within the documented peek length', () => {
    expect(webp.length).toBeLessThanOrEqual(SNIFF_BYTES);
  });
});
