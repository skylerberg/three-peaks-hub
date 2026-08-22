import { decodeEntryName } from './cp437.ts';

// A refusal a person is meant to read and act on. Every throw below carries one:
// a ZIP this cannot honestly parse must never come back as a shorter list of
// pages, because a page missing from an import tombstones the card it made.
export class ZipError extends Error {}

export interface ZipEntry {
  name: string;
  uncompressedSize: number;
  bytes(): Promise<Uint8Array>;
}

const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_SIGNATURE = 0x02014b50;
const LOCAL_SIGNATURE = 0x04034b50;
const ZIP64_EOCD_SIGNATURE = 0x06064b50;
const ZIP64_LOCATOR_SIGNATURE = 0x07064b50;

const EOCD_LENGTH = 22;
const CENTRAL_LENGTH = 46;
const LOCAL_LENGTH = 30;
const MAX_COMMENT_LENGTH = 0xffff;
const U16_SENTINEL = 0xffff;
const U32_SENTINEL = 0xffffffff;
const ZIP64_VERSION = 45;
const ZIP64_EXTRA_ID = 0x0001;

const NO_EOCD =
  'That file is not a ZIP: it has no end-of-central-directory record. Download the export from Canva again.';
const ZIP64 =
  'That ZIP uses the ZIP64 format, which this cannot read. Export fewer pages at a time, or unzip it and upload the images.';
const MULTI_VOLUME = 'That ZIP is split across several volumes, which this cannot read.';
const ENCRYPTED = 'That ZIP is password-protected, so its pages cannot be read.';

function damaged(index: number, total: number): ZipError {
  return new ZipError(
    `That ZIP’s directory is damaged (entry ${index} of ${total}). Download the export again.`
  );
}

// Table-driven and indexed rather than iterated: this runs over every byte of
// every page, and a megabyte image makes the difference measurable.
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

// The directory said how long this entry is and what it checksums to, and both
// were in hand before a byte was read. Bytes that disagree are a page's
// artwork: imported, they are versioned over a real card, and no later step
// looks at them closely enough to notice.
function reconciled(name: string, bytes: Uint8Array, size: number, crc: number): Uint8Array {
  if (bytes.length !== size) {
    throw new ZipError(
      `“${name}” holds ${bytes.length} bytes where the ZIP says ${size}. Download the export again.`
    );
  }
  if (crc32(bytes) !== crc) {
    throw new ZipError(
      `“${name}” does not match the checksum in the ZIP. Download the export again.`
    );
  }
  return bytes;
}

function misplaced(name: string): ZipError {
  return new ZipError(`“${name}” is not where the ZIP says it is. Download the export again.`);
}

// The trailing signature is not the record: an archive comment may contain those
// four bytes, and a fixture built that way sends a `lastIndexOf` scan 27 bytes
// past the real one. Only a candidate whose comment length reaches exactly the
// end of the file is the record.
function findEndOfCentralDirectory(view: DataView, length: number): number {
  const floor = Math.max(0, length - EOCD_LENGTH - MAX_COMMENT_LENGTH);
  for (let at = length - EOCD_LENGTH; at >= floor; at -= 1) {
    if (view.getUint32(at, true) !== EOCD_SIGNATURE) continue;
    if (at + EOCD_LENGTH + view.getUint16(at + 20, true) === length) return at;
  }
  return -1;
}

// A ZIP64 archive whose 32-bit fields all happen to fit still writes its own
// end record and the 20-byte locator between the directory and the tail, and 96
// bytes reaches back over both. The scan starts no earlier than the directory
// itself, so a stored page whose own bytes contain one of these signatures
// cannot be mistaken for one.
const ZIP64_TAIL_WINDOW = 96;

function hasZip64Record(view: DataView, eocdOffset: number, directoryOffset: number): boolean {
  const from = Math.max(directoryOffset, eocdOffset - ZIP64_TAIL_WINDOW);
  for (let at = from; at + 4 <= eocdOffset; at += 1) {
    const signature = view.getUint32(at, true);
    if (signature === ZIP64_EOCD_SIGNATURE || signature === ZIP64_LOCATOR_SIGNATURE) return true;
  }
  return false;
}

function hasZip64Extra(view: DataView, at: number, length: number): boolean {
  let cursor = at;
  const end = at + length;
  while (cursor + 4 <= end) {
    if (view.getUint16(cursor, true) === ZIP64_EXTRA_ID) return true;
    cursor += 4 + view.getUint16(cursor + 2, true);
  }
  return false;
}

async function inflateRaw(bytes: Uint8Array, entryName: string): Promise<Uint8Array> {
  const source = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(bytes);
      controller.close();
    },
  });
  // TS types the writable half as WritableStream<BufferSource>, which
  // pipeThrough will not take from a ReadableStream<Uint8Array>.
  const pair = new DecompressionStream('deflate-raw') as unknown as ReadableWritablePair<
    Uint8Array,
    Uint8Array
  >;
  try {
    return new Uint8Array(await new Response(source.pipeThrough(pair)).arrayBuffer());
  } catch {
    // The TypeError a failed inflate rejects with carries no message at all, so
    // naming the entry here is the only reason the screen has to show.
    throw new ZipError(`“${entryName}” could not be decompressed. The download may be incomplete.`);
  }
}

export async function readZip(file: Blob): Promise<ZipEntry[]> {
  const buffer = new Uint8Array(await file.arrayBuffer());
  const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);

  const eocd = findEndOfCentralDirectory(view, buffer.length);
  if (eocd === -1) throw new ZipError(NO_EOCD);

  const thisDisk = view.getUint16(eocd + 4, true);
  const startDisk = view.getUint16(eocd + 6, true);
  const diskEntries = view.getUint16(eocd + 8, true);
  const totalEntries = view.getUint16(eocd + 10, true);
  const directorySize = view.getUint32(eocd + 12, true);
  const directoryOffset = view.getUint32(eocd + 16, true);

  // The sentinels are checked before the disk numbers, because a ZIP64 archive
  // writes 0xFFFF into the very disk fields a multi-volume test reads -- and
  // the entry count is not the reliable tell either: a real ZIP64 fixture can
  // carry honest counts of 1 and 1 behind a 0xFFFFFFFF directory offset.
  if (
    thisDisk === U16_SENTINEL ||
    startDisk === U16_SENTINEL ||
    diskEntries === U16_SENTINEL ||
    totalEntries === U16_SENTINEL ||
    directorySize === U32_SENTINEL ||
    directoryOffset === U32_SENTINEL ||
    hasZip64Record(view, eocd, directoryOffset)
  ) {
    throw new ZipError(ZIP64);
  }

  if (thisDisk !== 0 || startDisk !== 0 || diskEntries !== totalEntries) {
    throw new ZipError(MULTI_VOLUME);
  }

  const directoryEnd = Math.min(directoryOffset + directorySize, buffer.length);
  const entries: ZipEntry[] = [];
  let at = directoryOffset;

  for (let index = 0; index < totalEntries; index += 1) {
    if (at + CENTRAL_LENGTH > directoryEnd) throw damaged(index + 1, totalEntries);
    if (view.getUint32(at, true) !== CENTRAL_SIGNATURE) throw damaged(index + 1, totalEntries);

    const versionNeeded = view.getUint16(at + 6, true);
    const flags = view.getUint16(at + 8, true);
    const method = view.getUint16(at + 10, true);
    const crc = view.getUint32(at + 16, true);
    const compressedSize = view.getUint32(at + 20, true);
    const uncompressedSize = view.getUint32(at + 24, true);
    const nameLength = view.getUint16(at + 28, true);
    const extraLength = view.getUint16(at + 30, true);
    const commentLength = view.getUint16(at + 32, true);
    const entryDisk = view.getUint16(at + 34, true);
    const localOffset = view.getUint32(at + 42, true);

    const stride = CENTRAL_LENGTH + nameLength + extraLength + commentLength;
    if (at + stride > directoryEnd) throw damaged(index + 1, totalEntries);

    if (entryDisk !== 0) throw new ZipError(MULTI_VOLUME);
    // Bit 0 is the classic password, bit 6 is strong encryption, and bit 13
    // says the directory's own values are masked -- which only ever happens
    // behind strong encryption, and leaves nothing here worth trusting.
    if ((flags & 0x0001) !== 0 || (flags & 0x0040) !== 0 || (flags & 0x2000) !== 0) {
      throw new ZipError(ENCRYPTED);
    }

    const name = decodeEntryName(
      buffer.subarray(at + CENTRAL_LENGTH, at + CENTRAL_LENGTH + nameLength),
      (flags & 0x0800) !== 0
    );

    // Ahead of the ZIP64 test below, because version-needed is not a ZIP64 flag
    // on its own: APPNOTE assigns 4.6 to BZIP2 and 6.3 to LZMA, so an archive
    // using either would be refused for a format it does not use.
    if (method !== 0 && method !== 8) {
      throw new ZipError(
        `“${name}” uses compression method ${method}, which this cannot read. Re-export it from Canva.`
      );
    }

    if (
      versionNeeded >= ZIP64_VERSION ||
      compressedSize === U32_SENTINEL ||
      uncompressedSize === U32_SENTINEL ||
      hasZip64Extra(view, at + CENTRAL_LENGTH + nameLength, extraLength)
    ) {
      throw new ZipError(ZIP64);
    }

    entries.push({
      name,
      uncompressedSize,
      // Inflated on demand: a sixty-page export otherwise doubles in memory
      // before the first page is posted, and the manifest needs names only.
      async bytes(): Promise<Uint8Array> {
        if (localOffset + LOCAL_LENGTH > buffer.length) throw misplaced(name);
        if (view.getUint32(localOffset, true) !== LOCAL_SIGNATURE) throw misplaced(name);

        // The local header's own extra-field length, never the directory's:
        // Info-ZIP 3.0 writes 24 central against 28 local and `ditto` writes 12
        // against 16, and the four bytes that puts the read out by are trailing
        // garbage a complete deflate stream inflates straight past.
        const dataStart =
          localOffset +
          LOCAL_LENGTH +
          view.getUint16(localOffset + 26, true) +
          view.getUint16(localOffset + 28, true);
        if (dataStart + compressedSize > buffer.length) throw misplaced(name);

        // DecompressionStream rejects zero bytes with that same empty
        // TypeError; a genuinely empty deflate stream is two bytes, not none.
        if (compressedSize === 0) {
          return reconciled(name, new Uint8Array(0), uncompressedSize, crc);
        }

        const data = buffer.subarray(dataStart, dataStart + compressedSize);
        const out = method === 0 ? data : await inflateRaw(data, name);
        return reconciled(name, out, uncompressedSize, crc);
      },
    });

    at += stride;
  }

  return entries;
}
