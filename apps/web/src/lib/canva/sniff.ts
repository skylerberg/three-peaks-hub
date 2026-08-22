import { ALLOWED_IMAGE_TYPES } from '@three-peaks/shared';

export type SniffedImageType = (typeof ALLOWED_IMAGE_TYPES)[number];

// The server decides an image's type the same way and ignores what a request
// declares, so this exists to drop a ZIP's junk entries before they are posted
// -- not to talk the API into anything.
const SVG_HEAD_BYTES = 1024;

function startsWith(bytes: Uint8Array, magic: readonly number[], offset = 0): boolean {
  if (bytes.length < offset + magic.length) return false;
  return magic.every((byte, index) => bytes[offset + index] === byte);
}

// A declaration, comments and a doctype may all sit in front of the root tag.
// An unterminated one yields nothing, because a root tag has then not been seen.
function afterXmlPreamble(text: string): string {
  let rest = text;
  for (;;) {
    const trimmed = rest.replace(/^\s+/u, '');
    const open = trimmed.startsWith('<?') ? '?>' : trimmed.startsWith('<!--') ? '-->' : null;
    if (open === null) {
      if (!/^<!DOCTYPE/iu.test(trimmed)) return trimmed;
      const close = trimmed.indexOf('>');
      if (close === -1) return '';
      rest = trimmed.slice(close + 1);
      continue;
    }
    const end = trimmed.indexOf(open);
    if (end === -1) return '';
    rest = trimmed.slice(end + open.length);
  }
}

function isSvg(bytes: Uint8Array): boolean {
  const text = new TextDecoder('utf-8')
    .decode(bytes.subarray(0, SVG_HEAD_BYTES))
    .replace(/^\uFEFF/u, '');
  return /^<svg[\s/>]/iu.test(afterXmlPreamble(text));
}

export function sniffImageType(bytes: Uint8Array): SniffedImageType | null {
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'image/png';
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return 'image/jpeg';
  if (startsWith(bytes, [0x47, 0x49, 0x46, 0x38])) return 'image/gif';
  if (
    startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) &&
    startsWith(bytes, [0x57, 0x45, 0x42, 0x50], 8)
  ) {
    return 'image/webp';
  }
  return isSvg(bytes) ? 'image/svg+xml' : null;
}
