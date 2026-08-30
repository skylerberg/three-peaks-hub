import { describe, expect, it } from 'vitest';
import {
  CAMERA_LIMITS,
  DEFAULT_SCENE_CAMERA,
  DEFAULT_SURFACE_CHOICE,
  SCENE_LIMITS,
  SURFACE_LIMITS,
} from '@three-peaks/shared';
import {
  blockOrigins,
  blocksExtent,
  clampPosition,
  frameCamera,
  gridFootprint,
  gridOffsets,
  stackOffsets,
  surfaceFor,
} from './layout.ts';

describe('stackOffsets', () => {
  it('rests the bottom card on the table and puts the first one on top', () => {
    expect(stackOffsets(3, 2)).toEqual([
      [0, 0, 5],
      [0, 0, 3],
      [0, 0, 1],
    ]);
  });

  it('has nothing to place for an empty deck', () => {
    expect(stackOffsets(0, 2)).toEqual([]);
  });
});

describe('gridOffsets', () => {
  it('centres a square grid and puts the first row nearest the camera', () => {
    expect(gridOffsets(4, { width_mm: 10, depth_mm: 20 })).toEqual([
      [-5, -10, 0],
      [5, -10, 0],
      [-5, 10, 0],
      [5, 10, 0],
    ]);
  });

  it('lifts every piece by whatever it is told to', () => {
    expect(gridOffsets(1, { width_mm: 10, depth_mm: 10 }, 8)).toEqual([[0, 0, 8]]);
  });

  it('measures the grid it would lay out', () => {
    expect(gridFootprint(5, { width_mm: 10, depth_mm: 20 })).toEqual({
      width_mm: 30,
      depth_mm: 40,
    });
  });
});

describe('blockOrigins', () => {
  it('sets two blocks side by side, centred on the origin', () => {
    const blocks = [
      { width_mm: 100, depth_mm: 200, height_mm: 2 },
      { width_mm: 100, depth_mm: 200, height_mm: 2 },
    ];

    expect(blockOrigins(blocks, 20)).toEqual([
      [-60, 0, 0],
      [60, 0, 0],
    ]);
  });

  it('puts the tallest row furthest from the camera', () => {
    const blocks = [
      { width_mm: 400, depth_mm: 100, height_mm: 200 },
      { width_mm: 400, depth_mm: 100, height_mm: 2 },
    ];

    // A standing box in the near row hides whatever small pieces are behind it,
    // and nothing about the arrangement says it has to be there.
    const origins = blockOrigins(blocks, 20);

    expect(origins[0][1]).toBeGreaterThan(origins[1][1]);
  });

  it('wraps toward a square arrangement rather than one long line', () => {
    const footprints = Array.from({ length: 9 }, () => ({
      width_mm: 100,
      depth_mm: 100,
      height_mm: 1,
    }));

    const origins = blockOrigins(footprints, 20);
    const span = (axis: number) => {
      const values = origins.map((origin) => origin[axis]);
      return Math.max(...values) - Math.min(...values);
    };

    // Three rows of three: one line of nine would be 1080 across and 100 deep,
    // which fills a frame's width and none of its height.
    expect(new Set(origins.map((origin) => origin[1])).size).toBe(3);
    expect(span(0)).toBeCloseTo(span(1), 6);
  });

  it('measures what the whole arrangement spans, height included', () => {
    const blocks = [
      { width_mm: 100, depth_mm: 200, height_mm: 4 },
      { width_mm: 100, depth_mm: 200, height_mm: 60 },
    ];

    expect(blocksExtent(blockOrigins(blocks, 20), blocks)).toEqual({
      width_mm: 220,
      depth_mm: 200,
      height_mm: 60,
    });
  });
});

describe('clampPosition', () => {
  it('holds a position inside the world the document allows', () => {
    const [min, max] = SCENE_LIMITS.position_mm;
    expect(clampPosition([max * 2, min * 2, 0])).toEqual([max, min, 0]);
  });
});

describe('frameCamera', () => {
  const WIDE = 1920 / 1080;
  const volume = (width_mm: number, depth_mm: number, height_mm = 0) => ({
    width_mm,
    depth_mm,
    height_mm,
  });

  // Where a corner of the subject lands in the frame, as a fraction of the half
  // frame: 1 is exactly on the edge and anything past it is cropped.
  function reach(camera: ReturnType<typeof frameCamera>, extent: ReturnType<typeof volume>) {
    const offset = camera.position_mm.map((axis, index) => axis - camera.target_mm[index]);
    const length = Math.hypot(...offset);
    const forward = offset.map((axis) => -axis / length);
    const right = [1, 0, 0];
    const up = [
      right[1] * forward[2] - right[2] * forward[1],
      right[2] * forward[0] - right[0] * forward[2],
      right[0] * forward[1] - right[1] * forward[0],
    ];
    const tan = 36 / (2 * camera.focal_length_mm);
    // About the camera's own aim point, which frameCamera puts at the middle of
    // the subject rather than on the table it stands on.
    let worst = 0;
    for (const x of [-extent.width_mm / 2, extent.width_mm / 2]) {
      for (const y of [-extent.depth_mm / 2, extent.depth_mm / 2]) {
        for (const z of [-extent.height_mm / 2, extent.height_mm / 2]) {
          const point = [x, y, z];
          const along =
            point[0] * forward[0] + point[1] * forward[1] + point[2] * forward[2] + length;
          const across = point[0] * right[0] + point[1] * right[1] + point[2] * right[2];
          const above = point[0] * up[0] + point[1] * up[1] + point[2] * up[2];
          worst = Math.max(
            worst,
            Math.abs(across) / (along * tan),
            Math.abs(above) / (along * (tan / WIDE))
          );
        }
      }
    }
    return worst;
  }

  it('pulls back further for a board than for a card, along the same direction', () => {
    const card = frameCamera(DEFAULT_SCENE_CAMERA, volume(63, 88), WIDE);
    const board = frameCamera(DEFAULT_SCENE_CAMERA, volume(500, 500), WIDE);

    const distance = (position: readonly number[]) => Math.hypot(...position);
    expect(distance(board.position_mm)).toBeGreaterThan(distance(card.position_mm));
    expect(board.position_mm[1] / board.position_mm[2]).toBeCloseTo(
      DEFAULT_SCENE_CAMERA.position_mm[1] / DEFAULT_SCENE_CAMERA.position_mm[2],
      6
    );
  });

  it('holds a card that is deeper than it is wide inside a 16:9 frame', () => {
    // The near corner of a card lying on the table is the one that crops: it is
    // closer than the middle and it lands on the axis a wide frame has least of.
    const framed = frameCamera(DEFAULT_SCENE_CAMERA, volume(63, 88), WIDE);

    expect(reach(framed, volume(63, 88))).toBeLessThanOrEqual(1);
  });

  it('holds a box tall enough to reach out of the top of the frame', () => {
    const framed = frameCamera(DEFAULT_SCENE_CAMERA, volume(120, 90, 260), WIDE);
    const flat = frameCamera(DEFAULT_SCENE_CAMERA, volume(120, 90, 0), WIDE);

    expect(reach(framed, volume(120, 90, 260))).toBeLessThanOrEqual(1);
    expect(Math.hypot(...framed.position_mm)).toBeGreaterThan(Math.hypot(...flat.position_mm));
  });

  it('aims at the middle of what is there rather than at the table', () => {
    const framed = frameCamera(DEFAULT_SCENE_CAMERA, volume(120, 90, 260), WIDE);

    expect(framed.target_mm[2]).toBeCloseTo(DEFAULT_SCENE_CAMERA.target_mm[2] + 130, 6);
  });

  it('gives a tall frame the room a wide one gives across', () => {
    const wide = frameCamera(DEFAULT_SCENE_CAMERA, volume(400, 60), WIDE);
    const tall = frameCamera(DEFAULT_SCENE_CAMERA, volume(400, 60), 1080 / 1920);

    expect(Math.hypot(...tall.position_mm)).toBeGreaterThan(Math.hypot(...wide.position_mm));
  });

  it('keeps a lone meeple out of its own near clip', () => {
    const framed = frameCamera(DEFAULT_SCENE_CAMERA, volume(16, 16), WIDE);

    expect(Math.hypot(...framed.position_mm)).toBeCloseTo(150, 6);
  });

  it('stops down far enough to hold a card, and leaves a whole table alone', () => {
    const card = frameCamera(DEFAULT_SCENE_CAMERA, volume(63, 88), WIDE);
    const table = frameCamera(DEFAULT_SCENE_CAMERA, volume(4000, 3000), WIDE);

    // A card framed to fill the picture is millimetres deep in focus at the
    // stop a portrait wants; a table that far away is already sharp throughout,
    // so it keeps whatever softness the template asked for.
    expect(card.dof.f_stop).toBeGreaterThan(DEFAULT_SCENE_CAMERA.dof.f_stop * 4);
    expect(card.dof.f_stop).toBeLessThanOrEqual(CAMERA_LIMITS.f_stop[1]);
    expect(table.dof.f_stop).toBe(DEFAULT_SCENE_CAMERA.dof.f_stop);
  });

  it('leaves the focal length and the rest of the depth of field alone', () => {
    const framed = frameCamera(DEFAULT_SCENE_CAMERA, volume(300, 300), WIDE);

    expect(framed.focal_length_mm).toBe(DEFAULT_SCENE_CAMERA.focal_length_mm);
    expect(framed.dof.enabled).toBe(DEFAULT_SCENE_CAMERA.dof.enabled);
    expect(framed.dof.focus_target).toBe(DEFAULT_SCENE_CAMERA.dof.focus_target);
  });
});

describe('surfaceFor', () => {
  const WIDE = 1920 / 1080;
  const volume = (width_mm: number, depth_mm: number, height_mm = 0) => ({
    width_mm,
    depth_mm,
    height_mm,
  });
  const card = volume(63, 88, 0.3);
  const framed = (extent = card) => frameCamera(DEFAULT_SCENE_CAMERA, extent, WIDE);

  // Where the frame stands at the plane the backdrop is on, worked out from the
  // camera rather than from the sizing: the half-width it has to cover, and how
  // high its top edge has run by then. Both are constant across the frame,
  // because the camera has no roll and its right axis is level.
  function frameAt(camera: ReturnType<typeof frameCamera>, wall_mm: number) {
    const offset = camera.target_mm.map((axis, index) => axis - camera.position_mm[index]);
    const length = Math.hypot(...offset);
    const forward = offset.map((axis) => axis / length);
    const up = [0, -forward[2], forward[1]];
    const tan = 36 / (2 * camera.focal_length_mm);
    const reach = (wall_mm - camera.position_mm[1]) / forward[1];
    return {
      half_width_mm: tan * reach,
      top_mm: camera.position_mm[2] + (forward[2] + (tan / WIDE) * up[2]) * reach,
    };
  }

  it('is bigger than what stands on it, in both directions', () => {
    const surface = surfaceFor(DEFAULT_SURFACE_CHOICE, framed(), WIDE, card);

    expect(surface.width_mm).toBeGreaterThan(card.width_mm);
    expect(surface.depth_mm).toBeGreaterThan(card.depth_mm);
    expect(surface.thickness_mm).toBeGreaterThan(0);
  });

  it('carries the finish and the colour it was handed', () => {
    const surface = surfaceFor(
      { ...DEFAULT_SURFACE_CHOICE, finish: 'felt', color: '#1f4d3a' },
      framed(),
      WIDE,
      card
    );

    expect(surface.finish).toBe('felt');
    expect(surface.color).toBe('#1f4d3a');
  });

  it('fills the frame where the backdrop stands, not merely where the cards do', () => {
    // A long, narrow arrangement, which is the case that separates the two: the
    // camera stands well back to hold its depth, so the frame at the backdrop
    // is several times what the arrangement's own span would have given, and
    // the frame is what has to win.
    const strip = volume(60, 400, 0.3);
    const camera = framed(strip);
    const surface = surfaceFor(DEFAULT_SURFACE_CHOICE, camera, WIDE, strip);
    const frame = frameAt(camera, surface.depth_mm / 2);

    expect(surface.width_mm / 2).toBeGreaterThanOrEqual(frame.half_width_mm);
    expect(surface.sweep_height_mm).toBeGreaterThanOrEqual(frame.top_mm);
  });

  it('widens with the distance the camera stands at, not only with the span', () => {
    // Two arrangements the same width, one of them deep enough that the camera
    // has to stand back for it. The frame at the backdrop is wider there, so
    // the backdrop is too.
    const strip = volume(60, 400, 0.3);
    const stub = volume(60, 60, 0.3);

    expect(surfaceFor(DEFAULT_SURFACE_CHOICE, framed(strip), WIDE, strip).width_mm).toBeGreaterThan(
      surfaceFor(DEFAULT_SURFACE_CHOICE, framed(stub), WIDE, stub).width_mm
    );
  });

  it('lies flat when no backdrop was asked for', () => {
    const surface = surfaceFor({ ...DEFAULT_SURFACE_CHOICE, sweep: false }, framed(), WIDE, card);

    expect(surface.sweep_height_mm).toBe(0);
  });

  it('stands the backdrop close behind the subject, and a plain table further out', () => {
    const swept = surfaceFor(DEFAULT_SURFACE_CHOICE, framed(), WIDE, card);
    const flat = surfaceFor({ ...DEFAULT_SURFACE_CHOICE, sweep: false }, framed(), WIDE, card);

    // A wall across the room is out of frame in every shot that looks down at
    // all, which is every shot here.
    expect(swept.depth_mm).toBeLessThan(flat.depth_mm);
  });

  it('takes the millimetres somebody typed over the ones it worked out', () => {
    const auto = surfaceFor(DEFAULT_SURFACE_CHOICE, framed(), WIDE, card);
    const typed = surfaceFor(
      { ...DEFAULT_SURFACE_CHOICE, width_mm: 1500, depth_mm: 1200 },
      framed(),
      WIDE,
      card
    );

    expect(auto.width_mm).not.toBe(1500);
    expect(typed.width_mm).toBe(1500);
    expect(typed.depth_mm).toBe(1200);
  });

  it('holds a typed size inside what the importer will build', () => {
    const surface = surfaceFor(
      { ...DEFAULT_SURFACE_CHOICE, width_mm: 900000, depth_mm: 1 },
      framed(),
      WIDE,
      card
    );

    expect(surface.width_mm).toBe(SURFACE_LIMITS.width_mm[1]);
    expect(surface.depth_mm).toBe(SURFACE_LIMITS.depth_mm[0]);
  });

  it('grows with the selection rather than with the frame alone', () => {
    const boards = volume(1200, 900, 40);
    const small = surfaceFor(DEFAULT_SURFACE_CHOICE, framed(), WIDE, card);
    const large = surfaceFor(DEFAULT_SURFACE_CHOICE, framed(boards), WIDE, boards);

    expect(large.width_mm).toBeGreaterThan(small.width_mm);
    expect(large.width_mm).toBeGreaterThan(boards.width_mm);
    expect(large.depth_mm).toBeGreaterThan(boards.depth_mm);
  });
});
