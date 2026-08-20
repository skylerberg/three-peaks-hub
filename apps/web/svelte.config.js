import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

export default {
  preprocess: vitePreprocess(),
  // Runes only. Legacy `export let`, `$:` labels and svelte/store become
  // compile errors rather than a convention someone has to keep.
  compilerOptions: { runes: true },
};
