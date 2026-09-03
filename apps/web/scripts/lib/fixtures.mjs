// Images for the probes to upload, written rather than checked in.
//
// The base64 blob this replaced was not a valid PNG: its IDAT carried a bad
// adler32 and its IEND was a byte short. Browsers and the API's magic-byte
// sniffer both took it anyway, so it worked for years -- and a strict decoder
// refuses it, which is how it surfaced. A generator cannot rot that way, and it
// is also the only form a reviewer can read in a diff.
import { deflateSync } from 'node:zlib';

const CRC_TABLE = Array.from({ length: 256 }, (_value, n) => {
  let c = n;
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const typed = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typed));
  return Buffer.concat([length, typed, crc]);
}

/**
 * A flat opaque PNG of one colour: 8-bit truecolour, no interlace, one IDAT.
 *
 * The colour is what makes several of these tellable apart once they are inside
 * a PDF, which is the whole reason a probe wants more than one.
 */
export function solidPng({ width = 4, height = width, rgb = [255, 255, 255] } = {}) {
  const stride = width * 3 + 1;
  const raw = Buffer.alloc(height * stride);
  for (let y = 0; y < height; y += 1) {
    const row = y * stride;
    // Filter type 0 (None) for every scanline, which is the leading byte.
    raw[row] = 0;
    for (let x = 0; x < width; x += 1) {
      raw[row + 1 + x * 3] = rgb[0];
      raw[row + 2 + x * 3] = rgb[1];
      raw[row + 3 + x * 3] = rgb[2];
    }
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // colour type: truecolour

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// Something the API will accept as an image, for the two probes that do not
// care what it looks like: one only needs the studio to open on it, the other
// only needs a row that draws a thumbnail.
export const TINY_PNG = solidPng({ width: 4, rgb: [255, 255, 255] });
