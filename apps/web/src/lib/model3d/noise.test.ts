import { describe, expect, it } from 'vitest';
import { fractalNoise2d, mulberry32, valueNoise2d } from './noise.ts';

describe('mulberry32', () => {
  it('gives the same stream for the same seed', () => {
    const a = mulberry32(7);
    const b = mulberry32(7);
    expect([a(), a(), a()]).toEqual([b(), b(), b()]);
  });

  it('gives a different stream for a different seed', () => {
    expect(mulberry32(7)()).not.toBe(mulberry32(8)());
  });

  it('stays inside the unit interval', () => {
    const random = mulberry32(99);
    for (let i = 0; i < 500; i += 1) {
      const value = random();
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
  });
});

describe('valueNoise2d', () => {
  // The whole reason the seed is a setting: the same dial-in has to produce the
  // same grain, or an export can never be reproduced.
  it('is deterministic', () => {
    expect(valueNoise2d(1.7, -3.2, 5)).toBe(valueNoise2d(1.7, -3.2, 5));
  });

  it('moves when the seed moves', () => {
    expect(valueNoise2d(1.7, -3.2, 5)).not.toBe(valueNoise2d(1.7, -3.2, 6));
  });

  it('is continuous across a lattice line', () => {
    const before = valueNoise2d(2 - 1e-6, 0.5, 3);
    const after = valueNoise2d(2 + 1e-6, 0.5, 3);
    expect(Math.abs(after - before)).toBeLessThan(1e-4);
  });

  it('stays inside the unit interval', () => {
    for (let i = 0; i < 200; i += 1) {
      const value = valueNoise2d(i * 0.37, i * 0.91, 11);
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThanOrEqual(1);
    }
  });
});

describe('fractalNoise2d', () => {
  it('stays inside the unit interval however many octaves it is given', () => {
    for (const octaves of [1, 2, 4, 6]) {
      const value = fractalNoise2d(3.3, 7.1, 2, octaves);
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThanOrEqual(1);
    }
  });

  it('is deterministic', () => {
    expect(fractalNoise2d(3.3, 7.1, 2)).toBe(fractalNoise2d(3.3, 7.1, 2));
  });
});
