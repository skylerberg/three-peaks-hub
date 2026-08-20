import { env } from '../../config/env.ts';
import type { EmailDriver, EmailMessage } from './types.ts';

// The AWS SDK is loaded on first send rather than at import, so a deployment
// running the console driver never pays to parse it.
type SESClient = Awaited<ReturnType<typeof createClient>>;

async function createClient() {
  const { SESv2Client } = await import('@aws-sdk/client-sesv2');
  return new SESv2Client({ region: env.email.sesRegion });
}

let clientPromise: Promise<SESClient> | null = null;

function client(): Promise<SESClient> {
  clientPromise ??= createClient();
  return clientPromise;
}

export const sesDriver: EmailDriver = {
  async send(message: EmailMessage) {
    const [{ SendEmailCommand }, ses] = await Promise.all([
      import('@aws-sdk/client-sesv2'),
      client(),
    ]);

    await ses.send(
      new SendEmailCommand({
        FromEmailAddress: env.email.fromAddress,
        Destination: { ToAddresses: [message.to] },
        Content: {
          Simple: {
            Subject: { Data: message.subject, Charset: 'UTF-8' },
            Body: {
              Text: { Data: message.text, Charset: 'UTF-8' },
              ...(message.html ? { Html: { Data: message.html, Charset: 'UTF-8' } } : {}),
            },
          },
        },
      })
    );
  },
};
