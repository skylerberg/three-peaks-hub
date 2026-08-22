import { Shape } from 'three';
import type { Bounds, Outline, Point, Ring } from './types.ts';

export function containsPoint(ring: Ring, point: Point): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const a = ring[i];
    const b = ring[j];
    if (a.y > point.y !== b.y > point.y) {
      const x = ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y) + a.x;
      if (point.x < x) inside = !inside;
    }
  }
  return inside;
}

export function boundsOf(rings: readonly Ring[]): Bounds {
  const bounds: Bounds = {
    minX: Infinity,
    minY: Infinity,
    maxX: -Infinity,
    maxY: -Infinity,
  };

  for (const ring of rings) {
    for (const point of ring) {
      if (point.x < bounds.minX) bounds.minX = point.x;
      if (point.y < bounds.minY) bounds.minY = point.y;
      if (point.x > bounds.maxX) bounds.maxX = point.x;
      if (point.y > bounds.maxY) bounds.maxY = point.y;
    }
  }

  return bounds;
}

export function outlineBounds(outlines: readonly Outline[]): Bounds {
  return boundsOf(outlines.map((outline) => outline.contour));
}

// Nests rings by containment rather than by winding. A tracer can emit either
// winding depending on which pixel it started from, but a ring inside an odd
// number of others is a hole no matter which way round it was walked.
export function ringsToOutlines(rings: readonly Ring[]): Outline[] {
  const depths = rings.map((ring) =>
    rings.reduce(
      (depth, other) => (other !== ring && containsPoint(other, ring[0]) ? depth + 1 : depth),
      0
    )
  );

  const outlines: Outline[] = [];
  const outlineIndexByRing = new Map<number, number>();

  rings.forEach((ring, index) => {
    if (depths[index] % 2 !== 0) return;
    outlineIndexByRing.set(index, outlines.length);
    outlines.push({ contour: ring, holes: [] });
  });

  rings.forEach((ring, index) => {
    if (depths[index] % 2 === 0) return;

    // The immediate parent, not any ancestor: an island inside a hole inside a
    // shape must be punched out of the hole's parent, not the outermost ring.
    let parent = -1;
    rings.forEach((candidate, candidateIndex) => {
      if (depths[candidateIndex] !== depths[index] - 1) return;
      if (!containsPoint(candidate, ring[0])) return;
      parent = candidateIndex;
    });

    const outlineIndex = outlineIndexByRing.get(parent);
    if (outlineIndex !== undefined) outlines[outlineIndex].holes.push(ring);
  });

  return outlines;
}

export interface NormalizeOptions {
  longestSideMm: number;
  // Traced and parsed outlines both arrive in a y-down space; the scene is
  // y-up, and the flip belongs here rather than in each producer.
  flipY: boolean;
}

// Centres on the origin and scales so the longer side measures what was asked
// for, in metres -- glTF's unit, and the only conversion in the pipeline.
export function normalizeOutlines(
  outlines: readonly Outline[],
  options: NormalizeOptions
): Outline[] {
  const bounds = boundsOf(outlines.flatMap((outline) => [outline.contour, ...outline.holes]));
  const width = bounds.maxX - bounds.minX;
  const height = bounds.maxY - bounds.minY;
  const longest = Math.max(width, height);
  if (!Number.isFinite(longest) || longest <= 0) return [];

  const scale = options.longestSideMm / 1000 / longest;
  const centreX = (bounds.minX + bounds.maxX) / 2;
  const centreY = (bounds.minY + bounds.maxY) / 2;
  const ySign = options.flipY ? -1 : 1;

  const move = (ring: Ring): Ring =>
    ring.map((point) => ({
      x: (point.x - centreX) * scale,
      y: (point.y - centreY) * scale * ySign,
    }));

  return outlines.map((outline) => ({
    contour: move(outline.contour),
    holes: outline.holes.map(move),
  }));
}

export function outlinesToShapes(outlines: readonly Outline[]): Shape[] {
  return outlines.map((outline) => {
    const shape = new Shape();
    trace(shape, outline.contour);
    shape.holes = outline.holes.map((hole) => {
      const path = new Shape();
      trace(path, hole);
      return path;
    });
    return shape;
  });
}

function trace(shape: Shape, ring: Ring): void {
  shape.moveTo(ring[0].x, ring[0].y);
  for (let i = 1; i < ring.length; i += 1) shape.lineTo(ring[i].x, ring[i].y);
  shape.closePath();
}
