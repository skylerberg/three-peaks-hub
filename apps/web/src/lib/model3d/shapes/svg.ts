import { SVGLoader } from 'three/addons/loaders/SVGLoader.js';
import type { Bounds, Outline, Ring } from './types.ts';

// Divisions per curve when a parsed path is flattened to a polygon. A token is
// a few centimetres across, so this is well past what an eye or an extruder can
// tell from the curve itself.
const CURVE_DIVISIONS = 24;

// Parsed, never rendered. SVGLoader reads the document with DOMParser as
// image/svg+xml, which does not run script, and nothing here reaches the page:
// only the path data becomes geometry.
export function svgOutlines(text: string): Outline[] {
  const parsed = new SVGLoader().parse(text);
  const outlines: Outline[] = [];

  for (const path of parsed.paths) {
    // A stroke-only path has no area to extrude; taking its outline anyway
    // would turn a construction line into a piece of wood.
    const style = (path.userData as { style?: { fill?: string } } | undefined)?.style;
    if (style?.fill === 'none') continue;

    for (const shape of SVGLoader.createShapes(path)) {
      const points = shape.extractPoints(CURVE_DIVISIONS);
      const contour = toRing(points.shape);
      if (contour.length < 3) continue;
      outlines.push({ contour, holes: points.holes.map(toRing).filter((h) => h.length >= 3) });
    }
  }

  return outlines;
}

/**
 * The rectangle the document declares, which is what a punchboard's die line is
 * measured against: a token's size and the part of the sheet it samples both
 * come out of the same mapping, so neither can disagree with the other.
 *
 * Null when the document declares nothing, and the caller then falls back to
 * the paths' own extent -- which is right for a piece cut to its own outline
 * and wrong for a sheet, where the margin round the tokens is part of it.
 */
export function svgViewBox(text: string): Bounds | null {
  // SVGLoader hands back the parsed document, and the viewBox is on its root
  // element rather than on the document itself.
  const parsed = new SVGLoader().parse(text).xml as unknown as { documentElement?: Element };
  const box = parsed.documentElement?.getAttribute('viewBox');
  if (!box) return null;

  const parts = box
    .trim()
    .split(/[\s,]+/u)
    .map(Number);
  if (parts.length !== 4 || parts.some((value) => !Number.isFinite(value))) return null;
  const [minX, minY, width, height] = parts;
  if (width <= 0 || height <= 0) return null;
  return { minX, minY, maxX: minX + width, maxY: minY + height };
}

function toRing(points: { x: number; y: number }[]): Ring {
  const ring = points.map((point) => ({ x: point.x, y: point.y }));
  const first = ring[0];
  const last = ring[ring.length - 1];
  // extractPoints repeats the start of a closed path; the ring form does not.
  if (ring.length > 1 && first.x === last.x && first.y === last.y) ring.pop();
  return ring;
}
