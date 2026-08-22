// Seeded, so the same settings produce the same grain every time. Math.random
// would make an export unreproducible and every texture test a coin toss.

export function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hashLattice(ix: number, iy: number, seed: number): number {
  let h = Math.imul(ix, 0x27d4eb2d) ^ Math.imul(iy, 0x165667b1) ^ Math.imul(seed, 0x9e3779b1);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

const smoothstep = (t: number) => t * t * (3 - 2 * t);
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

// Value noise rather than gradient noise: wood grain is bands, and the extra
// smoothness of Perlin buys nothing a warp does not already give.
export function valueNoise2d(x: number, y: number, seed: number): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = smoothstep(x - ix);
  const fy = smoothstep(y - iy);

  const top = lerp(hashLattice(ix, iy, seed), hashLattice(ix + 1, iy, seed), fx);
  const bottom = lerp(hashLattice(ix, iy + 1, seed), hashLattice(ix + 1, iy + 1, seed), fx);
  return lerp(top, bottom, fy);
}

export function fractalNoise2d(x: number, y: number, seed: number, octaves = 4): number {
  let value = 0;
  let amplitude = 1;
  let frequency = 1;
  let total = 0;

  for (let octave = 0; octave < octaves; octave += 1) {
    value += valueNoise2d(x * frequency, y * frequency, seed + octave * 101) * amplitude;
    total += amplitude;
    amplitude *= 0.5;
    frequency *= 2;
  }

  return value / total;
}
