import { MeshStandardMaterial, type Texture } from 'three';
import type { PunchboardModelSettings } from '@three-peaks/shared';
import { laminateRoughness } from './box.ts';

// Printed greyboard: flatter than a box wrap, because a punchboard is finished
// matte so the tokens do not shine under a table lamp.
const PRINTED_ROUGHNESS = 0.66;
// The die cut goes through to raw board, which takes no sheen at all.
const CUT_EDGE_ROUGHNESS = 0.95;

export interface PunchboardMaterials {
  face: MeshStandardMaterial;
  back: MeshStandardMaterial;
  edge: MeshStandardMaterial;
}

export function punchboardMaterials(
  settings: PunchboardModelSettings,
  artwork: Texture
): PunchboardMaterials {
  const roughnessMap = laminateRoughness(settings.seed, PRINTED_ROUGHNESS);
  const common = { roughnessMap, roughness: 1, metalness: 0 };

  return {
    face: new MeshStandardMaterial({ ...common, name: 'Punchboard.face', map: artwork }),
    back: new MeshStandardMaterial({
      ...common,
      name: 'Punchboard.back',
      color: settings.back_color,
    }),
    // Flat, for the reason boardMaterials gives about its own edge.
    edge: new MeshStandardMaterial({
      name: 'Punchboard.edge',
      color: settings.edge_color,
      roughness: CUT_EDGE_ROUGHNESS,
      metalness: 0,
    }),
  };
}
