import type { Texture } from 'three';
import { authHeader } from '../../api/client.ts';
import { textureFrom } from './materials/canvas.ts';
import type { ImageDataLike } from './shapes/trace.ts';

// Both the artwork texture and the traced outline come off one raster, and the
// trace walks every pixel -- so this is a bound on how long dragging a slider
// can take, as much as on texture size.
const MAX_SOURCE_PIXELS = 1024;

export interface SourceImage {
  canvas: HTMLCanvasElement;
  pixels: ImageDataLike;
  // Present only for an SVG. The outline then comes from the path data rather
  // than from tracing the raster below it, which is the whole reason to accept
  // vector sources at all.
  svgText: string | null;
}

function fit(width: number, height: number): { width: number; height: number } {
  const longest = Math.max(width, height);
  if (longest <= MAX_SOURCE_PIXELS) return { width, height };
  const scale = MAX_SOURCE_PIXELS / longest;
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

function draw(source: CanvasImageSource, width: number, height: number): SourceImage['canvas'] {
  const size = fit(width, height);
  const canvas = document.createElement('canvas');
  canvas.width = size.width;
  canvas.height = size.height;

  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) throw new Error('This browser did not give up a 2D canvas context');
  context.drawImage(source, 0, 0, size.width, size.height);
  return canvas;
}

function readPixels(canvas: HTMLCanvasElement): ImageDataLike {
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) throw new Error('This browser did not give up a 2D canvas context');
  return context.getImageData(0, 0, canvas.width, canvas.height);
}

// An SVG has no pixel size of its own, so it is rasterised at the cap rather
// than at whatever width the document happens to declare.
async function rasterizeSvg(text: string): Promise<HTMLCanvasElement> {
  const url = URL.createObjectURL(new Blob([text], { type: 'image/svg+xml' }));
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    const width = image.naturalWidth || MAX_SOURCE_PIXELS;
    const height = image.naturalHeight || MAX_SOURCE_PIXELS;
    const scale = MAX_SOURCE_PIXELS / Math.max(width, height);
    return draw(image, width * scale, height * scale);
  } finally {
    URL.revokeObjectURL(url);
  }
}

export async function loadSource(fileId: string, contentType: string): Promise<SourceImage> {
  const response = await fetch(`/api/files/${fileId}/download`, { headers: authHeader() });
  if (!response.ok) throw new Error(`Could not read the image (status ${response.status})`);

  if (contentType === 'image/svg+xml') {
    const svgText = await response.text();
    const canvas = await rasterizeSvg(svgText);
    return { canvas, pixels: readPixels(canvas), svgText };
  }

  const bitmap = await createImageBitmap(await response.blob());
  try {
    const canvas = draw(bitmap, bitmap.width, bitmap.height);
    return { canvas, pixels: readPixels(canvas), svgText: null };
  } finally {
    bitmap.close();
  }
}

export function sourceTexture(source: SourceImage): Texture {
  return textureFrom(source.canvas, true);
}
