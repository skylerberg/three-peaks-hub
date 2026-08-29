// The half of the export that needs a GPU-shaped browser: it builds each
// component the studio would build and asks the same exporter for the same
// bytes. Everything that reaches three is behind this one module, so a plan or
// a document can be assembled -- and tested -- without loading any of it.

import {
  buildModel,
  disposeModel,
  exportGlb,
  loadSource,
  type SourceImage,
} from '../model3d/index.ts';
import type { AssetBuild, SceneImageRef } from './assets.ts';

export type SceneAssetRenderer = (build: AssetBuild) => Promise<Uint8Array>;

/**
 * One renderer per export, holding the images it has already read.
 *
 * A deck puts the same back on every card in it and a token may be selected
 * twice over, so an uncached renderer would fetch and decode one image fifty
 * times to build fifty files that each embed it once.
 */
export function componentRenderer(): SceneAssetRenderer {
  const sources = new Map<string, Promise<SourceImage>>();

  const read = (ref: SceneImageRef): Promise<SourceImage> => {
    const held = sources.get(ref.file_id);
    if (held) return held;
    const started = loadSource(ref.file_id, ref.content_type);
    sources.set(ref.file_id, started);
    return started;
  };

  return async (build) => {
    const artwork = await read(build.front);
    const back = build.back ? await read(build.back) : null;
    const cut = build.cut ? await read(build.cut) : null;
    const model = buildModel(build.settings, { artwork, back, cut }, build.part);
    try {
      return new Uint8Array(await exportGlb(model.group));
    } finally {
      // Geometry and textures hold GPU memory until they are told to let go,
      // and an export builds a thousand of them one after another.
      disposeModel(model);
    }
  };
}
