// The importer's pure-Python half, run without Blender: the shot maths in
// shots.py, the parametric geometry in pieces.py, and the reader in scenedoc.py
// that decides what a scene.json is allowed to say.
//
// Those three import no `bpy` on purpose, which is what lets a shot be iterated
// on with one file and one command. This is the command. Blender itself is
// covered by tools/blender/smoke.sh, which is run by hand because `check:all`
// has to pass on a checkout with nothing else installed.
//
// A plain `python3 -m unittest` would do the running. What it would not do is
// notice that it ran nothing: a discovery pattern that matches no file, or a
// tools/blender that has moved, exits 0 with "Ran 0 tests" and reads as a pass.
// So the count is parsed and an empty run is a failure, and --selftest puts the
// millimetre conversion back on its bug and requires the suite to go red.
import { spawnSync } from 'node:child_process';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const selftest = process.argv.includes('--selftest');

const PYTHON = process.env.PYTHON ?? 'python3';
const SOURCE = 'tools/blender';

function runSuite(tree) {
  const child = spawnSync(PYTHON, ['-m', 'unittest', 'discover', '-s', join(tree, 'tests')], {
    cwd: root,
    encoding: 'utf8',
  });
  if (child.error) {
    return { ok: false, ran: 0, output: `${PYTHON} could not be run: ${child.error.message}` };
  }
  const output = `${child.stdout ?? ''}${child.stderr ?? ''}`;
  const counted = /^Ran (\d+) tests?/m.exec(output);
  return { ok: child.status === 0, ran: counted ? Number(counted[1]) : 0, output };
}

// A copy of the tree with one edit in it, so the suite can be run against a
// deliberate bug without the working tree ever holding one.
function withMutation(edit) {
  const work = mkdtempSync(join(tmpdir(), 'tph-scene-shots-'));
  try {
    const tree = join(work, 'blender');
    cpSync(join(root, SOURCE), tree, {
      recursive: true,
      filter: (path) => !path.includes('__pycache__'),
    });
    const applied = edit(tree);
    if (applied === 0) {
      return { ok: false, ran: 0, applied, output: 'the planted edit matched nothing' };
    }
    return { ...runSuite(tree), applied };
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

const real = runSuite(join(root, SOURCE));

if (real.ran === 0) {
  console.error('check:scene-shots found no tests to run.');
  console.error(real.output.split('\n').slice(-20).join('\n'));
  process.exit(1);
}

if (!real.ok) {
  console.error(real.output);
  process.exit(1);
}

console.log(`check:scene-shots passed (${real.ran} tests, no Blender)`);

if (selftest) {
  // Sensitivity, and the bug it is aimed at is the one this whole boundary
  // exists to get right: the document is millimetres and Blender is metres, so
  // every value crosses scenedoc.MM exactly once on its way out of shots.py.
  // Dropping the multiply leaves a scene a thousand times too big, and a suite
  // that did not notice would be measuring the shape of the curves and nothing
  // about where they put anything.
  //
  // Not MM itself: the tests import that constant too, so moving it moves both
  // sides of every assertion and the suite stays green -- which is exactly the
  // kind of hole this arm is here to prove is not there.
  console.log('\n[selftest] the same suite against shots.py with the conversion dropped:');
  const broken = withMutation((tree) => {
    const path = join(tree, 'shots.py');
    const source = readFileSync(path, 'utf8');
    const count = source.split(' * MM').length - 1;
    writeFileSync(path, source.replaceAll(' * MM', ' * 1.0'));
    return count;
  });

  if (broken.applied === 0) {
    console.error('[selftest] FAILED: shots.py no longer multiplies anything by MM');
    process.exit(1);
  }
  if (broken.ok) {
    console.error(
      `[selftest] FAILED: ${broken.applied} millimetre conversions were removed and ` +
        `${broken.ran} tests still passed`
    );
    process.exit(1);
  }
  console.log(
    `  ok   ${broken.applied} conversions removed and the suite fails (${broken.ran} tests ran)`
  );
}

console.log('Blender itself is not covered here; run `pnpm run blender:smoke` for that half.');
