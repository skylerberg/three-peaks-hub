import { pixelsForPrint } from '@three-peaks/shared';
import { authHeader } from '../../api/client.ts';

// Artwork on its way into a PDF. `data` is what jsPDF embeds, and `format` is
// what it is told the bytes are -- the two are the same fact, kept together so
// no caller can pair a PNG with 'JPEG'.
export interface PrintImage {
  data: Uint8Array;
  format: 'PNG' | 'JPEG';
  width: number;
  height: number;
}

// The one format a PDF holds as-is. A JPEG is embedded as a DCTDecode stream
// with nothing decoded on the way in, so the bytes the designer uploaded are
// the bytes that get printed.
//
// PNG is deliberately NOT in here, which looks like an oversight and is not:
// jsPDF decodes every PNG and re-encodes it as a Flate stream regardless, so
// there is no pass-through to lose -- and its decoder is stricter than a
// browser's. A PNG with a bad adler32 or an interlaced one renders everywhere
// else and makes `addImage` throw, taking the whole print run with it. Routing
// them through the canvas that has already decoded them costs nothing and
// cannot fail that way.
const PASSED_THROUGH = 'image/jpeg';

// Guards against a source whose own dimensions are enormous. 6000 px is a
// 508 mm card at print resolution -- past anything this prints, and past the
// point where a browser will reliably give up a canvas of it.
const MAX_RASTER_PIXELS = 6000;

function context(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('This browser did not give up a 2D canvas context');
  return ctx;
}

async function canvasToPng(canvas: HTMLCanvasElement): Promise<PrintImage> {
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
  if (!blob) throw new Error('This browser could not encode the artwork');
  return {
    data: new Uint8Array(await blob.arrayBuffer()),
    format: 'PNG',
    width: canvas.width,
    height: canvas.height,
  };
}

function drawn(
  source: CanvasImageSource,
  width: number,
  height: number,
  transform?: (ctx: CanvasRenderingContext2D) => void
): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(width));
  canvas.height = Math.max(1, Math.round(height));
  const ctx = context(canvas);
  transform?.(ctx);
  ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
  return canvas;
}

// An SVG has no resolution of its own, so it is rasterised straight at the size
// it will be printed rather than at whatever the document happens to declare.
async function rasterizeSvg(text: string, targetPixels: number): Promise<PrintImage> {
  const url = URL.createObjectURL(new Blob([text], { type: 'image/svg+xml' }));
  try {
    const image = new Image();
    image.src = url;
    await image.decode();

    const naturalWidth = image.naturalWidth || targetPixels;
    const naturalHeight = image.naturalHeight || targetPixels;
    const scale = targetPixels / Math.max(naturalWidth, naturalHeight);
    return await canvasToPng(drawn(image, naturalWidth * scale, naturalHeight * scale));
  } finally {
    URL.revokeObjectURL(url);
  }
}

/**
 * Reads one file and returns it ready to embed.
 *
 * A JPEG is handed over untouched; everything else is redrawn through a canvas
 * at `targetMm` at print resolution. Rasters are never scaled up on that path --
 * a 200 px source printed at 300 DPI is a low-resolution card, and interpolating
 * it to look like a high-resolution one only hides that from the warning in the
 * editor.
 *
 * The declared type comes off the response rather than from the file row,
 * because the API decides an image's type by its magic bytes and serves that.
 */
export async function loadPrintImage(fileId: string, targetMm: number): Promise<PrintImage> {
  const response = await fetch(`/api/files/${fileId}/download`, { headers: authHeader() });
  if (!response.ok) throw new Error(`Could not read the artwork (status ${response.status})`);

  const contentType = (response.headers.get('Content-Type') ?? '').split(';')[0].trim();
  const targetPixels = Math.min(MAX_RASTER_PIXELS, pixelsForPrint(targetMm));

  if (contentType === 'image/svg+xml') {
    return await rasterizeSvg(await response.text(), targetPixels);
  }

  const blob = await response.blob();
  const bitmap = await createImageBitmap(blob);
  try {
    if (contentType === PASSED_THROUGH) {
      return {
        data: new Uint8Array(await blob.arrayBuffer()),
        format: 'JPEG',
        width: bitmap.width,
        height: bitmap.height,
      };
    }

    const scale = Math.min(1, targetPixels / Math.max(bitmap.width, bitmap.height));
    return await canvasToPng(drawn(bitmap, bitmap.width * scale, bitmap.height * scale));
  } finally {
    bitmap.close();
  }
}

/**
 * The same artwork upside down.
 *
 * Needed only for a short-edge duplex flip, where the paper arrives at the back
 * side inverted and the art has to be printed inverted to come out level. The
 * turn is baked into the pixels rather than asked of the PDF, because jsPDF's
 * rotation is applied inside the image's own unit square and moves the box as
 * well as its contents -- correct placement then depends on undoing that, which
 * is a great deal of arithmetic to get wrong for a case nobody looks at twice.
 *
 * One rotated copy per distinct back, not per card: the caller caches these.
 */
export async function rotate180(image: PrintImage): Promise<PrintImage> {
  const bitmap = await createImageBitmap(
    new Blob([image.data as BlobPart], {
      type: image.format === 'PNG' ? 'image/png' : 'image/jpeg',
    })
  );
  try {
    return await canvasToPng(
      drawn(bitmap, bitmap.width, bitmap.height, (ctx) => {
        ctx.translate(bitmap.width, bitmap.height);
        ctx.rotate(Math.PI);
      })
    );
  } finally {
    bitmap.close();
  }
}
