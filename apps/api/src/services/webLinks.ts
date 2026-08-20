import { env } from '../config/env.ts';

// Every link the server mails is built here, never in the service that sends
// it. The paths are pinned in one place and again in the web app's router test,
// which is what keeps a route rename from quietly turning mail into a
// not-found page.
function url(path: string, params?: Record<string, string>): string {
  const target = new URL(path, env.appUrlBase);
  for (const [key, value] of Object.entries(params ?? {})) {
    target.searchParams.set(key, value);
  }
  return target.toString();
}

export function passwordResetLink(token: string): string {
  return url('/reset-password', { token });
}
