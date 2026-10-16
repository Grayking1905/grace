import { beforeAll, afterAll, it, expect, vi } from 'vitest';
import { SMTPServer } from 'smtp-server';
import request from 'supertest';
import { createApp } from '../server/app.js';
import { Database } from '../server/db.js';
import { createMailSender } from '../server/mail.js';
let smtp: SMTPServer;
let app: Awaited<ReturnType<typeof createApp>>;
const received: string[] = [];
beforeAll(async () => {
  smtp = new SMTPServer({
    authOptional: true,
    disabledCommands: ['STARTTLS', 'AUTH'],
    onData(stream, _session, callback) {
      let body = '';
      stream.on('data', (chunk) => (body += String(chunk)));
      stream.on('end', () => {
        received.push(body);
        callback();
      });
    },
  });
  await new Promise<void>((resolve, reject) => {
    smtp.once('error', reject);
    smtp.listen(0, '127.0.0.1', () => resolve());
  });
  const port = (smtp.server.address() as { port: number }).port;
  vi.stubEnv('SMTP_HOST', '127.0.0.1');
  vi.stubEnv('SMTP_PORT', String(port));
  vi.stubEnv('SMTP_SECURE', 'false');
  vi.stubEnv('SMTP_REQUIRE_TLS', 'false');
  vi.stubEnv('SMTP_USER', '');
  vi.stubEnv('SMTP_FROM', 'Grace <sender@example.test>');
  vi.stubEnv('TEST_SMTP', 'true');
  app = await createApp({
    db: new Database('sqlite', ':memory:'),
    seed: false,
    mailer: createMailSender(),
  });
});
afterAll(async () => {
  await app.accounts.flush();
  app.io.close();
  await app.db.close();
  await new Promise<void>((resolve) => smtp.close(() => resolve()));
  vi.unstubAllEnvs();
});
it('delivers a real SMTP verification message and records metadata without storing its token', async () => {
  const user = request.agent(app.app);
  const response = await user
    .post('/api/v1/auth/register')
    .set('X-Grace-CSRF', '1')
    .send({
      email: 'smtp-recipient@example.test',
      name: 'SMTP User',
      workspace: 'SMTP workspace',
      password: 'LocalTestPassword2026!',
    });
  expect(response.status).toBe(201);
  await app.accounts.flush();
  expect(received).toHaveLength(1);
  const email = received[0].replace(/=\r?\n/g, '').replace(/=3D/g, '=');
  expect(email).toContain('Subject: Verify your Grace email');
  expect(email).toContain('/account/verify#token=');
  const token = /#token=([a-f0-9]{64})/.exec(email)?.[1];
  expect(token).toHaveLength(64);
  const deliveries = await app.db.all<{ state: string }>('SELECT * FROM mail_deliveries');
  expect(deliveries[0].state).toBe('sent');
  expect(JSON.stringify(deliveries)).not.toContain(token);
  expect(
    (await user.post('/api/v1/auth/verify-email').set('X-Grace-CSRF', '1').send({ token })).status,
  ).toBe(200);
});
