import { logger } from '../../utils/logger.ts';
import type { EmailDriver } from './types.ts';

// The default. Prints the whole message, link included, so a developer can
// follow a password reset without any mail infrastructure.
export const consoleDriver: EmailDriver = {
  async send(message) {
    logger.info('email (console driver)', {
      to: message.to,
      subject: message.subject,
      text: message.text,
    });
  },
};
