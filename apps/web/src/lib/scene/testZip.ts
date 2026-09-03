// A ZIP reader, for the tests of the writer beside it. It parses the archive
// from its end record inwards -- offsets, sizes, checksums and the local
// header's own extra field -- rather than reversing what writeZip did, which is
// the whole reason it is a second module and not a helper inside that one: a
// wrong offset or a wrong size has to fail against a parser that shares none of
// the writer's arithmetic.
//
// It reads only what this repo writes. An archive somebody else produced can be
// ZIP64, split across volumes or encrypted, and none of that is handled here --
// there is no longer anything in the app that opens a file a person supplied.

// There is no `cp437` Encoding label -- `new TextDecoder('cp437')` throws a
// RangeError in Node and in Chromium alike -- and windows-1252 is not a
// substitute, because CP437's upper half is box-drawing and Greek.
const CP437_HIGH =
  'ÇüéâäàåçêëèïîìÄÅÉæÆôöòûùÿÖÜ¢£¥₧ƒáíóúñÑªº¿⌐¬½¼¡«»░▒▓│┤╡╢╖╕╣║╗╝╜╛┐└┴┬├─┼╞╟╚╔╩╦╠═╬╧╨╤╥╙╘╒╓╫╪┘┌█▄▌▐▀αßΓπΣσµτΦΘΩδ∞φε∩≡±≥≤⌠⌡÷≈°∙·√ⁿ²■ ';

// The flag is honoured rather than assumed, so a name written without it comes
// back mangled here -- which is what makes "the writer flags its names as
// UTF-8" a claim a test can fail.
function decodeEntryName(bytes: Uint8Array, utf8Flag: boolean): string {
  if (utf8Flag) return new TextDecoder('utf-8').decode(bytes);
  let name = '';
  for (const byte of bytes) {
    name += byte < 0x80 ? String.fromCharCode(byte) : CP437_HIGH[byte - 0x80];
  }
  return name;
}

export interface ZipEntry {
  name: string;
  uncompressedSize: number;
  bytes(): Promise<Uint8Array>;
}

const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_SIGNATURE = 0x02014b50;
const LOCAL_SIGNATURE = 0x04034b50;

const EOCD_LENGTH = 22;
const CENTRAL_LENGTH = 46;
const LOCAL_LENGTH = 30;
const MAX_COMMENT_LENGTH = 0xffff;

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
// were in hand before a byte was read.
function reconciled(name: string, bytes: Uint8Array, size: number, crc: number): Uint8Array {
  if (bytes.length !== size) {
    throw new Error(`“${name}” holds ${bytes.length} bytes where the directory says ${size}`);
  }
  if (crc32(bytes) !== crc) throw new Error(`“${name}” does not match its checksum`);
  return bytes;
}

// The trailing signature is not the record: an entry's own bytes may contain
// those four, and a `lastIndexOf` scan then lands inside one. Only a candidate
// whose comment length reaches exactly the end of the file is the record.
function findEndOfCentralDirectory(view: DataView, length: number): number {
  const floor = Math.max(0, length - EOCD_LENGTH - MAX_COMMENT_LENGTH);
  for (let at = length - EOCD_LENGTH; at >= floor; at -= 1) {
    if (view.getUint32(at, true) !== EOCD_SIGNATURE) continue;
    if (at + EOCD_LENGTH + view.getUint16(at + 20, true) === length) return at;
  }
  return -1;
}

async function inflateRaw(bytes: Uint8Array): Promise<Uint8Array> {
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
  return new Uint8Array(await new Response(source.pipeThrough(pair)).arrayBuffer());
}

export async function readZip(file: Blob): Promise<ZipEntry[]> {
  const buffer = new Uint8Array(await file.arrayBuffer());
  const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);

  const eocd = findEndOfCentralDirectory(view, buffer.length);
  if (eocd === -1) throw new Error('no end-of-central-directory record');

  const totalEntries = view.getUint16(eocd + 10, true);
  const directorySize = view.getUint32(eocd + 12, true);
  const directoryOffset = view.getUint32(eocd + 16, true);
  const directoryEnd = Math.min(directoryOffset + directorySize, buffer.length);

  const entries: ZipEntry[] = [];
  let at = directoryOffset;

  for (let index = 0; index < totalEntries; index += 1) {
    if (at + CENTRAL_LENGTH > directoryEnd || view.getUint32(at, true) !== CENTRAL_SIGNATURE) {
      throw new Error(`the directory is damaged at entry ${index + 1} of ${totalEntries}`);
    }

    const flags = view.getUint16(at + 8, true);
    const method = view.getUint16(at + 10, true);
    const crc = view.getUint32(at + 16, true);
    const compressedSize = view.getUint32(at + 20, true);
    const uncompressedSize = view.getUint32(at + 24, true);
    const nameLength = view.getUint16(at + 28, true);
    const extraLength = view.getUint16(at + 30, true);
    const commentLength = view.getUint16(at + 32, true);
    const localOffset = view.getUint32(at + 42, true);

    const name = decodeEntryName(
      buffer.subarray(at + CENTRAL_LENGTH, at + CENTRAL_LENGTH + nameLength),
      (flags & 0x0800) !== 0
    );
    if (method !== 0 && method !== 8) {
      throw new Error(`“${name}” uses compression method ${method}`);
    }

    entries.push({
      name,
      uncompressedSize,
      async bytes(): Promise<Uint8Array> {
        if (
          localOffset + LOCAL_LENGTH > buffer.length ||
          view.getUint32(localOffset, true) !== LOCAL_SIGNATURE
        ) {
          throw new Error(`“${name}” is not where the directory says it is`);
        }

        // The local header's own name and extra lengths, never the directory's:
        // the two records are free to disagree about the extra field, and the
        // bytes that puts the read out by are trailing garbage a complete
        // deflate stream inflates straight past.
        const dataStart =
          localOffset +
          LOCAL_LENGTH +
          view.getUint16(localOffset + 26, true) +
          view.getUint16(localOffset + 28, true);
        if (dataStart + compressedSize > buffer.length) {
          throw new Error(`“${name}” runs past the end of the archive`);
        }

        // DecompressionStream rejects zero bytes with an empty TypeError; a
        // genuinely empty deflate stream is two bytes, not none.
        if (compressedSize === 0) {
          return reconciled(name, new Uint8Array(0), uncompressedSize, crc);
        }

        const data = buffer.subarray(dataStart, dataStart + compressedSize);
        return reconciled(
          name,
          method === 0 ? data : await inflateRaw(data),
          uncompressedSize,
          crc
        );
      },
    });

    at += CENTRAL_LENGTH + nameLength + extraLength + commentLength;
  }

  return entries;
}
