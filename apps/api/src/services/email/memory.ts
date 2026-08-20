import type { EmailDriver, EmailMessage } from './types.ts';

// Used by tests, which assert on what was sent rather than on a log line.
const sent: EmailMessage[] = [];

export const memoryDriver: EmailDriver = {
  async send(message) {
    sent.push(message);
  },
};

export function sentEmails(): readonly EmailMessage[] {
  return sent;
}

export function clearSentEmails(): void {
  sent.length = 0;
}
