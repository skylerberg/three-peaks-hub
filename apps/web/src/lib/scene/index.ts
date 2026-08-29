// The only module the export screen imports, and it reaches it through
// `await import()`. Everything under here leads to ./render.ts and from there
// to three, which no screen that is not exporting a bundle should pay a byte
// for -- the same arrangement ../model3d/ and ../print/ are kept behind.
export {
  buildSceneBundle,
  SceneExportError,
  type SceneBundle,
  type SceneBundleProgress,
  type SceneBundleRequest,
} from './bundle.ts';
export {
  DEFAULT_SCENE_TEMPLATE_ID,
  SCENE_TEMPLATES,
  sceneTemplate,
  type SceneTemplate,
} from './templates.ts';
export { type Footprint } from './layout.ts';
export {
  planScene,
  type SceneComponentSelection,
  type SceneDeckCardSelection,
  type SceneDeckSelection,
  type SceneImageRef,
  type SceneLibrarySelection,
  type ScenePlan,
  type SceneSelection,
} from './assets.ts';
