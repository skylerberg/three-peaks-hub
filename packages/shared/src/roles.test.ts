import { describe, expect, it } from 'vitest';
import { canEdit, normalizeProjectRole } from './roles.ts';

describe('normalizeProjectRole', () => {
  it('keeps editor', () => {
    expect(normalizeProjectRole('editor')).toBe('editor');
  });

  // The point of the function: every one of these is a way a role can arrive
  // wrong, and none of them may widen access.
  it.each([['viewer'], ['Editor'], ['EDITOR'], ['owner'], [''], ['admin']])(
    'reads %j as viewer',
    (input) => {
      expect(normalizeProjectRole(input)).toBe('viewer');
    }
  );

  it('reads null and undefined as viewer', () => {
    expect(normalizeProjectRole(null)).toBe('viewer');
    expect(normalizeProjectRole(undefined)).toBe('viewer');
  });

  it('gives only editor write access', () => {
    expect(canEdit('editor')).toBe(true);
    expect(canEdit('viewer')).toBe(false);
  });
});
