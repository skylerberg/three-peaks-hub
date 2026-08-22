import { describe, expect, it } from 'vitest';
import type { SlotBox } from '@three-peaks/shared';
import { placement } from './pdf.ts';

// A 63 x 88 mm slot, the poker cell.
const box: SlotBox = { row: 0, column: 0, x_mm: 20, y_mm: 30, width_mm: 63, height_mm: 88 };

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
