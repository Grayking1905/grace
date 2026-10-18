import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../server/app.js';
import { Database } from '../server/db.js';
import { applyOrganizationMigration } from '../server/organization.js';
import {
  defaultTeamPermissions,
  dashboardSections,
  type OrganizationTeam,
} from '../shared/organization.js';

const csrf = { 'X-Grace-CSRF': '1' };
let service: Awaited<ReturnType<typeof createApp>>;
let owner: ReturnType<typeof request.agent>,
  member: ReturnType<typeof request.agent>,
  outsider: ReturnType<typeof request.agent>;
let frontend: OrganizationTeam, backend: OrganizationTeam;
beforeAll(async () => {
  service = await createApp({
    db: new Database('sqlite', ':memory:'),
    seed: true,
    mailer: async () => {},
  });
  owner = request.agent(service.app);
  member = request.agent(service.app);
  outsider = request.agent(service.app);
  await owner.post('/api/v1/auth/demo').set(csrf);
  await member
    .post('/api/v1/auth/login')
    .set(csrf)
    .send({ email: 'sarah@grace.local', password: 'GraceDemo2026!' });
  await outsider.post('/api/v1/auth/register').set(csrf).send({
    name: 'Outside owner',
    email: 'outside-org@example.test',
    password: 'StrongPassword2026!',
    workspace: 'Separate organization',
    employee_id: 'EMP-OWNER',
  });
  const organization = (await owner.get('/api/v1/organization')).body;
  frontend = organization.teams.find((t: OrganizationTeam) => t.slug === 'frontend');
  backend = organization.teams.find((t: OrganizationTeam) => t.slug === 'backend');
});
afterAll(async () => {
  await service.accounts.flush();
  service.io.close();
  await service.db.close();
});
describe('Organization employee routing and team permissions', () => {
  it('migrates existing accounts to stable employee assignments without touching existing work', async () => {
    const before = (await owner.get('/api/v1/bootstrap')).body;
    expect(before.organization.teams).toHaveLength(6);
    expect(before.user.employee_id).toMatch(/^EMP-/);
    await applyOrganizationMigration(service.db);
    const after = (await owner.get('/api/v1/bootstrap')).body;
    expect(after.user.employee_id).toBe(before.user.employee_id);
    expect(after.issues).toEqual(before.issues);
    expect(after.organization.teams).toEqual(before.organization.teams);
    const employee = (await member.get('/api/v1/bootstrap')).body;
    expect(employee.organization.employee.team_id).toBe(frontend.id);
    expect(employee.organization.teams.map((t: OrganizationTeam) => t.id)).toEqual([frontend.id]);
    expect((await member.get('/api/v1/organization/employees')).status).toBe(403);
  });
  it('signs in using the assigned ID, organization code and password without inferring privileges from the ID', async () => {
    const bootstrap = (await member.get('/api/v1/bootstrap')).body;
    const agent = request.agent(service.app);
    expect(
      (
        await agent.post('/api/v1/auth/login').set(csrf).send({
          employee_id: bootstrap.user.employee_id.toLowerCase(),
          organization: bootstrap.workspace.slug,
          password: 'GraceDemo2026!',
        })
      ).status,
    ).toBe(200);
    expect((await agent.get('/api/v1/bootstrap')).body.organization.employee.team_id).toBe(
      frontend.id,
    );
    expect(
      (
        await agent.post('/api/v1/auth/login').set(csrf).send({
          employee_id: bootstrap.user.employee_id,
          organization: 'wrong-organization',
          password: 'GraceDemo2026!',
        })
      ).status,
    ).toBe(401);
    expect(
      (
        await agent.post('/api/v1/auth/login').set(csrf).send({
          employee_id: bootstrap.user.employee_id,
          organization: bootstrap.workspace.slug,
          password: 'WrongPassword123!',
        })
      ).status,
    ).toBe(401);
  });
  it('creates custom dashboards and rejects non-admin and cross-organization configuration', async () => {
    const body = {
      name: 'Customer success',
      description: 'Support and onboarding',
      color: '#e4eefa',
      sections: ['daily', 'brds'],
      permissions: defaultTeamPermissions,
    };
    expect((await member.post('/api/v1/organization/teams').set(csrf).send(body)).status).toBe(403);
    const created = await owner.post('/api/v1/organization/teams').set(csrf).send(body);
    expect(created.status).toBe(201);
    expect(created.body.sections).toEqual(['daily', 'brds']);
    expect(
      (
        await outsider
          .patch(`/api/v1/organization/teams/${created.body.id}`)
          .set(csrf)
          .send({ ...body, version: 1 })
      ).status,
    ).toBe(404);
    const changed = await owner
      .patch(`/api/v1/organization/teams/${created.body.id}`)
      .set(csrf)
      .send({ ...body, name: 'Customer experience', version: 1 });
    expect(changed.body.version).toBe(2);
    expect(
      (
        await owner
          .patch(`/api/v1/organization/teams/${created.body.id}`)
          .set(csrf)
          .send({ ...body, version: 1 })
      ).status,
    ).toBe(409);
    expect(
      (
        await owner
          .patch(`/api/v1/organization/teams/${created.body.id}`)
          .set(csrf)
          .send({ ...body, sections: [], version: 2 })
      ).status,
    ).toBe(400);
  });
  it('binds employee invitation assignments to email and prevents claiming reserved IDs', async () => {
    const invite = await owner.post('/api/v1/invites').set(csrf).send({
      email: 'new-frontend@example.test',
      employee_id: 'FRONT-1042',
      team_id: frontend.id,
      team_role: 'member',
    });
    expect(invite.status).toBe(201);
    expect(
      (
        await owner.post('/api/v1/invites').set(csrf).send({
          email: 'other-frontend@example.test',
          employee_id: 'FRONT-1042',
          team_id: frontend.id,
        })
      ).status,
    ).toBe(409);
    const token = new URL(invite.body.url).searchParams.get('token');
    expect(
      (await request(service.app).get(`/api/v1/auth/invite?token=${token}`)).body,
    ).toMatchObject({ employee_id: 'FRONT-1042', team: 'Frontend' });
    const agent = request.agent(service.app);
    const body = {
      invite_token: token,
      employee_id: 'ADMIN-999',
      email: 'new-frontend@example.test',
      name: 'New colleague',
      password: 'StrongPassword2026!',
    };
    expect((await agent.post('/api/v1/auth/register').set(csrf).send(body)).status).toBe(400);
    expect(
      (
        await agent
          .post('/api/v1/auth/register')
          .set(csrf)
          .send({ ...body, employee_id: 'FRONT-1042', email: 'imposter@example.test' })
      ).status,
    ).toBe(400);
    expect(
      (
        await agent
          .post('/api/v1/auth/register')
          .set(csrf)
          .send({ ...body, employee_id: 'FRONT-1042' })
      ).status,
    ).toBe(201);
    const bootstrap = (await agent.get('/api/v1/bootstrap')).body;
    expect(bootstrap.user.role).toBe('member');
    expect(bootstrap.user.employee_id).toBe('FRONT-1042');
    expect(bootstrap.organization.employee.team_id).toBe(frontend.id);
    expect((await agent.get('/api/v1/organization')).body.teams).toHaveLength(1);
    expect(
      (
        await owner
          .delete(
            `/api/v1/invites/${(await service.db.one<{ id: string }>('SELECT id FROM invites WHERE email=?', ['other-frontend@example.test']))?.id}`,
          )
          .set(csrf)
      ).status,
    ).toBe(404);
  });
});
describe('BRDs, daily tasks and versions', () => {
  let brd: Record<string, any>;
  const values = (kind = 'brd') => ({
    team_id: frontend.id,
    kind,
    title: 'Business onboarding requirements',
    content: '<h2>Goal</h2><p>Clear requirements</p><script>alert(1)</script>',
    owner_id: 'user-sarah',
    state: 'draft',
    issue_ids: [],
  });
  it('stores rich team work, enforces team visibility and supports versioned edits', async () => {
    const created = await member.post('/api/v1/organization/work').set(csrf).send(values());
    expect(created.status).toBe(201);
    brd = created.body;
    expect(brd.content).toContain('<h2>Goal</h2>');
    expect(brd.content).not.toContain('script');
    expect((await outsider.get(`/api/v1/organization/work/${brd.id}`)).status).toBe(404);
    expect((await member.get(`/api/v1/organization/work?team_id=${backend.id}`)).status).toBe(404);
    const updated = await member
      .patch(`/api/v1/organization/work/${brd.id}`)
      .set(csrf)
      .send({ ...values(), version: 1, state: 'review' });
    expect(updated.status).toBe(200);
    expect(updated.body.version).toBe(2);
    brd = updated.body;
    expect(
      (
        await member
          .patch(`/api/v1/organization/work/${brd.id}`)
          .set(csrf)
          .send({ ...values(), version: 1 })
      ).status,
    ).toBe(409);
    expect(
      (await owner.get('/api/v1/organization/work')).body.some(
        (w: { id: string }) => w.id === brd.id,
      ),
    ).toBe(true);
  });
  it('applies role privileges on the server and retains admin access to every team component', async () => {
    expect(
      (
        await member
          .post('/api/v1/organization/work')
          .set(csrf)
          .send({ ...values('version'), version_tag: 'v1.0.0' })
      ).status,
    ).toBe(403);
    expect(
      (
        await owner
          .post('/api/v1/organization/work')
          .set(csrf)
          .send({ ...values('version'), version_tag: 'v1.0.0' })
      ).status,
    ).toBe(201);
    const permissions = { ...defaultTeamPermissions, member: ['daily'] };
    const saved = await owner
      .patch(`/api/v1/organization/teams/${frontend.id}`)
      .set(csrf)
      .send({ ...frontend, permissions });
    expect(saved.status).toBe(200);
    frontend = saved.body;
    expect(
      (
        await member
          .post('/api/v1/issues')
          .set(csrf)
          .send({ project_id: 'project-platform', summary: 'Blocked by team policy' })
      ).status,
    ).toBe(403);
    expect(
      (
        await member
          .patch(`/api/v1/organization/work/${brd.id}`)
          .set(csrf)
          .send({ ...values(), version: 2 })
      ).status,
    ).toBe(403);
    expect(
      (
        await member
          .post('/api/v1/organization/work')
          .set(csrf)
          .send({ ...values('daily'), state: 'planned' })
      ).status,
    ).toBe(201);
    const reset = await owner
      .patch(`/api/v1/organization/teams/${frontend.id}`)
      .set(csrf)
      .send({ ...frontend, permissions: defaultTeamPermissions });
    expect(reset.status).toBe(200);
    frontend = reset.body;
  });
  it('protects employee assignments from ID collisions, stale edits and orphaned open work', async () => {
    const employees = (await owner.get('/api/v1/organization/employees')).body;
    const sarah = employees.find((e: { user_id: string }) => e.user_id === 'user-sarah');
    const james = employees.find((e: { user_id: string }) => e.user_id === 'user-james');
    expect(
      (
        await owner
          .put('/api/v1/organization/employees/user-sarah')
          .set(csrf)
          .send({ ...sarah, employee_id: james.employee_id })
      ).status,
    ).toBe(409);
    expect(
      (
        await owner
          .put('/api/v1/organization/employees/user-sarah')
          .set(csrf)
          .send({ ...sarah, team_id: backend.id })
      ).status,
    ).toBe(409);
    expect(
      (
        await owner
          .put('/api/v1/organization/employees/user-james')
          .set(csrf)
          .send({ ...james, employee_id: 'BACK-2042', team_role: 'lead' })
      ).status,
    ).toBe(200);
    expect(
      (
        await owner
          .put('/api/v1/organization/employees/user-james')
          .set(csrf)
          .send({ ...james, employee_id: 'BACK-2043' })
      ).status,
    ).toBe(409);
    expect(
      (await member.put('/api/v1/organization/employees/user-sarah').set(csrf).send(sarah)).status,
    ).toBe(403);
  });
  it('validates traceability links, isolates private project work and deletes with concurrency checks', async () => {
    const privateProject = await owner
      .post('/api/v1/projects')
      .set(csrf)
      .send({ name: 'Private roadmap', key: 'PRIVORG', visibility: 'private' });
    expect(privateProject.status).toBe(201);
    expect(
      (
        await member
          .post('/api/v1/organization/work')
          .set(csrf)
          .send({ ...values(), project_id: privateProject.body.id })
      ).status,
    ).toBe(404);
    const privateWork = await owner
      .post('/api/v1/organization/work')
      .set(csrf)
      .send({ ...values(), project_id: privateProject.body.id });
    expect(privateWork.status).toBe(201);
    expect((await member.get(`/api/v1/organization/work/${privateWork.body.id}`)).status).toBe(404);
    expect(
      (await member.get('/api/v1/organization/work')).body.some(
        (w: { id: string }) => w.id === privateWork.body.id,
      ),
    ).toBe(false);
    expect(
      (
        await member
          .post('/api/v1/organization/work')
          .set(csrf)
          .send({ ...values(), issue_ids: ['missing-issue'] })
      ).status,
    ).toBe(404);
    const issue = (await owner.get('/api/v1/bootstrap')).body.issues[0];
    const release = await owner
      .post('/api/v1/organization/work')
      .set(csrf)
      .send({ ...values('version'), version_tag: 'v2.0', issue_ids: [issue.id] });
    expect(release.status).toBe(201);
    expect(release.body.issue_ids).toEqual([issue.id]);
    expect(
      (await owner.delete(`/api/v1/organization/work/${release.body.id}?version=2`).set(csrf))
        .status,
    ).toBe(409);
    expect(
      (await owner.delete(`/api/v1/organization/work/${release.body.id}?version=1`).set(csrf))
        .status,
    ).toBe(200);
    expect(
      await service.db.one('SELECT work_id FROM organization_work_issues WHERE work_id=?', [
        release.body.id,
      ]),
    ).toBeUndefined();
    expect(
      await service.db.one('SELECT id FROM audit_log WHERE target_id=? AND action=?', [
        release.body.id,
        'version.deleted',
      ]),
    ).toBeTruthy();
  });
  it('revokes a reserved employee invitation atomically', async () => {
    const invite = await owner.post('/api/v1/invites').set(csrf).send({
      email: 'revoked-employee@example.test',
      employee_id: 'ENG-REVOKED',
      team_id: frontend.id,
    });
    expect(invite.status).toBe(201);
    const row = await service.db.one<{ id: string }>('SELECT id FROM invites WHERE email=?', [
      'revoked-employee@example.test',
    ]);
    expect((await owner.delete(`/api/v1/invites/${row!.id}`).set(csrf)).status).toBe(200);
    expect(
      await service.db.one('SELECT invite_id FROM employee_invites WHERE invite_id=?', [row!.id]),
    ).toBeUndefined();
    expect(
      (
        await owner.post('/api/v1/invites').set(csrf).send({
          email: 'reused-employee@example.test',
          employee_id: 'ENG-REVOKED',
          team_id: frontend.id,
        })
      ).status,
    ).toBe(201);
  });
  it('preserves restricted traceability links during edits and normalizes issue keys to IDs', async () => {
    const privateProject = await owner
      .post('/api/v1/projects')
      .set(csrf)
      .send({ name: 'Restricted delivery', key: 'HIDLINK', visibility: 'private' });
    const hiddenIssue = await owner
      .post('/api/v1/issues')
      .set(csrf)
      .send({ project_id: privateProject.body.id, summary: 'Restricted linked requirement' });
    const created = await owner
      .post('/api/v1/organization/work')
      .set(csrf)
      .send({
        team_id: frontend.id,
        kind: 'brd',
        title: 'Shared requirement with restricted links',
        owner_id: 'user-sarah',
        issue_ids: [hiddenIssue.body.key, hiddenIssue.body.id],
      });
    expect(created.status).toBe(201);
    expect(created.body.issue_ids).toEqual([hiddenIssue.body.id]);
    const visible = await member.get(`/api/v1/organization/work/${created.body.id}`);
    expect(visible.body.issue_ids).toEqual([]);
    expect(visible.body.has_hidden_links).toBe(true);
    const saved = await member
      .patch(`/api/v1/organization/work/${created.body.id}`)
      .set(csrf)
      .send({ ...visible.body, state: 'planned' });
    expect(saved.status).toBe(200);
    expect(
      (await owner.get(`/api/v1/organization/work/${created.body.id}`)).body.issue_ids,
    ).toEqual([hiddenIssue.body.id]);
    expect(
      (await member.get('/api/v1/organization/work')).body.find(
        (w: { id: string }) => w.id === created.body.id,
      ),
    ).toMatchObject({ issue_ids: [], has_hidden_links: true });
  });
  it('enforces a read-only team role without changing the organization membership role', async () => {
    const employees = (await owner.get('/api/v1/organization/employees')).body;
    const employee = employees.find((e: { user_id: string }) => e.user_id === 'user-noah');
    expect(
      (
        await owner
          .put('/api/v1/organization/employees/user-noah')
          .set(csrf)
          .send({ ...employee, team_role: 'viewer' })
      ).status,
    ).toBe(200);
    const viewer = request.agent(service.app);
    await viewer
      .post('/api/v1/auth/login')
      .set(csrf)
      .send({ email: 'noah@grace.local', password: 'GraceDemo2026!' });
    const bootstrap = (await viewer.get('/api/v1/bootstrap')).body;
    expect(bootstrap.user.role).toBe('member');
    expect(bootstrap.user.team_role).toBe('viewer');
    expect(bootstrap.projects.every((p: { can_write: boolean }) => !p.can_write)).toBe(true);
    expect(
      (
        await viewer
          .post('/api/v1/issues')
          .set(csrf)
          .send({ project_id: 'project-platform', summary: 'Should not create' })
      ).status,
    ).toBe(403);
    expect(
      (
        await viewer.post('/api/v1/organization/work').set(csrf).send({
          team_id: employee.team_id,
          kind: 'daily',
          title: 'Should not create',
          owner_id: 'user-noah',
        })
      ).status,
    ).toBe(403);
  });
});
