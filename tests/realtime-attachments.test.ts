import { beforeAll, afterAll, it, expect } from 'vitest';
import request from 'supertest';
import { io, type Socket } from 'socket.io-client';
import { rm } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { createApp } from '../server/app.js';
import { Database } from '../server/db.js';
let app: Awaited<ReturnType<typeof createApp>>;
let owner: ReturnType<typeof request.agent>;
let outsider: ReturnType<typeof request.agent>;
let ownerCookie: string;
let memberCookie: string;
let origin: string;
const sockets: Socket[] = [];
const files: string[] = [];
const csrf = { 'X-Grace-CSRF': '1' };
beforeAll(async () => {
  app = await createApp({
    db: new Database('sqlite', ':memory:'),
    seed: true,
    mailer: async () => {},
  });
  owner = request.agent(app.app);
  outsider = request.agent(app.app);
  const login = await owner.post('/api/v1/auth/demo').set(csrf);
  ownerCookie = (login.headers['set-cookie'] as unknown as string[])
    .map((c) => c.split(';')[0])
    .join('; ');
  const member = await request(app.app)
    .post('/api/v1/auth/login')
    .set(csrf)
    .send({ email: 'james@grace.local', password: 'GraceDemo2026!' });
  memberCookie = (member.headers['set-cookie'] as unknown as string[])
    .map((c) => c.split(';')[0])
    .join('; ');
  await outsider.post('/api/v1/auth/register').set(csrf).send({
    email: 'file-outside@example.test',
    name: 'File outsider',
    workspace: 'Other files',
    password: 'AttachmentPassword2026!',
  });
  await new Promise<void>((done) => app.httpServer.listen(0, '127.0.0.1', () => done()));
  origin = `http://127.0.0.1:${(app.httpServer.address() as { port: number }).port}`;
});
afterAll(async () => {
  sockets.forEach((s) => s.disconnect());
  await app.accounts.flush();
  app.io.close();
  await new Promise<void>((done) => app.httpServer.close(() => done()));
  await app.db.close();
  for (const file of files) {
    const path = resolve('data/uploads', file);
    if (dirname(path) !== resolve('data/uploads')) throw new Error('Unsafe test attachment path.');
    await rm(path, { force: true });
  }
});
async function connect(cookie: string) {
  const socket = io(origin, {
    extraHeaders: { Cookie: cookie },
    transports: ['websocket'],
    reconnection: false,
  });
  sockets.push(socket);
  await new Promise<void>((done, reject) => {
    socket.once('connect', () => done());
    socket.once('connect_error', reject);
  });
  return socket;
}
it('notifies two authenticated clients without broadcasting issue contents and disconnects a deactivated member', async () => {
  const first = await connect(ownerCookie);
  const second = await connect(memberCookie);
  const event = (socket: Socket) =>
    new Promise<unknown>((done) => socket.once('workspace.updated', done));
  const a = event(first),
    b = event(second);
  const created = await owner
    .post('/api/v1/issues')
    .set(csrf)
    .send({ project_id: 'project-platform', summary: 'Do not broadcast this private content' });
  expect(created.status).toBe(201);
  const messages = await Promise.all([a, b]);
  expect(JSON.stringify(messages)).not.toContain('Do not broadcast');
  const disconnected = new Promise<void>((done) => second.once('disconnect', () => done()));
  expect((await owner.post('/api/v1/members/user-james/deactivate').set(csrf)).status).toBe(200);
  await disconnected;
  expect(second.connected).toBe(false);
}, 15000);
it('protects uploaded files, preserves their content, and rejects cross-tenant access', async () => {
  const upload = await owner
    .post('/api/v1/issues/issue-0-0/attachments')
    .set(csrf)
    .attach('file', Buffer.from('A verified attachment'), 'context.txt');
  expect(upload.status).toBe(201);
  const record = await app.db.one<{ path: string }>('SELECT path FROM attachments WHERE id=?', [
    upload.body.id,
  ]);
  files.push(record!.path);
  const download = await owner.get(`/api/v1/attachments/${upload.body.id}`);
  expect(download.status).toBe(200);
  expect(Buffer.from(download.body).toString('utf8')).toBe('A verified attachment');
  expect(download.headers['content-disposition']).toContain('attachment');
  expect((await outsider.get(`/api/v1/attachments/${upload.body.id}`)).status).toBe(404);
  expect(
    (
      await outsider
        .post('/api/v1/issues/issue-0-0/attachments')
        .set(csrf)
        .attach('file', Buffer.from('not allowed'), 'no.txt')
    ).status,
  ).toBe(404);
});
