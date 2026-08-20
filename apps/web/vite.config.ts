import { svelte } from '@sveltejs/vite-plugin-svelte';
import { svelteTesting } from '@testing-library/svelte/vite';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vitest/config';
import { guardMutation } from '../../scripts/guard-mutation.mjs';

// An API on a non-default port is the normal case once two branches are in
// flight: a worktree's API takes a free port because the main checkout already
// holds 3001, and a dev server hard-wired to 3001 proxies to whichever build
// owns it without saying so — which looks exactly like the branch's change not
// working.
const apiTarget = process.env.API_PROXY_TARGET ?? 'http://localhost:3001';

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

  server: { proxy: apiProxy },
  preview: { port: 4173, strictPort: true, proxy: apiProxy },

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
