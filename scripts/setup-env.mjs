// Copies every tracked `.env*.example` to the real filename when it is absent.
//
// It exists because `node --env-file=X` hard-errors when X is missing — the
// same fact CI works around with a heredoc. Every fresh clone and every new
// worktree hits it on the first `pnpm dev`, and one idempotent command beats a
// README paragraph.
import { copyFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const dirs = ['apps/api'];

let copied = 0;
for (const dir of dirs) {
  const abs = join(root, dir);
  if (!existsSync(abs)) continue;
  for (const name of readdirSync(abs)) {
    if (!name.endsWith('.example')) continue;
    const target = join(abs, name.slice(0, -'.example'.length));
    if (existsSync(target)) continue;
    copyFileSync(join(abs, name), target);
    console.log(`created ${dir}/${name.slice(0, -'.example'.length)}`);
    copied += 1;
  }
}
console.log(copied === 0 ? 'env files already present' : `${copied} env file(s) created`);
