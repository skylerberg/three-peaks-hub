// The scene bundle: what the browser hands Blender.
//
// A scene is never stored anywhere. It is a pure function of the files someone
// picked, the settings each of them already has, and a shot template, written
// out as a ZIP of `assets/*.glb` plus one `scene.json`. This module owns that
// document's shape and its bounds; the maths that turns a Shot into keyframes
// lives in the importer, in pure Python, where it can be iterated on without a
// browser in the loop.
//
// Lengths are millimetres, angles degrees, times seconds. The metre glTF wants
// and the frame Blender counts in are both conversions the importer makes.
//
// Axes are Blender's: +X right, +Y away from the default camera, +Z up. Each
// .glb arrives Y-up and its importer rotates it, so nothing in this document is
// written in glTF's frame.

import { MODEL_KINDS } from './models3d.ts';
import type { ModelKind } from './models3d.ts';
import { MAX_DECK_CARDS } from './decks.ts';

export const SCENE_FORMAT = 'three-peaks-scene';
export const SCENE_VERSION = 1;

export const SCENE_FILE_NAME = 'scene.json';
export const SCENE_ASSET_DIR = 'assets';

export type Vec3 = [number, number, number];

// --- assets -----------------------------------------------------------------

export const SCENE_ASSET_KINDS = ['glb', 'library'] as const;
export type SceneAssetKind = (typeof SCENE_ASSET_KINDS)[number];

export const LIBRARY_PIECES = ['d6', 'meeple', 'cube', 'disc', 'cylinder'] as const;
export type LibraryPiece = (typeof LIBRARY_PIECES)[number];

export const LIBRARY_PIECE_LABELS: Record<LibraryPiece, string> = {
  d6: 'D6 die',
  meeple: 'Meeple',
  cube: 'Cube',
  disc: 'Disc',
  cylinder: 'Cylinder',
};

// The longest dimension each piece is usually cut at, so a scene reads right
// before anyone touches a number.
export const DEFAULT_LIBRARY_SIZE_MM: Record<LibraryPiece, number> = {
  d6: 16,
  meeple: 16,
  cube: 10,
  disc: 22,
  cylinder: 20,
};

export const DEFAULT_LIBRARY_COLOR = '#c0392b';

export interface GlbAsset {
  kind: 'glb';
  id: string;
  // Relative to the bundle root, always under SCENE_ASSET_DIR. Deduplicated:
  // two instances of one card name one path.
  path: string;
  component: ModelKind;
  label: string;
}

// Built by the importer out of `piece` and `size_mm`, so it has no path and
// costs the bundle no bytes.
export interface LibraryAsset {
  kind: 'library';
  id: string;
  piece: LibraryPiece;
  color: string;
  size_mm: number;
  label: string;
}

export type SceneAsset = GlbAsset | LibraryAsset;

// --- instances --------------------------------------------------------------

export interface SceneInstance {
  id: string;
  asset_id: string;
  label: string;
  // What a shot aims at. Several instances share one, e.g. 'deck:villagers'.
  group: string | null;
  // Where the asset's own origin goes, and that origin is not the same point on
  // both kinds: a .glb is built about its middle, a library piece about the
  // middle of the face it stands on. Resting either on the table is the
  // exporter's arithmetic, not the importer's.
  position_mm: Vec3;
  rotation_deg: Vec3;
}

// --- shots ------------------------------------------------------------------

export const SHOT_KINDS = [
  'turntable',
  'fan',
  'flip',
  'deal',
  'stack',
  'parade',
  'orbit',
  'reveal',
] as const;
export type ShotKind = (typeof SHOT_KINDS)[number];

// The two that move the camera instead of their target.
export const CAMERA_SHOT_KINDS = ['orbit', 'reveal'] as const;

// The three whose items leave one after another.
export const STAGGERED_SHOT_KINDS = ['fan', 'deal', 'stack'] as const;

export const FLIP_AXES = ['x', 'y'] as const;
export type FlipAxis = (typeof FLIP_AXES)[number];

// Every instance in the scene, as a target.
export const SCENE_TARGET = 'scene';

export interface ShotBase {
  id: string;
  // A group, an instance id, or SCENE_TARGET.
  target: string;
  start_s: number;
  // How long one target takes, hold included. A staggered shot is the one case
  // where the shot outlives it: the last item leaves stagger_s * (count - 1)
  // in, which is why shotEndSeconds has to be told the count.
  duration_s: number;
}

export interface TurntableShot extends ShotBase {
  kind: 'turntable';
  revolutions: number;
  tilt_deg: number;
}

export interface FanShot extends ShotBase {
  kind: 'fan';
  spread_deg: number;
  arc_radius_mm: number;
  stagger_s: number;
}

export interface FlipShot extends ShotBase {
  kind: 'flip';
  // 'x' tumbles the piece end over end; 'y' turns it like a page.
  axis: FlipAxis;
  hold_s: number;
}

export interface DealGrid {
  columns: number;
  rows: number;
  spacing_x_mm: number;
  spacing_y_mm: number;
  origin_mm: Vec3;
}

export interface DealShot extends ShotBase {
  kind: 'deal';
  // Exactly one of the two. Positions name every landing spot; a grid leaves
  // them to the importer, which is what a deck of an unknown size wants.
  to_positions_mm: Vec3[] | null;
  grid: DealGrid | null;
  arc_height_mm: number;
  stagger_s: number;
}

export interface StackShot extends ShotBase {
  kind: 'stack';
  drop_height_mm: number;
  stagger_s: number;
}

export interface ParadeShot extends ShotBase {
  kind: 'parade';
  spacing_mm: number;
  revolutions: number;
}

export interface OrbitShot extends ShotBase {
  kind: 'orbit';
  revolutions: number;
  radius_mm: number;
  height_mm: number;
}

export interface RevealShot extends ShotBase {
  kind: 'reveal';
  from_mm: Vec3;
  to_mm: Vec3;
}

export type Shot =
  TurntableShot | FanShot | FlipShot | DealShot | StackShot | ParadeShot | OrbitShot | RevealShot;

export type ShotOfKind<K extends ShotKind> = Extract<Shot, { kind: K }>;
export type ShotParams<K extends ShotKind> = Omit<ShotOfKind<K>, 'id' | 'kind' | 'target'>;

// --- camera, lighting, render ------------------------------------------------

export interface CameraDof {
  enabled: boolean;
  // A group or an instance id to hold focus on; null focuses target_mm.
  focus_target: string | null;
  f_stop: number;
}

export interface CameraSpec {
  focal_length_mm: number;
  position_mm: Vec3;
  target_mm: Vec3;
  dof: CameraDof;
}

export const LIGHTING_PRESETS = ['studio', 'softbox', 'dramatic', 'flat'] as const;
export type LightingPreset = (typeof LIGHTING_PRESETS)[number];

export const SCENE_BACKGROUNDS = ['transparent', 'solid', 'gradient'] as const;
export type SceneBackground = (typeof SCENE_BACKGROUNDS)[number];

export interface LightingSpec {
  preset: LightingPreset;
  strength: number;
  background: SceneBackground;
  // Read as the fill for 'solid' and as the lower stop for 'gradient'; a
  // transparent film ignores it.
  background_color: string;
}

// 'EEVEE' is what a person calls it. Blender spells its own enum differently
// from version to version, and mapping onto that spelling is the importer's
// job, so nothing here has to be reissued when it moves again.
export const RENDER_ENGINES = ['CYCLES', 'EEVEE'] as const;
export type RenderEngine = (typeof RENDER_ENGINES)[number];

export interface RenderSpec {
  engine: RenderEngine;
  resolution: [number, number];
  fps: number;
  samples: number;
  // Inclusive, and frame 1 is t = 0. Derived by sceneFrameRange rather than
  // chosen, so a shot cannot be cut off by a range someone typed.
  frame_range: [number, number];
}

// --- the document ------------------------------------------------------------

export interface SceneDocument {
  format: typeof SCENE_FORMAT;
  version: typeof SCENE_VERSION;
  // ISO 8601, and passed in. Nothing here reads a clock, so two exports of one
  // selection differ in exactly this field.
  generated_at: string;
  project_name: string;
  units: 'mm';
  assets: SceneAsset[];
  instances: SceneInstance[];
  shots: Shot[];
  camera: CameraSpec;
  lighting: LightingSpec;
  render: RenderSpec;
}

// --- bounds ------------------------------------------------------------------

const START_S = [0, 600] as const;
const DURATION_S = [0.05, 120] as const;
const STAGGER_S = [0, 5] as const;

// Every numeric parameter of every shot kind, keyed by the field it bounds --
// which is what lets validateScene check them all without a branch per kind.
export const SHOT_LIMITS = {
  turntable: {
    start_s: START_S,
    duration_s: DURATION_S,
    revolutions: [0.05, 20],
    tilt_deg: [-89, 89],
  },
  fan: {
    start_s: START_S,
    duration_s: DURATION_S,
    spread_deg: [0, 360],
    arc_radius_mm: [0, 2000],
    stagger_s: STAGGER_S,
  },
  flip: {
    start_s: START_S,
    duration_s: DURATION_S,
    hold_s: [0, 60],
  },
  deal: {
    start_s: START_S,
    duration_s: DURATION_S,
    arc_height_mm: [0, 1000],
    stagger_s: STAGGER_S,
  },
  stack: {
    start_s: START_S,
    duration_s: DURATION_S,
    drop_height_mm: [0, 1000],
    stagger_s: STAGGER_S,
  },
  parade: {
    start_s: START_S,
    duration_s: DURATION_S,
    spacing_mm: [0, 1000],
    revolutions: [0, 20],
  },
  orbit: {
    start_s: START_S,
    duration_s: DURATION_S,
    revolutions: [0.05, 20],
    radius_mm: [10, 5000],
    height_mm: [-2000, 2000],
  },
  reveal: {
    start_s: START_S,
    duration_s: DURATION_S,
  },
} as const satisfies Record<ShotKind, Record<string, readonly [number, number]>>;

export const DEAL_GRID_LIMITS = {
  columns: [1, 64],
  rows: [1, 64],
  spacing_x_mm: [0, 2000],
  spacing_y_mm: [0, 2000],
} as const satisfies Record<string, readonly [number, number]>;

// Counts and world extents. A deck reaches MAX_DECK_CARDS on its own and a
// scene may hold several, so the ceilings are multiples of it rather than a
// round number that would refuse one deck plus a hand.
export const SCENE_LIMITS = {
  assets: [1, MAX_DECK_CARDS * 2],
  instances: [1, MAX_DECK_CARDS * 4],
  shots: [0, 32],
  position_mm: [-10000, 10000],
  rotation_deg: [-3600, 3600],
  library_size_mm: [1, 500],
} as const satisfies Record<string, readonly [number, number]>;

// The f-number reaches well past what a lens is engraved with on purpose. What
// keeps a subject sharp is the aperture and nothing else -- framing fixes the
// distance over the focal length, which is the only other term -- and a 63 mm
// card framed to fill the picture needs somewhere past f/60 to stay readable
// end to end. Past that the number is only Blender's blur radius going to
// nothing.
export const CAMERA_LIMITS = {
  focal_length_mm: [8, 300],
  f_stop: [0.5, 128],
} as const satisfies Record<string, readonly [number, number]>;

export const LIGHTING_LIMITS = {
  strength: [0, 20],
} as const satisfies Record<string, readonly [number, number]>;

export const RENDER_LIMITS = {
  resolution_px: [64, 7680],
  fps: [1, 120],
  samples: [1, 4096],
  frame: [1, 100000],
} as const satisfies Record<string, readonly [number, number]>;

// Lengths rather than values. No API route validates this document, so the
// exporter is the only gate on what lands in scene.json.
export const SCENE_TEXT_LIMITS = {
  id: [1, 120],
  label: [0, 200],
  group: [1, 120],
  project_name: [0, 200],
  path: [1, 300],
  generated_at: [1, 64],
} as const satisfies Record<string, readonly [number, number]>;

// --- defaults ----------------------------------------------------------------

// duration_s is one target's move, not the shot's total: a staggered kind runs
// past it by design, and a template that wants a slower deal raises this rather
// than dividing by a count it does not know yet.
export const DEFAULT_SHOT_PARAMS: { [K in ShotKind]: ShotParams<K> } = {
  turntable: { start_s: 0, duration_s: 6, revolutions: 1, tilt_deg: 15 },
  fan: { start_s: 0, duration_s: 1.2, spread_deg: 40, arc_radius_mm: 120, stagger_s: 0.06 },
  flip: { start_s: 0, duration_s: 1.2, axis: 'y', hold_s: 0.3 },
  deal: {
    start_s: 0,
    duration_s: 0.6,
    to_positions_mm: null,
    grid: { columns: 4, rows: 3, spacing_x_mm: 70, spacing_y_mm: 95, origin_mm: [0, 0, 0] },
    arc_height_mm: 60,
    stagger_s: 0.12,
  },
  stack: { start_s: 0, duration_s: 0.5, drop_height_mm: 80, stagger_s: 0.08 },
  parade: { start_s: 0, duration_s: 8, spacing_mm: 90, revolutions: 0.5 },
  orbit: { start_s: 0, duration_s: 8, revolutions: 1, radius_mm: 400, height_mm: 220 },
  reveal: { start_s: 0, duration_s: 5, from_mm: [0, -700, 320], to_mm: [0, -260, 140] },
};

export const DEFAULT_SCENE_CAMERA: CameraSpec = {
  focal_length_mm: 50,
  position_mm: [0, -420, 300],
  target_mm: [0, 0, 0],
  dof: { enabled: true, focus_target: null, f_stop: 2.8 },
};

export const DEFAULT_SCENE_LIGHTING: LightingSpec = {
  preset: 'studio',
  strength: 1,
  // Transparent by default because a trailer shot is composited over something
  // else far more often than it is rendered onto a colour.
  background: 'transparent',
  background_color: '#101418',
};

export const DEFAULT_SCENE_RENDER: Omit<RenderSpec, 'frame_range'> = {
  engine: 'CYCLES',
  resolution: [1920, 1080],
  fps: 30,
  samples: 128,
};

// --- reading a scene ---------------------------------------------------------

export function sceneAssetPath(fileName: string): string {
  return `${SCENE_ASSET_DIR}/${fileName}`;
}

// A path is written into a ZIP and then joined onto a directory Blender
// unpacked, so anything that could climb out of the bundle is refused at the
// one end that knows it is a bundle path at all.
export function isSceneAssetPath(path: string): boolean {
  return (
    path.startsWith(`${SCENE_ASSET_DIR}/`) &&
    !path.includes('..') &&
    !path.includes('\\') &&
    !path.includes('//')
  );
}

export function isCameraShot(shot: Shot): shot is OrbitShot | RevealShot {
  return (CAMERA_SHOT_KINDS as readonly string[]).includes(shot.kind);
}

export function isStaggeredShot(shot: Shot): shot is FanShot | DealShot | StackShot {
  return (STAGGERED_SHOT_KINDS as readonly string[]).includes(shot.kind);
}

function clonePlain<T>(value: T): T {
  if (Array.isArray(value)) return value.map(clonePlain) as unknown as T;
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>);
    return Object.fromEntries(entries.map(([key, item]) => [key, clonePlain(item)])) as T;
  }
  return value;
}

// The defaults are shared, so a Vec3 or a grid handed out by reference would be
// edited into every later shot of the same kind.
export function defaultShot<K extends ShotKind>(
  kind: K,
  target: string,
  id: string
): ShotOfKind<K> {
  const shot = { id, kind, target, ...clonePlain(DEFAULT_SHOT_PARAMS[kind]) };
  return shot as unknown as ShotOfKind<K>;
}

// SCENE_TARGET is every instance; otherwise a target names a group or one
// instance. The importer resolves it the same way, and a target matching
// nothing is what validateScene refuses.
export function instancesForTarget(
  instances: readonly SceneInstance[],
  target: string
): SceneInstance[] {
  if (target === SCENE_TARGET) return [...instances];
  return instances.filter((instance) => instance.group === target || instance.id === target);
}

export function shotEndSeconds(shot: Shot, targetCount: number): number {
  const trailing = isStaggeredShot(shot) ? shot.stagger_s * Math.max(0, targetCount - 1) : 0;
  return shot.start_s + trailing + shot.duration_s;
}

export function frameForSeconds(seconds: number, fps: number): number {
  return 1 + Math.round(seconds * fps);
}

export function sceneFrameRange(
  shots: readonly Shot[],
  instances: readonly SceneInstance[],
  fps: number
): [number, number] {
  let end = 0;
  for (const shot of shots) {
    const count = isCameraShot(shot) ? 1 : instancesForTarget(instances, shot.target).length;
    end = Math.max(end, shotEndSeconds(shot, Math.max(1, count)));
  }
  return [1, Math.max(1, frameForSeconds(end, fps))];
}

export interface SceneDraft {
  project_name: string;
  generated_at: string;
  assets: SceneAsset[];
  instances: SceneInstance[];
  shots: Shot[];
  camera?: CameraSpec;
  lighting?: LightingSpec;
  render?: Omit<RenderSpec, 'frame_range'>;
}

// The one place a document is assembled, so frame_range is derived rather than
// supplied and no caller can hand Blender a range its own shots run past.
export function buildScene(draft: SceneDraft): SceneDocument {
  const render = draft.render ?? DEFAULT_SCENE_RENDER;
  return {
    format: SCENE_FORMAT,
    version: SCENE_VERSION,
    generated_at: draft.generated_at,
    project_name: draft.project_name,
    units: 'mm',
    assets: draft.assets,
    instances: draft.instances,
    shots: draft.shots,
    camera: draft.camera ?? clonePlain(DEFAULT_SCENE_CAMERA),
    lighting: draft.lighting ?? clonePlain(DEFAULT_SCENE_LIGHTING),
    render: {
      ...render,
      frame_range: sceneFrameRange(draft.shots, draft.instances, render.fps),
    },
  };
}

// --- validation --------------------------------------------------------------

export interface SceneIssue {
  // Where it is, in the document's own terms: 'shots[2].spread_deg'.
  path: string;
  message: string;
}

const HEX_COLOR = /^#[0-9a-f]{6}$/;

function checkRange(
  issues: SceneIssue[],
  path: string,
  value: number,
  [min, max]: readonly [number, number]
): void {
  if (!Number.isFinite(value)) {
    issues.push({ path, message: 'is not a finite number' });
    return;
  }
  if (value < min || value > max) {
    issues.push({ path, message: `must be between ${min} and ${max}` });
  }
}

function checkVec3(
  issues: SceneIssue[],
  path: string,
  value: Vec3,
  bound: readonly [number, number]
): void {
  if (!Array.isArray(value) || value.length !== 3) {
    issues.push({ path, message: 'must be three numbers' });
    return;
  }
  value.forEach((axis, index) => checkRange(issues, `${path}[${index}]`, axis, bound));
}

function checkLength(
  issues: SceneIssue[],
  path: string,
  value: string,
  [min, max]: readonly [number, number]
): void {
  if (typeof value !== 'string' || value.length < min || value.length > max) {
    issues.push({ path, message: `must be ${min} to ${max} characters` });
  }
}

function checkCount(
  issues: SceneIssue[],
  path: string,
  count: number,
  [min, max]: readonly [number, number]
): void {
  if (count < min || count > max) {
    issues.push({ path, message: `must hold ${min} to ${max} entries` });
  }
}

function checkOneOf(
  issues: SceneIssue[],
  path: string,
  value: string,
  allowed: readonly string[]
): void {
  if (!allowed.includes(value)) {
    issues.push({ path, message: `must be one of ${allowed.join(', ')}` });
  }
}

function checkColor(issues: SceneIssue[], path: string, value: string): void {
  if (typeof value !== 'string' || !HEX_COLOR.test(value)) {
    issues.push({ path, message: 'must be a #rrggbb colour' });
  }
}

function checkUnique(issues: SceneIssue[], path: string, ids: readonly string[]): void {
  const seen = new Set<string>();
  ids.forEach((id, index) => {
    if (seen.has(id)) {
      issues.push({ path: `${path}[${index}].id`, message: `duplicates "${id}"` });
    }
    seen.add(id);
  });
}

function checkAsset(issues: SceneIssue[], asset: SceneAsset, at: string): void {
  checkLength(issues, `${at}.id`, asset.id, SCENE_TEXT_LIMITS.id);
  checkLength(issues, `${at}.label`, asset.label, SCENE_TEXT_LIMITS.label);
  checkOneOf(issues, `${at}.kind`, asset.kind, SCENE_ASSET_KINDS);
  if (asset.kind === 'glb') {
    checkLength(issues, `${at}.path`, asset.path, SCENE_TEXT_LIMITS.path);
    if (!isSceneAssetPath(asset.path)) {
      issues.push({ path: `${at}.path`, message: `must sit under ${SCENE_ASSET_DIR}/` });
    }
    checkOneOf(issues, `${at}.component`, asset.component, MODEL_KINDS);
  } else if (asset.kind === 'library') {
    checkOneOf(issues, `${at}.piece`, asset.piece, LIBRARY_PIECES);
    checkColor(issues, `${at}.color`, asset.color);
    checkRange(issues, `${at}.size_mm`, asset.size_mm, SCENE_LIMITS.library_size_mm);
  }
}

function checkDeal(issues: SceneIssue[], shot: DealShot, at: string): void {
  if ((shot.to_positions_mm !== null) === (shot.grid !== null)) {
    issues.push({ path: at, message: 'needs exactly one of to_positions_mm and grid' });
  }
  shot.to_positions_mm?.forEach((position, index) => {
    checkVec3(issues, `${at}.to_positions_mm[${index}]`, position, SCENE_LIMITS.position_mm);
  });
  const grid = shot.grid;
  if (grid !== null) {
    checkRange(issues, `${at}.grid.columns`, grid.columns, DEAL_GRID_LIMITS.columns);
    checkRange(issues, `${at}.grid.rows`, grid.rows, DEAL_GRID_LIMITS.rows);
    checkRange(issues, `${at}.grid.spacing_x_mm`, grid.spacing_x_mm, DEAL_GRID_LIMITS.spacing_x_mm);
    checkRange(issues, `${at}.grid.spacing_y_mm`, grid.spacing_y_mm, DEAL_GRID_LIMITS.spacing_y_mm);
    checkVec3(issues, `${at}.grid.origin_mm`, grid.origin_mm, SCENE_LIMITS.position_mm);
  }
}

function targetExists(scene: SceneDocument, target: string): boolean {
  if (target === SCENE_TARGET) return true;
  return scene.instances.some((instance) => instance.id === target || instance.group === target);
}

function checkShot(issues: SceneIssue[], scene: SceneDocument, shot: Shot, at: string): void {
  checkLength(issues, `${at}.id`, shot.id, SCENE_TEXT_LIMITS.id);
  checkOneOf(issues, `${at}.kind`, shot.kind, SHOT_KINDS);
  const params = shot as unknown as Record<string, number>;
  const limits: Record<string, readonly [number, number]> = SHOT_LIMITS[shot.kind] ?? {};
  for (const [field, bound] of Object.entries(limits)) {
    checkRange(issues, `${at}.${field}`, params[field], bound);
  }
  if (!targetExists(scene, shot.target)) {
    issues.push({ path: `${at}.target`, message: `names nothing ("${shot.target}")` });
  }
  if (shot.kind === 'flip') checkOneOf(issues, `${at}.axis`, shot.axis, FLIP_AXES);
  if (shot.kind === 'deal') checkDeal(issues, shot, at);
  if (shot.kind === 'reveal') {
    checkVec3(issues, `${at}.from_mm`, shot.from_mm, SCENE_LIMITS.position_mm);
    checkVec3(issues, `${at}.to_mm`, shot.to_mm, SCENE_LIMITS.position_mm);
  }
}

// Everything the importer would refuse, said in the browser where the export
// can still be fixed. An empty array is a bundle Blender will open.
export function validateScene(scene: SceneDocument): SceneIssue[] {
  const issues: SceneIssue[] = [];
  const { camera, lighting, render } = scene;

  if (scene.format !== SCENE_FORMAT) {
    issues.push({ path: 'format', message: `must be "${SCENE_FORMAT}"` });
  }
  if (scene.version !== SCENE_VERSION) {
    issues.push({ path: 'version', message: `must be ${SCENE_VERSION}` });
  }
  if (scene.units !== 'mm') issues.push({ path: 'units', message: 'must be "mm"' });
  checkLength(issues, 'generated_at', scene.generated_at, SCENE_TEXT_LIMITS.generated_at);
  checkLength(issues, 'project_name', scene.project_name, SCENE_TEXT_LIMITS.project_name);

  checkCount(issues, 'assets', scene.assets.length, SCENE_LIMITS.assets);
  checkCount(issues, 'instances', scene.instances.length, SCENE_LIMITS.instances);
  checkCount(issues, 'shots', scene.shots.length, SCENE_LIMITS.shots);

  checkUnique(
    issues,
    'assets',
    scene.assets.map((asset) => asset.id)
  );
  scene.assets.forEach((asset, index) => checkAsset(issues, asset, `assets[${index}]`));

  const assetIds = new Set(scene.assets.map((asset) => asset.id));
  checkUnique(
    issues,
    'instances',
    scene.instances.map((instance) => instance.id)
  );
  scene.instances.forEach((instance, index) => {
    const at = `instances[${index}]`;
    checkLength(issues, `${at}.id`, instance.id, SCENE_TEXT_LIMITS.id);
    checkLength(issues, `${at}.label`, instance.label, SCENE_TEXT_LIMITS.label);
    if (!assetIds.has(instance.asset_id)) {
      issues.push({ path: `${at}.asset_id`, message: `names no asset ("${instance.asset_id}")` });
    }
    if (instance.group !== null) {
      checkLength(issues, `${at}.group`, instance.group, SCENE_TEXT_LIMITS.group);
    }
    checkVec3(issues, `${at}.position_mm`, instance.position_mm, SCENE_LIMITS.position_mm);
    checkVec3(issues, `${at}.rotation_deg`, instance.rotation_deg, SCENE_LIMITS.rotation_deg);
  });

  checkUnique(
    issues,
    'shots',
    scene.shots.map((shot) => shot.id)
  );
  scene.shots.forEach((shot, index) => checkShot(issues, scene, shot, `shots[${index}]`));

  checkRange(
    issues,
    'camera.focal_length_mm',
    camera.focal_length_mm,
    CAMERA_LIMITS.focal_length_mm
  );
  checkVec3(issues, 'camera.position_mm', camera.position_mm, SCENE_LIMITS.position_mm);
  checkVec3(issues, 'camera.target_mm', camera.target_mm, SCENE_LIMITS.position_mm);
  checkRange(issues, 'camera.dof.f_stop', camera.dof.f_stop, CAMERA_LIMITS.f_stop);
  if (camera.dof.focus_target !== null && !targetExists(scene, camera.dof.focus_target)) {
    issues.push({ path: 'camera.dof.focus_target', message: 'names nothing' });
  }

  checkOneOf(issues, 'lighting.preset', lighting.preset, LIGHTING_PRESETS);
  checkRange(issues, 'lighting.strength', lighting.strength, LIGHTING_LIMITS.strength);
  checkOneOf(issues, 'lighting.background', lighting.background, SCENE_BACKGROUNDS);
  checkColor(issues, 'lighting.background_color', lighting.background_color);

  checkOneOf(issues, 'render.engine', render.engine, RENDER_ENGINES);
  checkRange(issues, 'render.resolution[0]', render.resolution[0], RENDER_LIMITS.resolution_px);
  checkRange(issues, 'render.resolution[1]', render.resolution[1], RENDER_LIMITS.resolution_px);
  checkRange(issues, 'render.fps', render.fps, RENDER_LIMITS.fps);
  checkRange(issues, 'render.samples', render.samples, RENDER_LIMITS.samples);
  checkRange(issues, 'render.frame_range[0]', render.frame_range[0], RENDER_LIMITS.frame);
  checkRange(issues, 'render.frame_range[1]', render.frame_range[1], RENDER_LIMITS.frame);
  const lastFrame = sceneFrameRange(scene.shots, scene.instances, render.fps)[1];
  if (render.frame_range[1] < lastFrame) {
    issues.push({
      path: 'render.frame_range',
      message: `ends at ${render.frame_range[1]}, before the shots do at ${lastFrame}`,
    });
  }

  return issues;
}
