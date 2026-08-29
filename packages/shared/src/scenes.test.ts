import { describe, expect, it } from 'vitest';
import { MAX_DECK_CARDS } from './decks.ts';
import {
  DEFAULT_LIBRARY_SIZE_MM,
  DEFAULT_SCENE_CAMERA,
  DEFAULT_SCENE_LIGHTING,
  DEFAULT_SHOT_PARAMS,
  DEFAULT_SURFACE_CHOICE,
  DEFAULT_SURFACE_COLORS,
  LIBRARY_PIECES,
  LIBRARY_PIECE_LABELS,
  SCENE_FORMAT,
  SCENE_LIMITS,
  SCENE_TARGET,
  SHOT_KINDS,
  SHOT_LIMITS,
  SURFACE_FINISHES,
  buildScene,
  defaultShot,
  frameForSeconds,
  instancesForTarget,
  isCameraShot,
  isSceneAssetPath,
  isStaggeredShot,
  sceneAssetPath,
  sceneFrameRange,
  shotEndSeconds,
  validateScene,
  type SceneAsset,
  type SceneDocument,
  type SceneInstance,
  type Shot,
  type SurfaceFinish,
  type SurfaceSpec,
} from './scenes.ts';

function cardAsset(id: string): SceneAsset {
  return { kind: 'glb', id, path: sceneAssetPath(`${id}.glb`), component: 'card', label: id };
}

function cardInstance(id: string, assetId: string, group: string | null): SceneInstance {
  return {
    id,
    asset_id: assetId,
    label: id,
    group,
    position_mm: [0, 0, 0],
    rotation_deg: [0, 0, 0],
  };
}

function table(): SurfaceSpec {
  return {
    finish: 'wood',
    color: '#6b4a2f',
    width_mm: 900,
    depth_mm: 600,
    thickness_mm: 18,
    sweep_height_mm: 300,
  };
}

function sampleScene(shots: Shot[] = []): SceneDocument {
  return buildScene({
    project_name: 'Villagers',
    generated_at: '2026-08-27T10:00:00.000Z',
    assets: [cardAsset('card-a'), cardAsset('card-b')],
    instances: [
      cardInstance('i1', 'card-a', 'deck:villagers'),
      cardInstance('i2', 'card-b', 'deck:villagers'),
    ],
    shots,
  });
}

function paths(scene: SceneDocument): string[] {
  return validateScene(scene).map((issue) => issue.path);
}

describe('the bounds and the defaults agree', () => {
  it('bounds every shot kind', () => {
    expect(Object.keys(SHOT_LIMITS).sort()).toEqual([...SHOT_KINDS].sort());
  });

  it.each(SHOT_KINDS)('%s defaults sit inside their own bounds', (kind) => {
    const params = DEFAULT_SHOT_PARAMS[kind] as Record<string, unknown>;
    const limits = SHOT_LIMITS[kind] as Record<string, readonly [number, number]>;
    for (const [field, [min, max]] of Object.entries(limits)) {
      const value = params[field];
      expect(typeof value, `${kind}.${field}`).toBe('number');
      expect(value as number).toBeGreaterThanOrEqual(min);
      expect(value as number).toBeLessThanOrEqual(max);
    }
  });

  // The other direction: a parameter added without a bound would validate
  // against nothing, which is how a value the importer refuses gets exported.
  it.each(SHOT_KINDS)('%s bounds every numeric parameter it carries', (kind) => {
    const params = DEFAULT_SHOT_PARAMS[kind] as Record<string, unknown>;
    const limits = SHOT_LIMITS[kind] as Record<string, readonly [number, number]>;
    const unbounded = Object.entries(params)
      .filter(([field, value]) => typeof value === 'number' && !(field in limits))
      .map(([field]) => field);
    expect(unbounded).toEqual([]);
  });

  it('admits a deck at its own maximum, several times over', () => {
    expect(SCENE_LIMITS.instances[1]).toBeGreaterThanOrEqual(MAX_DECK_CARDS);
    expect(SCENE_LIMITS.assets[1]).toBeGreaterThanOrEqual(MAX_DECK_CARDS);
  });

  it.each(LIBRARY_PIECES)('%s has a label and a default size that fits', (piece) => {
    expect(LIBRARY_PIECE_LABELS[piece].length).toBeGreaterThan(0);
    const size = DEFAULT_LIBRARY_SIZE_MM[piece];
    expect(size).toBeGreaterThanOrEqual(SCENE_LIMITS.library_size_mm[0]);
    expect(size).toBeLessThanOrEqual(SCENE_LIMITS.library_size_mm[1]);
  });
});

describe('defaultShot', () => {
  it('carries the id, the kind, the target and the defaults for that kind', () => {
    expect(defaultShot('turntable', 'deck:villagers', 's1')).toEqual({
      id: 's1',
      kind: 'turntable',
      target: 'deck:villagers',
      ...DEFAULT_SHOT_PARAMS.turntable,
    });
  });

  it('copies deeply, so editing one shot does not move the default', () => {
    const reveal = defaultShot('reveal', SCENE_TARGET, 's1');
    reveal.from_mm[2] = 999;
    expect(DEFAULT_SHOT_PARAMS.reveal.from_mm[2]).not.toBe(999);

    const deal = defaultShot('deal', 'deck:villagers', 's2');
    if (deal.grid) deal.grid.columns = 99;
    expect(DEFAULT_SHOT_PARAMS.deal.grid?.columns).not.toBe(99);
  });

  it('knows which kinds move the camera and which stagger', () => {
    expect(isCameraShot(defaultShot('orbit', SCENE_TARGET, 's1'))).toBe(true);
    expect(isCameraShot(defaultShot('fan', 'deck:villagers', 's2'))).toBe(false);
    expect(isStaggeredShot(defaultShot('fan', 'deck:villagers', 's3'))).toBe(true);
    expect(isStaggeredShot(defaultShot('turntable', 'deck:villagers', 's4'))).toBe(false);
  });
});

describe('targets and timing', () => {
  const instances = [
    cardInstance('i1', 'card-a', 'deck:villagers'),
    cardInstance('i2', 'card-b', 'deck:villagers'),
    cardInstance('i3', 'card-b', null),
  ];

  it('resolves a group, one instance, and the whole scene', () => {
    expect(instancesForTarget(instances, 'deck:villagers').map((i) => i.id)).toEqual(['i1', 'i2']);
    expect(instancesForTarget(instances, 'i3').map((i) => i.id)).toEqual(['i3']);
    expect(instancesForTarget(instances, SCENE_TARGET)).toHaveLength(3);
    expect(instancesForTarget(instances, 'deck:nothing')).toEqual([]);
  });

  it('runs a staggered shot past its duration, by the count it was given', () => {
    const fan = { ...defaultShot('fan', 'deck:villagers', 's1'), start_s: 1, duration_s: 2 };
    const staggered = { ...fan, stagger_s: 0.5 };
    expect(shotEndSeconds(staggered, 5)).toBe(5);
    expect(shotEndSeconds(staggered, 1)).toBe(3);
  });

  it('leaves an unstaggered shot alone whatever the count', () => {
    const base = defaultShot('turntable', SCENE_TARGET, 's1');
    const turntable = { ...base, start_s: 1, duration_s: 4 };
    expect(shotEndSeconds(turntable, 40)).toBe(5);
  });

  it('counts frame 1 as t = 0', () => {
    expect(frameForSeconds(0, 30)).toBe(1);
    expect(frameForSeconds(2, 30)).toBe(61);
  });

  it('ends the range on the last frame any shot reaches', () => {
    const fan: Shot = {
      ...defaultShot('fan', 'deck:villagers', 's1'),
      start_s: 1,
      duration_s: 2,
      stagger_s: 0.5,
    };
    expect(sceneFrameRange([fan], instances, 30)).toEqual([1, 106]);
  });

  it('is one frame long with no shots at all', () => {
    expect(sceneFrameRange([], instances, 30)).toEqual([1, 1]);
  });
});

describe('buildScene', () => {
  it('stamps the format and derives the frame range from the shots', () => {
    const scene = sampleScene([
      { ...defaultShot('fan', 'deck:villagers', 's1'), start_s: 1, duration_s: 2, stagger_s: 0.5 },
    ]);
    expect(scene.format).toBe(SCENE_FORMAT);
    expect(scene.units).toBe('mm');
    expect(scene.render.frame_range).toEqual([1, 106]);
  });

  it('copies the shared camera and lighting defaults', () => {
    const scene = sampleScene();
    scene.camera.position_mm[0] = 999;
    scene.lighting.strength = 9;
    expect(DEFAULT_SCENE_CAMERA.position_mm[0]).not.toBe(999);
    expect(DEFAULT_SCENE_LIGHTING.strength).not.toBe(9);
  });

  it('is plain JSON, since the whole document is written to a file', () => {
    const scene = sampleScene([defaultShot('deal', 'deck:villagers', 's1')]);
    expect(JSON.parse(JSON.stringify(scene))).toEqual(scene);
  });
});

describe('validateScene', () => {
  it('passes a scene the exporter built', () => {
    expect(validateScene(sampleScene([defaultShot('turntable', 'deck:villagers', 's1')]))).toEqual(
      []
    );
  });

  it('reports a shot parameter outside its bound', () => {
    const shot = { ...defaultShot('turntable', 'deck:villagers', 's1'), revolutions: 99 };
    expect(paths(sampleScene([shot]))).toContain('shots[0].revolutions');
  });

  it('reports a target that names nothing', () => {
    expect(paths(sampleScene([defaultShot('fan', 'deck:absent', 's1')]))).toContain(
      'shots[0].target'
    );
  });

  it('reports a deal that names neither positions nor a grid', () => {
    const shot = { ...defaultShot('deal', 'deck:villagers', 's1'), grid: null };
    expect(paths(sampleScene([shot]))).toContain('shots[0]');
  });

  it('reports a deal that names both', () => {
    const shot = { ...defaultShot('deal', 'deck:villagers', 's1'), to_positions_mm: [] };
    expect(paths(sampleScene([shot]))).toContain('shots[0]');
  });

  it('reports an instance naming no asset', () => {
    const scene = sampleScene();
    scene.instances[0].asset_id = 'gone';
    expect(paths(scene)).toContain('instances[0].asset_id');
  });

  it('reports a duplicate id', () => {
    const scene = sampleScene();
    scene.assets[1].id = scene.assets[0].id;
    expect(paths(scene)).toContain('assets[1].id');
  });

  it('reports a frame range that ends before the shots do', () => {
    const scene = sampleScene([defaultShot('turntable', 'deck:villagers', 's1')]);
    scene.render.frame_range = [1, 2];
    expect(paths(scene)).toContain('render.frame_range');
  });

  it('reports a library piece sized past the bound', () => {
    const scene = sampleScene();
    scene.assets.push({
      kind: 'library',
      id: 'die',
      piece: 'd6',
      color: '#ffffff',
      size_mm: 9000,
      label: 'D6',
    });
    expect(paths(scene)).toContain('assets[2].size_mm');
  });

  it('reports a colour that is not #rrggbb', () => {
    const scene = sampleScene();
    scene.lighting.background_color = 'red';
    expect(paths(scene)).toContain('lighting.background_color');
  });

  it('reports a table cut past what the importer will build', () => {
    const scene = sampleScene();
    scene.surface = { ...table(), width_mm: 90000 };
    expect(paths(scene)).toContain('surface.width_mm');
  });

  it('reports a finish nothing knows how to make', () => {
    const scene = sampleScene();
    scene.surface = { ...table(), finish: 'marble' as SurfaceFinish };
    expect(paths(scene)).toContain('surface.finish');
  });

  it('says nothing about a table that is not there', () => {
    const scene = sampleScene();
    scene.surface = null;
    expect(paths(scene)).toEqual([]);
  });
});

describe('the table', () => {
  it('is absent unless the export asked for one', () => {
    expect(sampleScene().surface).toBeNull();
  });

  it('is carried through as the export sized it', () => {
    const scene = buildScene({
      project_name: 'Villagers',
      generated_at: '2026-08-27T10:00:00.000Z',
      assets: [cardAsset('card-a')],
      instances: [cardInstance('i1', 'card-a', null)],
      shots: [],
      surface: table(),
    });
    expect(scene.surface).toEqual(table());
    expect(validateScene(scene)).toEqual([]);
  });

  it('is neither an asset nor an instance, so no shot can be aimed at it', () => {
    const scene = buildScene({
      project_name: 'Villagers',
      generated_at: '2026-08-27T10:00:00.000Z',
      assets: [cardAsset('card-a')],
      instances: [cardInstance('i1', 'card-a', null)],
      shots: [],
      surface: table(),
    });
    expect(scene.assets).toHaveLength(1);
    expect(scene.instances).toHaveLength(1);
    expect(instancesForTarget(scene.instances, SCENE_TARGET)).toHaveLength(1);
  });

  it('starts from a finish that has a colour of its own', () => {
    expect(SURFACE_FINISHES).toContain(DEFAULT_SURFACE_CHOICE.finish);
    expect(DEFAULT_SURFACE_CHOICE.color).toBe(
      DEFAULT_SURFACE_COLORS[DEFAULT_SURFACE_CHOICE.finish]
    );
    expect(DEFAULT_SURFACE_CHOICE.width_mm).toBeNull();
  });
});

describe('bundle paths', () => {
  it('puts an asset under the asset directory', () => {
    expect(sceneAssetPath('card-a1b2.glb')).toBe('assets/card-a1b2.glb');
  });

  it('refuses anything that could climb out of the bundle', () => {
    expect(isSceneAssetPath('assets/card.glb')).toBe(true);
    expect(isSceneAssetPath('card.glb')).toBe(false);
    expect(isSceneAssetPath('assets/../../etc/passwd')).toBe(false);
    expect(isSceneAssetPath('assets//card.glb')).toBe(false);
    expect(isSceneAssetPath('assets\\card.glb')).toBe(false);
  });

  it('refuses a glb asset whose path leaves the directory', () => {
    const scene = sampleScene();
    const asset = scene.assets[0];
    if (asset.kind === 'glb') asset.path = '../card.glb';
    expect(paths(scene)).toContain('assets[0].path');
  });
});
