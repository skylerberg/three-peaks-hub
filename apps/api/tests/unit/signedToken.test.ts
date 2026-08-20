import { describe, expect, it } from 'vitest';
import {
  PASSWORD_RESET_TTL_MS,
  decodeSignedToken,
  encodeSignedToken,
} from '../../src/services/signedToken.ts';

describe('signedToken', () => {
  it('round-trips claims', () => {
    const token = encodeSignedToken('reset', { sub: 'abc' }, PASSWORD_RESET_TTL_MS);
    expect(decodeSignedToken<{ sub: string }>('reset', token)?.sub).toBe('abc');
  });

  // The whole reason the type is a required argument rather than a claim each
  // caller remembers to check: the families share a secret, so a reset token
  // spent as a verification token would be a privilege escalation.
  it('refuses a token of one family presented as another', () => {
    const token = encodeSignedToken('reset', { sub: 'abc' }, PASSWORD_RESET_TTL_MS);
    expect(decodeSignedToken('verify-email', token)).toBeNull();
    expect(decodeSignedToken('unsubscribe', token)).toBeNull();
  });

  it('refuses a tampered payload', () => {
    const token = encodeSignedToken('reset', { sub: 'abc' }, PASSWORD_RESET_TTL_MS);
    const forged = `${Buffer.from(JSON.stringify({ sub: 'someone-else', tokenType: 'reset', exp: Date.now() + 60_000 })).toString('base64url')}.${token.split('.')[1]}`;
    expect(decodeSignedToken('reset', forged)).toBeNull();
  });

  it('refuses a token that has expired', () => {
    expect(decodeSignedToken('reset', encodeSignedToken('reset', { sub: 'a' }, -1))).toBeNull();
  });

  it.each([['no-dot'], ['a.b.c'], [''], ['.']])('refuses malformed input %j', (token) => {
    expect(decodeSignedToken('reset', token)).toBeNull();
  });
});
