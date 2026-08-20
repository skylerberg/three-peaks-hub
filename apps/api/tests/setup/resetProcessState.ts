import { beforeEach } from 'vitest';

// Process-global state that no single test owns. Cleared before every test, so
// a rate-limit window or a token-touch cache filled by one file cannot decide
// the outcome of another.
//
// Deliberately NOT here: anything a test file sets up once in beforeAll.
// Clearing that per test would break those files rather than isolate them.
beforeEach(async () => {
  // Imported inside the hook so vi.mock() in a test file still applies.
  const { resetPersonalAccessTokenCache } =
    await import('../../src/services/personalAccessTokens.ts');
  const { clearSentEmails } = await import('../../src/services/email/index.ts');
  resetPersonalAccessTokenCache();
  clearSentEmails();
});
