import { describe, expect, it } from 'vitest';
import {
  boundsOf,
  containsPoint,
  normalizeOutlines,
  outlinesToShapes,
  ringsToOutlines,
} from './outlines.ts';
import type { Ring } from './types.ts';

const square = (x: number, y: number, size: number): Ring => [
  { x, y },
  { x: x + size, y },
  { x: x + size, y: y + size },
  { x, y: y + size },
];

describe('containsPoint', () => {
  it('sees a point inside', () => {
    expect(containsPoint(square(0, 0, 10), { x: 5, y: 5 })).toBe(true);
  });

  it('sees a point outside', () => {
    expect(containsPoint(square(0, 0, 10), { x: 15, y: 5 })).toBe(false);
  });
});

describe('boundsOf', () => {
  it('spans every ring it is given', () => {
    expect(boundsOf([square(0, 0, 4), square(10, 2, 4)])).toEqual({
      minX: 0,
      minY: 0,
      maxX: 14,
      maxY: 6,
    });
  });
});

describe('ringsToOutlines', () => {
  it('keeps two separate pieces separate', () => {
    const outlines = ringsToOutlines([square(0, 0, 4), square(10, 0, 4)]);
    expect(outlines).toHaveLength(2);
    expect(outlines.every((outline) => outline.holes.length === 0)).toBe(true);
  });

  it('punches a contained ring out of the ring around it', () => {
    const outlines = ringsToOutlines([square(0, 0, 10), square(3, 3, 4)]);
    expect(outlines).toHaveLength(1);
    expect(outlines[0].holes).toHaveLength(1);
  });

  // An island inside a hole is a second piece of wood, not a hole in the piece
  // around the hole -- the shape the letter B cut from ply actually has.
  it('treats a ring inside a hole as a piece of its own', () => {
    const outlines = ringsToOutlines([square(0, 0, 20), square(4, 4, 12), square(8, 8, 4)]);
    expect(outlines).toHaveLength(2);
    const outer = outlines.find((outline) => outline.holes.length === 1);
    expect(outer).toBeDefined();
  });
});

describe('normalizeOutlines', () => {
  const outlines = [{ contour: square(100, 200, 50), holes: [] }];

  it('centres on the origin', () => {
    const [normalized] = normalizeOutlines(outlines, { longestSideMm: 20, flipY: false });
    const bounds = boundsOf([normalized.contour]);
    expect(bounds.minX + bounds.maxX).toBeCloseTo(0, 10);
    expect(bounds.minY + bounds.maxY).toBeCloseTo(0, 10);
  });

  // Millimetres in, metres out: glTF's unit, and the only conversion anywhere.
  it('scales the longer side to the requested size, in metres', () => {
    const [normalized] = normalizeOutlines(outlines, { longestSideMm: 20, flipY: false });
    const bounds = boundsOf([normalized.contour]);
    expect(bounds.maxX - bounds.minX).toBeCloseTo(0.02, 10);
  });

  it('flips y, because the tracer and the parser both work downwards', () => {
    const [flipped] = normalizeOutlines(outlines, { longestSideMm: 20, flipY: true });
    const [upright] = normalizeOutlines(outlines, { longestSideMm: 20, flipY: false });
    expect(flipped.contour[0].y).toBeCloseTo(-upright.contour[0].y, 10);
  });

  it('hands back nothing for an outline with no area', () => {
    const degenerate = [{ contour: [{ x: 1, y: 1 }], holes: [] }];
    expect(normalizeOutlines(degenerate, { longestSideMm: 20, flipY: true })).toEqual([]);
  });
});

describe('outlinesToShapes', () => {
  it('carries holes onto the shape', () => {
    const shapes = outlinesToShapes(ringsToOutlines([square(0, 0, 10), square(3, 3, 4)]));
    expect(shapes).toHaveLength(1);
    expect(shapes[0].holes).toHaveLength(1);
  });
});
