import { env } from '../../config/env.ts';
import { consoleDriver } from './console.ts';
import { memoryDriver } from './memory.ts';
import { sesDriver } from './ses.ts';
import type { EmailMessage } from './types.ts';

export type { EmailMessage } from './types.ts';
export { sentEmails, clearSentEmails } from './memory.ts';

function driver() {
  if (env.isTest) return memoryDriver;
  return env.email.driver === 'ses' ? sesDriver : consoleDriver;
}

export async function sendEmail(message: EmailMessage): Promise<void> {
  await driver().send(message);
}
