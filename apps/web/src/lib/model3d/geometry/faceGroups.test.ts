import { describe, expect, it } from 'vitest';
import { BoxGeometry, ExtrudeGeometry } from 'three';
import { DEFAULT_CARD_SETTINGS } from '@three-peaks/shared';
import { roundedRectShape } from '../shapes/roundedRect.ts';
import { MM } from '../units.ts';
import { buildCardGeometry } from './card.ts';
import { BACK_GROUP, FRONT_GROUP, RIM_GROUP, assignFaceGroups, remapCapUVs } from './faceGroups.ts';

const bounds = { minX: -2, minY: -3, maxX: 2, maxY: 3 };

function slab() {
  return new ExtrudeGeometry(roundedRectShape(4, 6, 0.5), {
    depth: 0.4,
    bevelEnabled: false,
    curveSegments: 4,
    steps: 1,
  });
}

describe('assignFaceGroups', () => {
  it('splits the extrusion into a front, a back and a rim', () => {
    const geometry = slab();
    assignFaceGroups(geometry);

    expect(geometry.groups.map((group) => group.materialIndex)).toEqual([
      FRONT_GROUP,
      BACK_GROUP,
      RIM_GROUP,
    ]);
  });

  // ExtrudeGeometry puts both lids in one group, which is why this exists at
  // all: a card whose two faces share a material cannot have a back.
  it('accounts for every triangle exactly once', () => {
    const geometry = slab();
    const vertices = geometry.getAttribute('position').count;
    assignFaceGroups(geometry);

    const covered = geometry.groups.reduce((total, group) => total + group.count, 0);
    expect(covered).toBe(vertices);
    expect(geometry.getAttribute('position').count).toBe(vertices);
  });

  it('puts the front and back triangles in the groups that face that way', () => {
    const geometry = slab();
    assignFaceGroups(geometry);
    const normal = geometry.getAttribute('normal');

    for (const group of geometry.groups) {
      for (let i = group.start; i < group.start + group.count; i += 1) {
        const nz = normal.getZ(i);
        if (group.materialIndex === FRONT_GROUP) expect(nz).toBeGreaterThan(0.9);
        if (group.materialIndex === BACK_GROUP) expect(nz).toBeLessThan(-0.9);
        if (group.materialIndex === RIM_GROUP) expect(Math.abs(nz)).toBeLessThan(0.9);
      }
    }
  });

  it('refuses an indexed geometry rather than reordering it wrongly', () => {
    expect(() => assignFaceGroups(new BoxGeometry(1, 1, 1))).toThrow(/non-indexed/);
  });
});

describe('remapCapUVs', () => {
  it('spreads the cap faces across the whole texture', () => {
    const geometry = slab();
    assignFaceGroups(geometry);
    remapCapUVs(geometry, bounds);

    const normal = geometry.getAttribute('normal');
    const uv = geometry.getAttribute('uv');
    let capped = 0;

    for (let i = 0; i < uv.count; i += 1) {
      if (Math.abs(normal.getZ(i)) < 0.99) continue;
      capped += 1;
      expect(uv.getX(i)).toBeGreaterThanOrEqual(-1e-6);
      expect(uv.getX(i)).toBeLessThanOrEqual(1 + 1e-6);
      expect(uv.getY(i)).toBeGreaterThanOrEqual(-1e-6);
      expect(uv.getY(i)).toBeLessThanOrEqual(1 + 1e-6);
    }

    expect(capped).toBeGreaterThan(0);
  });

  // Textures are exported with flipY off, so v = 0 is the first row of the
  // image and belongs at the top of the piece.
  it('puts the top of the image at the top of the piece', () => {
    const geometry = slab();
    assignFaceGroups(geometry);
    remapCapUVs(geometry, bounds);

    const position = geometry.getAttribute('position');
    const normal = geometry.getAttribute('normal');
    const uv = geometry.getAttribute('uv');

    for (let i = 0; i < uv.count; i += 1) {
      if (normal.getZ(i) < 0.99) continue;
      expect(uv.getY(i)).toBeCloseTo((bounds.maxY - position.getY(i)) / 6, 6);
    }
  });

  // The reverse is seen from behind. Without the mirror every card back reads
  // as its own mirror image, which only shows up once there is artwork on it.
  it('mirrors the back face across the front', () => {
    const geometry = slab();
    assignFaceGroups(geometry);
    remapCapUVs(geometry, bounds);

    const position = geometry.getAttribute('position');
    const normal = geometry.getAttribute('normal');
    const uv = geometry.getAttribute('uv');

    let checked = 0;
    for (let i = 0; i < uv.count; i += 1) {
      if (normal.getZ(i) > -0.99) continue;
      checked += 1;
      expect(uv.getX(i)).toBeCloseTo((bounds.maxX - position.getX(i)) / 4, 6);
    }

    expect(checked).toBeGreaterThan(0);
  });
});

describe('buildCardGeometry', () => {
  it('builds a card in metres, straddling the origin', () => {
    const geometry = buildCardGeometry(DEFAULT_CARD_SETTINGS);
    geometry.computeBoundingBox();
    const box = geometry.boundingBox;
    if (!box) throw new Error('no bounding box');

    // The size asked for is the size of the piece, bevel included. Before the
    // bevel was offset inwards a 63.5 mm card measured 63.66 mm.
    //
    // Read off the settings rather than written out, so this keeps asserting
    // the thing it is about when the default card size moves.
    expect(box.max.x - box.min.x).toBeCloseTo(DEFAULT_CARD_SETTINGS.width_mm * MM, 6);
    expect(box.max.y - box.min.y).toBeCloseTo(DEFAULT_CARD_SETTINGS.height_mm * MM, 6);
    expect(box.max.z - box.min.z).toBeCloseTo(DEFAULT_CARD_SETTINGS.thickness_mm * MM, 7);
    expect(box.max.z + box.min.z).toBeCloseTo(0, 6);
  });

  it('gives the card three material slots to fill', () => {
    const geometry = buildCardGeometry(DEFAULT_CARD_SETTINGS);
    expect(geometry.groups).toHaveLength(3);
  });
});
