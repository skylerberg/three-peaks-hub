import { ExtrudeGeometry, type BufferGeometry } from 'three';
import type { BoardFold, BoardModelSettings } from '@three-peaks/shared';
import { roundedRectShape } from '../shapes/roundedRect.ts';
import { MM } from '../units.ts';
import type { Bounds } from '../shapes/types.ts';
import { bevelledExtrusion } from './extrude.ts';
import { assignFaceGroups, remapCapUVs } from './faceGroups.ts';

// A bifold creases once down the middle; a quadfold creases again across it,
// which is the two-by-two a retail board is boxed in.
const PANEL_GRID: Record<BoardFold, { columns: number; rows: number }> = {
  none: { columns: 1, rows: 1 },
  bifold: { columns: 2, rows: 1 },
  quadfold: { columns: 2, rows: 2 },
};

export interface BoardPanel {
  // Reading order from the top left of the artwork, one-based and padded to
  // three digits. The importer keeps these names on the objects it makes, so
  // which panel is which survives the trip and a hinge can be built by hand.
  name: string;
  geometry: BufferGeometry;
  // Where the panel sits in the board's plane, in metres. The crease between
  // two neighbours is halfway between their centres, which is the line to turn
  // them about.
  center: readonly [number, number, number];
}

// The gap is cut out of the board rather than added to it, so a 500 mm board
// measures 500 mm laid flat however many times it is creased.
function panelSpan(total: number, count: number, gap: number): { size: number; gap: number } {
  const limited = Math.max(0, Math.min(gap, total / (2 * count)));
  return { size: (total - (count - 1) * limited) / count, gap: limited };
}

export function buildBoardPanels(settings: BoardModelSettings): BoardPanel[] {
  const width = settings.width_mm * MM;
  const height = settings.height_mm * MM;
  const thickness = settings.thickness_mm * MM;
  const { columns, rows } = PANEL_GRID[settings.fold];
  const across = panelSpan(width, columns, settings.fold_gap_mm * MM);
  const down = panelSpan(height, rows, settings.fold_gap_mm * MM);

  // Square corners: a mounted board is guillotined, and the extruder's own
  // bevel is what would round it.
  const shape = roundedRectShape(across.size, down.size, 0);
  const panels: BoardPanel[] = [];

  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      const centerX = -width / 2 + column * (across.size + across.gap) + across.size / 2;
      const centerY = height / 2 - row * (down.size + down.gap) - down.size / 2;

      const geometry = new ExtrudeGeometry(shape, {
        ...bevelledExtrusion(thickness, 0),
        curveSegments: 1,
      });
      geometry.center();
      assignFaceGroups(geometry);

      // The artwork spans the whole board, so every panel is handed the board's
      // rectangle in its own coordinates and takes only the slice it covers.
      // Whatever falls in a crease is never sampled, which is the gap.
      const bounds: Bounds = {
        minX: -width / 2 - centerX,
        minY: -height / 2 - centerY,
        maxX: width / 2 - centerX,
        maxY: height / 2 - centerY,
      };
      remapCapUVs(geometry, bounds);

      panels.push({
        name: `Panel.${String(panels.length + 1).padStart(3, '0')}`,
        geometry,
        center: [centerX, centerY, 0],
      });
    }
  }

  return panels;
}
