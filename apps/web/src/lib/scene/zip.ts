// The writer half of the container the reader in ../canva/zip.ts already walks.
// Neither imports the other: an import of a Canva export and an export of a
// Blender bundle share a file format and nothing else, and coupling them would
// drag the deck importer into this screen's chunk. What holds the two to one
// reading of the spec is zip.test.ts, which writes with this and reads back
// with that -- so a wrong checksum, a wrong size or a misplaced offset fails
// against a table and a parser written independently of these.
//
// There is no dependency here for the same reason there is none over there:
// deflate-raw is a stream every browser this targets already has.

// A refusal a person is meant to read. Nothing below fails on a bundle a ZIP
// can express, so a throw here means the export is past the format's own
// 32-bit ceiling -- which is worth saying plainly rather than writing an
// archive no reader will open.
export class ZipWriteError extends Error {}

export interface ZipInput {
  name: string;
  bytes: Uint8Array;
  // Deflated when set. scene.json is JSON and shrinks by an order of magnitude;
  // a .glb is mostly PNG already, and deflating it again buys a fraction of a
  // percent for the whole file's worth of CPU.
  compress?: boolean;
}

const LOCAL_SIGNATURE = 0x04034b50;
const CENTRAL_SIGNATURE = 0x02014b50;
const EOCD_SIGNATURE = 0x06054b50;

const VERSION = 20;
// Bit 11 says the name is UTF-8. Always set, because a reader that is not told
// is left sniffing, and a card named "Déck" that sniffs wrong is a different
// card.
const UTF8_FLAG = 0x0800;

const METHOD_STORE = 0;
const METHOD_DEFLATE = 8;

const MAX_ENTRIES = 0xffff;
const MAX_U32 = 0xffffffff;

const DOS_EPOCH_YEAR = 1980;

// Two exports of one selection have to differ in nothing but the timestamp they
// were handed, so the default is the earliest date a ZIP can express rather
// than the clock.
export const ZIP_EPOCH = new Date(DOS_EPOCH_YEAR, 0, 1);

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    table[index] = value >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (let at = 0; at < bytes.length; at += 1) {
    crc = CRC_TABLE[(crc ^ bytes[at]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

async function deflateRaw(bytes: Uint8Array): Promise<Uint8Array> {
  const source = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(bytes);
      controller.close();
    },
  });
  // Cast because the writable half is typed for BufferSource, which
  // pipeThrough refuses to accept a Uint8Array reader into.
  const pair = new CompressionStream('deflate-raw') as unknown as ReadableWritablePair<
    Uint8Array,
    Uint8Array
  >;
  return new Uint8Array(await new Response(source.pipeThrough(pair)).arrayBuffer());
}

// MS-DOS packs a date and a time into 16 bits each, at two-second resolution,
// in local time. Anything earlier than 1980 is unrepresentable rather than
// negative.
function dosStamp(at: Date): { time: number; date: number } {
  const year = Math.max(DOS_EPOCH_YEAR, at.getFullYear());
  return {
    time: (at.getHours() << 11) | (at.getMinutes() << 5) | (at.getSeconds() >> 1),
    date: ((year - DOS_EPOCH_YEAR) << 9) | ((at.getMonth() + 1) << 5) | at.getDate(),
  };
}

// Parts rather than one growing buffer: the bulk of a bundle is .glb that is
// already allocated, and a Blob assembles the pieces without copying every one
// of them through a second array on the way.
class ByteWriter {
  #parts: Uint8Array[] = [];
  #length = 0;

  get length(): number {
    return this.#length;
  }

  push(part: Uint8Array): void {
    this.#parts.push(part);
    this.#length += part.length;
  }

  u16(value: number): void {
    const part = new Uint8Array(2);
    new DataView(part.buffer).setUint16(0, value & 0xffff, true);
    this.push(part);
  }

  u32(value: number): void {
    const part = new Uint8Array(4);
    new DataView(part.buffer).setUint32(0, value >>> 0, true);
    this.push(part);
  }

  toBlob(type: string): Blob {
    return new Blob(this.#parts as BlobPart[], { type });
  }
}

interface PlannedEntry {
  nameBytes: Uint8Array;
  method: number;
  crc: number;
  compressedSize: number;
  uncompressedSize: number;
  localOffset: number;
}

function tooLarge(what: string): ZipWriteError {
  return new ZipWriteError(
    `This export is too large for a ZIP: ${what} passes 4 GB. Export fewer components at a time.`
  );
}

/**
 * Lays the archive down in the order a reader walks it back: every local header
 * with its data, then the central directory, then the end record naming where
 * that directory begins.
 *
 * Every entry is stamped with `modified`, so the bytes are a pure function of
 * the inputs and the one time the caller passes in.
 */
export async function writeZip(
  inputs: readonly ZipInput[],
  modified: Date = ZIP_EPOCH
): Promise<Blob> {
  if (inputs.length > MAX_ENTRIES) {
    throw new ZipWriteError(
      `A ZIP holds at most ${MAX_ENTRIES} entries and this export has ${inputs.length}.`
    );
  }

  const encoder = new TextEncoder();
  const stamp = dosStamp(modified);
  const writer = new ByteWriter();
  const planned: PlannedEntry[] = [];
  const names = new Set<string>();

  for (const input of inputs) {
    if (names.has(input.name)) {
      throw new ZipWriteError(`Two entries are both named “${input.name}”.`);
    }
    names.add(input.name);

    const data = input.compress ? await deflateRaw(input.bytes) : input.bytes;
    if (input.bytes.length > MAX_U32 || data.length > MAX_U32) throw tooLarge(`“${input.name}”`);

    const localOffset = writer.length;
    if (localOffset > MAX_U32) throw tooLarge('the archive');

    const entry: PlannedEntry = {
      nameBytes: encoder.encode(input.name),
      method: input.compress ? METHOD_DEFLATE : METHOD_STORE,
      crc: crc32(input.bytes),
      compressedSize: data.length,
      uncompressedSize: input.bytes.length,
      localOffset,
    };
    planned.push(entry);

    writer.u32(LOCAL_SIGNATURE);
    writer.u16(VERSION);
    writer.u16(UTF8_FLAG);
    writer.u16(entry.method);
    writer.u16(stamp.time);
    writer.u16(stamp.date);
    writer.u32(entry.crc);
    writer.u32(entry.compressedSize);
    writer.u32(entry.uncompressedSize);
    writer.u16(entry.nameBytes.length);
    writer.u16(0);
    writer.push(entry.nameBytes);
    writer.push(data);
  }

  const directoryOffset = writer.length;
  if (directoryOffset > MAX_U32) throw tooLarge('the archive');

  for (const entry of planned) {
    writer.u32(CENTRAL_SIGNATURE);
    writer.u16(VERSION);
    writer.u16(VERSION);
    writer.u16(UTF8_FLAG);
    writer.u16(entry.method);
    writer.u16(stamp.time);
    writer.u16(stamp.date);
    writer.u32(entry.crc);
    writer.u32(entry.compressedSize);
    writer.u32(entry.uncompressedSize);
    writer.u16(entry.nameBytes.length);
    writer.u16(0);
    writer.u16(0);
    writer.u16(0);
    writer.u16(0);
    writer.u32(0);
    writer.u32(entry.localOffset);
    writer.push(entry.nameBytes);
  }

  const directorySize = writer.length - directoryOffset;

  writer.u32(EOCD_SIGNATURE);
  writer.u16(0);
  writer.u16(0);
  writer.u16(planned.length);
  writer.u16(planned.length);
  writer.u32(directorySize);
  writer.u32(directoryOffset);
  writer.u16(0);

  return writer.toBlob('application/zip');
}
