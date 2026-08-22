// Images for the probes to upload, written rather than checked in.
//
// The base64 blob this replaced was not a valid PNG: its IDAT carried a bad
// adler32 and its IEND was a byte short. Browsers and the API's magic-byte
// sniffer both took it anyway, so it worked for years -- and a strict decoder
// refuses it, which is how it surfaced. A generator cannot rot that way, and it
// is also the only form a reviewer can read in a diff.
import { deflateRawSync, deflateSync } from 'node:zlib';

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

// The extra field, written at two different lengths on purpose.
//
// Info-ZIP 3.0 writes 24 bytes in the central directory against 28 in the local
// header, and `ditto` 12 against 16. A reader that starts its inflate from the
// central directory's length is then four bytes early on every entry -- and
// trailing garbage after a complete deflate stream inflates fine, so nothing
// downstream notices. An export built with both lengths equal cannot see that.
// Header id 0x5455 (extended timestamp), which is not the ZIP64 id a reader
// must refuse.
const LOCAL_EXTRA = Buffer.from([0x55, 0x54, 0x05, 0x00, 0x01, 0, 0, 0, 0]);
const CENTRAL_EXTRA = Buffer.from([0x55, 0x54, 0x01, 0x00, 0x01]);

// 1980-01-01 00:00, the earliest a DOS timestamp can name. Fixed, so two runs
// of the same probe build byte-identical archives.
const DOS_TIME = 0;
const DOS_DATE = 0x0021;

/**
 * A Canva export, as the real thing is shaped: entries named by page number and
 * page title, a central directory, and an end record.
 *
 * Built here rather than in the page under test. The browser's job in the probe
 * is to *parse* one, and a fixture made with `CompressionStream` in the same tab
 * would be testing the round trip of one implementation against itself.
 *
 * `method` picks stored (0) or deflate (8) per entry, and `utf8: false` leaves
 * the language-encoding flag clear over UTF-8 name bytes -- which is what macOS
 * writes, and the case a CP437 fallback gets wrong.
 */
export function canvaZip(entries) {
  const body = [];
  const directory = [];
  let offset = 0;

  for (const entry of entries) {
    const method = entry.method ?? 8;
    const raw = Buffer.from(entry.bytes);
    const data = method === 0 ? raw : deflateRawSync(raw);
    const name = Buffer.from(entry.name, 'utf8');
    const flags = entry.utf8 === false ? 0 : 0x0800;
    const crc = crc32(raw);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(flags, 6);
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(DOS_TIME, 10);
    local.writeUInt16LE(DOS_DATE, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(LOCAL_EXTRA.length, 28);
    body.push(local, name, LOCAL_EXTRA, data);

    const record = Buffer.alloc(46);
    record.writeUInt32LE(0x02014b50, 0);
    record.writeUInt16LE(20, 4);
    record.writeUInt16LE(20, 6);
    record.writeUInt16LE(flags, 8);
    record.writeUInt16LE(method, 10);
    record.writeUInt16LE(DOS_TIME, 12);
    record.writeUInt16LE(DOS_DATE, 14);
    record.writeUInt32LE(crc, 16);
    record.writeUInt32LE(data.length, 20);
    record.writeUInt32LE(raw.length, 24);
    record.writeUInt16LE(name.length, 28);
    record.writeUInt16LE(CENTRAL_EXTRA.length, 30);
    record.writeUInt16LE(0, 32); // comment length
    record.writeUInt16LE(0, 34); // the disk this entry starts on
    record.writeUInt16LE(0, 36); // internal attributes
    record.writeUInt32LE(0, 38); // external attributes
    record.writeUInt32LE(offset, 42);
    directory.push(record, name, CENTRAL_EXTRA);

    offset += local.length + name.length + LOCAL_EXTRA.length + data.length;
  }

  const central = Buffer.concat(directory);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(central.length, 12);
  end.writeUInt32LE(offset, 16);

  return Buffer.concat([...body, central, end]);
}
