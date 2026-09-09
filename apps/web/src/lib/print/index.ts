import { type CardSize, planRuns } from '@three-peaks/shared';
import { type PrintImage, loadPrintImage } from './images.ts';
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
  // Which version of each file to draw, by file id. A file left out is drawn at
  // whatever it is now, which is what a screen that has no version to offer
  // wants; the print screen has one for every card and pins them all.
  versions?: Readonly<Record<string, number>>;
}

export interface PrintProgress {
  drawn: number;
  total: number;
}

// One fetch and one decode per distinct piece of artwork, however many cards
// name it and whichever side of them it is on. Every turn a card takes is drawn
// in the file rather than in the pixels, so there is one copy of each to hold.
function cachedImages(versions: Readonly<Record<string, number>>): ImageSource {
  const cache = new Map<string, Promise<PrintImage>>();

  return {
    artwork(fileId, card) {
      const existing = cache.get(fileId);
      if (existing) return existing;
      const started = loadPrintImage(
        fileId,
        Math.max(card.width_mm, card.height_mm),
        versions[fileId]
      );
      cache.set(fileId, started);
      return started;
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

  await renderRuns(doc, runs, job.options, cachedImages(job.versions ?? {}), onProgress);
  return doc.output('blob');
}
