import { type CardSize, planRuns } from '@three-peaks/shared';
import { type PrintImage, loadPrintImage, rotate180 } from './images.ts';
import { type ImageSource, type PrintOptions, renderRuns } from './pdf.ts';

export type { ArtworkFit, PrintOptions } from './pdf.ts';

export interface PrintJobDeck {
  name: string;
  card: CardSize;
  back_file_id: string | null;
  cards: readonly { file_id: string; copies: number }[];
}

export interface PrintJob {
  decks: readonly PrintJobDeck[];
  options: PrintOptions;
}

export interface PrintProgress {
  drawn: number;
  total: number;
}

// One fetch and one decode per distinct piece of artwork, however many cards
// name it. Backs are cached separately per turn, because a short-edge flip needs
// an upside-down copy and that is a different set of pixels.
function cachedImages(): ImageSource {
  const cache = new Map<string, Promise<PrintImage>>();

  const target = (card: CardSize) => Math.max(card.width_mm, card.height_mm);

  const load = (key: string, produce: () => Promise<PrintImage>) => {
    const existing = cache.get(key);
    if (existing) return existing;
    const started = produce();
    cache.set(key, started);
    return started;
  };

  return {
    front(fileId, card) {
      return load(`front:${fileId}`, () => loadPrintImage(fileId, target(card)));
    },
    back(fileId, card, rotated) {
      const upright = load(`front:${fileId}`, () => loadPrintImage(fileId, target(card)));
      if (!rotated) return upright;
      return load(`turned:${fileId}`, async () => rotate180(await upright));
    },
  };
}

/**
 * Builds the whole document and hands back the bytes.
 *
 * `jspdf` is imported here and nowhere above, so it lands in the chunk this
 * module already is -- reached only through `await import()` from the print
 * screen, the way the 3D studio keeps `three` out of everyone else's bundle.
 */
export async function generatePrintPdf(
  job: PrintJob,
  onProgress?: (progress: PrintProgress) => void
): Promise<Blob> {
  const runs = planRuns(job.decks);
  if (runs.length === 0) throw new Error('There is nothing selected to print.');

  const { jsPDF } = await import('jspdf');
  const doc = new jsPDF({
    unit: 'mm',
    format: [job.options.page.width_mm, job.options.page.height_mm],
    orientation: 'portrait',
    compress: true,
  });

  await renderRuns(doc, runs, job.options, cachedImages(), onProgress);
  return doc.output('blob');
}
