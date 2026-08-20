// Verifies that every path a Dockerfile COPYs from the build context survives
// .dockerignore.
//
// This exists because that mismatch is invisible locally: the API image copies
// the other workspace packages' manifests -- pnpm reads the whole workspace to
// validate the lockfile even for a filtered install -- and excluding those
// directories made the build fail on a line that reads perfectly well. Nothing
// short of an actual image build could see it, so CI was the first to know.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const selftest = process.argv.includes('--selftest');

const DOCKERFILES = ['apps/api/Dockerfile', 'apps/preview-edge/Dockerfile'];

function parseIgnore() {
  const path = join(root, '.dockerignore');
  if (!existsSync(path)) return [];
  return readFileSync(path, 'utf8')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith('#'));
}

// Docker's matcher is Go's filepath.Match extended with a double-star. This
// covers the forms this repo actually uses; it errs toward reporting a match,
// because a false "excluded" fails loudly here rather than silently in a build.
function matchesPattern(pattern, path) {
  const negated = pattern.startsWith('!');
  const body = negated ? pattern.slice(1) : pattern;

  const source = body
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*\*/g, 'DOUBLESTAR')
    .replace(/\*/g, '[^/]*')
    .replace(/DOUBLESTAR/g, '.*');

  return { hit: new RegExp(`^${source}(/.*)?$`).test(path), negated };
}

function isExcluded(path, patterns) {
  let excluded = false;
  for (const pattern of patterns) {
    const { hit, negated } = matchesPattern(pattern, path);
    if (hit) excluded = !negated;
  }
  return excluded;
}

// Conventional exclusions that are meant to apply inside a copied directory.
// Anything else nested under one is almost certainly a mistake: the COPY still
// succeeds and silently omits the excluded part, which is how the preview-edge
// image once shipped with no source in it.
const EXPECTED_NESTED =
  /(^|\/)(node_modules|dist|coverage|data|\.env.*|.*\.tsbuildinfo|.*\.md|openapi\.json|realtime-events\.json|tests)$/;

function nestedExclusions(copiedDir, patterns) {
  const prefix = copiedDir.endsWith('/') ? copiedDir : `${copiedDir}/`;
  return patterns.filter(
    (pattern) =>
      !pattern.startsWith('!') &&
      !pattern.startsWith('**') &&
      pattern.startsWith(prefix) &&
      !EXPECTED_NESTED.test(pattern)
  );
}

function copySources(dockerfile) {
  const source = readFileSync(join(root, dockerfile), 'utf8');
  const sources = [];

  for (const line of source.split('\n')) {
    const match = /^\s*COPY\s+(.*)$/i.exec(line);
    if (!match) continue;
    // --from=<stage> copies come from an earlier build stage, not the context.
    if (/--from=/.test(line)) continue;

    const parts = match[1].split(/\s+/).filter((part) => !part.startsWith('--'));
    // The last argument is the destination inside the image.
    for (const part of parts.slice(0, -1)) sources.push(part);
  }
  return sources;
}

const patterns = parseIgnore();
const problems = [];

for (const dockerfile of DOCKERFILES) {
  for (const source of copySources(dockerfile)) {
    if (!existsSync(join(root, source))) {
      problems.push(`${dockerfile}: COPY ${source} -- no such path in the repository`);
      continue;
    }
    if (isExcluded(source, patterns)) {
      problems.push(`${dockerfile}: COPY ${source} -- excluded by .dockerignore`);
      continue;
    }

    // A directory copy that succeeds while silently missing part of its
    // contents is worse than one that fails outright.
    for (const nested of nestedExclusions(source, patterns)) {
      problems.push(
        `${dockerfile}: COPY ${source} -- .dockerignore excludes ${nested} from inside it`
      );
    }
  }
}

if (selftest) {
  // Sensitivity: the matcher has to separate the two cases, or this check
  // passes by never matching anything.
  if (!isExcluded('apps/api/tests', patterns)) {
    console.error('[selftest] FAILED: an excluded path was not detected as excluded');
    process.exit(1);
  }
  if (isExcluded('apps/api/package.json', patterns)) {
    console.error('[selftest] FAILED: an included path was reported as excluded');
    process.exit(1);
  }
  if (nestedExclusions('apps/api', ['apps/api/src']).length !== 1) {
    console.error('[selftest] FAILED: an unexpected nested exclusion was not reported');
    process.exit(1);
  }
  if (nestedExclusions('apps/api', ['apps/api/node_modules']).length !== 0) {
    console.error('[selftest] FAILED: a conventional nested exclusion was reported');
    process.exit(1);
  }
  console.log('[selftest] the matcher separates excluded paths from included ones,');
  console.log('[selftest] and an unexpected nested exclusion from a conventional one');
}

if (problems.length > 0) {
  console.error(`\n${problems.length} Dockerfile/.dockerignore conflict(s):`);
  for (const problem of problems) console.error(`  ${problem}`);
  process.exit(1);
}

console.log(`check:dockerfiles passed (${DOCKERFILES.length} Dockerfiles)`);
