import { beforeAll, afterAll, it, expect } from 'vitest';
import request from 'supertest';
import { createApp } from '../server/app.js';
import { Database } from '../server/db.js';
let app: Awaited<ReturnType<typeof createApp>>;
let owner: ReturnType<typeof request.agent>;
let outsider: ReturnType<typeof request.agent>;
const csrf = { 'X-Grace-CSRF': '1' };
beforeAll(async () => {
  app = await createApp({
    db: new Database('sqlite', ':memory:'),
    seed: true,
    mailer: async () => {},
  });
  owner = request.agent(app.app);
  outsider = request.agent(app.app);
  await owner.post('/api/v1/auth/demo').set(csrf);
  await outsider
    .post('/api/v1/auth/register')
    .set(csrf)
    .send({
      email: 'portfolio-outside@example.test',
      name: 'Other person',
      workspace: 'Another team',
      password: 'PortfolioPassword2026!',
    });
});
afterAll(async () => {
  await app.accounts.flush();
  app.io.close();
  await app.db.close();
});
it('assigns module members and rejects circular dependencies atomically', async () => {
  const first = await owner
    .post('/api/v1/modules')
    .set(csrf)
    .send({ project_id: 'project-platform', name: 'First milestone' });
  const second = await owner
    .post('/api/v1/modules')
    .set(csrf)
    .send({ project_id: 'project-platform', name: 'Second milestone' });
  expect(
    (
      await owner
        .put(`/api/v1/modules/${second.body.id}/planning`)
        .set(csrf)
        .send({ version: 1, members: ['user-james'], depends_on: [first.body.id] })
    ).status,
  ).toBe(200);
  const plan = await owner.get(`/api/v1/modules/${second.body.id}/planning`);
  expect(plan.body.members).toEqual(['user-james']);
  expect(plan.body.dependencies[0].id).toBe(first.body.id);
  expect(
    (
      await owner
        .put(`/api/v1/modules/${first.body.id}/planning`)
        .set(csrf)
        .send({ version: 1, members: [], depends_on: [second.body.id] })
    ).status,
  ).toBe(400);
  expect((await owner.get(`/api/v1/modules/${first.body.id}/planning`)).body.version).toBe(1);
  expect((await outsider.get(`/api/v1/modules/${first.body.id}/planning`)).status).toBe(404);
});
it('links initiatives across projects and checks versions and completion requirements', async () => {
  const module = await owner
    .post('/api/v1/modules')
    .set(csrf)
    .send({ project_id: 'project-mobile', name: 'Mobile outcome' });
  const created = await owner
    .post('/api/v1/initiatives')
    .set(csrf)
    .send({ name: 'Customer experience', module_ids: [module.body.id], lead_id: 'user-james' });
  expect(created.status).toBe(201);
  expect((await outsider.get('/api/v1/initiatives')).body).toEqual([]);
  expect(
    (
      await owner
        .patch(`/api/v1/initiatives/${created.body.id}`)
        .set(csrf)
        .send({
          name: 'Customer experience',
          state: 'completed',
          module_ids: [module.body.id],
          version: 1,
        })
    ).status,
  ).toBe(409);
  expect(
    (
      await owner
        .patch(`/api/v1/initiatives/${created.body.id}`)
        .set(csrf)
        .send({ name: 'Better experience', module_ids: [module.body.id], version: 1 })
    ).status,
  ).toBe(200);
  expect(
    (
      await owner
        .patch(`/api/v1/initiatives/${created.body.id}`)
        .set(csrf)
        .send({ name: 'Stale plan', version: 1 })
    ).status,
  ).toBe(409);
});
it('stores versioned personal cycle retrospectives and denies writes to active cycles', async () => {
  const body = {
    went_well: 'A focused sprint',
    improve: 'Smaller reviews',
    actions: 'Pair on the next risky change',
    version: 0,
  };
  expect(
    (await owner.put('/api/v1/sprints/sprint-0-current/retrospectives').set(csrf).send(body))
      .status,
  ).toBe(409);
  const closed = await app.db.one<{ id: string }>(
    'SELECT id FROM sprints WHERE project_id=? AND state=? LIMIT 1',
    ['project-platform', 'closed'],
  );
  expect(closed).toBeDefined();
  expect(
    (await owner.put(`/api/v1/sprints/${closed!.id}/retrospectives`).set(csrf).send(body)).status,
  ).toBe(200);
  expect((await owner.get(`/api/v1/sprints/${closed!.id}/retrospectives`)).body[0].actions).toBe(
    body.actions,
  );
  expect(
    (await owner.put(`/api/v1/sprints/${closed!.id}/retrospectives`).set(csrf).send(body)).status,
  ).toBe(409);
  expect((await outsider.get(`/api/v1/sprints/${closed!.id}/retrospectives`)).status).toBe(404);
});
it('returns bounded bootstrap issue pages and SQL report totals with workspace isolation', async () => {
  const first = await owner.get('/api/v1/bootstrap').query({ issue_limit: 3 });
  expect(first.body.issues).toHaveLength(3);
  expect(first.body.issue_page.nextCursor).toBeTruthy();
  const next = await owner
    .get('/api/v1/bootstrap')
    .query({ issue_limit: 3, issue_cursor: first.body.issue_page.nextCursor });
  expect(
    next.body.issues.every(
      (i: { id: string }) => !first.body.issues.some((j: { id: string }) => i.id === j.id),
    ),
  ).toBe(true);
  const report = await owner.get('/api/v1/reports/summary');
  expect(report.status).toBe(200);
  expect(report.body.summary.total).toBe(28);
  expect((await outsider.get('/api/v1/reports/summary')).body.summary.total).toBe(0);
  expect((await owner.get('/api/v1/reports/summary').query({ days: 99999 })).status).toBe(400);
});
