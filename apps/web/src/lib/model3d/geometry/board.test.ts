import { describe, expect, it } from 'vitest';
import { DEFAULT_BOARD_SETTINGS, type BoardFold } from '@three-peaks/shared';
import { MM } from '../units.ts';
import { buildBoardPanels, type BoardPanel } from './board.ts';

const PLACES = 6;

interface Span {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  minZ: number;
  maxZ: number;
}

// Where the panel lands on the board, rather than where its own vertices sit:
// the mesh carries the offset, so the two have to be added back together.
function span(panel: BoardPanel): Span {
  panel.geometry.computeBoundingBox();
  const box = panel.geometry.boundingBox;
  if (!box) throw new Error('no bounding box');
  const [x, y, z] = panel.center;
  return {
    minX: box.min.x + x,
    maxX: box.max.x + x,
    minY: box.min.y + y,
    maxY: box.max.y + y,
    minZ: box.min.z + z,
    maxZ: box.max.z + z,
  };
}

function boardSpan(panels: BoardPanel[]): Span {
  return panels.map(span).reduce((total, next) => ({
    minX: Math.min(total.minX, next.minX),
    maxX: Math.max(total.maxX, next.maxX),
    minY: Math.min(total.minY, next.minY),
    maxY: Math.max(total.maxY, next.maxY),
    minZ: Math.min(total.minZ, next.minZ),
    maxZ: Math.max(total.maxZ, next.maxZ),
  }));
}

// Only the printed face, because remapCapUVs mirrors the reverse and would
// widen every range read here.
function frontUvRange(panel: BoardPanel) {
  const normal = panel.geometry.getAttribute('normal');
  const uv = panel.geometry.getAttribute('uv');
  const range = { minU: Infinity, maxU: -Infinity, minV: Infinity, maxV: -Infinity };

  for (let i = 0; i < uv.count; i += 1) {
    if (normal.getZ(i) < 0.99) continue;
    range.minU = Math.min(range.minU, uv.getX(i));
    range.maxU = Math.max(range.maxU, uv.getX(i));
    range.minV = Math.min(range.minV, uv.getY(i));
    range.maxV = Math.max(range.maxV, uv.getY(i));
  }

  return range;
}

describe('buildBoardPanels', () => {
  it.each([
    ['none', 1],
    ['bifold', 2],
    ['quadfold', 4],
  ] as [BoardFold, number][])('cuts a %s board into %i panels', (fold, count) => {
    expect(buildBoardPanels({ ...DEFAULT_BOARD_SETTINGS, fold })).toHaveLength(count);
  });

  // The Blender importer finds the panels it turns by name, so the numbering is
  // as load-bearing as the geometry.
  it('numbers the panels in reading order, one-based and padded', () => {
    const panels = buildBoardPanels({ ...DEFAULT_BOARD_SETTINGS, fold: 'quadfold' });

    expect(panels.map((panel) => panel.name)).toEqual([
      'Panel.001',
      'Panel.002',
      'Panel.003',
      'Panel.004',
    ]);
    // Reading order: the first panel is the top left of the artwork.
    expect(span(panels[0]).minX).toBeLessThan(span(panels[1]).minX);
    expect(span(panels[0]).minY).toBeGreaterThan(span(panels[2]).minY);
  });

  it.each(['none', 'bifold', 'quadfold'] as BoardFold[])(
    'measures the board it was asked for when %s',
    (fold) => {
      const settings = { ...DEFAULT_BOARD_SETTINGS, fold };
      const measured = boardSpan(buildBoardPanels(settings));

      // The creases are cut out of the board rather than added to it. Added
      // instead, a 500 mm quadfold would export 506 mm.
      expect(measured.maxX - measured.minX).toBeCloseTo(settings.width_mm * MM, PLACES);
      expect(measured.maxY - measured.minY).toBeCloseTo(settings.height_mm * MM, PLACES);
      expect(measured.maxZ - measured.minZ).toBeCloseTo(settings.thickness_mm * MM, PLACES);
      expect(measured.maxZ + measured.minZ).toBeCloseTo(0, PLACES);
    }
  );

  it('leaves exactly the fold gap between two panels', () => {
    const settings = { ...DEFAULT_BOARD_SETTINGS, fold: 'bifold' as const };
    const [left, right] = buildBoardPanels(settings).map(span);

    expect(left.maxX).toBeLessThan(0);
    expect(right.minX - left.maxX).toBeCloseTo(settings.fold_gap_mm * MM, PLACES);
  });

  it('gives every panel a front, a back and a rim to dress', () => {
    for (const panel of buildBoardPanels({ ...DEFAULT_BOARD_SETTINGS, fold: 'quadfold' })) {
      expect(panel.geometry.groups).toHaveLength(3);
    }
  });

  // One image spans the whole board, so a panel takes the slice it covers and
  // the strip that falls in the crease is sampled by nobody.
  it('hands each panel its own slice of the artwork', () => {
    const settings = { ...DEFAULT_BOARD_SETTINGS, fold: 'bifold' as const };
    const panels = buildBoardPanels(settings);
    const share = (settings.width_mm - settings.fold_gap_mm) / 2 / settings.width_mm;

    const left = frontUvRange(panels[0]);
    const right = frontUvRange(panels[1]);

    expect(left.minU).toBeCloseTo(0, PLACES);
    expect(left.maxU).toBeCloseTo(share, PLACES);
    expect(right.minU).toBeCloseTo(1 - share, PLACES);
    expect(right.maxU).toBeCloseTo(1, PLACES);
    // A bifold creases across the width only, so both panels run the full drop.
    expect(left.minV).toBeCloseTo(0, PLACES);
    expect(left.maxV).toBeCloseTo(1, PLACES);
  });
});
