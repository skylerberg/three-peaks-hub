// Application close codes, in one table. A client generates the set it has to
// route on from this, so a code added at a close site but not written down here
// reaches no client at all.
export const CLOSE_CODES = {
  // The credential this socket authenticated with was revoked.
  UNAUTHORIZED: 4401,
  // Too many sockets for this account; the oldest is closed so a reconnect is
  // never refused by the socket it is replacing.
  REPLACED: 4429,
} as const;

export type RealtimeCloseCode = (typeof CLOSE_CODES)[keyof typeof CLOSE_CODES];

export const CLOSE_CODE_REASONS: Record<RealtimeCloseCode, string> = {
  4401: 'credential revoked',
  4429: 'replaced by a newer connection',
};
