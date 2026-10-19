import { beforeAll, afterAll, it, expect } from 'vitest';
import request from 'supertest';
import { createApp } from '../server/app.js';
import { Database } from '../server/db.js';
import { applyOrganizationMigration } from '../server/organization.js';
import {
  defaultTeamPermissions,
  type OrganizationTeam,
  type EmployeeProfile,
} from '../shared/organization.js';
const csrf = { 'X-Grace-CSRF': '1' };
let service: Awaited<ReturnType<typeof createApp>>;
let owner: ReturnType<typeof request.agent>,
  manager: ReturnType<typeof request.agent>,
  member: ReturnType<typeof request.agent>;
let frontend: OrganizationTeam, backend: OrganizationTeam;
async function employee(userId: string): Promise<EmployeeProfile> {
  return (await owner.get('/api/v1/organization/employees')).body.find(
    (e: EmployeeProfile) => e.user_id === userId,
  );
}
async function assign(userId: string, changes: Partial<EmployeeProfile>) {
  const original = await employee(userId);
  return owner
    .put(`/api/v1/organization/employees/${userId}`)
    .set(csrf)
    .send({ ...original, ...changes });
}
beforeAll(async () => {
  service = await createApp({
    db: new Database('sqlite', ':memory:'),
    seed: true,
    mailer: async () => {},
  });
  owner = request.agent(service.app);
  manager = request.agent(service.app);
  member = request.agent(service.app);
  await owner.post('/api/v1/auth/demo').set(csrf);
  await manager
    .post('/api/v1/auth/login')
    .set(csrf)
    .send({ email: 'sarah@grace.local', password: 'GraceDemo2026!' });
  await member
    .post('/api/v1/auth/login')
    .set(csrf)
    .send({ email: 'james@grace.local', password: 'GraceDemo2026!' });
  const organization = (await owner.get('/api/v1/organization')).body;
  frontend = organization.teams.find((t: OrganizationTeam) => t.slug === 'frontend');
  backend = organization.teams.find((t: OrganizationTeam) => t.slug === 'backend');
  expect((await assign('user-sarah', { team_role: 'manager' })).status).toBe(200);
  expect((await assign('user-james', { team_id: frontend.id })).status).toBe(200);
});
afterAll(async () => {
  await service.accounts.flush();
  service.io.close();
  await service.db.close();
});
it('routes managers to their own team and scopes the editable employee directory', async () => {
  const data = (await manager.get('/api/v1/bootstrap')).body;
  expect(data.user.team_role).toBe('manager');
  expect(data.organization).toMatchObject({ can_admin: false, can_manage_team: true });
  expect(data.organization.teams.map((t: OrganizationTeam) => t.id)).toEqual([frontend.id]);
  const employees = await manager.get('/api/v1/organization/employees');
  expect(employees.status).toBe(200);
  expect(employees.body.map((e: EmployeeProfile) => e.user_id).sort()).toEqual([
    'user-james',
    'user-sarah',
  ]);
  expect((await member.get('/api/v1/organization/employees')).status).toBe(403);
});
it('lets managers change member and lead roles with optimistic concurrency', async () => {
  const original = await employee('user-james');
  expect(
    (
      await manager
        .put('/api/v1/organization/employees/user-james')
        .set(csrf)
        .send({ ...original, team_role: 'lead' })
    ).status,
  ).toBe(200);
  expect(
    (
      await manager
        .put('/api/v1/organization/employees/user-james')
        .set(csrf)
        .send({ ...original, team_role: 'viewer' })
    ).status,
  ).toBe(409);
  expect((await employee('user-james')).team_role).toBe('lead');
  expect(
    (
      await manager
        .put('/api/v1/organization/employees/user-james')
        .set(csrf)
        .send({ ...(await employee('user-james')), team_role: 'member' })
    ).status,
  ).toBe(200);
});
it('rejects privilege escalation, identity changes, transfers and edits outside the team', async () => {
  const original = await employee('user-james');
  for (const changes of [
    { team_role: 'manager' },
    { employee_id: 'FORGED-1' },
    { team_id: backend.id },
  ]) {
    expect([403, 404]).toContain(
      (
        await manager
          .put('/api/v1/organization/employees/user-james')
          .set(csrf)
          .send({ ...original, ...changes })
      ).status,
    );
  }
  expect(
    (
      await manager
        .put('/api/v1/organization/employees/user-sarah')
        .set(csrf)
        .send({ ...(await employee('user-sarah')), team_role: 'member' })
    ).status,
  ).toBe(403);
  expect(
    (
      await manager
        .put('/api/v1/organization/employees/user-noah')
        .set(csrf)
        .send({ ...(await employee('user-noah')), team_id: frontend.id })
    ).status,
  ).toBe(404);
  expect(
    (
      await manager
        .post('/api/v1/invites')
        .set(csrf)
        .send({ email: 'forged@example.test', role: 'admin' })
    ).status,
  ).toBe(403);
  expect(await employee('user-james')).toEqual(original);
});
it('lets managers edit their dashboard layout while preserving admin-controlled permissions', async () => {
  const { permissions, id, workspace_id, slug, created_at, updated_at, ...layout } = frontend;
  const saved = await manager
    .patch(`/api/v1/organization/teams/${id}/layout`)
    .set(csrf)
    .send({ ...layout, name: 'Frontend delivery', sections: ['issues', 'daily', 'brds'] });
  expect(saved.status).toBe(200);
  expect(saved.body.permissions).toEqual(permissions);
  expect(
    (await manager.patch(`/api/v1/organization/teams/${id}/layout`).set(csrf).send(layout)).status,
  ).toBe(409);
  expect(
    (
      await manager
        .patch(`/api/v1/organization/teams/${id}/layout`)
        .set(csrf)
        .send({ ...layout, version: saved.body.version, permissions: {} })
    ).status,
  ).toBe(400);
  expect(
    (await manager.patch(`/api/v1/organization/teams/${backend.id}/layout`).set(csrf).send(layout))
      .status,
  ).toBe(404);
  expect(
    (
      await manager
        .patch(`/api/v1/organization/teams/${id}`)
        .set(csrf)
        .send({ ...layout, permissions })
    ).status,
  ).toBe(403);
  expect(
    (
      await manager
        .post('/api/v1/organization/teams')
        .set(csrf)
        .send({ ...layout, permissions })
    ).status,
  ).toBe(403);
});
it('lets managers assign and complete another employee’s work, but not another team’s work', async () => {
  const body = {
    team_id: frontend.id,
    kind: 'daily',
    title: 'Review handoff',
    state: 'planned',
    owner_id: 'user-james',
  };
  const created = await owner.post('/api/v1/organization/work').set(csrf).send(body);
  expect(created.status).toBe(201);
  const saved = await manager
    .patch(`/api/v1/organization/work/${created.body.id}`)
    .set(csrf)
    .send({ ...created.body, state: 'done' });
  expect(saved.status).toBe(200);
  expect(saved.body.state).toBe('done');
  expect(
    (
      await manager
        .patch(`/api/v1/organization/work/${created.body.id}`)
        .set(csrf)
        .send({ ...created.body, state: 'active' })
    ).status,
  ).toBe(409);
  const other = await owner
    .post('/api/v1/organization/work')
    .set(csrf)
    .send({ ...body, team_id: backend.id, owner_id: 'user-alex' });
  expect(other.status).toBe(201);
  expect(
    (
      await manager
        .patch(`/api/v1/organization/work/${other.body.id}`)
        .set(csrf)
        .send({ ...other.body, state: 'done' })
    ).status,
  ).toBe(404);
});
it('accepts an email-bound manager invitation without elevating the organization role', async () => {
  const invitation = await owner.post('/api/v1/invites').set(csrf).send({
    email: 'delivery-manager@example.test',
    employee_id: 'FRONT-M42',
    team_id: frontend.id,
    team_role: 'manager',
  });
  expect(invitation.status).toBe(201);
  const token = new URL(invitation.body.url).searchParams.get('token');
  const account = request.agent(service.app);
  const registered = await account.post('/api/v1/auth/register').set(csrf).send({
    name: 'Delivery Manager',
    email: 'delivery-manager@example.test',
    password: 'StrongPassword2026!',
    invite_token: token,
    employee_id: 'FRONT-M42',
  });
  expect(registered.status).toBe(201);
  const data = (await account.get('/api/v1/bootstrap')).body;
  expect(data.user).toMatchObject({ role: 'member', team_role: 'manager' });
  expect(data.organization).toMatchObject({ can_admin: false, can_manage_team: true });
});
it('adds manager defaults to existing team permissions once without changing employee roles or custom rules', async () => {
  const custom = { lead: ['work'], member: ['daily'], viewer: [] };
  const before = await employee('user-james');
  await service.db.run('UPDATE organization_teams SET permissions=? WHERE id=?', [
    JSON.stringify(custom),
    backend.id,
  ]);
  await service.db.run('DELETE FROM schema_migrations WHERE version=8');
  await applyOrganizationMigration(service.db);
  const first = await service.db.one<{ permissions: string; version: number }>(
    'SELECT permissions,version FROM organization_teams WHERE id=?',
    [backend.id],
  );
  expect(JSON.parse(first!.permissions)).toEqual({
    ...custom,
    manager: defaultTeamPermissions.manager,
  });
  await applyOrganizationMigration(service.db);
  expect(
    await service.db.one('SELECT permissions,version FROM organization_teams WHERE id=?', [
      backend.id,
    ]),
  ).toEqual(first);
  expect(await employee('user-james')).toEqual(before);
});
