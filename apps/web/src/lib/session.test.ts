import '../api/testUtils.ts';
import { describe, expect, it } from 'vitest';
import { isSignedIn, type SessionStatus } from './session.svelte.ts';

describe('isSignedIn', () => {
  // `offline` is the one that matters: a signed-in session whose token could
  // not be checked because the server was unreachable. Reading it as signed-out
  // is what makes launching without a network land on the login screen.
  it.each<[SessionStatus, boolean]>([
    ['authed', true],
    ['offline', true],
    ['anon', false],
    ['unknown', false],
  ])('reads %s as signed-in=%s', (status, expected) => {
    expect(isSignedIn(status)).toBe(expected);
  });
});
