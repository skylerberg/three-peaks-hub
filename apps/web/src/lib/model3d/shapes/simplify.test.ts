import { describe, expect, it } from 'vitest';
import { simplifyPolyline, simplifyRing } from './simplify.ts';
import type { Point } from './types.ts';

const line = (points: [number, number][]): Point[] => points.map(([x, y]) => ({ x, y }));

describe('simplifyPolyline', () => {
  it('drops points that sit on the line between their neighbours', () => {
    const points = line([
      [0, 0],
      [1, 0],
      [2, 0],
      [3, 0],
    ]);
    expect(simplifyPolyline(points, 0.1)).toEqual(
      line([
        [0, 0],
        [3, 0],
      ])
    );
  });

  it('keeps a point that is further off the line than the tolerance', () => {
    const points = line([
      [0, 0],
      [1, 1],
      [2, 0],
    ]);
    expect(simplifyPolyline(points, 0.5)).toHaveLength(3);
  });

  it('keeps the ends', () => {
    const points = line([
      [0, 0],
      [1, 0.01],
      [2, 0],
    ]);
    const simplified = simplifyPolyline(points, 1);
    expect(simplified[0]).toEqual({ x: 0, y: 0 });
    expect(simplified[simplified.length - 1]).toEqual({ x: 2, y: 0 });
  });

  it('passes a zero tolerance through untouched', () => {
    const points = line([
      [0, 0],
      [1, 0],
      [2, 0],
    ]);
    expect(simplifyPolyline(points, 0)).toEqual(points);
  });

  // A staircase is what the tracer emits for any diagonal edge, and every one
  // of its points is exactly as far off the chord as every other. Splitting at
  // the first of them instead of the middle made this quadratic: 50,000 points
  // took minutes rather than milliseconds.
  it('simplifies a long staircase without splitting one point at a time', () => {
    const points = Array.from({ length: 50_000 }, (_value, i) => ({ x: i, y: i % 2 }));
    expect(simplifyPolyline(points, 0.1).length).toBeGreaterThan(2);
  });
});

describe('simplifyRing', () => {
  it('reduces a densely sampled square to its corners', () => {
    const ring: Point[] = [];
    for (let x = 0; x < 10; x += 1) ring.push({ x, y: 0 });
    for (let y = 0; y < 10; y += 1) ring.push({ x: 10, y });
    for (let x = 10; x > 0; x -= 1) ring.push({ x, y: 10 });
    for (let y = 10; y > 0; y -= 1) ring.push({ x: 0, y });

    expect(simplifyRing(ring, 0.5)).toHaveLength(4);
  });

  it('does not repeat the first point at the end', () => {
    const ring = line([
      [0, 0],
      [4, 0],
      [4, 4],
      [0, 4],
    ]);
    const simplified = simplifyRing(ring, 0.5);
    expect(simplified[0]).not.toEqual(simplified[simplified.length - 1]);
  });

  it('leaves a ring too short to simplify alone', () => {
    const ring = line([
      [0, 0],
      [1, 0],
      [0, 1],
    ]);
    expect(simplifyRing(ring, 5)).toEqual(ring);
  });
});
