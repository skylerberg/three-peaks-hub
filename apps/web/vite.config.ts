import { fileURLToPath } from 'node:url';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { svelteTesting } from '@testing-library/svelte/vite';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vitest/config';
import { guardMutation } from '../../scripts/guard-mutation.mjs';

// An API on a non-default port is the normal case once two branches are in
// flight: a worktree's API takes a free port because the main checkout already
// holds 17310, and a dev server hard-wired to one port proxies to whichever
// build owns it without saying so — which looks exactly like the branch's
// change not working.
const apiTarget = process.env.API_PROXY_TARGET ?? 'http://localhost:17310';

const apiProxy = {
  '/api': apiTarget,
  '/ws': { target: apiTarget, ws: true },
};

export default defineConfig({
  // guardMutation runs at enforce:'pre', so it edits the source as written
  // rather than whatever svelte has already rewritten. Inactive unless
  // GUARD_MUTATION is set.
  plugins: [guardMutation(), tailwindcss(), svelte(), svelteTesting()],
  cacheDir: process.env.GUARD_CACHE_DIR,

  // Source-only workspace package: Vite must treat it as source rather than
  // trying to prebundle a package with no build output.
  optimizeDeps: { exclude: ['@three-peaks/shared'] },

  // jsPDF's browser build carries `import('html2canvas')`, `import('canvg')` and
  // `import('dompurify')` inside methods this app never calls. They are optional
  // dependencies pnpm is told not to install, and a dynamic import is still a
  // specifier Vite has to resolve at transform time -- so without these three
  // the dev server 500s and the build fails, on a code path that cannot run.
  // The stub throws if one is ever genuinely reached.
  resolve: {
    alias: Object.fromEntries(
      ['html2canvas', 'canvg', 'dompurify'].map((name) => [
        name,
        fileURLToPath(new URL('./src/lib/print/jspdfUnavailable.ts', import.meta.url)),
      ])
    ),
  },

  // three is ~650 kB on its own and is the only thing above the 500 kB default.
  // It is already in a chunk of its own -- the studio screen imports the model3d
  // library dynamically -- so raising the bar to just over it keeps the warning
  // meaningful for anything else that grows.
  build: { chunkSizeWarningLimit: 700 },

  server: { port: 17300, proxy: apiProxy },
  preview: { port: 17320, strictPort: true, proxy: apiProxy },

  test: {
    environment: 'jsdom',
    setupFiles: ['./src/vitest-setup.ts'],
    // A failing test used to leave a live spy on a shared store for every case
    // after it.
    restoreMocks: true,
    // Pinned west of Greenwich, so a local-vs-UTC date bug can actually fail.
    env: { TZ: 'America/Los_Angeles' },
    exclude: ['**/node_modules/**', '**/dist/**', 'scripts/tmp-*'],
  },
});
