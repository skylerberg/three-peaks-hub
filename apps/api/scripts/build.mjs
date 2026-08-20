import { readFileSync } from 'node:fs';
import { build } from 'esbuild';

// `--packages=external` cannot express what this build needs. Registry packages
// must stay external so pnpm installs them into the image -- argon2 and sharp
// are native addons and cannot be bundled at all. Workspace packages are on no
// registry and resolve to .ts files a bare `node` cannot load, so they have to
// be bundled in. The flag makes no distinction between the two, which is why
// this is a script rather than a one-liner.
const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

const external = Object.keys(pkg.dependencies).filter((name) => !name.startsWith('@three-peaks/'));

await build({
  entryPoints: ['src/index.ts'],
  bundle: true,
  platform: 'node',
  target: 'node24',
  format: 'esm',
  outfile: 'dist/index.mjs',
  sourcemap: true,
  external,
});

console.log(`bundled dist/index.mjs (${external.length} external packages)`);
