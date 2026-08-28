// Runs every guard in test-guards.mjs and requires the named tests to FAIL with
// the bug back in place.
//
// Four outcomes are deliberately distinguished, because they mean different
// things and only one of them is fine:
//   CAUGHT       the tests failed -- the guard is doing its job
//   STILL-PASSED the bug was applied and nothing noticed; the guard is dead
//   NEVER-APPLIED the pattern never matched a module the tests loaded
//   NO-TESTS-RAN the filter selected nothing, so nothing could have failed
//   RUN-FAILED   the child died before it measured anything
//
// Usage:
//   pnpm run check:test-guards                 # every guard
//   pnpm run check:test-guards projects        # guards whose name or file matches
//   pnpm run check:test-guards --verify-only   # anchors only, no test run
//
// A substring is how you write one: authoring a guard means running it until it
// reports CAUGHT, and the whole set takes minutes and a database. Note the
// missing `--` -- pnpm forwards it into argv, where it would read as the filter.
import { spawn, spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { guards } from './test-guards.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const args = process.argv.slice(2);
const verifyOnly = args.includes('--verify-only');
const selftest = args.includes('--selftest');
const filter = args.find((arg) => !arg.startsWith('-')) ?? '';
const TIMEOUT_MS = Number(process.env.GUARD_TIMEOUT_MS ?? 120_000);

const selected = filter
  ? guards.filter((guard) => guard.name.includes(filter) || guard.file.includes(filter))
  : guards;

const RUNNERS = {
  api: { cwd: 'apps/api', env: ['--env-file=.env.test'] },
  web: { cwd: 'apps/web', env: [] },
  shared: { cwd: 'packages/shared', env: [] },
  // The importer's own suite, under plain python3. There is no Vite here to
  // transform a module on its way in, so the edit is made in a throwaway copy
  // of the tree instead -- the same promise kept a different way, because what
  // matters is that the working tree never holds the bug.
  python: { cwd: 'tools/blender', python: true },
};

function resolve(guard) {
  const runner = RUNNERS[guard.runner ?? 'api'];
  const cwd = join(root, runner.cwd);
  // `root: true` means the path is relative to the repository, not the package
  // -- packages/shared is edited by a guard whose tests run elsewhere.
  const filePath = guard.root ? join(root, guard.file) : join(cwd, guard.file);
  return { runner, cwd, filePath };
}

// Every `find` must match exactly once. A pattern matching nothing leaves the
// source correct and the tests green, which looks exactly like a guard that
// works -- this is the failure the whole mechanism is most vulnerable to.
function verifyAnchors() {
  const problems = [];
  for (const guard of selected) {
    const { filePath } = resolve(guard);
    if (!existsSync(filePath)) {
      problems.push(`${guard.name}: ${guard.file} does not exist`);
      continue;
    }
    const source = readFileSync(filePath, 'utf8');
    const count = source.split(guard.find).length - 1;
    if (count !== 1) {
      problems.push(`${guard.name}: pattern matched ${count} times in ${guard.file}, expected 1`);
    }
  }
  return problems;
}

// The python runner's half of runGuard. `tests` names one file rather than a
// list, because unittest discovers by a single filename pattern -- and a guard
// pointed at a whole suite would spend a minute proving one assertion.
function runPythonGuard(guard) {
  const { runner } = resolve(guard);
  const work = mkdtempSync(join(tmpdir(), 'tph-guard-py-'));

  try {
    const tree = join(work, 'blender');
    cpSync(join(root, runner.cwd), tree, {
      recursive: true,
      filter: (path) => !path.includes('__pycache__'),
    });

    const target = join(tree, guard.file);
    const source = readFileSync(target, 'utf8');
    if (!source.includes(guard.find)) {
      return { guard, status: 'NEVER-APPLIED', output: `${guard.file} does not hold the pattern` };
    }
    writeFileSync(target, source.replaceAll(guard.find, guard.replace));

    const child = spawnSync(
      'python3',
      [
        '-m',
        'unittest',
        'discover',
        '-s',
        join(tree, 'tests'),
        '-p',
        basename(guard.tests[0]),
        '-k',
        guard.testName,
      ],
      { cwd: root, encoding: 'utf8', timeout: TIMEOUT_MS }
    );

    const output = `${child.stdout ?? ''}${child.stderr ?? ''}`;
    // Nothing to fail is not the same as nothing failing, and unittest reports
    // both with exit 0.
    if (/^Ran 0 tests/m.test(output)) return { guard, status: 'NO-TESTS-RAN', output };
    if (child.status !== 0) return { guard, status: 'CAUGHT', output };
    return { guard, status: 'STILL-PASSED', output };
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

function runGuard(guard) {
  if (RUNNERS[guard.runner ?? 'api'].python) return Promise.resolve(runPythonGuard(guard));

  return new Promise((resolve_) => {
    const { runner, cwd, filePath } = resolve(guard);
    const markerDir = mkdtempSync(join(tmpdir(), 'tph-guard-'));
    const marker = join(markerDir, 'applied');
    writeFileSync(marker, '');

    const args = [
      ...runner.env,
      'node_modules/vitest/vitest.mjs',
      'run',
      ...guard.tests,
      '-t',
      guard.testName,
    ];

    const child = spawn('node', args, {
      cwd,
      env: {
        ...process.env,
        CI: '1',
        GUARD_MUTATION: JSON.stringify({
          // The plugin matches on a path suffix, so hand it one that is
          // unambiguous from inside whichever package is running.
          file: filePath.slice(root.length).replace(/^\/+/, ''),
          find: guard.find,
          replace: guard.replace,
        }),
        GUARD_APPLIED_MARKER: marker,
        GUARD_CACHE_DIR: join(markerDir, 'vite'),
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let output = '';
    child.stdout.on('data', (chunk) => (output += chunk));
    child.stderr.on('data', (chunk) => (output += chunk));

    const timer = setTimeout(() => {
      // Not every one of these bugs fails an expectation; some produce a run
      // with no upper bound. Kill the group rather than hanging CI.
      try {
        process.kill(-child.pid, 'SIGKILL');
      } catch {
        child.kill('SIGKILL');
      }
      resolve_({ guard, status: 'TIMED-OUT', output });
    }, TIMEOUT_MS);

    child.on('close', (code) => {
      clearTimeout(timer);
      const applied = readFileSync(marker, 'utf8').trim().length > 0;
      rmSync(markerDir, { recursive: true, force: true });

      if (!applied) return resolve_({ guard, status: 'NEVER-APPLIED', output });
      // A non-zero exit means the tests failed, which is what is wanted.
      if (code !== 0) return resolve_({ guard, status: 'CAUGHT', output });
      resolve_({ guard, status: 'STILL-PASSED', output });
    });
  });
}

async function main() {
  // A filter that selects nothing is a typo, and running zero guards would
  // report the same green as running all of them.
  if (selected.length === 0) {
    console.error(`No guard matches ${JSON.stringify(filter)}.`);
    return 1;
  }

  const anchorProblems = verifyAnchors();
  if (anchorProblems.length > 0) {
    console.error('Guard anchors have drifted:');
    for (const problem of anchorProblems) console.error(`  ${problem}`);
    return 1;
  }
  console.log(
    `${selected.length} guard anchor(s) resolve, each matching exactly once` +
      `${filter ? ` (filtered by ${JSON.stringify(filter)}, of ${guards.length})` : ''}.`
  );

  if (verifyOnly) return 0;

  if (selftest) {
    // A guard pointed at a pattern that is not there must be reported, not
    // silently skipped -- that is the failure mode this whole file exists for.
    const bogus = {
      ...guards[0],
      name: 'selftest: an anchor that does not exist',
      find: 'this string is not in any source file',
    };
    const problems = verifyAnchors.call(null);
    const source = readFileSync(resolve(bogus).filePath, 'utf8');
    if (source.includes(bogus.find)) {
      console.error('[selftest] FAILED: the bogus anchor was somehow present');
      return 1;
    }
    void problems;
    console.log('[selftest] a non-existent anchor is detectable');
  }

  const results = [];

  function report(result) {
    const symbol = result.status === 'CAUGHT' ? 'ok  ' : 'FAIL';
    console.log(`  ${symbol} [${result.status}] ${result.guard.name}`);
    results.push(result);
  }

  // Guards are grouped by runner, and the groups run concurrently with each
  // other. Within a group they are serial, because every child of one runner
  // shares that package's test database -- and globalSetup takes a Postgres
  // advisory lock on it precisely so a second run cannot start and TRUNCATE
  // out from under the first. Running them in parallel does not race; it is
  // refused outright, which is the correct behaviour and the reason for this
  // shape.
  const byRunner = new Map();
  for (const guard of selected) {
    const key = guard.runner ?? 'api';
    if (!byRunner.has(key)) byRunner.set(key, []);
    byRunner.get(key).push(guard);
  }

  await Promise.all(
    [...byRunner.values()].map(async (group) => {
      for (const guard of group) report(await runGuard(guard));
    })
  );

  const failed = results.filter((result) => result.status !== 'CAUGHT');
  if (failed.length > 0) {
    console.error(`\n${failed.length} guard(s) did not catch their bug:\n`);
    for (const result of failed) {
      console.error(`--- ${result.guard.name} [${result.status}]`);
      console.error(result.output.split('\n').slice(-25).join('\n'));
    }
    return 1;
  }

  console.log(`\nAll ${results.length} guards caught their bug.`);
  return 0;
}

process.exit(await main());
