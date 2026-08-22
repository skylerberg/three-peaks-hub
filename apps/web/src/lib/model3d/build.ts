import { Group, Mesh, type BufferGeometry, type Material, type Shape } from 'three';
import type { CardModelSettings, ModelSettings, WoodModelSettings } from '@three-peaks/shared';
import { buildCardGeometry } from './geometry/card.ts';
import { buildWoodGeometry } from './geometry/wood.ts';
import { cardMaterials } from './materials/cardStock.ts';
import { woodMaterials } from './materials/wood.ts';
import {
  normalizeOutlines,
  outlineBounds,
  outlinesToShapes,
  ringsToOutlines,
} from './shapes/outlines.ts';
import { simplifyRing } from './shapes/simplify.ts';
import { svgOutlines } from './shapes/svg.ts';
import { traceRings } from './shapes/trace.ts';
import type { Bounds, Outline } from './shapes/types.ts';
import { sourceTexture, type SourceImage } from './sources.ts';

export class EmptyOutlineError extends Error {
  constructor() {
    super('Nothing was found to cut out. Try a lower threshold, or an image with a clear outline.');
    this.name = 'EmptyOutlineError';
  }
}

function woodOutlines(source: SourceImage, settings: WoodModelSettings): Outline[] {
  // A vector source already is an outline. Rasterising it only to trace the
  // raster back would throw away the exact edge and hand back a stepped one.
  if (source.svgText !== null) return svgOutlines(source.svgText);

  const rings = traceRings(source.pixels, {
    source: settings.trace_source,
    threshold: settings.trace_threshold,
  }).map((ring) => simplifyRing(ring, settings.simplify_tolerance));

  return ringsToOutlines(rings.filter((ring) => ring.length >= 3));
}

function buildCard(settings: CardModelSettings, front: SourceImage, back: SourceImage | null) {
  const geometry = buildCardGeometry(settings);
  const materials = cardMaterials(
    settings,
    sourceTexture(front),
    back ? sourceTexture(back) : null
  );
  return { geometry, materials: [materials.front, materials.back, materials.rim] };
}

function buildWood(settings: WoodModelSettings, source: SourceImage) {
  const outlines = normalizeOutlines(woodOutlines(source, settings), {
    longestSideMm: settings.longest_side_mm,
    flipY: true,
  });
  if (outlines.length === 0) throw new EmptyOutlineError();

  const shapes: Shape[] = outlinesToShapes(outlines);
  const bounds: Bounds = outlineBounds(outlines);
  const geometry = buildWoodGeometry(shapes, bounds, settings);

  // Printed pieces carry the artwork on both faces and bare wood on the cut
  // edge; unprinted ones are wood all the way round.
  const materials = woodMaterials(settings, settings.printed ? sourceTexture(source) : null);
  return { geometry, materials: [materials.face, materials.face, materials.edge] };
}

export interface BuiltModel {
  group: Group;
  geometry: BufferGeometry;
  materials: Material[];
}

export function buildModel(
  settings: ModelSettings,
  source: SourceImage,
  back: SourceImage | null
): BuiltModel {
  const built =
    settings.kind === 'card' ? buildCard(settings, source, back) : buildWood(settings, source);

  const group = new Group();
  group.name = settings.kind === 'card' ? 'Card' : 'Component';
  group.add(new Mesh(built.geometry, built.materials));

  return { group, geometry: built.geometry, materials: built.materials };
}

// A rebuild happens on every slider move, and neither geometry nor a texture is
// released by dropping the reference to it -- both hold GPU memory until they
// are told to let go.
export function disposeModel(model: BuiltModel): void {
  model.geometry.dispose();

  // A Set because the same material sits at two slots on a printed piece, and
  // the same texture at two slots on a material.
  const seen = new Set<{ dispose(): void }>();
  for (const material of model.materials) {
    for (const value of Object.values(material)) {
      if (value && typeof value === 'object' && 'isTexture' in value) {
        seen.add(value as { dispose(): void });
      }
    }
    seen.add(material);
  }
  for (const disposable of seen) disposable.dispose();
}
