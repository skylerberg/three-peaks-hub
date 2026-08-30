import { defineConfig } from 'vitest/config';
import { guardMutation } from '../../scripts/guard-mutation.mjs';

export default defineConfig({
  plugins: [guardMutation()],
  cacheDir: process.env.GUARD_CACHE_DIR,
  // Node, not jsdom: what is worth testing here is the design reading and the
  // export guard, neither of which touches the DOM. The screens are exercised
  // by opening the app, which is the only place Canva's own APIs exist at all.
  test: { environment: 'node', include: ['src/**/*.test.ts'] },
});
