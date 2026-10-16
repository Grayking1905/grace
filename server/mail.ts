import nodemailer from 'nodemailer';
export interface MailMessage {
  to: string;
  subject: string;
  text: string;
}
export type MailSender = (message: MailMessage) => Promise<void>;
export function smtpConfigured() {
  return !!process.env.SMTP_HOST;
}
export function createMailSender(): MailSender {
  let transport: ReturnType<typeof nodemailer.createTransport> | undefined;
  return async (message) => {
    if (!smtpConfigured() || (process.env.NODE_ENV === 'test' && process.env.TEST_SMTP !== 'true'))
      throw Object.assign(new Error('SMTP is not configured.'), { code: 'NOT_CONFIGURED' });
    transport ??= nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT || 587),
      secure: process.env.SMTP_SECURE === 'true',
      requireTLS: process.env.SMTP_REQUIRE_TLS !== 'false',
      auth: process.env.SMTP_USER
        ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD }
        : undefined,
      connectionTimeout: 10000,
      greetingTimeout: 10000,
      socketTimeout: 15000,
      disableFileAccess: true,
      disableUrlAccess: true,
    });
    await transport.sendMail({
      ...message,
      from: process.env.SMTP_FROM || 'Grace <no-reply@grace.local>',
    });
  };
}
