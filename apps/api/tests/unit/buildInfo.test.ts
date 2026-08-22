import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildInfo, resetBuildInfoCache } from '../../src/config/buildInfo.ts';

const SAVED = { branch: process.env.BUILD_BRANCH, commit: process.env.BUILD_COMMIT };

beforeEach(() => {
  resetBuildInfoCache();
});

afterEach(() => {
  if (SAVED.branch === undefined) delete process.env.BUILD_BRANCH;
  else process.env.BUILD_BRANCH = SAVED.branch;
  if (SAVED.commit === undefined) delete process.env.BUILD_COMMIT;
  else process.env.BUILD_COMMIT = SAVED.commit;
  resetBuildInfoCache();
});

describe('buildInfo', () => {
  // What the deploy substitutes into the manifest. There is no .git in the
  // image, so this is the only source that exists in production.
  it('prefers the environment the deploy sets', () => {
    process.env.BUILD_BRANCH = 'main';
    process.env.BUILD_COMMIT = '0123456789abcdef0123456789abcdef01234567';
    expect(buildInfo()).toEqual({ branch: 'main', commit: '0123456' });
  });

  it('shortens the commit to seven characters', () => {
    process.env.BUILD_COMMIT = 'abcdef1234567890';
    expect(buildInfo().commit).toHaveLength(7);
  });

  it('treats an empty variable as absent rather than as an empty branch', () => {
    process.env.BUILD_BRANCH = '   ';
    process.env.BUILD_COMMIT = '';
    const info = buildInfo();
    // Falls through to git, which this checkout has.
    expect(info.branch).not.toBe('');
    expect(info.commit).not.toBe('');
  });

  // The development case, and the one that matters locally: two worktrees on
  // two ports are indistinguishable until one of them says which branch it is.
  it('reads the checkout when the deploy set nothing', () => {
    delete process.env.BUILD_BRANCH;
    delete process.env.BUILD_COMMIT;
    const info = buildInfo();
    expect(info.branch).toBeTruthy();
    expect(info.commit).toMatch(/^[0-9a-f]{7}$/);
  });

  // Shelling out per request would put a subprocess spawn on the readiness
  // probe's path, which k8s hits every ten seconds per replica.
  it('reads once and caches', () => {
    delete process.env.BUILD_BRANCH;
    const first = buildInfo();
    process.env.BUILD_BRANCH = 'something-else';
    expect(buildInfo()).toBe(first);
  });
});
