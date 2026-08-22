export const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;
export const MAX_AVATAR_BYTES = 11 * 1024 * 1024;
export const PROJECT_STORAGE_QUOTA_BYTES = 1024 * 1024 * 1024;

// The web app pre-validates against this so a 200 MB file fails in a
// millisecond instead of after 50 MB of transfer. The API is the actual gate —
// and it decides an image's type by magic bytes, never by what the client
// declares here.
export const ALLOWED_IMAGE_TYPES = [
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
  'image/svg+xml',
] as const;

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
