import { beforeAll, afterAll, it, expect } from 'vitest';
import request from 'supertest';
import { io, type Socket } from 'socket.io-client';
import { createApp } from '../server/app.js';
import { Database } from '../server/db.js';
import { applyHomeMigration } from '../server/home-events.js';
let service: Awaited<ReturnType<typeof createApp>>,
  owner: ReturnType<typeof request.agent>,
  member: ReturnType<typeof request.agent>,
  outside: ReturnType<typeof request.agent>;
const csrf = { 'X-Grace-CSRF': '1' };
const sockets: Socket[] = [];
let frontend: string, backend: string, cookie: string, origin: string;
beforeAll(async () => {
  service = await createApp({
    db: new Database('sqlite', ':memory:'),
    seed: true,
    mailer: async () => {},
  });
  owner = request.agent(service.app);
  member = request.agent(service.app);
  outside = request.agent(service.app);
  await owner.post('/api/v1/auth/demo').set(csrf);
  const login = await member
    .post('/api/v1/auth/login')
    .set(csrf)
    .send({ email: 'sarah@grace.local', password: 'GraceDemo2026!' });
  cookie = (login.headers['set-cookie'] as unknown as string[])
    .map((c) => c.split(';')[0])
    .join('; ');
  await outside.post('/api/v1/auth/register').set(csrf).send({
    email: 'home-outsider@example.test',
    name: 'Outside person',
    workspace: 'Outside',
    password: 'StrongPassword2026!',
  });
  const teams = (await owner.get('/api/v1/organization')).body.teams;
  frontend = teams.find((t: { slug: string }) => t.slug === 'frontend').id;
  backend = teams.find((t: { slug: string }) => t.slug === 'backend').id;
  await new Promise<void>((done) => service.httpServer.listen(0, '127.0.0.1', done));
  origin = `http://127.0.0.1:${(service.httpServer.address() as { port: number }).port}`;
});
afterAll(async () => {
  sockets.forEach((s) => s.disconnect());
  await service.accounts.flush();
  service.io.close();
  await new Promise<void>((done) => service.httpServer.close(() => done()));
  await service.db.close();
});
it('returns actual SQL counts and a complete zero-filled activity window for admins and members', async () => {
  const result = await owner.get('/api/v1/organization/overview?days=7');
  expect(result.status).toBe(200);
  expect(result.body.scope).toBe('organization');
  expect(result.body.teams).toHaveLength(6);
  expect(result.body.trend).toHaveLength(7);
  const count = await service.db.one<{ n: number }>(
    'SELECT COUNT(*) AS n FROM issues WHERE deleted_at IS NULL',
  );
  expect(result.body.summary.total).toBe(count!.n);
  expect(
    result.body.summary.completed + result.body.summary.active + result.body.summary.todo,
  ).toBe(result.body.summary.total);
  const personal = await member.get('/api/v1/organization/overview');
  expect(personal.status).toBe(200);
  expect(personal.body.scope).toBe('team');
  expect(personal.body.team_id).toBe(frontend);
  expect(personal.body.teams).toHaveLength(1);
  expect(personal.body.people.every((p: { team_id: string }) => p.team_id === frontend)).toBe(true);
  expect((await member.get(`/api/v1/organization/overview?team_id=${backend}`)).status).toBe(404);
  expect((await owner.get('/api/v1/organization/overview?days=10000')).status).toBe(400);
});
it('records successful logins without exposing failed authentication or account secrets', async () => {
  const feed = (await owner.get('/api/v1/organization/activity?kind=signins')).body;
  expect(
    feed.items.some(
      (e: { actor_id: string; action: string }) =>
        e.actor_id === 'user-sarah' && e.action === 'auth.login',
    ),
  ).toBe(true);
  const before = await service.db.one<{ n: number }>('SELECT COUNT(*) AS n FROM home_events');
  expect(
    (
      await request(service.app)
        .post('/api/v1/auth/login')
        .set(csrf)
        .send({ email: 'sarah@grace.local', password: 'WrongPassword2026!' })
    ).status,
  ).toBe(401);
  expect((await service.db.one<{ n: number }>('SELECT COUNT(*) AS n FROM home_events'))!.n).toBe(
    before!.n,
  );
  expect(JSON.stringify(feed)).not.toMatch(/password_hash|refresh_hash|GraceDemo2026|sarah@grace/);
});
it('assigns projects to teams with version checks and without granting private-project access', async () => {
  expect(
    (
      await member
        .put('/api/v1/projects/project-platform/teams')
        .set(csrf)
        .send({ team_ids: [frontend], version: 0 })
    ).status,
  ).toBe(403);
  const saved = await owner
    .put('/api/v1/projects/project-platform/teams')
    .set(csrf)
    .send({ team_ids: [frontend, backend], version: 0 });
  expect(saved.status).toBe(200);
  expect(
    (
      await owner
        .put('/api/v1/projects/project-platform/teams')
        .set(csrf)
        .send({ team_ids: [backend], version: 0 })
    ).status,
  ).toBe(409);
  const home = (await owner.get('/api/v1/organization/overview')).body;
  expect(
    home.projects.find((p: { id: string }) => p.id === 'project-platform').team_ids.sort(),
  ).toEqual([frontend, backend].sort());
  const filtered = (await owner.get('/api/v1/organization/overview').query({ team_id: frontend }))
    .body;
  expect(
    filtered.projects.find((p: { id: string }) => p.id === 'project-platform').team_ids.sort(),
  ).toEqual([frontend, backend].sort());
  const privateProject = await owner.post('/api/v1/projects').set(csrf).send({
    name: 'Restricted home project',
    key: 'HPR',
    template: 'basic',
    visibility: 'private',
  });
  expect(privateProject.status).toBe(201);
  expect(
    (
      await owner
        .put(`/api/v1/projects/${privateProject.body.id}/teams`)
        .set(csrf)
        .send({ team_ids: [frontend], version: 0 })
    ).status,
  ).toBe(200);
  const secret = await owner.post('/api/v1/issues').set(csrf).send({
    project_id: privateProject.body.id,
    summary: 'Never leak this private home title',
    assignee_id: 'user-sarah',
  });
  expect(secret.status).toBe(201);
  expect(JSON.stringify((await member.get('/api/v1/organization/overview')).body)).not.toContain(
    'Restricted home project',
  );
  expect(JSON.stringify((await member.get('/api/v1/organization/activity')).body)).not.toContain(
    'Never leak this private home title',
  );
  expect(
    (await member.get(`/api/v1/organization/overview?project_id=${privateProject.body.id}`)).status,
  ).toBe(404);
  expect(
    (await outside.get('/api/v1/organization/activity')).body.items.every(
      (e: { actor_id: string }) => !['user-alex', 'user-sarah'].includes(e.actor_id),
    ),
  ).toBe(true);
});
it('records issue creation, status changes and team work, with stable paginated activity', async () => {
  const issue = await member.post('/api/v1/issues').set(csrf).send({
    project_id: 'project-platform',
    summary: 'Home activity test issue',
    type: 'bug',
    assignee_id: 'user-sarah',
  });
  expect(issue.status).toBe(201);
  const status = await service.db.one<{ id: string }>(
    "SELECT id FROM statuses WHERE project_id='project-platform' AND category='done' LIMIT 1",
  );
  expect(
    (
      await member
        .patch(`/api/v1/issues/${issue.body.id}`)
        .set(csrf)
        .send({ version: 1, status_id: status!.id })
    ).status,
  ).toBe(200);
  const work = await member
    .post('/api/v1/organization/work')
    .set(csrf)
    .send({ team_id: frontend, kind: 'daily', title: 'Home feed task', owner_id: 'user-sarah' });
  expect(work.status).toBe(201);
  const feed = await member.get('/api/v1/organization/activity?kind=work');
  expect(feed.status).toBe(200);
  expect(feed.body.items.some((e: { entity_id: string }) => e.entity_id === issue.body.id)).toBe(
    true,
  );
  expect(feed.body.items.some((e: { title: string }) => e.title === 'Home feed task')).toBe(true);
  const report = (await member.get('/api/v1/organization/overview?days=7')).body;
  expect(report.trend.at(-1).completed).toBeGreaterThan(0);
  const first = await member.get('/api/v1/organization/activity?limit=2');
  expect(first.body.items).toHaveLength(2);
  expect(first.body.next_cursor).toBeTruthy();
  const next = await member
    .get('/api/v1/organization/activity')
    .query({ limit: 2, cursor: first.body.next_cursor });
  expect(next.status).toBe(200);
  expect(
    next.body.items.every(
      (e: { id: string }) => !first.body.items.some((a: { id: string }) => a.id === e.id),
    ),
  ).toBe(true);
  expect((await member.get('/api/v1/organization/activity?cursor=invalid')).status).toBe(400);
});
it('keeps lead, manager and viewer Home views scoped to the assigned team', async () => {
  for (const role of ['lead', 'manager', 'viewer', 'member']) {
    const employee = (await owner.get('/api/v1/organization/employees')).body.find(
      (e: { user_id: string }) => e.user_id === 'user-sarah',
    );
    expect(
      (
        await owner
          .put('/api/v1/organization/employees/user-sarah')
          .set(csrf)
          .send({ ...employee, team_role: role })
      ).status,
    ).toBe(200);
    const home = await member.get('/api/v1/organization/overview');
    expect(home.status).toBe(200);
    expect(home.body.team_id).toBe(frontend);
    expect(home.body.teams).toHaveLength(1);
  }
});
it('hides earlier issue activity when the issue moves into a restricted project', async () => {
  const privateProject = await service.db.one<{ id: string }>(
    "SELECT id FROM projects WHERE name='Restricted home project'",
  );
  const created = await owner.post('/api/v1/issues').set(csrf).send({
    project_id: 'project-platform',
    summary: 'Home visibility transition',
    type: 'task',
    assignee_id: 'user-sarah',
  });
  expect(created.status).toBe(201);
  expect(JSON.stringify((await member.get('/api/v1/organization/activity')).body)).toContain(
    'Home visibility transition',
  );
  expect(
    (
      await owner
        .post(`/api/v1/issues/${created.body.id}/move`)
        .set(csrf)
        .send({ project_id: privateProject!.id, version: created.body.version })
    ).status,
  ).toBe(200);
  expect(JSON.stringify((await member.get('/api/v1/organization/activity')).body)).not.toContain(
    'Home visibility transition',
  );
});
it('deduplicates online members across browser clients and updates on disconnect and logout', async () => {
  async function connect() {
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
  const first = await connect();
  const second = await connect();
  let home = (await owner.get('/api/v1/organization/overview')).body;
  expect(home.summary.online).toBe(1);
  expect(home.people.find((p: { id: string }) => p.id === 'user-sarah').online).toBe(true);
  first.disconnect();
  home = (await owner.get('/api/v1/organization/overview')).body;
  expect(home.summary.online).toBe(1);
  const disconnected = new Promise<void>((done) => second.once('disconnect', () => done()));
  expect((await member.post('/api/v1/auth/logout').set(csrf)).status).toBe(200);
  await disconnected;
  home = (await owner.get('/api/v1/organization/overview')).body;
  expect(home.summary.online).toBe(0);
  expect(
    (await owner.get('/api/v1/organization/activity?kind=signins')).body.items.some(
      (e: { action: string }) => e.action === 'auth.logout',
    ),
  ).toBe(true);
});
it('applies Home migration idempotently without duplicating activity', async () => {
  const before = await service.db.one<{ n: number }>('SELECT COUNT(*) AS n FROM home_events');
  await applyHomeMigration(service.db);
  expect((await service.db.one<{ n: number }>('SELECT COUNT(*) AS n FROM home_events'))!.n).toBe(
    before!.n,
  );
});
