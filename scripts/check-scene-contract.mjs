// The scene document's bounds are written twice: once in
// packages/shared/src/scenes.ts, which is what the exporter is allowed to emit,
// and once in tools/blender/scenedoc.py, which is what the importer will open.
// They cannot share a file -- one is loaded by a browser bundle and the other by
// Blender's Python -- so this reads both and fails on any disagreement.
//
// It is the same hazard check:scripts exists for. A hand-copied list drifts the
// moment one copy is edited, and here the symptom is a bundle the exporter
// believed in and the importer refuses, which surfaces in Blender rather than in
// the app that wrote it.
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const selftest = process.argv.includes('--selftest');

// Every name both ends have to agree on. A bound left out of this list is a
// bound nothing compares, so adding one to scenes.ts means adding it here.
const SHARED = [
  'SCENE_FORMAT',
  'SCENE_VERSION',
  'SCENE_FILE_NAME',
  'SCENE_ASSET_DIR',
  'SCENE_ASSET_KINDS',
  'LIBRARY_PIECES',
  'SHOT_KINDS',
  'CAMERA_SHOT_KINDS',
  'STAGGERED_SHOT_KINDS',
  'FLIP_AXES',
  'SCENE_TARGET',
  'LIGHTING_PRESETS',
  'SCENE_BACKGROUNDS',
  'SURFACE_FINISHES',
  'RENDER_ENGINES',
  'SHOT_LIMITS',
  'DEAL_GRID_LIMITS',
  'SCENE_LIMITS',
  'CAMERA_LIMITS',
  'LIGHTING_LIMITS',
  'SURFACE_LIMITS',
  'RENDER_LIMITS',
  'SCENE_TEXT_LIMITS',
];

// MODEL_KINDS lives in models3d.ts rather than scenes.ts, and a glb asset names
// one, so the importer carries a copy of that list too.
const MODEL_KINDS_NAME = 'MODEL_KINDS';

function pythonSide() {
  const program = [
    'import json, sys',
    'sys.path.insert(0, "tools/blender")',
    'import scenedoc',
    `names = ${JSON.stringify([...SHARED, MODEL_KINDS_NAME])}`,
    'print(json.dumps({name: getattr(scenedoc, name) for name in names}))',
  ].join('\n');
  return JSON.parse(execFileSync('python3', ['-c', program], { cwd: root, encoding: 'utf8' }));
}

async function typescriptSide() {
  const scenes = await import('../packages/shared/src/scenes.ts');
  const models = await import('../packages/shared/src/models3d.ts');
  const out = {};
  for (const name of SHARED) out[name] = scenes[name];
  out[MODEL_KINDS_NAME] = models[MODEL_KINDS_NAME];
  return out;
}

// JSON.stringify on both sides: a tuple and a list, a dict and an object, and a
// readonly array and a mutable one all have to compare equal, and their shapes
// only agree once serialised.
function compare(typescript, python) {
  const problems = [];
  for (const name of [...SHARED, MODEL_KINDS_NAME]) {
    if (typescript[name] === undefined) {
      problems.push(`${name}: packages/shared/src/scenes.ts exports nothing by that name`);
      continue;
    }
    const left = JSON.stringify(typescript[name]);
    const right = JSON.stringify(python[name]);
    if (left !== right) problems.push(`${name}:\n    shared:   ${left}\n    scenedoc: ${right}`);
  }
  return problems;
}

const typescript = await typescriptSide();
const python = pythonSide();
const problems = compare(typescript, python);

if (selftest) {
  // A check that compares nothing passes exactly like one that agrees. Move a
  // bound by hand and it has to be reported.
  const drifted = { ...python, SCENE_LIMITS: { ...python.SCENE_LIMITS, shots: [0, 33] } };
  if (!compare(typescript, drifted).some((problem) => problem.startsWith('SCENE_LIMITS:'))) {
    console.error('[selftest] FAILED: a moved bound was not reported');
    process.exit(1);
  }
  console.log('[selftest] a bound moved on one side only is reported, as expected');
}

if (problems.length > 0) {
  console.error(`\n${problems.length} scene contract disagreement(s):\n`);
  for (const problem of problems) console.error(`  ${problem}`);
  console.error(
    '\nThe exporter and the importer read separate copies of these. Change both, or' +
      '\nthe browser writes a bundle Blender refuses.'
  );
  process.exit(1);
}

console.log(`check:scene-contract passed (${SHARED.length + 1} names agree)`);
