import {
  type CardSize,
  type FlipEdge,
  type Grid,
  type PageSize,
  type PrintRun,
  type SlotBox,
  backPlacement,
  cutMarks,
  planSheets,
  slotBox,
} from '@three-peaks/shared';
import type { jsPDF } from 'jspdf';
import type { PrintImage } from './images.ts';

export type ArtworkFit = 'fill' | 'fit';

export interface PrintOptions {
  page: PageSize;
  printer_margin_mm: number;
  include_backs: boolean;
  flip: FlipEdge;
  cut_marks: boolean;
  fit: ArtworkFit;
}

// Resolves a file id to bytes. The caller owns the cache, so the same artwork
// asked for by twenty cards is fetched and decoded once.
export interface ImageSource {
  front(fileId: string, card: CardSize): Promise<PrintImage>;
  back(fileId: string, card: CardSize, rotated: boolean): Promise<PrintImage>;
}

const CUT_MARK_LENGTH_MM = 3;
const CUT_MARK_WIDTH_MM = 0.15;
// Mid grey. Black trim guides are legible but also the first thing a hurried cut
// leaves a fragment of on the card.
const CUT_MARK_GREY = 150;

// Where a piece of artwork actually lands inside its slot.
//
// `fit` shows the whole image and leaves a margin on the axis that does not
// match -- which is what makes an artwork prepared at the wrong aspect ratio
// visible rather than silently trimmed. `fill` covers the slot and lets the
// overflow be clipped away, which is what artwork drawn to bleed expects.
export function placement(
  image: { width: number; height: number },
  box: SlotBox,
  fit: ArtworkFit
): { x_mm: number; y_mm: number; width_mm: number; height_mm: number } {
  const aspect = image.width / image.height;
  const boxAspect = box.width_mm / box.height_mm;
  const matchWidth = fit === 'fill' ? aspect < boxAspect : aspect > boxAspect;

  const width = matchWidth ? box.width_mm : box.height_mm * aspect;
  const height = matchWidth ? box.width_mm / aspect : box.height_mm;

  return {
    x_mm: box.x_mm + (box.width_mm - width) / 2,
    y_mm: box.y_mm + (box.height_mm - height) / 2,
    width_mm: width,
    height_mm: height,
  };
}

function drawArtwork(
  doc: jsPDF,
  image: PrintImage,
  box: SlotBox,
  fit: ArtworkFit,
  alias: string
): void {
  const at = placement(image, box, fit);
  const overflows = at.width_mm > box.width_mm + 1e-6 || at.height_mm > box.height_mm + 1e-6;

  // Clipped rather than pre-cropped on a canvas: cropping would re-encode the
  // artwork, and re-encoding is what the pass-through in images.ts exists to
  // avoid. The clip costs four numbers in the content stream.
  if (overflows) {
    doc.saveGraphicsState();
    doc.rect(box.x_mm, box.y_mm, box.width_mm, box.height_mm);
    doc.clip();
    doc.discardPath();
  }

  // The alias is what stops the same artwork being embedded once per copy. With
  // a quantity of forty, that is the difference between a four-megabyte file and
  // a hundred-and-sixty-megabyte one.
  doc.addImage(
    image.data,
    image.format,
    at.x_mm,
    at.y_mm,
    at.width_mm,
    at.height_mm,
    alias,
    'FAST'
  );

  if (overflows) doc.restoreGraphicsState();
}

function drawCutMarks(doc: jsPDF, options: PrintOptions, grid: Grid): void {
  doc.setDrawColor(CUT_MARK_GREY);
  doc.setLineWidth(CUT_MARK_WIDTH_MM);
  for (const mark of cutMarks(grid, options.page, CUT_MARK_LENGTH_MM)) {
    doc.line(mark.x1_mm, mark.y1_mm, mark.x2_mm, mark.y2_mm);
  }
}

export interface RenderProgress {
  drawn: number;
  total: number;
}

/**
 * Draws every run into one document and returns the bytes.
 *
 * Pages come out front, back, front, back. A back page is emitted for **every**
 * front page whenever backs are asked for, even one on which no card has a back
 * and nothing is drawn: a duplex printer pairs sheet n's front with page 2n, and
 * skipping one blank page slides every later back onto the wrong front.
 *
 * `jsPDF` is imported by the caller and handed in, so this module can be unit
 * tested and so the library stays inside the chunk that only the print screen
 * loads.
 */
export async function renderRuns(
  doc: jsPDF,
  runs: readonly PrintRun[],
  options: PrintOptions,
  images: ImageSource,
  onProgress?: (progress: RenderProgress) => void
): Promise<void> {
  const plans = runs.map((run) => ({
    run,
    plan: planSheets(run.items, options.page, run.card, options.printer_margin_mm),
  }));

  const total = plans.reduce(
    (sum, entry) => sum + entry.plan.sheets.reduce((slots, sheet) => slots + sheet.slots.length, 0),
    0
  );
  let drawn = 0;
  let started = false;

  const page = () => {
    if (started) doc.addPage();
    started = true;
  };

  for (const { run, plan } of plans) {
    if (plan.grid.per_sheet === 0) continue;

    for (const sheet of plan.sheets) {
      page();
      for (const slot of sheet.slots) {
        const image = await images.front(slot.item.front_file_id, run.card);
        drawArtwork(doc, image, slot.box, options.fit, `front:${slot.item.front_file_id}`);
        drawn += 1;
        onProgress?.({ drawn, total });
      }
      if (options.cut_marks) drawCutMarks(doc, options, plan.grid);

      if (!options.include_backs) continue;

      page();
      for (const slot of sheet.slots) {
        if (slot.item.back_file_id === null) continue;
        const placementOnBack = backPlacement(slot.index, plan.grid, options.flip);
        const image = await images.back(
          slot.item.back_file_id,
          run.card,
          placementOnBack.rotate_180
        );
        drawArtwork(
          doc,
          image,
          slotBox(plan.grid, placementOnBack.index),
          options.fit,
          `back:${slot.item.back_file_id}:${placementOnBack.rotate_180 ? 'turned' : 'upright'}`
        );
      }
      if (options.cut_marks) drawCutMarks(doc, options, plan.grid);
    }
  }
}
