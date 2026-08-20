import type { Plugin } from 'vite';

// A .d.ts rather than converting the module to TypeScript: it is imported by
// vitest configs, which load before any transform could compile it.
export declare function guardMutation(): Plugin;
