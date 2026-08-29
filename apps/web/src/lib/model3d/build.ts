import { Group, Mesh, type BufferGeometry, type Material, type Shape } from 'three';
import {
  BOX_FACES,
  type BoardModelSettings,
  type BoxModelSettings,
  type CardModelSettings,
  type ModelKind,
  type ModelSettings,
  type PunchboardModelSettings,
  type WoodModelSettings,
} from '@three-peaks/shared';
import { buildBoardPanels } from './geometry/board.ts';
import { buildBoxGeometry } from './geometry/box.ts';
import { buildCardGeometry } from './geometry/card.ts';
import { buildPunchboardPiece, punchboardLayout } from './geometry/punchboard.ts';
import { buildWoodGeometry } from './geometry/wood.ts';
import { boardMaterials } from './materials/board.ts';
import { boxMaterials } from './materials/box.ts';
import { cardMaterials } from './materials/cardStock.ts';
import { punchboardMaterials } from './materials/punchboard.ts';
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

// What the exported node is called. A trailer scene holds several of these at
// once, so the name is the only thing telling one apart in an outliner.
const GROUP_NAMES: Record<ModelKind, string> = {
  card: 'Card',
  wood: 'Component',
  box: 'Box',
  board: 'Board',
  punchboard: 'Punchboard',
};

export class MissingCutSheetError extends Error {
  constructor() {
    super('A punchboard needs an SVG cut sheet: it is what says where the tokens are.');
    this.name = 'MissingCutSheetError';
  }
}

/**
 * The images a component is built from.
 *
 * Two of them at most, and which second one depends on the kind: a card takes
 * the artwork for its reverse, a punchboard takes the die line that says where
 * its tokens are. Named rather than positional because the two are nothing
 * alike, and a builder handed the wrong one would extrude a card back.
 */
export interface ModelSources {
  artwork: SourceImage;
  back?: SourceImage | null;
  cut?: SourceImage | null;
}

// One kind may be several meshes -- a folded board is one per panel -- and they
// share their materials, which is why the two lists are not the same length.
interface BuiltParts {
  meshes: Mesh[];
  materials: Material[];
}

interface Cut {
  outlines: Outline[];
  // Where the artwork sits in the same space the outlines came out in.
  frame: Bounds;
}

function woodOutlines(source: SourceImage, settings: WoodModelSettings): Cut {
  // A vector source already is an outline. Rasterising it only to trace the
  // raster back would throw away the exact edge and hand back a stepped one.
  if (source.svgText !== null) {
    // Its artwork is rasterised across the whole viewport, which nothing here
    // reads back; the paths' own bounds are the closest frame available.
    const outlines = svgOutlines(source.svgText);
    return { outlines, frame: outlineBounds(outlines) };
  }

  const rings = traceRings(source.pixels, {
    source: settings.trace_source,
    threshold: settings.trace_threshold,
  }).map((ring) => simplifyRing(ring, settings.simplify_tolerance));

  return {
    outlines: ringsToOutlines(rings.filter((ring) => ring.length >= 3)),
    frame: { minX: 0, minY: 0, maxX: source.pixels.width, maxY: source.pixels.height },
  };
}

function buildCard(
  settings: CardModelSettings,
  front: SourceImage,
  back: SourceImage | null
): BuiltParts {
  const geometry = buildCardGeometry(settings);
  const materials = cardMaterials(
    settings,
    sourceTexture(front),
    back ? sourceTexture(back) : null
  );
  const slots = [materials.front, materials.back, materials.rim];
  return { meshes: [new Mesh(geometry, slots)], materials: slots };
}

function buildWood(settings: WoodModelSettings, source: SourceImage): BuiltParts {
  const cut = woodOutlines(source, settings);
  const placed = normalizeOutlines(cut.outlines, cut.frame, {
    longestSideMm: settings.longest_side_mm,
    flipY: true,
  });
  if (placed.outlines.length === 0) throw new EmptyOutlineError();

  const shapes: Shape[] = outlinesToShapes(placed.outlines);
  const geometry = buildWoodGeometry(shapes, placed.frame, settings);

  // Printed pieces carry the artwork on both faces and bare wood on the cut
  // edge; unprinted ones are wood all the way round.
  const materials = woodMaterials(settings, settings.printed ? sourceTexture(source) : null);
  const slots = [materials.face, materials.face, materials.edge];
  return { meshes: [new Mesh(geometry, slots)], materials: slots };
}

function buildBox(settings: BoxModelSettings, source: SourceImage): BuiltParts {
  const geometry = buildBoxGeometry(settings);
  const materials = boxMaterials(settings, sourceTexture(source));
  // buildBoxGeometry numbers its groups by each face's place in BOX_FACES, so
  // reading the slots off the same list is what keeps the two in step.
  const slots = BOX_FACES.map((face) => materials.faces[face]);
  return { meshes: [new Mesh(geometry, slots)], materials: slots };
}

// A punchboard is several meshes and the scene wants them as separate files, so
// this builds the one it is asked for. `null` is all of them, which is what the
// studio previews.
function buildPunchboard(
  settings: PunchboardModelSettings,
  source: SourceImage,
  cut: SourceImage | null,
  part: string | null
): BuiltParts {
  if (!cut || cut.svgText === null) throw new MissingCutSheetError();

  const layout = punchboardLayout(settings, cut.svgText);
  const materials = punchboardMaterials(settings, sourceTexture(source));
  const slots = [materials.face, materials.back, materials.edge];

  const wanted = part === null ? layout.pieces : layout.pieces.filter((one) => one.name === part);
  const meshes = wanted.map((piece) => {
    const mesh = new Mesh(buildPunchboardPiece(layout, piece, settings), slots);
    mesh.name = piece.name;
    // A piece asked for by name is exported on its own, so it stands at the
    // origin rather than where it sat on the sheet it came out of.
    if (part === null) mesh.position.set(...piece.center);
    return mesh;
  });

  return { meshes, materials: slots };
}

function buildBoard(settings: BoardModelSettings, source: SourceImage): BuiltParts {
  const materials = boardMaterials(settings, sourceTexture(source));
  const slots = [materials.face, materials.back, materials.edge];
  const meshes = buildBoardPanels(settings).map((panel) => {
    const mesh = new Mesh(panel.geometry, slots);
    mesh.name = panel.name;
    mesh.position.set(...panel.center);
    return mesh;
  });

  return { meshes, materials: slots };
}

export interface BuiltModel {
  group: Group;
  geometries: BufferGeometry[];
  materials: Material[];
}

function partsFor(settings: ModelSettings, sources: ModelSources, part: string | null): BuiltParts {
  switch (settings.kind) {
    case 'card':
      return buildCard(settings, sources.artwork, sources.back ?? null);
    case 'wood':
      return buildWood(settings, sources.artwork);
    case 'box':
      return buildBox(settings, sources.artwork);
    case 'board':
      return buildBoard(settings, sources.artwork);
    case 'punchboard':
      return buildPunchboard(settings, sources.artwork, sources.cut ?? null, part);
  }
}

/**
 * `part` names one mesh of a component that has several -- a punchboard's sheet
 * or one of its tokens. Null builds the whole thing, which is what the studio
 * previews and what every other kind is regardless.
 */
export function buildModel(
  settings: ModelSettings,
  sources: ModelSources,
  part: string | null = null
): BuiltModel {
  const built = partsFor(settings, sources, part);

  const group = new Group();
  group.name = GROUP_NAMES[settings.kind];
  for (const mesh of built.meshes) group.add(mesh);

  return {
    group,
    geometries: built.meshes.map((mesh) => mesh.geometry),
    materials: built.materials,
  };
}

// A rebuild happens on every slider move, and neither geometry nor a texture is
// released by dropping the reference to it -- both hold GPU memory until they
// are told to let go.
export function disposeModel(model: BuiltModel): void {
  for (const geometry of model.geometries) geometry.dispose();

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
