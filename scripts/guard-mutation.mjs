// Applies a guard's edit as a module is transformed, so a run is invisible to
// whatever else is reading those files and cannot leave a bug behind on disk.
// Imported by both apps' vitest configs.
import { appendFileSync } from 'node:fs';

export function guardMutation() {
  const raw = process.env.GUARD_MUTATION;
  if (!raw) return { name: 'guard-mutation-inactive' };

  const { file, find, replace } = JSON.parse(raw);
  const marker = process.env.GUARD_APPLIED_MARKER;

  return {
    name: 'guard-mutation',
    // Before any other transform, so `find` matches the source as written.
    enforce: 'pre',
    transform(code, id) {
      if (!id.replace(/\\/g, '/').endsWith(file)) return null;
      if (!code.includes(find)) return null;

      // Records that the bug was actually in play, which is what separates a
      // guard aimed at a module the tests never load from one that has stopped
      // biting.
      if (marker) appendFileSync(marker, `${id}\n`);
      return { code: code.replaceAll(find, replace), map: null };
    },
  };
}
