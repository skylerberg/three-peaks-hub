import { MeshStandardMaterial, type Texture } from 'three';
import type { CardModelSettings } from '@three-peaks/shared';
import { fractalNoise2d } from '../noise.ts';
import { commit, paintCanvas, textureFrom } from './canvas.ts';

const TEXTURE_SIZE = 256;

// Card stock is matte with a faint fibre tooth. Without it a printed face reads
// as gloss plastic under any light that is not perfectly diffuse.
function stockRoughness(seed: number): Texture {
  const painted = paintCanvas(TEXTURE_SIZE);

  for (let y = 0; y < TEXTURE_SIZE; y += 1) {
    for (let x = 0; x < TEXTURE_SIZE; x += 1) {
      const fibre = fractalNoise2d((x / TEXTURE_SIZE) * 120, (y / TEXTURE_SIZE) * 120, seed, 3);
      const value = Math.round((0.72 + fibre * 0.18) * 255);
      const offset = (y * TEXTURE_SIZE + x) * 4;
      painted.image.data[offset] = value;
      painted.image.data[offset + 1] = value;
      painted.image.data[offset + 2] = value;
      painted.image.data[offset + 3] = 255;
    }
  }

  return textureFrom(commit(painted), false);
}

export interface CardMaterials {
  front: MeshStandardMaterial;
  back: MeshStandardMaterial;
  rim: MeshStandardMaterial;
}

export function cardMaterials(
  settings: CardModelSettings,
  front: Texture,
  back: Texture | null
): CardMaterials {
  const roughnessMap = stockRoughness(settings.seed);
  const common = { roughnessMap, roughness: 1, metalness: 0 };

  return {
    front: new MeshStandardMaterial({ ...common, map: front }),
    back: back
      ? new MeshStandardMaterial({ ...common, map: back })
      : new MeshStandardMaterial({ ...common, color: settings.back_color }),
    // The cut edge of a card is the white core, not the print, which is why a
    // worn deck shows a pale line before it shows anything else.
    rim: new MeshStandardMaterial({ ...common, color: settings.stock_color }),
  };
}
