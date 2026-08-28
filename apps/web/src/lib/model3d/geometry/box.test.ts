import { describe, expect, it } from 'vitest';
import type { BufferGeometry } from 'three';
import { BOX_FACES, DEFAULT_BOX_SETTINGS, boxNetRegions } from '@three-peaks/shared';
import { MM } from '../units.ts';
import { buildBoxGeometry } from './box.ts';

// Positions and UVs are float32 in the buffer, which is about seven digits.
const EPSILON = 1e-6;

function measure(geometry: BufferGeometry) {
  geometry.computeBoundingBox();
  const box = geometry.boundingBox;
  if (!box) throw new Error('no bounding box');
  return {
    width: box.max.x - box.min.x,
    height: box.max.y - box.min.y,
    depth: box.max.z - box.min.z,
    centre: [box.max.x + box.min.x, box.max.y + box.min.y, box.max.z + box.min.z],
  };
}

describe('buildBoxGeometry', () => {
  it('builds a box in metres, straddling the origin', () => {
    const measured = measure(buildBoxGeometry(DEFAULT_BOX_SETTINGS));

    // The chamfer is cut inwards, so the size asked for is the size of the
    // piece. Added on instead, a 295 mm box would export 297 mm.
    expect(measured.width).toBeCloseTo(DEFAULT_BOX_SETTINGS.width_mm * MM, 6);
    expect(measured.height).toBeCloseTo(DEFAULT_BOX_SETTINGS.height_mm * MM, 6);
    expect(measured.depth).toBeCloseTo(DEFAULT_BOX_SETTINGS.depth_mm * MM, 6);
    for (const offset of measured.centre) expect(offset).toBeCloseTo(0, 6);
  });

  it('measures the same with no chamfer at all', () => {
    const measured = measure(buildBoxGeometry({ ...DEFAULT_BOX_SETTINGS, corner_bevel_mm: 0 }));

    expect(measured.width).toBeCloseTo(DEFAULT_BOX_SETTINGS.width_mm * MM, 6);
    expect(measured.depth).toBeCloseTo(DEFAULT_BOX_SETTINGS.depth_mm * MM, 6);
  });

  // The largest chamfer the settings allow is deeper than the shallowest box
  // they allow, which would leave a face with no flat part and two chamfers
  // crossing through each other.
  it('measures the same when the chamfer is clamped against a shallow box', () => {
    const settings = { ...DEFAULT_BOX_SETTINGS, depth_mm: 5, corner_bevel_mm: 10 };
    const measured = measure(buildBoxGeometry(settings));

    expect(measured.width).toBeCloseTo(settings.width_mm * MM, 6);
    expect(measured.depth).toBeCloseTo(settings.depth_mm * MM, 6);
  });

  it('gives every face a material slot of its own, in the order BOX_FACES lists', () => {
    const geometry = buildBoxGeometry(DEFAULT_BOX_SETTINGS);

    expect(geometry.groups.map((group) => group.materialIndex)).toEqual(
      BOX_FACES.map((_, index) => index)
    );
  });

  it('accounts for every triangle exactly once', () => {
    const geometry = buildBoxGeometry(DEFAULT_BOX_SETTINGS);
    const vertices = geometry.getAttribute('position').count;

    let next = 0;
    for (const group of geometry.groups) {
      expect(group.start).toBe(next);
      next += group.count;
    }
    expect(next).toBe(vertices);
    expect(vertices % 3).toBe(0);
  });

  it('runs a strip along every edge and a patch into every corner', () => {
    const chamfered = buildBoxGeometry(DEFAULT_BOX_SETTINGS);
    const sharp = buildBoxGeometry({ ...DEFAULT_BOX_SETTINGS, corner_bevel_mm: 0 });

    expect(chamfered.getAttribute('position').count / 3).toBe(6 * 2 + 12 * 2 + 8);
    expect(sharp.getAttribute('position').count / 3).toBe(6 * 2);
  });

  it('keeps each face inside its own region of the wrap', () => {
    const geometry = buildBoxGeometry(DEFAULT_BOX_SETTINGS);
    const regions = boxNetRegions(DEFAULT_BOX_SETTINGS);
    const uv = geometry.getAttribute('uv');

    for (const group of geometry.groups) {
      const rect = regions[BOX_FACES[group.materialIndex ?? 0]];
      for (let i = group.start; i < group.start + group.count; i += 1) {
        expect(uv.getX(i)).toBeGreaterThanOrEqual(rect.u0 - EPSILON);
        expect(uv.getX(i)).toBeLessThanOrEqual(rect.u1 + EPSILON);
        expect(uv.getY(i)).toBeGreaterThanOrEqual(rect.v0 - EPSILON);
        expect(uv.getY(i)).toBeLessThanOrEqual(rect.v1 + EPSILON);
      }
    }
  });

  // The wrap's own first row has to land on the top of the front face. Turned
  // the other way up the box still looks like a box -- a net is symmetric
  // enough for that -- and every word printed on it is upside down.
  it('puts the top of the net panel at the top of the face', () => {
    const geometry = buildBoxGeometry(DEFAULT_BOX_SETTINGS);
    const regions = boxNetRegions(DEFAULT_BOX_SETTINGS);
    const position = geometry.getAttribute('position');
    const uv = geometry.getAttribute('uv');
    const front = geometry.groups[BOX_FACES.indexOf('front')];

    let highest = -Infinity;
    let atHighest = 0;
    for (let i = front.start; i < front.start + front.count; i += 1) {
      if (position.getY(i) <= highest) continue;
      highest = position.getY(i);
      atHighest = uv.getY(i);
    }

    expect(highest).toBeCloseTo((DEFAULT_BOX_SETTINGS.height_mm / 2) * MM, 6);
    expect(atHighest).toBeCloseTo(regions.front.v0, 6);
  });

  // The wrap unrolls front, right, back, left across the image, so walking the
  // box the other way round is what puts the back panel on the back. Without
  // it every box reads mirrored, which only shows once there is type on it.
  it('unrolls the back panel the opposite way from the front', () => {
    const geometry = buildBoxGeometry(DEFAULT_BOX_SETTINGS);
    const regions = boxNetRegions(DEFAULT_BOX_SETTINGS);
    const position = geometry.getAttribute('position');
    const uv = geometry.getAttribute('uv');
    const back = geometry.groups[BOX_FACES.indexOf('back')];

    let rightmost = -Infinity;
    let atRightmost = 0;
    for (let i = back.start; i < back.start + back.count; i += 1) {
      if (position.getX(i) <= rightmost) continue;
      rightmost = position.getX(i);
      atRightmost = uv.getX(i);
    }

    expect(rightmost).toBeCloseTo((DEFAULT_BOX_SETTINGS.width_mm / 2) * MM, 6);
    expect(atRightmost).toBeCloseTo(regions.back.u0, 6);
  });

  it('winds every triangle outwards', () => {
    const geometry = buildBoxGeometry(DEFAULT_BOX_SETTINGS);
    const position = geometry.getAttribute('position');

    for (let triangle = 0; triangle < position.count / 3; triangle += 1) {
      const base = triangle * 3;
      const points = [0, 1, 2].map((offset) => [
        position.getX(base + offset),
        position.getY(base + offset),
        position.getZ(base + offset),
      ]);
      const [a, b, c] = points;
      const ab = b.map((value, axis) => value - a[axis]);
      const ac = c.map((value, axis) => value - a[axis]);
      const normal = [
        ab[1] * ac[2] - ab[2] * ac[1],
        ab[2] * ac[0] - ab[0] * ac[2],
        ab[0] * ac[1] - ab[1] * ac[0],
      ];
      // The box is convex and centred on the origin, so an outward triangle is
      // one whose normal leans the same way as its own centroid.
      const centroid = a.map((_, axis) => (a[axis] + b[axis] + c[axis]) / 3);
      const facing = normal.reduce((total, value, axis) => total + value * centroid[axis], 0);

      expect(facing).toBeGreaterThan(0);
    }
  });
});
