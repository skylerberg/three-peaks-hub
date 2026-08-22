// Fixtures for zip.test.ts. Every knob here exists because some refusal in
// zip.ts is otherwise unreachable, and a refusal no fixture can reach is a
// branch the suite reports green without ever having run it.

interface BuildEntry {
  name: string;
  bytes: Uint8Array;
  method?: 0 | 8;
  flags?: number;
  nameBytes?: Uint8Array;
  localExtra?: Uint8Array;
  centralExtra?: Uint8Array;
  versionNeeded?: number;
  entryDisk?: number;
  // What macOS `ditto` does to every local header: crc and both sizes are
  // deferred to a data descriptor and written as zero here.
  zeroLocalSizes?: boolean;
  sizeSentinel?: boolean;
  // What the central directory says came out, where the entry's own bytes say
  // otherwise -- the declaration a reader acts on before it inflates anything.
  uncompressedSizeOverride?: number;
  dataOverride?: Uint8Array;
  compressedSizeOverride?: number;
}

interface BuildOptions {
  comment?: Uint8Array;
  thisDisk?: number;
  startDisk?: number;
  diskEntries?: number;
  totalEntries?: number;
  directorySize?: number;
  directoryOffset?: number;
  // Laid down between the directory and the end record, where a ZIP64 archive
  // keeps its own end record and locator.
  beforeEnd?: Uint8Array;
}

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

// Deliberately a second implementation of the one in zip.ts: a fixture whose
// checksums come from the code under test agrees with itself however wrong the
// table is.
function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

async function deflateRaw(bytes: Uint8Array): Promise<Uint8Array> {
  const source = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(bytes);
      controller.close();
    },
  });
  const pair = new CompressionStream('deflate-raw') as unknown as ReadableWritablePair<
    Uint8Array,
    Uint8Array
  >;
  return new Uint8Array(await new Response(source.pipeThrough(pair)).arrayBuffer());
}

class Writer {
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

  toBytes(): Uint8Array {
    const out = new Uint8Array(this.#length);
    let at = 0;
    for (const part of this.#parts) {
      out.set(part, at);
      at += part.length;
    }
    return out;
  }
}

const SENTINEL = 0xffffffff;
const EMPTY = new Uint8Array(0);

export async function buildZip(
  entries: BuildEntry[],
  options: BuildOptions = {}
): Promise<Uint8Array> {
  const planned = [];
  for (const entry of entries) {
    const method = entry.method ?? 0;
    const deflated = method === 8 ? await deflateRaw(entry.bytes) : entry.bytes;
    const data = entry.dataOverride ?? deflated;
    planned.push({
      entry,
      method,
      data,
      compressedSize: entry.compressedSizeOverride ?? data.length,
      nameBytes: entry.nameBytes ?? new TextEncoder().encode(entry.name),
      crc: crc32(entry.bytes),
      localOffset: 0,
    });
  }

  const writer = new Writer();

  for (const item of planned) {
    item.localOffset = writer.length;
    const localExtra = item.entry.localExtra ?? EMPTY;
    writer.u32(0x04034b50);
    writer.u16(item.entry.versionNeeded ?? 20);
    writer.u16(item.entry.flags ?? 0);
    writer.u16(item.method);
    writer.u16(0);
    writer.u16(0);
    writer.u32(item.entry.zeroLocalSizes ? 0 : item.crc);
    writer.u32(item.entry.zeroLocalSizes ? 0 : item.compressedSize);
    writer.u32(item.entry.zeroLocalSizes ? 0 : item.entry.bytes.length);
    writer.u16(item.nameBytes.length);
    writer.u16(localExtra.length);
    writer.push(item.nameBytes);
    writer.push(localExtra);
    writer.push(item.data);
  }

  const directoryOffset = writer.length;
  for (const item of planned) {
    const centralExtra = item.entry.centralExtra ?? EMPTY;
    writer.u32(0x02014b50);
    writer.u16(20);
    writer.u16(item.entry.versionNeeded ?? 20);
    writer.u16(item.entry.flags ?? 0);
    writer.u16(item.method);
    writer.u16(0);
    writer.u16(0);
    writer.u32(item.crc);
    writer.u32(item.entry.sizeSentinel ? SENTINEL : item.compressedSize);
    writer.u32(
      item.entry.sizeSentinel
        ? SENTINEL
        : (item.entry.uncompressedSizeOverride ?? item.entry.bytes.length)
    );
    writer.u16(item.nameBytes.length);
    writer.u16(centralExtra.length);
    writer.u16(0);
    writer.u16(item.entry.entryDisk ?? 0);
    writer.u16(0);
    writer.u32(0);
    writer.u32(item.localOffset);
    writer.push(item.nameBytes);
    writer.push(centralExtra);
  }
  const directorySize = writer.length - directoryOffset;

  if (options.beforeEnd) writer.push(options.beforeEnd);

  const comment = options.comment ?? EMPTY;
  writer.u32(0x06054b50);
  writer.u16(options.thisDisk ?? 0);
  writer.u16(options.startDisk ?? 0);
  writer.u16(options.diskEntries ?? planned.length);
  writer.u16(options.totalEntries ?? planned.length);
  writer.u32(options.directorySize ?? directorySize);
  writer.u32(options.directoryOffset ?? directoryOffset);
  writer.u16(comment.length);
  writer.push(comment);

  return writer.toBytes();
}

export function zipBlob(bytes: Uint8Array): Blob {
  return new Blob([bytes as BlobPart], { type: 'application/zip' });
}

export function extraField(id: number, length: number): Uint8Array {
  const field = new Uint8Array(4 + length).fill(0x41);
  new DataView(field.buffer).setUint16(0, id, true);
  new DataView(field.buffer).setUint16(2, length, true);
  return field;
}
