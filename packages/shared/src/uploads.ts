// The cap on one upload, in bytes. Every caller pre-validates against it before
// a byte leaves the browser, so an oversized file is refused in a millisecond
// rather than after the whole transfer; the API re-checks what actually arrives,
// because a content-length is a claim.
export const MAX_UPLOAD_BYTES = 500 * 1024 * 1024;
// A project pays for every version it has kept and for everything it has
// deleted but not purged, so 1 GiB was roughly one deck.
export const PROJECT_STORAGE_QUOTA_BYTES = 10 * 1024 * 1024 * 1024;

// The web app pre-validates against this too. The API is the actual gate — and
// it decides an image's type by magic bytes, never by what the client declares
// here.
export const ALLOWED_IMAGE_TYPES = [
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
  'image/svg+xml',
] as const;

// The extension a stored image is named with. Keyed by the sniffed type rather
// than by whatever the upload was called, so a page named ".jpeg" by one
// exporter and ".jpg" by the next lands under one name either way.
const IMAGE_EXTENSIONS: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/svg+xml': 'svg',
};

export function extensionForImageType(contentType: string): string {
  return IMAGE_EXTENSIONS[contentType] ?? 'bin';
}

// What the 3D studio can turn into a mesh. GIF is absent deliberately: an
// animated source has no single frame to trace or to print onto a face.
export const MODEL_SOURCE_TYPES = [
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/svg+xml',
] as const;

export type ModelSourceType = (typeof MODEL_SOURCE_TYPES)[number];

export function isModelSource(contentType: string): contentType is ModelSourceType {
  return (MODEL_SOURCE_TYPES as readonly string[]).includes(contentType);
}

export const GLB_CONTENT_TYPE = 'model/gltf-binary';

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value < 10 ? value.toFixed(1) : Math.round(value)} ${units[unit]}`;
}

// The one sentence a refused upload is answered with, said by the browser
// before the transfer starts and by the API when an oversized body arrives
// anyway. `byteSize` is omitted only where the cap tripped mid-stream: the body
// was never fully read, so its total is a number nothing here knows. `subject`
// is how a caller that can name the file names it instead.
export function uploadTooLargeMessage(
  maxBytes: number,
  byteSize?: number,
  subject = 'That file'
): string {
  const limit = formatBytes(maxBytes);
  const size = byteSize === undefined ? null : formatBytes(byteSize);
  // A file a hair over rounds to the same string as the limit itself, and
  // "that file is 500 MB, over the 500 MB limit" reads as a contradiction
  // rather than as a refusal.
  const measured = size === null || size === limit ? `${subject} is` : `${subject} is ${size},`;
  return `${measured} over the ${limit} limit for one upload.`;
}
