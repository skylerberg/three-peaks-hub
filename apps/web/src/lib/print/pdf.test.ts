import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PRINTER_MARGIN_MM,
  type PrintRun,
  type SlotBox,
  backPlacement,
  cardPreset,
  pageSize,
  planGrid,
  slotBox,
} from '@three-peaks/shared';
import type { jsPDF } from 'jspdf';
import type { PrintImage } from './images.ts';
import {
  type ImageArgs,
  type PrintOptions,
  type Rect,
  artworkRect,
  imageArgs,
  placement,
  renderRuns,
} from './pdf.ts';

// A 63 x 88 mm slot, the poker cell.
const box: SlotBox = { row: 0, column: 0, x_mm: 20, y_mm: 30, width_mm: 63, height_mm: 88 };
// A mini cell, which the planner lays on its side: 67 wide, 44 tall.
const turnedBox: SlotBox = {
  row: 0,
  column: 0,
  x_mm: 7.45,
  y_mm: 7.7,
  width_mm: 67,
  height_mm: 44,
};

describe('placement', () => {
  it('fills the slot exactly when the artwork already matches it', () => {
    for (const fit of ['fill', 'fit'] as const) {
      const at = placement({ width: 630, height: 880 }, box, fit);
      expect(at.width_mm).toBeCloseTo(63, 6);
      expect(at.height_mm).toBeCloseTo(88, 6);
      expect(at.x_mm).toBeCloseTo(20, 6);
      expect(at.y_mm).toBeCloseTo(30, 6);
    }
  });

  // Artwork drawn to bleed is wider than the card. Fill covers the slot and
  // lets the clip take the overflow; fit shows all of it and leaves bars.
  it('covers the slot for a wider-than-card image when filling', () => {
    const at = placement({ width: 2000, height: 1000 }, box, 'fill');
    expect(at.height_mm).toBeCloseTo(88, 6);
    expect(at.width_mm).toBeGreaterThan(box.width_mm);
  });

  it('fits a wider-than-card image inside the slot when fitting', () => {
    const at = placement({ width: 2000, height: 1000 }, box, 'fit');
    expect(at.width_mm).toBeCloseTo(63, 6);
    expect(at.height_mm).toBeLessThan(box.height_mm);
  });

  it('covers the slot for a taller-than-card image when filling', () => {
    const at = placement({ width: 1000, height: 3000 }, box, 'fill');
    expect(at.width_mm).toBeCloseTo(63, 6);
    expect(at.height_mm).toBeGreaterThan(box.height_mm);
  });

  it('fits a taller-than-card image inside the slot when fitting', () => {
    const at = placement({ width: 1000, height: 3000 }, box, 'fit');
    expect(at.height_mm).toBeCloseTo(88, 6);
    expect(at.width_mm).toBeLessThan(box.width_mm);
  });

  // Off-centre artwork crops or letterboxes unevenly, which reads as a
  // misregistered print rather than as a mismatched source.
  it.each(['fill', 'fit'] as const)('centres the artwork in the slot when %sing', (fit) => {
    const at = placement({ width: 2000, height: 1000 }, box, fit);
    expect(at.x_mm + at.width_mm / 2).toBeCloseTo(box.x_mm + box.width_mm / 2, 6);
    expect(at.y_mm + at.height_mm / 2).toBeCloseTo(box.y_mm + box.height_mm / 2, 6);
  });

  it('never crops when fitting, and never leaves a gap when filling', () => {
    for (const image of [
      { width: 2000, height: 1000 },
      { width: 1000, height: 3000 },
      { width: 640, height: 480 },
    ]) {
      const fitted = placement(image, box, 'fit');
      expect(fitted.width_mm).toBeLessThanOrEqual(box.width_mm + 1e-6);
      expect(fitted.height_mm).toBeLessThanOrEqual(box.height_mm + 1e-6);

      const filled = placement(image, box, 'fill');
      expect(filled.width_mm).toBeGreaterThanOrEqual(box.width_mm - 1e-6);
      expect(filled.height_mm).toBeGreaterThanOrEqual(box.height_mm - 1e-6);
    }
  });
});

describe('artworkRect', () => {
  const miniArt = { width: 264, height: 402 };

  it('is the plain placement when the card is upright or upside down', () => {
    for (const turns of [0, 2] as const) {
      expect(artworkRect({ width: 630, height: 880 }, box, 'fill', turns)).toEqual(
        placement({ width: 630, height: 880 }, box, 'fill')
      );
    }
  });

  // The screenshot bug: a portrait card in a landscape cell, drawn upright at
  // the cell's width, is 67 x 102 mm clipped to a 44 mm band of its middle.
  // Turned, it is the cell.
  it.each([1, 3] as const)(
    'lays portrait artwork over a landscape cell exactly when turned %i quarter',
    (turns) => {
      for (const fit of ['fill', 'fit'] as const) {
        const rect = artworkRect(miniArt, turnedBox, fit, turns);
        expect(rect.x_mm).toBeCloseTo(turnedBox.x_mm, 6);
        expect(rect.y_mm).toBeCloseTo(turnedBox.y_mm, 6);
        expect(rect.width_mm).toBeCloseTo(67, 6);
        expect(rect.height_mm).toBeCloseTo(44, 6);
      }
    }
  );

  // Fit and fill are decided in the card's frame, so an image wider than the
  // card overflows along the card's width -- which on the page is the cell's
  // height once the card is on its side.
  it('measures the overflow along the turned axis', () => {
    const rect = artworkRect({ width: 2000, height: 1000 }, turnedBox, 'fill', 1);
    expect(rect.width_mm).toBeCloseTo(67, 6);
    expect(rect.height_mm).toBeGreaterThan(44);
    expect(rect.x_mm + rect.width_mm / 2).toBeCloseTo(turnedBox.x_mm + 67 / 2, 6);
    expect(rect.y_mm + rect.height_mm / 2).toBeCloseTo(turnedBox.y_mm + 44 / 2, 6);
  });
});

/**
 * jsPDF's own placement, as `writeImageToPDF` writes it: translate to the
 * bottom-left corner of the box it was given, rotate anticlockwise, scale the
 * unit square by the width and height. Modelled in the millimetres and the
 * top-left origin the arguments are given in, so the answer is the rectangle a
 * reader of the page would measure. `check:print` holds this model to the
 * library by reading a real file back.
 */
function covered(args: ImageArgs): Rect & { up: 'N' | 'E' | 'S' | 'W' } {
  const { x_mm: x, y_mm: y, width_mm: w, height_mm: h, rotation } = args;
  const rad = (rotation * Math.PI) / 180;
  const corner = (u: number, v: number) => {
    const px = u * w;
    const py = v * h;
    // PDF's y runs up the page, so an anticlockwise turn there is anticlockwise
    // to the eye, and the pivot's PDF-space offsets come off the page's y.
    const rx = px * Math.cos(rad) - py * Math.sin(rad);
    const ry = px * Math.sin(rad) + py * Math.cos(rad);
    return { x: x + rx, y: y + h - ry };
  };

  const corners = [corner(0, 0), corner(1, 0), corner(0, 1), corner(1, 1)];
  const xs = corners.map((c) => c.x);
  const ys = corners.map((c) => c.y);
  const upX = corner(0, 1).x - corner(0, 0).x;
  const upY = corner(0, 1).y - corner(0, 0).y;

  return {
    x_mm: Math.min(...xs),
    y_mm: Math.min(...ys),
    width_mm: Math.max(...xs) - Math.min(...xs),
    height_mm: Math.max(...ys) - Math.min(...ys),
    up: Math.abs(upX) > Math.abs(upY) ? (upX > 0 ? 'E' : 'W') : upY < 0 ? 'N' : 'S',
  };
}

describe('imageArgs', () => {
  const rect: Rect = { x_mm: 30, y_mm: 50, width_mm: 67, height_mm: 44 };

  it.each([
    [0, 'N'],
    [1, 'E'],
    [2, 'S'],
    [3, 'W'],
  ] as const)(
    'covers the rectangle after %i clockwise quarter turns, top pointing %s',
    (turns, up) => {
      const drawn = covered(imageArgs(rect, turns));
      expect(drawn.x_mm).toBeCloseTo(rect.x_mm, 6);
      expect(drawn.y_mm).toBeCloseTo(rect.y_mm, 6);
      expect(drawn.width_mm).toBeCloseTo(rect.width_mm, 6);
      expect(drawn.height_mm).toBeCloseTo(rect.height_mm, 6);
      expect(drawn.up).toBe(up);
    }
  );

  // The library takes the artwork's own sides, so a sideways card is handed its
  // portrait width and height and left to turn them.
  it('hands over the artwork’s sides rather than the rectangle’s when sideways', () => {
    for (const turns of [1, 3] as const) {
      const at = imageArgs(rect, turns);
      expect(at.width_mm).toBe(rect.height_mm);
      expect(at.height_mm).toBe(rect.width_mm);
    }
  });

  it('asks for no rotation at all on an upright card', () => {
    expect(imageArgs(rect, 0)).toEqual({ ...rect, rotation: 0 });
  });
});

interface Placed {
  page: number;
  alias: string;
  rect: Rect & { up: 'N' | 'E' | 'S' | 'W' };
}

// Records where every image lands and which way it points, through the same
// model of the library as above.
function recordingDoc(): { doc: jsPDF; placed: Placed[] } {
  const placed: Placed[] = [];
  let page = 1;
  const doc = {
    addPage: () => {
      page += 1;
    },
    saveGraphicsState: () => undefined,
    restoreGraphicsState: () => undefined,
    rect: () => undefined,
    clip: () => undefined,
    discardPath: () => undefined,
    setDrawColor: () => undefined,
    setLineWidth: () => undefined,
    line: () => undefined,
    addImage: (
      _data: unknown,
      _format: unknown,
      x_mm: number,
      y_mm: number,
      width_mm: number,
      height_mm: number,
      alias: string,
      _compression: unknown,
      rotation: number
    ) => {
      placed.push({
        page,
        alias,
        rect: covered({ x_mm, y_mm, width_mm, height_mm, rotation }),
      });
    },
  };
  return { doc: doc as unknown as jsPDF, placed };
}

const letter = pageSize('letter')!;

function options(overrides: Partial<PrintOptions> = {}): PrintOptions {
  return {
    page: letter,
    printer_margin_mm: DEFAULT_PRINTER_MARGIN_MM,
    include_backs: true,
    flip: 'long',
    cut_marks: false,
    fit: 'fill',
    ...overrides,
  };
}

// Artwork at each card's own aspect, so every placement is exactly its cell.
const images = {
  artwork: (_fileId: string, card: { width_mm: number; height_mm: number }): Promise<PrintImage> =>
    Promise.resolve({
      data: new Uint8Array(),
      format: 'PNG',
      width: card.width_mm * 6,
      height: card.height_mm * 6,
    }),
};

function run(preset: string, items: PrintRun['items']): PrintRun {
  return { card: cardPreset(preset)!, items };
}

function expectRect(actual: Rect, expected: SlotBox): void {
  expect(actual.x_mm).toBeCloseTo(expected.x_mm, 6);
  expect(actual.y_mm).toBeCloseTo(expected.y_mm, 6);
  expect(actual.width_mm).toBeCloseTo(expected.width_mm, 6);
  expect(actual.height_mm).toBeCloseTo(expected.height_mm, 6);
}

describe('renderRuns', () => {
  const mini = planGrid(letter, cardPreset('mini')!, DEFAULT_PRINTER_MARGIN_MM);
  const poker = planGrid(letter, cardPreset('poker')!, DEFAULT_PRINTER_MARGIN_MM);
  const items = [
    { front_file_id: 'a', back_file_id: 'z' },
    { front_file_id: 'b', back_file_id: 'z' },
  ];

  it('draws an upright card and its back both pointing up the page', async () => {
    const { doc, placed } = recordingDoc();
    await renderRuns(doc, [run('poker', items)], options(), images);

    expect(placed.map((p) => p.page)).toEqual([1, 1, 2, 2]);
    for (const [index, front] of placed.filter((p) => p.page === 1).entries()) {
      expectRect(front.rect, slotBox(poker, index));
      expect(front.rect.up).toBe('N');
    }
    for (const back of placed.filter((p) => p.page === 2)) expect(back.rect.up).toBe('N');
  });

  it('turns every card of a turned grid onto its side', async () => {
    const { doc, placed } = recordingDoc();
    await renderRuns(doc, [run('mini', items)], options({ include_backs: false }), images);

    expect(mini.rotated).toBe(true);
    expect(placed).toHaveLength(2);
    for (const [index, front] of placed.entries()) {
      expectRect(front.rect, slotBox(mini, index));
      expect(front.rect.up).toBe('E');
    }
  });

  // The back's top has to land on the physical edge the front's top is on, and
  // a long-edge flip reverses left and right -- the axis a sideways card's top
  // now lies along.
  it('turns a long-edge back the opposite way to its sideways front', async () => {
    const { doc, placed } = recordingDoc();
    await renderRuns(doc, [run('mini', items)], options({ flip: 'long' }), images);

    const backs = placed.filter((p) => p.page === 2);
    expect(backs).toHaveLength(2);
    for (const [index, back] of backs.entries()) {
      expectRect(back.rect, slotBox(mini, backPlacement(index, mini, 'long').index));
      expect(back.rect.up).toBe('W');
    }
  });

  it('turns a short-edge back the same way as its sideways front', async () => {
    const { doc, placed } = recordingDoc();
    await renderRuns(doc, [run('mini', items)], options({ flip: 'short' }), images);

    const backs = placed.filter((p) => p.page === 2);
    for (const [index, back] of backs.entries()) {
      expectRect(back.rect, slotBox(mini, backPlacement(index, mini, 'short').index));
      expect(back.rect.up).toBe('E');
    }
  });

  it('draws a short-edge back of an upright card upside down', async () => {
    const { doc, placed } = recordingDoc();
    await renderRuns(doc, [run('poker', items)], options({ flip: 'short' }), images);

    for (const back of placed.filter((p) => p.page === 2)) expect(back.rect.up).toBe('S');
  });

  // One embedding per artwork, whichever way and on whichever side it is drawn.
  it('names the same artwork by one alias on every side and at every turn', async () => {
    const { doc, placed } = recordingDoc();
    await renderRuns(
      doc,
      [run('mini', [{ front_file_id: 'a', back_file_id: 'a' }])],
      options(),
      images
    );
    expect(new Set(placed.map((p) => p.alias)).size).toBe(1);
  });
});
