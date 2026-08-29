import { ExtrudeGeometry, Shape, type BufferGeometry } from 'three';
import type { PunchboardModelSettings } from '@three-peaks/shared';
import { boundsOf, outlinesToShapes } from '../shapes/outlines.ts';
import { roundedRectShape } from '../shapes/roundedRect.ts';
import { svgOutlines, svgViewBox } from '../shapes/svg.ts';
import type { Bounds, Outline, Ring } from '../shapes/types.ts';
import { MM } from '../units.ts';
import { bevelledExtrusion } from './extrude.ts';
import { assignFaceGroups, remapCapUVs } from './faceGroups.ts';

export class EmptyCutSheetError extends Error {
  constructor() {
    super('That cut sheet has no closed shapes in it, so there is nothing to punch out.');
    this.name = 'EmptyCutSheetError';
  }
}

// The sheet's own mesh. A token's is 'Token.001' upward, numbered in reading
// order from the top left and padded to three digits the way a board's panels
// are: once the bundle is in Blender the numbering is the only thing left
// saying which token came from where on the sheet.
const PUNCHBOARD_SHEET_NAME = 'Sheet';

export interface PunchboardPiece {
  name: string;
  // Where it sits in the sheet's plane, in metres.
  center: readonly [number, number, number];
  // What it measures, in metres. The scene needs this to lay tokens out and
  // cannot work it out for itself: the die line decides it.
  size: { width: number; height: number };
  // The artwork rectangle in this piece's own coordinates, so it samples
  // exactly the patch of sheet it was cut from.
  artwork: Bounds;
  outline: Outline | null;
}

export interface PunchboardLayout {
  pieces: PunchboardPiece[];
  width: number;
  height: number;
  // Every token, in sheet coordinates. The sheet reads these to punch itself
  // out; a token reads only its own.
  cuts: Outline[];
}

/**
 * Reads a die line and works out where everything is, without building any
 * geometry.
 *
 * Cheap on purpose: the scene exports the sheet and each token as a file of its
 * own, and extruding all of them once per file would be quadratic in the number
 * of tokens on the sheet.
 *
 * The document's viewBox is the whole sheet, not the extent of the shapes in
 * it: a die line with a margin round its tokens is ordinary, and measuring the
 * shapes instead would stretch that margin away and take every token with it.
 * The same mapping decides a token's size and the rectangle of artwork it
 * samples, which is what stops the two from disagreeing -- the property
 * boxNetRegions has for a box wrap.
 */
export function punchboardLayout(
  settings: PunchboardModelSettings,
  cutSvg: string
): PunchboardLayout {
  const outlines = svgOutlines(cutSvg);
  if (outlines.length === 0) throw new EmptyCutSheetError();

  const frame =
    svgViewBox(cutSvg) ?? boundsOf(outlines.flatMap((one) => [one.contour, ...one.holes]));
  const width = settings.width_mm * MM;
  const height = settings.height_mm * MM;
  const spanX = frame.maxX - frame.minX;
  const spanY = frame.maxY - frame.minY;

  // y is negated because an SVG counts down the page and the scene counts up.
  const place = (point: { x: number; y: number }) => ({
    x: -width / 2 + ((point.x - frame.minX) / spanX) * width,
    y: height / 2 - ((point.y - frame.minY) / spanY) * height,
  });
  const move = (ring: Ring): Ring => ring.map(place);

  const cuts: Outline[] = outlines.map((outline) => ({
    contour: move(outline.contour),
    holes: outline.holes.map(move),
  }));

  const sheetArtwork: Bounds = {
    minX: -width / 2,
    minY: -height / 2,
    maxX: width / 2,
    maxY: height / 2,
  };

  const shift = (bounds: Bounds, x: number, y: number): Bounds => ({
    minX: bounds.minX - x,
    minY: bounds.minY - y,
    maxX: bounds.maxX - x,
    maxY: bounds.maxY - y,
  });

  // Reading order from the top left: rows first, so two tokens side by side are
  // consecutive.
  const ordered = cuts
    .map((outline) => ({ outline, bounds: boundsOf([outline.contour]) }))
    .sort((a, b) => b.bounds.maxY - a.bounds.maxY || a.bounds.minX - b.bounds.minX);

  const pieces: PunchboardPiece[] = [
    {
      name: PUNCHBOARD_SHEET_NAME,
      center: [0, 0, 0],
      size: { width, height },
      artwork: sheetArtwork,
      outline: null,
    },
    ...ordered.map((entry, index) => {
      const centerX = (entry.bounds.minX + entry.bounds.maxX) / 2;
      const centerY = (entry.bounds.minY + entry.bounds.maxY) / 2;
      return {
        name: `Token.${String(index + 1).padStart(3, '0')}`,
        center: [centerX, centerY, 0] as const,
        size: {
          width: entry.bounds.maxX - entry.bounds.minX,
          height: entry.bounds.maxY - entry.bounds.minY,
        },
        artwork: shift(sheetArtwork, centerX, centerY),
        outline: {
          contour: entry.outline.contour.map((p) => ({ x: p.x - centerX, y: p.y - centerY })),
          holes: entry.outline.holes.map((hole) =>
            hole.map((p) => ({ x: p.x - centerX, y: p.y - centerY }))
          ),
        },
      };
    }),
  ];

  return { pieces, width, height, cuts };
}

function shapeFor(
  layout: PunchboardLayout,
  piece: PunchboardPiece,
  settings: PunchboardModelSettings
): Shape {
  if (piece.outline !== null) return outlinesToShapes([piece.outline])[0];

  // Square corners: a punchboard is guillotined like a mounted board.
  const sheet = roundedRectShape(layout.width, layout.height, 0);
  if (settings.sheet_state === 'punched') {
    // The tokens as holes: what is left once they have been pushed out.
    sheet.holes = outlinesToShapes(layout.cuts).map((shape) => {
      const hole = new Shape();
      hole.curves = shape.curves;
      return hole;
    });
  }
  return sheet;
}

export function buildPunchboardPiece(
  layout: PunchboardLayout,
  piece: PunchboardPiece,
  settings: PunchboardModelSettings
): BufferGeometry {
  const geometry = new ExtrudeGeometry(shapeFor(layout, piece, settings), {
    ...bevelledExtrusion(settings.thickness_mm * MM, 0),
    curveSegments: 1,
  });
  geometry.center();
  assignFaceGroups(geometry);
  remapCapUVs(geometry, piece.artwork);
  return geometry;
}
