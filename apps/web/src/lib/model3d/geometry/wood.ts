import { ExtrudeGeometry, type BufferGeometry, type Shape } from 'three';
import type { WoodModelSettings } from '@three-peaks/shared';
import { MM } from '../units.ts';
import type { Bounds } from '../shapes/types.ts';
import { bevelledExtrusion } from './extrude.ts';
import { assignFaceGroups, remapCapUVs } from './faceGroups.ts';

const BEVEL_SEGMENTS = 2;

// The shapes arrive already normalized to metres and centred, because the same
// outline can come from a traced bitmap or a parsed path and only one of those
// has a meaningful coordinate system of its own.
export function buildWoodGeometry(
  shapes: Shape[],
  bounds: Bounds,
  settings: WoodModelSettings
): BufferGeometry {
  const thickness = settings.thickness_mm * MM;
  const bevel = Math.min(settings.bevel_mm * MM, thickness / 3);

  const geometry = new ExtrudeGeometry(shapes, {
    ...bevelledExtrusion(thickness, bevel),
    bevelSegments: BEVEL_SEGMENTS,
    curveSegments: 1,
  });

  geometry.center();
  assignFaceGroups(geometry);
  remapCapUVs(geometry, bounds);

  return geometry;
}
