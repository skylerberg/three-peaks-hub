import { MeshStandardMaterial, type Texture } from 'three';
import type { BoardModelSettings } from '@three-peaks/shared';
import { laminateRoughness } from './box.ts';

// The same printed laminate as a box wrap, mounted on chipboard instead of
// carton and a shade flatter for it.
const BOARD_ROUGHNESS = 0.58;
// The guillotined edge is raw chipboard, which takes no sheen at all.
const CHIPBOARD_ROUGHNESS = 0.95;

export interface BoardMaterials {
  face: MeshStandardMaterial;
  back: MeshStandardMaterial;
  edge: MeshStandardMaterial;
}

export function boardMaterials(settings: BoardModelSettings, artwork: Texture): BoardMaterials {
  const roughnessMap = laminateRoughness(settings.seed, BOARD_ROUGHNESS);
  const common = { roughnessMap, roughness: 1, metalness: 0 };

  return {
    face: new MeshStandardMaterial({ ...common, name: 'Board.face', map: artwork }),
    // A board's reverse is unprinted, and it is the same sheet as the edge.
    back: new MeshStandardMaterial({ ...common, name: 'Board.back', color: settings.edge_color }),
    // No map here: remapCapUVs rewrites the two caps and leaves the rim on the
    // extruder's own coordinates, so a flat colour is the only honest thing to
    // hang on it.
    edge: new MeshStandardMaterial({
      name: 'Board.edge',
      color: settings.edge_color,
      roughness: CHIPBOARD_ROUGHNESS,
      metalness: 0,
    }),
  };
}
