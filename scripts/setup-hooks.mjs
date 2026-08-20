// Run by the root `prepare` script during `pnpm install`. Points git at the
// checked-in hooks directory, which is repository config — so a worktree picks
// it up too, without a second install step.
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';

// `prepare` also runs inside the Docker build, where there is no .git at all.
if (!existsSync(new URL('../.git', import.meta.url))) {
  process.exit(0);
}

try {
  execFileSync('git', ['config', 'core.hooksPath', '.githooks'], { stdio: 'inherit' });
} catch {
  // A missing or unusual git is not a reason to fail an install.
}
