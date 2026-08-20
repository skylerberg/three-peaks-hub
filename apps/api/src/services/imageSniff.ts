// The client's declared Content-Type is ignored. It is user input, it decides
// how a browser will later render the bytes, and a .png that is actually HTML
// is a stored XSS if anything ever serves it inline.
//
// Twelve bytes is enough for every format here: the longest check is WebP's,
// which needs "RIFF" at 0 and "WEBP" at 8.
export const SNIFF_BYTES = 12;

export type SniffedImageType = 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp';

function startsWith(buffer: Buffer, bytes: number[], offset = 0): boolean {
  if (buffer.length < offset + bytes.length) return false;
  return bytes.every((byte, index) => buffer[offset + index] === byte);
}

export function sniffImageType(head: Buffer): SniffedImageType | null {
  // 89 50 4E 47 0D 0A 1A 0A
  if (startsWith(head, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'image/png';
  // FF D8 FF
  if (startsWith(head, [0xff, 0xd8, 0xff])) return 'image/jpeg';
  // "GIF87a" / "GIF89a"
  if (startsWith(head, [0x47, 0x49, 0x46, 0x38])) return 'image/gif';
  // "RIFF" .... "WEBP"
  if (startsWith(head, [0x52, 0x49, 0x46, 0x46]) && startsWith(head, [0x57, 0x45, 0x42, 0x50], 8)) {
    return 'image/webp';
  }
  return null;
}
