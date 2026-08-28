import { MeshStandardMaterial, type Texture } from 'three';
import type { BoxFace, BoxModelSettings } from '@three-peaks/shared';
import { fractalNoise2d } from '../noise.ts';
import { commit, paintCanvas, textureFrom } from './canvas.ts';

const TEXTURE_SIZE = 256;

// Matte lamination over printed carton: glossier than card stock, nowhere near
// bare wood.
const CARTON_ROUGHNESS = 0.52;

// A laminated print is not uniformly matte -- the film settles unevenly across a
// panel this big, and a face held at one exact roughness is the first thing that
// makes a render read as computer graphics. The variation is deliberately low
// frequency: a paper tooth spread over 300 mm at this resolution would come out
// as blotches rather than as tooth, which is why the card paints its own.
export function laminateRoughness(seed: number, base: number): Texture {
  const painted = paintCanvas(TEXTURE_SIZE);

  for (let y = 0; y < TEXTURE_SIZE; y += 1) {
    for (let x = 0; x < TEXTURE_SIZE; x += 1) {
      const mottle = fractalNoise2d((x / TEXTURE_SIZE) * 9, (y / TEXTURE_SIZE) * 9, seed, 3) - 0.5;
      const value = Math.round(Math.min(1, Math.max(0, base + mottle * 0.22)) * 255);
      const offset = (y * TEXTURE_SIZE + x) * 4;
      painted.image.data[offset] = value;
      painted.image.data[offset + 1] = value;
      painted.image.data[offset + 2] = value;
      painted.image.data[offset + 3] = 255;
    }
  }

  return textureFrom(commit(painted), false);
}

export interface BoxMaterials {
  faces: Record<BoxFace, MeshStandardMaterial>;
}

// Six materials over one wrap, differing only in name. That is the point: three
// writes the name into the .glb, so a box arrives in Blender as six material
// slots on one mesh and an artist can select a face. One shared material would
// arrive as one slot and nothing to pick.
export function boxMaterials(settings: BoxModelSettings, wrap: Texture): BoxMaterials {
  const roughnessMap = laminateRoughness(settings.seed, CARTON_ROUGHNESS);
  const face = (name: BoxFace) =>
    new MeshStandardMaterial({
      name: `Box.${name}`,
      map: wrap,
      roughnessMap,
      roughness: 1,
      metalness: 0,
    });

  return {
    faces: {
      front: face('front'),
      back: face('back'),
      left: face('left'),
      right: face('right'),
      top: face('top'),
      bottom: face('bottom'),
    },
  };
}
