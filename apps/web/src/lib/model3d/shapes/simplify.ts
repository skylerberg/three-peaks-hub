import type { Point, Ring } from './types.ts';

function perpendicularDistance(point: Point, start: Point, end: Point): number {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const lengthSquared = dx * dx + dy * dy;

  if (lengthSquared === 0) return Math.hypot(point.x - start.x, point.y - start.y);

  const t = ((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSquared;
  const clamped = Math.max(0, Math.min(1, t));
  return Math.hypot(point.x - (start.x + clamped * dx), point.y - (start.y + clamped * dy));
}

// Ramer-Douglas-Peucker, iterative rather than recursive: a traced contour is
// one point per pixel edge, and a 2000-pixel outline recurses deeper than the
// stack allows.
export function simplifyPolyline(points: readonly Point[], tolerance: number): Point[] {
  if (tolerance <= 0 || points.length < 3) return [...points];

  const keep = new Uint8Array(points.length);
  keep[0] = 1;
  keep[points.length - 1] = 1;

  const stack: Array<[number, number]> = [[0, points.length - 1]];

  while (stack.length > 0) {
    const [first, last] = stack.pop() as [number, number];
    const middle = (first + last) / 2;
    let furthest = -1;
    let furthestDistance = tolerance;
    let furthestBias = Infinity;

    for (let i = first + 1; i < last; i += 1) {
      const distance = perpendicularDistance(points[i], points[first], points[last]);
      if (distance <= tolerance) continue;

      // Ties split down the middle rather than at the first point that reached
      // the maximum. A traced diagonal is a perfectly regular staircase, so
      // every point ties -- and peeling one off at a time makes this quadratic
      // on exactly the contours the tracer produces most.
      const bias = Math.abs(i - middle);
      if (distance > furthestDistance || (distance === furthestDistance && bias < furthestBias)) {
        furthest = i;
        furthestDistance = distance;
        furthestBias = bias;
      }
    }

    if (furthest === -1) continue;
    keep[furthest] = 1;
    stack.push([first, furthest], [furthest, last]);
  }

  return points.filter((_point, index) => keep[index] === 1);
}

// A ring has no endpoints to anchor on, and RDP anchors on two. Starting at the
// extreme point puts the anchor on a real corner, where keeping it costs
// nothing -- anchoring at an arbitrary index leaves a visible flat spot there.
export function simplifyRing(ring: Ring, tolerance: number): Ring {
  if (tolerance <= 0 || ring.length < 4) return [...ring];

  let start = 0;
  for (let i = 1; i < ring.length; i += 1) {
    const candidate = ring[i];
    const best = ring[start];
    if (candidate.x < best.x || (candidate.x === best.x && candidate.y < best.y)) start = i;
  }

  const rotated = [...ring.slice(start), ...ring.slice(0, start)];
  // Closed for the pass, so the anchor point is not treated as two loose ends,
  // then dropped again.
  const simplified = simplifyPolyline([...rotated, rotated[0]], tolerance);
  simplified.pop();
  return simplified;
}
