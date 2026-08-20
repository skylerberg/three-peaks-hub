#!/bin/sh
# Creates a worktree that can actually run the checks: branch, worktree,
# install, and the untracked env files copied across.
#
# Usage: scripts/new-worktree.sh <branch> [base-ref]
set -eu

branch="${1:?usage: new-worktree.sh <branch> [base-ref]}"
base="${2:-main}"

repo_root=$(git rev-parse --show-toplevel)
repo_name=$(basename "$repo_root")
# Outside the repository, always. A worktree inside it is a second full copy of
# the codebase that every recursive search then walks.
target="$HOME/.worktrees/$repo_name/$branch"

if [ -e "$target" ]; then
  echo "worktree already exists at $target" >&2
  exit 1
fi

git -C "$repo_root" fetch origin --quiet || true
git -C "$repo_root" branch "$branch" "$base" 2>/dev/null || true
git -C "$repo_root" worktree add "$target" "$branch"

# Untracked, so git does not carry them; the checks fail without them for
# reasons that have nothing to do with the change in the branch.
for env_file in apps/api/.env apps/api/.env.test; do
  if [ -f "$repo_root/$env_file" ]; then
    mkdir -p "$(dirname "$target/$env_file")"
    cp "$repo_root/$env_file" "$target/$env_file"
    echo "copied $env_file"
  fi
done

# pnpm hardlinks from one content-addressable store, so a second checkout costs
# inodes rather than downloads. Never symlink node_modules back to the main
# checkout: an install from the worktree would rewrite the tree it is using.
(cd "$target" && pnpm install)

echo
echo "worktree ready: $target"
