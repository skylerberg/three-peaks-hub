import type { Point, Ring } from './types.ts';

export interface ImageDataLike {
  width: number;
  height: number;
  data: Uint8ClampedArray;
}

type TraceSource = 'alpha' | 'luminance';

export interface TraceOptions {
  source: TraceSource;
  threshold: number;
}

const luminanceAt = (data: Uint8ClampedArray, offset: number) =>
  (0.2126 * data[offset] + 0.7152 * data[offset + 1] + 0.0722 * data[offset + 2]) / 255;

// Sampled from the four corners rather than assumed white: a silhouette scanned
// onto grey card and one exported onto white are the same picture, and only one
// of them has a background this can be hard-coded to.
function backgroundLuminance(image: ImageDataLike): number {
  const { width, height, data } = image;
  const corners = [
    0,
    (width - 1) * 4,
    (height - 1) * width * 4,
    ((height - 1) * width + width - 1) * 4,
  ];
  const samples = corners.map((offset) => luminanceAt(data, offset)).sort((a, b) => a - b);
  return (samples[1] + samples[2]) / 2;
}

export function buildMask(image: ImageDataLike, options: TraceOptions): Uint8Array {
  const { width, height, data } = image;
  const mask = new Uint8Array(width * height);

  if (options.source === 'alpha') {
    const cutoff = options.threshold * 255;
    for (let i = 0; i < mask.length; i += 1) {
      mask[i] = data[i * 4 + 3] >= cutoff ? 1 : 0;
    }
    return mask;
  }

  // Distance from the background rather than a fixed direction, so dark art on
  // white and light art on black both trace without a second setting.
  const background = backgroundLuminance(image);
  for (let i = 0; i < mask.length; i += 1) {
    mask[i] = Math.abs(luminanceAt(data, i * 4) - background) >= options.threshold ? 1 : 0;
  }
  return mask;
}

// Traces the boundary between filled and empty pixels as unit segments along
// the pixel lattice, then chains them into closed rings.
//
// Every filled pixel contributes an edge for each empty neighbour, oriented so
// the filled side is consistent. Chaining those is exact where a threshold-and-
// walk is approximate, and it produces holes as separate rings for free.
export function traceRings(image: ImageDataLike, options: TraceOptions): Ring[] {
  const { width, height } = image;
  const mask = buildMask(image, options);
  const filled = (x: number, y: number) =>
    x >= 0 && y >= 0 && x < width && y < height && mask[y * width + x] === 1;

  const key = (x: number, y: number) => y * (width + 1) + x;
  const edges = new Map<number, Point[]>();

  const addEdge = (from: Point, to: Point) => {
    const bucket = edges.get(key(from.x, from.y));
    if (bucket) bucket.push(to);
    else edges.set(key(from.x, from.y), [to]);
  };

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (!filled(x, y)) continue;
      if (!filled(x, y - 1)) addEdge({ x, y }, { x: x + 1, y });
      if (!filled(x + 1, y)) addEdge({ x: x + 1, y }, { x: x + 1, y: y + 1 });
      if (!filled(x, y + 1)) addEdge({ x: x + 1, y: y + 1 }, { x, y: y + 1 });
      if (!filled(x - 1, y)) addEdge({ x, y: y + 1 }, { x, y });
    }
  }

  const rings: Ring[] = [];

  for (const [startKey, bucket] of edges) {
    const first: Point = { x: startKey % (width + 1), y: Math.floor(startKey / (width + 1)) };

    while (bucket.length > 0) {
      let current = bucket.pop() as Point;
      const ring: Ring = [first];
      let direction = { x: current.x - first.x, y: current.y - first.y };
      let closed = false;

      while (true) {
        if (current.x === first.x && current.y === first.y) {
          closed = true;
          break;
        }
        ring.push(current);
        const next = takeNext(edges, key(current.x, current.y), current, direction);
        if (!next) break;
        direction = { x: next.x - current.x, y: next.y - current.y };
        current = next;
      }

      // A chain that ran out of edges is not a boundary; every real one closes,
      // and keeping a broken path would extrude an open outline.
      if (closed && ring.length >= 4) rings.push(ring);
    }
  }

  return rings;
}

// At a point where two filled pixels meet only at a corner, two edges leave the
// same lattice point and the choice decides whether the diagonal counts as
// joined. Turning towards the filled side keeps it joined, which is what a
// silhouette drawn by hand means by it.
function takeNext(
  edges: Map<number, Point[]>,
  fromKey: number,
  from: Point,
  direction: Point
): Point | null {
  const bucket = edges.get(fromKey);
  if (!bucket || bucket.length === 0) return null;
  if (bucket.length === 1) return bucket.pop() as Point;

  const preferred = [
    { x: direction.y, y: -direction.x },
    direction,
    { x: -direction.y, y: direction.x },
  ];

  for (const turn of preferred) {
    const index = bucket.findIndex(
      (candidate) => candidate.x - from.x === turn.x && candidate.y - from.y === turn.y
    );
    if (index !== -1) return bucket.splice(index, 1)[0];
  }

  return bucket.pop() as Point;
}
