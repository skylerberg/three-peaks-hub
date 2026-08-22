import { ExtrudeGeometry, type BufferGeometry } from 'three';
import { clampCornerRadius, type CardModelSettings } from '@three-peaks/shared';
import { roundedRectShape } from '../shapes/roundedRect.ts';
import { MM } from '../units.ts';
import { bevelledExtrusion } from './extrude.ts';
import { assignFaceGroups, remapCapUVs } from './faceGroups.ts';

const CURVE_SEGMENTS = 16;
const BEVEL_SEGMENTS = 2;

export function buildCardGeometry(settings: CardModelSettings): BufferGeometry {
  const width = settings.width_mm * MM;
  const height = settings.height_mm * MM;
  const thickness = settings.thickness_mm * MM;
  // A bevel deeper than a third of the stock eats the flat face it is supposed
  // to be an edge of.
  const bevel = Math.min(settings.bevel_mm * MM, thickness / 3);

  const shape = roundedRectShape(width, height, clampCornerRadius(settings) * MM);
  const geometry = new ExtrudeGeometry(shape, {
    ...bevelledExtrusion(thickness, bevel),
    bevelSegments: BEVEL_SEGMENTS,
    curveSegments: CURVE_SEGMENTS,
  });

  // Extrusion runs from z = 0 forwards; a card that turns about its own face
  // has to straddle the origin.
  geometry.center();
  assignFaceGroups(geometry);
  remapCapUVs(geometry, {
    minX: -width / 2,
    minY: -height / 2,
    maxX: width / 2,
    maxY: height / 2,
  });

  return geometry;
}
