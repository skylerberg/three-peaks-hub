// The shot templates the export screen offers. A template is the one thing
// that turns "these decks and these pieces" into a timeline, and it lives here
// rather than in packages/shared because mapping a selection onto shots is a
// choice about what this app offers, not a fact both ends must agree on.
//
// Nothing here computes a keyframe. A shot is declarative -- a kind and its
// parameters -- and the importer expands it. What is decided here is which
// parameters: where a deal lands, how wide a fan opens, how far out a camera
// circles. Those follow the selection, because a fan of playing cards and a fan
// of game boards want radii two orders of magnitude apart, and a constant that
// suits one buries the other in a pile.

import {
  DEFAULT_SCENE_CAMERA,
  DEFAULT_SCENE_LIGHTING,
  DEFAULT_SHOT_PARAMS,
  defaultShot,
  instancesForTarget,
  isCameraShot,
  SCENE_LIMITS,
  SCENE_TARGET,
  shotEndSeconds,
  SHOT_LIMITS,
  type CameraSpec,
  type LightingSpec,
  type SceneInstance,
  type Shot,
  type Vec3,
} from '@three-peaks/shared';
import type { SceneGroup } from './assets.ts';
import { frameCamera, type Volume } from './layout.ts';

interface SceneTemplateContext {
  // Every group the plan made, decks first, each carrying its own patch of
  // table.
  groups: readonly SceneGroup[];
  instances: readonly SceneInstance[];
  extent: Volume;
  // The frame's own width over its height. The camera is framed here rather
  // than by the caller, because only a template knows whether its shots are
  // about to move it.
  aspect: number;
}

interface SceneTemplateResult {
  shots: Shot[];
  camera: CameraSpec;
  lighting: LightingSpec;
}

export interface SceneTemplate {
  id: string;
  name: string;
  description: string;
  build(context: SceneTemplateContext): SceneTemplateResult;
}

// A beat between shots, so two of them do not run into each other in a cut
// nobody asked for.
const SHOT_GAP_S = 0.4;

// Room between two pieces that a shot has just laid out side by side.
const LANDING_GAP_MM = 12;

const MAX_SHOTS = SCENE_LIMITS.shots[1];

function clamp(value: number, [min, max]: readonly [number, number]): number {
  return Math.min(max, Math.max(min, value));
}

// `covers` is for a template whose shots reach past where the selection stands.
function camera(
  context: SceneTemplateContext,
  position_mm: Vec3,
  covers: Volume = context.extent
): CameraSpec {
  return frameCamera(
    { ...DEFAULT_SCENE_CAMERA, position_mm, dof: { ...DEFAULT_SCENE_CAMERA.dof } },
    covers,
    context.aspect
  );
}

function lighting(preset: LightingSpec['preset']): LightingSpec {
  return { ...DEFAULT_SCENE_LIGHTING, preset };
}

/**
 * Lays a list of shots end to end.
 *
 * A staggered shot runs past its own `duration_s`, so where the next one starts
 * can only be answered with the count of what this one is aimed at -- which is
 * why the instances come in.
 */
function sequenceShots(shots: readonly Shot[], instances: readonly SceneInstance[]): Shot[] {
  let at = 0;
  return shots.map((shot) => {
    const count = isCameraShot(shot)
      ? 1
      : Math.max(1, instancesForTarget(instances, shot.target).length);
    const placed = { ...shot, start_s: Math.min(at, SHOT_LIMITS[shot.kind].start_s[1]) } as Shot;
    at = shotEndSeconds(placed, count) + SHOT_GAP_S;
    return placed;
  });
}

// Every group, or the whole scene where a selection somehow made none.
function targets(context: SceneTemplateContext): SceneGroup[] {
  return context.groups.slice(0, MAX_SHOTS);
}

const SCENE_GROUP: SceneGroup = {
  name: SCENE_TARGET,
  kind: 'files',
  origin_mm: [0, 0, 0],
  footprint: { width_mm: 0, depth_mm: 0 },
  count: 1,
};

/**
 * What a card gesture is aimed at.
 *
 * Fanning, dealing and dropping are all things done to a deck, and a selection
 * that has one means those decks: fanning a board and a box together collapses
 * both onto one small arc, which is a pile rather than a shot. A selection with
 * no deck at all still gets its gesture, aimed at whatever it does have.
 */
function cardTargets(context: SceneTemplateContext): SceneGroup[] {
  const all = targets(context);
  const decks = all.filter((group) => group.kind === 'deck');
  if (decks.length > 0) return decks;
  return all.length > 0 ? all : [SCENE_GROUP];
}

function everyTarget(context: SceneTemplateContext): SceneGroup[] {
  const all = targets(context);
  return all.length > 0 ? all : [SCENE_GROUP];
}

// One shot per group, which is what the staggered kinds want: each deck fans or
// deals on its own, one after another.
function perGroup(
  context: SceneTemplateContext,
  id: string,
  shape: (group: SceneGroup, shotId: string) => Shot
): Shot[] {
  return cardTargets(context).map((group, index) => shape(group, `${id}-${index + 1}`));
}

// A fan opens about a pivot one radius behind the group, so the radius is what
// decides how far apart two neighbours land. Twice the piece keeps a deck's
// cards overlapping the way a hand does and still pulls two boards apart.
function fanShot(group: SceneGroup, id: string): Shot {
  const shot = defaultShot('fan', group.name, id);
  return {
    ...shot,
    arc_radius_mm: clamp(
      Math.max(shot.arc_radius_mm, group.footprint.width_mm * 2),
      SHOT_LIMITS.fan.arc_radius_mm
    ),
  };
}

// Dealt onto the group's own patch of table, in as square a grid as the count
// allows, at the pieces' own size. The default grid is a dozen card-sized slots
// in the middle of the world, which every group would deal into at once.
function dealShot(group: SceneGroup, id: string): Shot {
  const shot = defaultShot('deal', group.name, id);
  const columns = Math.max(1, Math.ceil(Math.sqrt(group.count)));
  const rows = Math.max(1, Math.ceil(group.count / columns));
  const grid = DEFAULT_SHOT_PARAMS.deal.grid;
  return {
    ...shot,
    grid: {
      columns,
      rows,
      spacing_x_mm: Math.max(grid?.spacing_x_mm ?? 0, group.footprint.width_mm + LANDING_GAP_MM),
      spacing_y_mm: Math.max(grid?.spacing_y_mm ?? 0, group.footprint.depth_mm + LANDING_GAP_MM),
      origin_mm: [group.origin_mm[0], group.origin_mm[1], 0],
    },
  };
}

function stackShot(group: SceneGroup, id: string): Shot {
  return defaultShot('stack', group.name, id);
}

export const SCENE_TEMPLATES: readonly SceneTemplate[] = [
  {
    id: 'turntable',
    name: 'Turntable',
    description: 'Everything selected turns once on the spot. The safe first look at a component.',
    build: (context) => ({
      shots: sequenceShots(
        [defaultShot('turntable', SCENE_TARGET, 'turntable-1')],
        context.instances
      ),
      camera: camera(context, [0, -420, 300]),
      lighting: lighting('studio'),
    }),
  },
  {
    id: 'fan-out',
    name: 'Fan out',
    description: 'Each deck fans from its stack in turn, one card behind the next.',
    build: (context) => ({
      shots: sequenceShots(perGroup(context, 'fan', fanShot), context.instances),
      camera: camera(context, [0, -460, 340]),
      lighting: lighting('studio'),
    }),
  },
  {
    id: 'deal-out',
    name: 'Deal out',
    description: 'Cards arc off the stack onto a grid, as though being dealt to the table.',
    build: (context) => ({
      shots: sequenceShots(perGroup(context, 'deal', dealShot), context.instances),
      camera: camera(context, [0, -520, 420]),
      lighting: lighting('softbox'),
    }),
  },
  {
    id: 'stack-drop',
    name: 'Stack drop',
    description: 'Pieces fall into place one after another and settle into a stack.',
    build: (context) => ({
      shots: sequenceShots(perGroup(context, 'stack', stackShot), context.instances),
      camera: camera(context, [0, -400, 260]),
      lighting: lighting('softbox'),
    }),
  },
  {
    id: 'parade',
    name: 'Parade',
    description: 'Everything files past the camera in order, turning as it goes.',
    build: (context) => {
      const shot = defaultShot('parade', SCENE_TARGET, 'parade-1');
      // A parade puts every instance in one line at `spacing_mm`, which for a
      // dozen pieces is several times wider than the table they were standing
      // on. Framing on where they stand is what leaves the first and last
      // seconds of the pass outside the picture.
      const line = Math.max(1, context.instances.length) * shot.spacing_mm;
      return {
        shots: sequenceShots([shot], context.instances),
        camera: camera(context, [0, -500, 200], {
          ...context.extent,
          width_mm: Math.max(context.extent.width_mm, line),
        }),
        lighting: lighting('flat'),
      };
    },
  },
  {
    id: 'orbit',
    name: 'Orbit',
    description: 'The camera circles the table while everything holds still.',
    build: (context) => {
      const framed = camera(context, [0, -430, 380]);
      const shot = defaultShot('orbit', SCENE_TARGET, 'orbit-1');
      return {
        // The circle is the framed pose swung round, rather than a fixed radius
        // that a big enough selection puts the camera inside of.
        shots: sequenceShots(
          [
            {
              ...shot,
              radius_mm: clamp(
                Math.hypot(framed.position_mm[0], framed.position_mm[1]),
                SHOT_LIMITS.orbit.radius_mm
              ),
              height_mm: clamp(framed.position_mm[2], SHOT_LIMITS.orbit.height_mm),
            },
          ],
          context.instances
        ),
        camera: framed,
        lighting: lighting('studio'),
      };
    },
  },
  {
    id: 'hero-reveal',
    name: 'Hero reveal',
    description: 'The camera pushes in out of the dark, and the first group turns to face it.',
    build: (context) => {
      const framed = camera(context, [0, -320, 150]);
      const reveal = defaultShot('reveal', SCENE_TARGET, 'reveal-1');
      const back = (away: number): Vec3 =>
        framed.position_mm.map((axis) => clamp(axis * away, SCENE_LIMITS.position_mm)) as Vec3;
      return {
        shots: sequenceShots(
          [
            // In to the composed pose from twice as far out, so the push ends
            // where a still of this selection would have been framed rather
            // than somewhere inside it.
            { ...reveal, from_mm: back(2.2), to_mm: back(1) },
            // The first group only. Turning every one of them in sequence is the
            // fan-out template; this one is a camera move with a single beat.
            defaultShot('flip', everyTarget(context)[0].name, 'reveal-flip-1'),
          ],
          context.instances
        ),
        camera: framed,
        lighting: lighting('dramatic'),
      };
    },
  },
];

export const DEFAULT_SCENE_TEMPLATE_ID = 'turntable';

export function sceneTemplate(id: string): SceneTemplate | undefined {
  return SCENE_TEMPLATES.find((template) => template.id === id);
}
