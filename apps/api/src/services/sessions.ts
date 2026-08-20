import { createHash, randomBytes } from 'node:crypto';
import { SESSION_TTL_DAYS } from '../config/constants.ts';
import { newId } from '../utils/uuid.ts';
import type { AnyContextGetter } from '../types/index.ts';

const USER_AGENT_MAX_LENGTH = 512;

function generateSessionToken(): string {
  return randomBytes(32).toString('base64url');
}

// Bearer tokens are compared by hash, so what the database holds is not a
// credential. sha256 rather than argon2 deliberately: the token is 256 bits of
// entropy already, so there is nothing to brute-force, and every authenticated
// request pays this cost.
export function hashBearerToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export interface CreatedSession {
  id: string;
  token: string;
  expiresAt: Date;
}

// Takes the request context rather than a connection, so no call site can
// forget to record the user agent — the sessions list is unusable without it.
export async function createSession(
  c: AnyContextGetter & { req: { header: (name: string) => string | undefined } },
  userId: string
): Promise<CreatedSession> {
  const db = c.get('db');
  const token = generateSessionToken();
  const id = newId();
  const expiresAt = new Date(Date.now() + SESSION_TTL_DAYS * 24 * 60 * 60 * 1000);
  const userAgent = c.req.header('user-agent')?.slice(0, USER_AGENT_MAX_LENGTH) ?? null;

  await db
    .insertInto('session')
    .values({
      id,
      user_id: userId,
      token_hash: hashBearerToken(token),
      user_agent: userAgent,
      expires_at: expiresAt,
    })
    .execute();

  return { id, token, expiresAt };
}
