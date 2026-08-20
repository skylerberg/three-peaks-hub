import { defineConfig } from 'vitest/config';
import { guardMutation } from '../../scripts/guard-mutation.mjs';

export default defineConfig({
  plugins: [guardMutation()],
  cacheDir: process.env.GUARD_CACHE_DIR,
  test: { environment: 'node', include: ['src/**/*.test.ts'] },
});
