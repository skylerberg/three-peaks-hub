// Builds the production bundle and boots it, the way the image does, and
// requires it to answer /health.
//
// This exists because `pnpm dev` runs src/index.ts through tsx and every other
// check reads the source tree, so nothing in this repo ever ran the artefact
// the container runs. build:prod is an esbuild bundle, and bundling collapses
// every module into one file whose `import.meta.url` is the entrypoint's -- so
// an `import.meta.url === argv[1]` guard in a module the server merely imports
// is false from source and true in the image. src/db/migrate.ts carried one.
// Every API pod ran the migration CLI at boot, could not find the migration
// directory beside dist/, exited 1, and crash-looped; eight consecutive deploys
// timed out on a rollout that never became ready, and the previous release kept
// serving so nothing else said a word.
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const apiRoot = fileURLToPath(new URL('..', import.meta.url));
const selftest = process.argv.includes('--selftest');
// The half that needs no database: a build and a read. It runs in check:all,
// where booting cannot -- that has to pass on a checkout with no dev database.
// The boot half runs in CI's probes job, which has one.
const staticOnly = process.argv.includes('--static');

// Its own port in the development block, so a probe and a running dev server
// never take each other's.
const PORT = 17333;
const BOOT_TIMEOUT_MS = 30_000;
const ENTRY = join(apiRoot, 'dist/index.mjs');

// The guard the server's own entrypoint is written with. Exactly one belongs in
// the bundle: a second one is a module that only meant to be imported.
const ENTRY_GUARD = 'import.meta.url === `file://${process.argv[1]}`';

function build() {
  const built = spawnSync('node', ['scripts/build.mjs'], { cwd: apiRoot, stdio: 'inherit' });
  if (built.status !== 0) {
    console.error('check:bundle FAILED: build:prod did not produce a bundle');
    process.exit(1);
  }
}

// Answers what happened rather than throwing, so the selftest can require a
// failure without having to catch one.
async function boot(entry) {
  const child = spawn('node', ['--env-file=.env', entry], {
    cwd: apiRoot,
    env: { ...process.env, PORT: String(PORT) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let output = '';
  child.stdout.on('data', (chunk) => (output += chunk));
  child.stderr.on('data', (chunk) => (output += chunk));

  let exited = null;
  child.on('exit', (code, signal) => (exited = { code, signal }));

  const deadline = Date.now() + BOOT_TIMEOUT_MS;
  try {
    while (Date.now() < deadline) {
      // Before the request, never after: a process that is already gone must be
      // reported as gone rather than as a connection that could not be made.
      if (exited) {
        return {
          ok: false,
          reason: `the process exited (${exited.signal ?? exited.code})`,
          output,
        };
      }
      try {
        const response = await fetch(`http://localhost:${PORT}/health`);
        const body = await response.json();
        if (response.ok && body.status === 'ok') return { ok: true, body, output };
        return { ok: false, reason: `/health answered ${response.status} ${body.status}`, output };
      } catch {
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
    }
    return { ok: false, reason: `no answer from /health within ${BOOT_TIMEOUT_MS}ms`, output };
  } finally {
    child.kill('SIGKILL');
  }
}

build();

const bundle = readFileSync(ENTRY, 'utf8');
const guards = bundle.split(ENTRY_GUARD).length - 1;
if (guards !== 1) {
  console.error(
    `check:bundle FAILED: dist/index.mjs holds ${guards} entrypoint guard(s), expected 1.\n` +
      '  A module the server imports carries one of its own, and bundling makes it true.\n' +
      '  Give that module its own entrypoint file, the way src/db/migrate-cli.ts is one.'
  );
  process.exit(1);
}

console.log('  ok   dist/index.mjs holds one entrypoint guard');

if (selftest) {
  const planted = `${bundle}\nif (${ENTRY_GUARD}) {}\n`;
  if (planted.split(ENTRY_GUARD).length - 1 !== 2) {
    console.error('[selftest] FAILED: a second entrypoint guard was not countable');
    process.exit(1);
  }
  console.log('[selftest] a second entrypoint guard in the bundle is countable');
}

if (staticOnly) {
  console.log('check:bundle passed (static; the boot runs in CI)');
  process.exit(0);
}

const result = await boot(ENTRY);
if (!result.ok) {
  console.error(`check:bundle FAILED: the bundle did not serve -- ${result.reason}`);
  console.error(result.output);
  process.exit(1);
}
console.log(`  ok   dist/index.mjs answers /health as ${result.body.commit}`);

if (selftest) {
  // A boot that exits before it serves is the whole failure this measures, so
  // the measurement has to be shown refusing one.
  const dir = mkdtempSync(join(tmpdir(), 'tph-bundle-'));
  const broken = join(dir, 'exits-at-boot.mjs');
  writeFileSync(broken, 'process.exit(1);\n');
  try {
    const refused = await boot(broken);
    if (refused.ok) {
      console.error('[selftest] FAILED: a bundle that exits at boot was reported as serving');
      process.exit(1);
    }
    console.log(`[selftest] a bundle that exits at boot is caught: ${refused.reason}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

console.log('check:bundle passed');
