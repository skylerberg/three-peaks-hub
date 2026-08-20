import { createHmac, timingSafeEqual } from 'node:crypto';
import { env } from '../config/env.ts';

// One codec for every mailed link: password reset, email verification,
// unsubscribe. Format is base64url(claims).base64url(hmac).
//
// The families share a secret, so separating them is what stops one family's
// token being spent as another's — a reset link becoming a verification link is
// a privilege escalation. The type is therefore a *required argument* to both
// encode and decode rather than a claim each caller remembers to check, and it
// is reserved from the claims object at the type level so it cannot be
// overwritten by a caller.
export type SignedTokenType = 'reset' | 'verify-email' | 'unsubscribe';

const TYPE_CLAIM = 'tokenType';

type Claims = Record<string, unknown> & { [TYPE_CLAIM]?: never; exp?: never };

function sign(payload: string): string {
  return createHmac('sha256', env.emailTokenSecret).update(payload).digest('base64url');
}

export function encodeSignedToken(
  tokenType: SignedTokenType,
  claims: Claims,
  ttlMs: number
): string {
  const body = JSON.stringify({
    ...claims,
    [TYPE_CLAIM]: tokenType,
    exp: Date.now() + ttlMs,
  });
  const encoded = Buffer.from(body, 'utf8').toString('base64url');
  return `${encoded}.${sign(encoded)}`;
}

export function decodeSignedToken<T extends Record<string, unknown>>(
  tokenType: SignedTokenType,
  token: string
): T | null {
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [encoded, signature] = parts;

  const expected = Buffer.from(sign(encoded), 'utf8');
  const actual = Buffer.from(signature, 'utf8');
  if (expected.length !== actual.length) return null;
  if (!timingSafeEqual(expected, actual)) return null;

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'));
  } catch {
    return null;
  }

  // A token naming no type verifies for nobody, which is what makes adding a
  // new family safe.
  if (parsed[TYPE_CLAIM] !== tokenType) return null;
  if (typeof parsed.exp !== 'number' || parsed.exp <= Date.now()) return null;

  return parsed as unknown as T;
}

export const PASSWORD_RESET_TTL_MS = 15 * 60 * 1000;
