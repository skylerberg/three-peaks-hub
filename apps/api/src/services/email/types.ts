export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

export interface EmailDriver {
  send(message: EmailMessage): Promise<void>;
}
