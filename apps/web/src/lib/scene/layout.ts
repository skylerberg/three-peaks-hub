// Where everything stands before a shot moves it, and where the camera stands
// to hold it. Pure arithmetic in millimetres, in the axes scene.json is written
// in, so it is testable without three, a canvas or a fetch.

import {
  CAMERA_LIMITS,
  SCENE_LIMITS,
  type CameraSpec,
  type ModelKind,
  type Vec3,
} from '@three-peaks/shared';

// A card, a wooden token and a board are each built in three's own XY plane and
// extruded along +Z, centred on the origin. The glTF importer maps +Y onto
// Blender's +Z and +Z onto -Y, which lands the piece standing on edge with its
// face toward the camera; a quarter turn back about X lays it on the table, top
// edge away.
const FLAT_ROTATION_DEG: Vec3 = [-90, 0, 0];

const UPRIGHT_DEG: Vec3 = [0, 0, 0];

// A box is the one imported kind that does not take the turn. Its own up axis
// is three's +Y, which is what folds the printer's cross the right way round,
// so it arrives already standing -- and laying it down would leave its lid on
// top with four of its five other panels reading sideways or upside down.
const LAID_FLAT: ReadonlySet<ModelKind> = new Set<ModelKind>(['card', 'wood', 'board']);

// `null` is a library piece, which the importer builds in Blender's own axes.
export function restRotationDeg(component: ModelKind | null): Vec3 {
  if (component === null || !LAID_FLAT.has(component)) return [...UPRIGHT_DEG];
  return [...FLAT_ROTATION_DEG];
}

export interface Footprint {
  width_mm: number;
  depth_mm: number;
}

// What a block covers on the table and how far it stands off it. The height is
// what keeps a box out of the top of the frame, and a footprint alone cannot
// say it.
export interface Volume extends Footprint {
  height_mm: number;
}

// A row is never allowed past this, whatever the arrangement wants: beyond it
// a block's own origin starts running into the world bound.
const MAX_ROW_SPAN_MM = 4000;

const GROUP_GAP_MM = 40;

export function clampPosition(position: Vec3): Vec3 {
  const [min, max] = SCENE_LIMITS.position_mm;
  return position.map((axis) => Math.min(max, Math.max(min, axis))) as Vec3;
}

/**
 * A deck as it sits before anyone touches it: one footprint, each card its own
 * thickness above the last, resting on the table rather than half sunk into it.
 *
 * Index 0 comes out on top, because a deck's first card is the one a fan or a
 * flip is about to show.
 */
export function stackOffsets(count: number, thickness_mm: number): Vec3[] {
  const step = Math.max(thickness_mm, 0);
  return Array.from({ length: Math.max(0, count) }, (_, index) => [
    0,
    0,
    step / 2 + (count - 1 - index) * step,
  ]);
}

/**
 * Loose pieces laid out on the table in as square a grid as the count allows,
 * centred on the block's own origin, first row nearest the camera.
 */
export function gridOffsets(count: number, spacing: Footprint, lift_mm = 0): Vec3[] {
  if (count <= 0) return [];
  const columns = Math.ceil(Math.sqrt(count));
  const rows = Math.ceil(count / columns);
  return Array.from({ length: count }, (_, index) => {
    const column = index % columns;
    const row = Math.floor(index / columns);
    return [
      (column - (columns - 1) / 2) * spacing.width_mm,
      (row - (rows - 1) / 2) * spacing.depth_mm,
      lift_mm,
    ];
  });
}

export function gridFootprint(count: number, spacing: Footprint): Footprint {
  if (count <= 0) return { width_mm: 0, depth_mm: 0 };
  const columns = Math.ceil(Math.sqrt(count));
  const rows = Math.ceil(count / columns);
  return { width_mm: columns * spacing.width_mm, depth_mm: rows * spacing.depth_mm };
}

/**
 * How wide the arrangement wants to be.
 *
 * A square arrangement is what fills a frame. The camera fits whichever span is
 * larger, and the table's depth arrives foreshortened by the angle it is seen
 * from, so seven blocks in one line are framed on a width that leaves the whole
 * height of the picture empty. With `k` blocks a row, the arrangement comes to
 * `k(w + gap)` across and `(n / k)(d + gap)` deep; setting those equal and
 * eliminating k is the square root below.
 */
function targetRowWidth(footprints: readonly Volume[], gap_mm: number): number {
  if (footprints.length === 0) return MAX_ROW_SPAN_MM;
  const mean = (pick: (footprint: Footprint) => number) =>
    footprints.reduce((sum, footprint) => sum + pick(footprint), 0) / footprints.length;
  const square = Math.sqrt(
    footprints.length * (mean((f) => f.width_mm) + gap_mm) * (mean((f) => f.depth_mm) + gap_mm)
  );
  const widest = Math.max(...footprints.map((footprint) => footprint.width_mm));
  // Never narrower than the widest block, which would put it alone in a row it
  // still overflows and wrap everything else needlessly.
  return Math.min(MAX_ROW_SPAN_MM, Math.max(widest, square));
}

/**
 * Blocks side by side across the frame, wrapping to a further row once one row
 * has grown past what the arrangement wants to be wide.
 *
 * The whole arrangement is centred on the origin, which is what the camera and
 * every scene-wide shot turn about.
 */
export function blockOrigins(blocks: readonly Volume[], gap_mm: number = GROUP_GAP_MM): Vec3[] {
  const rows: { members: number[]; width_mm: number; depth_mm: number; height_mm: number }[] = [];
  const target = targetRowWidth(blocks, gap_mm);

  blocks.forEach((block, index) => {
    const row = rows[rows.length - 1];
    const grown = row ? row.width_mm + gap_mm + block.width_mm : 0;
    // Whichever of the two rows lands nearer the target, rather than whichever
    // fits under it: a target between one block and two would otherwise put
    // every block in a row of its own and stand the arrangement on end.
    if (!row || Math.abs(grown - target) > Math.abs(row.width_mm - target)) {
      rows.push({
        members: [index],
        width_mm: block.width_mm,
        depth_mm: block.depth_mm,
        height_mm: block.height_mm,
      });
      return;
    }
    row.members.push(index);
    row.width_mm = grown;
    row.depth_mm = Math.max(row.depth_mm, block.depth_mm);
    row.height_mm = Math.max(row.height_mm, block.height_mm);
  });

  const totalDepth =
    rows.reduce((sum, row) => sum + row.depth_mm, 0) + gap_mm * Math.max(0, rows.length - 1);

  const origins: Vec3[] = blocks.map(() => [0, 0, 0]);
  let y = -totalDepth / 2;
  // Shortest row nearest the camera. Which blocks share a row is settled above
  // and left alone; only where the rows sit changes, so a standing box does not
  // park itself in front of the meeples.
  for (const row of [...rows].sort((a, b) => a.height_mm - b.height_mm)) {
    let x = -row.width_mm / 2;
    for (const index of row.members) {
      const block = blocks[index];
      origins[index] = clampPosition([x + block.width_mm / 2, y + row.depth_mm / 2, 0]);
      x += block.width_mm + gap_mm;
    }
    y += row.depth_mm + gap_mm;
  }

  return origins;
}

export function blocksExtent(origins: readonly Vec3[], blocks: readonly Volume[]): Volume {
  let width = 0;
  let depth = 0;
  let height = 0;
  origins.forEach((origin, index) => {
    const block = blocks[index] ?? { width_mm: 0, depth_mm: 0, height_mm: 0 };
    width = Math.max(width, 2 * (Math.abs(origin[0]) + block.width_mm / 2));
    depth = Math.max(depth, 2 * (Math.abs(origin[1]) + block.depth_mm / 2));
    height = Math.max(height, block.height_mm);
  });
  return { width_mm: width, depth_mm: depth, height_mm: height };
}

// Blender's default sensor, which is what the importer builds a camera on. The
// focal length in the document is meaningless without it.
const SENSOR_WIDTH_MM = 36;

// The circle of confusion a 36 mm sensor is judged on, which is what turns an
// f-number into a depth of field.
const CIRCLE_OF_CONFUSION_MM = 0.029;

// Room around the content, so a turntable does not swing a corner out of frame.
const FRAMING_MARGIN = 1.45;

// A meeple on its own would otherwise put the camera 40 mm away, inside its own
// near clip and past any depth of field worth having.
const MIN_CAMERA_DISTANCE_MM = 150;

const UP: Vec3 = [0, 0, 1];

const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];

function normalized(v: Vec3): Vec3 {
  const length = Math.hypot(...v) || 1;
  return [v[0] / length, v[1] / length, v[2] / length];
}

/**
 * Half the frame, as a tangent, on each axis.
 *
 * Blender fits its sensor to the longer side of the render, so a 16:9 frame
 * sees the whole 36 mm across and a field narrower by the aspect up the middle.
 * Fitting on the horizontal alone is what crops a card lying on a table: the
 * depth it covers lands on the axis with the least room.
 */
function halfFields(focal_length_mm: number, aspect: number): { h: number; v: number } {
  const full = SENSOR_WIDTH_MM / (2 * Math.max(focal_length_mm, 1));
  const wide = aspect >= 1;
  return {
    h: (wide ? full : full * aspect) / FRAMING_MARGIN,
    v: (wide ? full / aspect : full) / FRAMING_MARGIN,
  };
}

// The eight corners of the block the arrangement occupies, about its own
// middle -- which is the point the camera is aimed at, and half the subject's
// height above the table it stands on.
function subjectCorners(extent: Volume): Vec3[] {
  const half: [number, number, number] = [
    extent.width_mm / 2,
    extent.depth_mm / 2,
    extent.height_mm / 2,
  ];
  return [-1, 1].flatMap((x) =>
    [-1, 1].flatMap((y) => [-1, 1].map((z): Vec3 => [x * half[0], y * half[1], z * half[2]]))
  );
}

interface Framing {
  distance_mm: number;
  // How deep the subject runs along the camera's own axis, which is what a
  // depth of field has to cover.
  depth_mm: number;
}

function solveFraming(
  camera: CameraSpec,
  direction: Vec3,
  extent: Volume,
  aspect: number
): Framing {
  const forward: Vec3 = [-direction[0], -direction[1], -direction[2]];
  const sideways = cross(forward, UP);
  const right = normalized(Math.hypot(...sideways) < 1e-6 ? ([1, 0, 0] as Vec3) : sideways);
  const up = cross(right, forward);
  const field = halfFields(camera.focal_length_mm, aspect);

  let distance = MIN_CAMERA_DISTANCE_MM;
  let nearest = Infinity;
  let furthest = -Infinity;
  for (const corner of subjectCorners(extent)) {
    // The corner in the camera's own axes, with the camera still at the target:
    // moving it back by s adds s to the depth and leaves the other two alone,
    // so each corner sets a floor on s directly.
    const across = dot(corner, right);
    const above = dot(corner, up);
    const along = dot(corner, forward);
    distance = Math.max(
      distance,
      Math.abs(across) / field.h - along,
      Math.abs(above) / field.v - along
    );
    nearest = Math.min(nearest, along);
    furthest = Math.max(furthest, along);
  }
  return { distance_mm: distance, depth_mm: Math.max(0, furthest - nearest) };
}

/**
 * An aperture that holds the whole subject, rather than the one a portrait
 * wants.
 *
 * Depth of field goes as the f-number and as the square of the distance over
 * the focal length -- and framing fixes that ratio, so the f-number is the only
 * thing left to move. At the distance a 63 mm card is framed from, f/2.8 leaves
 * two millimetres of it sharp and the rest unreadable, which is the one thing a
 * component render must not be. A table big enough for the default to cover
 * keeps the default, and its background stays as soft as the template asked.
 */
function apertureFor(camera: CameraSpec, framing: Framing): number {
  const ratio = framing.distance_mm / Math.max(camera.focal_length_mm, 1);
  const perStop = 2 * CIRCLE_OF_CONFUSION_MM * ratio * ratio;
  const needed = perStop > 0 ? framing.depth_mm / perStop : camera.dof.f_stop;
  const [min, max] = CAMERA_LIMITS.f_stop;
  return Math.min(max, Math.max(min, camera.dof.f_stop, needed));
}

/**
 * Pulls the camera back along the direction the template already chose until
 * the content fits the frame, and stops the aperture down far enough to hold
 * it. The angle is the template's; only the distance and the f-number are ours,
 * because those are the parts that depend on what was selected.
 */
export function frameCamera(camera: CameraSpec, extent: Volume, aspect: number): CameraSpec {
  // Aimed at the middle of what is there rather than at the table it stands on.
  // The corners are symmetric about that point and their projection is linear
  // in them, so it is also what puts the subject in the middle of the picture:
  // aiming at the table leaves a box sitting in the top of the frame with its
  // own height of nothing underneath.
  const target_mm = clampPosition([
    camera.target_mm[0],
    camera.target_mm[1],
    camera.target_mm[2] + extent.height_mm / 2,
  ]);
  const direction = normalized(
    camera.position_mm.map((axis, index) => axis - camera.target_mm[index]) as Vec3
  );
  const framing = solveFraming(camera, direction, extent, aspect);

  return {
    ...camera,
    target_mm,
    position_mm: clampPosition(
      target_mm.map((axis, index) => axis + direction[index] * framing.distance_mm) as Vec3
    ),
    dof: { ...camera.dof, f_stop: apertureFor(camera, framing) },
  };
}
