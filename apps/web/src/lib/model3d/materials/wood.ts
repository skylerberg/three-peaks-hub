import { Color, MeshStandardMaterial, type Texture } from 'three';
import type { WoodModelSettings } from '@three-peaks/shared';
import { fractalNoise2d } from '../noise.ts';
import { commit, paintCanvas, textureFrom } from './canvas.ts';

const TEXTURE_SIZE = 512;

// Grain is bands of denser fibre, not a pattern: the bands run along the board,
// a low-frequency warp bends them the way a real board's do, and the dark lines
// are where the surface is also rougher. Painting roughness from the same field
// is what makes it read as wood rather than as a photograph of wood.
function grainAt(x: number, y: number, settings: WoodModelSettings, stretch: number): number {
  const warp = fractalNoise2d(x * 2, y * 12 * stretch, settings.seed) - 0.5;
  const bands = Math.sin((y * settings.grain_scale + warp * 1.6) * Math.PI * 2);
  const fibre = fractalNoise2d(x * 180, y * 24, settings.seed + 7) - 0.5;
  return Math.min(1, Math.max(0, Math.abs(bands) ** 0.45 + fibre * 0.12));
}

function paint(
  settings: WoodModelSettings,
  stretch: number
): {
  map: Texture;
  roughnessMap: Texture;
} {
  const painted = paintCanvas(TEXTURE_SIZE);
  const rough = paintCanvas(TEXTURE_SIZE);
  const light = new Color(settings.wood_color);
  const dark = new Color(settings.grain_color);
  const mixed = new Color();

  for (let y = 0; y < TEXTURE_SIZE; y += 1) {
    for (let x = 0; x < TEXTURE_SIZE; x += 1) {
      const grain = grainAt(x / TEXTURE_SIZE, y / TEXTURE_SIZE, settings, stretch);
      mixed.copy(dark).lerp(light, grain);

      const offset = (y * TEXTURE_SIZE + x) * 4;
      painted.image.data[offset] = Math.round(mixed.r * 255);
      painted.image.data[offset + 1] = Math.round(mixed.g * 255);
      painted.image.data[offset + 2] = Math.round(mixed.b * 255);
      painted.image.data[offset + 3] = 255;

      const roughness = Math.round((0.9 - grain * 0.35) * 255);
      rough.image.data[offset] = roughness;
      rough.image.data[offset + 1] = roughness;
      rough.image.data[offset + 2] = roughness;
      rough.image.data[offset + 3] = 255;
    }
  }

  return {
    map: textureFrom(commit(painted), true),
    roughnessMap: textureFrom(commit(rough), false),
  };
}

export interface WoodMaterials {
  face: MeshStandardMaterial;
  edge: MeshStandardMaterial;
}

// A printed piece takes artwork on its faces; the painted grain there is then
// only the tooth underneath, so its colour map is dropped rather than left to
// hold GPU memory nothing samples.
export function woodMaterials(settings: WoodModelSettings, faceMap: Texture | null): WoodMaterials {
  const faceMaps = paint(settings, 1);
  // The cut edge shows the grain end-on, so the same field compressed across
  // the band direction rather than a second texture that has to be kept in step.
  const edgeMaps = paint(settings, 6);

  if (faceMap) {
    faceMaps.map.dispose();
    faceMaps.map = faceMap;
  }

  return {
    face: new MeshStandardMaterial({ ...faceMaps, roughness: 1, metalness: 0 }),
    edge: new MeshStandardMaterial({ ...edgeMaps, roughness: 1, metalness: 0 }),
  };
}
