import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import request from 'supertest';
import { createApp } from '../server/app.js';
import { Database } from '../server/db.js';
import { demoWorkspace, id, now } from '../server/seed.js';

let service: Awaited<ReturnType<typeof createApp>>;
let owner: ReturnType<typeof request.agent>;
let member: ReturnType<typeof request.agent>;
let outsider: ReturnType<typeof request.agent>;
let outsiderWorkspace: string;
const csrf = { 'X-Grace-CSRF': '1' };
beforeAll(async () => {
  service = await createApp({ db: new Database('sqlite', ':memory:'), seed: true });
  owner = request.agent(service.app);
  member = request.agent(service.app);
  outsider = request.agent(service.app);
  await owner.post('/api/v1/auth/demo').set(csrf);
  await member
    .post('/api/v1/auth/login')
    .set(csrf)
    .send({ email: 'sarah@grace.local', password: 'GraceDemo2026!' });
  await outsider.post('/api/v1/auth/register').set(csrf).send({
    email: 'outsider-administration@example.test',
    password: 'AdministrationPassword123!',
    name: 'Separate Owner',
    workspace: 'Isolated workspace',
  });
  outsiderWorkspace = (await outsider.get('/api/v1/bootstrap')).body.workspace.id;
});
afterAll(async () => {
  service.io.close();
  await service.db.close();
});

describe('Workspace lifecycle and session isolation', () => {
  it('lists only actual memberships and rejects switching into an unrelated workspace', async () => {
    const list = await owner.get('/api/v1/workspaces');
    expect(list.status).toBe(200);
    expect(list.body.map((row: { id: string }) => row.id)).toEqual([demoWorkspace]);
    expect(list.body[0]).toMatchObject({ current: true, role: 'owner' });
    expect(
      (await owner.post(`/api/v1/workspaces/${outsiderWorkspace}/switch`).set(csrf)).status,
    ).toBe(404);
    expect((await owner.get('/api/v1/bootstrap')).body.workspace.id).toBe(demoWorkspace);
  });
  it('creates a SQL-backed workspace, rotates credentials, and switches back without data crossover', async () => {
    const session = request.agent(service.app);
    const signedIn = await session.post('/api/v1/auth/demo').set(csrf);
    const previousCookies = signedIn.headers['set-cookie'] as unknown as string[];
    const previousAccess = previousCookies
      .find((cookie) => cookie.startsWith('grace_access='))!
      .split(';')[0];
    const previousRefresh = previousCookies
      .find((cookie) => cookie.startsWith('grace_refresh='))!
      .split(';')[0];
    const created = await session
      .post('/api/v1/workspaces')
      .set(csrf)
      .send({ name: 'New product team' });
    expect(created.status).toBe(201);
    const bootstrap = await session.get('/api/v1/bootstrap');
    expect(bootstrap.body.workspace.id).toBe(created.body.id);
    expect(bootstrap.body.user.role).toBe('owner');
    expect(bootstrap.body.projects).toEqual([]);
    expect(bootstrap.body.issues).toEqual([]);
    expect(
      (await request(service.app).get('/api/v1/bootstrap').set('Cookie', previousAccess)).status,
    ).toBe(401);
    expect(
      (
        await request(service.app)
          .post('/api/v1/auth/refresh')
          .set(csrf)
          .set('Cookie', previousRefresh)
      ).status,
    ).toBe(401);
    const list = await session.get('/api/v1/workspaces');
    expect(list.body).toHaveLength(2);
    const currentCookies = created.headers['set-cookie'] as unknown as string[];
    const currentAccess = currentCookies
      .find((cookie) => cookie.startsWith('grace_access='))!
      .split(';')[0];
    expect(
      (await session.post(`/api/v1/workspaces/${demoWorkspace}/switch`).set(csrf)).status,
    ).toBe(200);
    expect((await session.get('/api/v1/bootstrap')).body.workspace.id).toBe(demoWorkspace);
    expect(
      (await request(service.app).get('/api/v1/bootstrap').set('Cookie', currentAccess)).status,
    ).toBe(401);
  });
  it('lists safe session metadata and revokes only sessions belonging to the current user', async () => {
    const first = request.agent(service.app);
    const second = request.agent(service.app);
    await first.post('/api/v1/auth/register').set(csrf).send({
      email: 'session-owner@example.test',
      password: 'SessionOwnerPassword123!',
      name: 'Session Owner',
      workspace: 'Session security team',
    });
    await second
      .post('/api/v1/auth/login')
      .set(csrf)
      .send({ email: 'session-owner@example.test', password: 'SessionOwnerPassword123!' });
    const sessions = await first.get('/api/v1/sessions');
    expect(sessions.status).toBe(200);
    expect(sessions.body).toHaveLength(2);
    expect(JSON.stringify(sessions.body)).not.toMatch(/refresh_hash|password_hash|grace_refresh/);
    const other = sessions.body.find((session: { current: boolean }) => !session.current);
    const current = sessions.body.find((session: { current: boolean }) => session.current);
    expect((await owner.delete(`/api/v1/sessions/${other.id}`).set(csrf)).status).toBe(404);
    expect((await first.delete(`/api/v1/sessions/${current.id}`).set(csrf)).status).toBe(409);
    expect((await first.delete(`/api/v1/sessions/${other.id}`).set(csrf)).status).toBe(200);
    expect((await second.get('/api/v1/bootstrap')).status).toBe(401);
    expect((await first.get('/api/v1/bootstrap')).status).toBe(200);
    await second
      .post('/api/v1/auth/login')
      .set(csrf)
      .send({ email: 'session-owner@example.test', password: 'SessionOwnerPassword123!' });
    expect((await first.post('/api/v1/sessions/revoke-others').set(csrf)).body.revoked).toBe(1);
    expect((await second.get('/api/v1/bootstrap')).status).toBe(401);
    expect((await first.get('/api/v1/sessions')).body).toHaveLength(1);
    expect((await first.post('/api/v1/sessions/revoke-all').set(csrf)).body.revoked).toBe(1);
    expect((await first.get('/api/v1/bootstrap')).status).toBe(401);
  });
});

describe('Invitation management', () => {
  it('lists no invite secrets and revokes a pending link without permitting cross-tenant deletion', async () => {
    const invitation = await owner
      .post('/api/v1/invites')
      .set(csrf)
      .send({ email: 'invite-administration@example.test', role: 'member' });
    expect(invitation.status).toBe(201);
    const token = new URL(invitation.body.url).searchParams.get('token');
    const list = await owner.get('/api/v1/invites');
    expect(list.status).toBe(200);
    const row = list.body.find(
      (invite: { email: string }) => invite.email === 'invite-administration@example.test',
    );
    expect(row.state).toBe('pending');
    expect(JSON.stringify(list.body)).not.toContain('token');
    expect((await member.get('/api/v1/invites')).status).toBe(403);
    expect((await outsider.delete(`/api/v1/invites/${row.id}`).set(csrf)).status).toBe(404);
    expect((await owner.delete(`/api/v1/invites/${row.id}`).set(csrf)).status).toBe(200);
    expect((await request(service.app).get(`/api/v1/auth/invite?token=${token}`)).status).toBe(404);
  });
  it('retains accepted invite audit records and prevents revocation after acceptance', async () => {
    const inviteId = id();
    await service.db.insert('invites', {
      id: inviteId,
      workspace_id: demoWorkspace,
      email: 'accepted@example.test',
      role: 'member',
      token_hash: id(),
      expires_at: new Date(Date.now() + 86400000).toISOString(),
      accepted_at: now(),
      created_at: now(),
    });
    expect((await owner.delete(`/api/v1/invites/${inviteId}`).set(csrf)).status).toBe(404);
    const list = await owner.get('/api/v1/invites');
    expect(list.body.find((row: { id: string }) => row.id === inviteId).state).toBe('accepted');
  });
});

describe('Project membership, administration and archive recovery', () => {
  let projectId: string;
  it('creates a private project and protects its administration from nonmembers', async () => {
    const created = await owner
      .post('/api/v1/projects')
      .set(csrf)
      .send({ name: 'Administration private project', key: 'ADMN', visibility: 'private' });
    expect(created.status).toBe(201);
    projectId = created.body.id;
    expect((await member.get(`/api/v1/projects/${projectId}/members`)).status).toBe(404);
    expect((await outsider.get(`/api/v1/projects/${projectId}/members`)).status).toBe(404);
    expect(
      (
        await member
          .patch(`/api/v1/projects/${projectId}/administration`)
          .set(csrf)
          .send({ name: 'No access' })
      ).status,
    ).toBe(404);
    expect(
      (
        await owner
          .post(`/api/v1/projects/${projectId}/members`)
          .set(csrf)
          .send({ user_id: (await outsider.get('/api/v1/bootstrap')).body.user.id })
      ).status,
    ).toBe(404);
  });
  it('adds a viewer, enforces project view-only access, and supports deliberate promotion', async () => {
    expect(
      (
        await owner
          .post(`/api/v1/projects/${projectId}/members`)
          .set(csrf)
          .send({ user_id: 'user-sarah', role: 'viewer' })
      ).status,
    ).toBe(201);
    const list = await member.get(`/api/v1/projects/${projectId}/members`);
    expect(list.status).toBe(200);
    expect(list.body.can_manage).toBe(false);
    expect(
      (
        await member
          .post('/api/v1/issues')
          .set(csrf)
          .send({ project_id: projectId, summary: 'Viewer edit blocked' })
      ).status,
    ).toBe(403);
    expect(
      (
        await member
          .post(`/api/v1/projects/${projectId}/members`)
          .set(csrf)
          .send({ user_id: 'user-james', role: 'admin' })
      ).status,
    ).toBe(403);
    expect(
      (
        await owner
          .patch(`/api/v1/projects/${projectId}/members/user-sarah`)
          .set(csrf)
          .send({ role: 'admin' })
      ).status,
    ).toBe(200);
    expect((await member.get(`/api/v1/projects/${projectId}/members`)).body.can_manage).toBe(true);
    expect(
      (
        await member
          .post(`/api/v1/projects/${projectId}/members`)
          .set(csrf)
          .send({ user_id: 'user-james', role: 'member' })
      ).status,
    ).toBe(201);
    expect(
      (
        await member
          .post(`/api/v1/projects/${projectId}/members`)
          .set(csrf)
          .send({ user_id: 'user-james', role: 'member' })
      ).status,
    ).toBe(409);
  });
  it('allows project admins to change settings while preserving lead and workspace viewer rules', async () => {
    expect(
      (
        await member
          .patch(`/api/v1/projects/${projectId}/administration`)
          .set(csrf)
          .send({ name: 'A clearer private project', lead_id: 'user-james' })
      ).status,
    ).toBe(200);
    const lead = await service.db.one<{ lead_id: string }>(
      'SELECT lead_id FROM projects WHERE id = ?',
      [projectId],
    );
    expect(lead!.lead_id).toBe('user-james');
    expect(
      (await member.delete(`/api/v1/projects/${projectId}/members/user-james`).set(csrf)).status,
    ).toBe(409);
    expect(
      (
        await member
          .patch(`/api/v1/projects/${projectId}/members/user-james`)
          .set(csrf)
          .send({ role: 'viewer' })
      ).status,
    ).toBe(409);
    await service.db.run('UPDATE memberships SET role = ? WHERE workspace_id = ? AND user_id = ?', [
      'viewer',
      demoWorkspace,
      'user-sarah',
    ]);
    expect(
      (
        await member
          .patch(`/api/v1/projects/${projectId}/administration`)
          .set(csrf)
          .send({ name: 'Forbidden viewer update' })
      ).status,
    ).toBe(403);
    expect((await member.get(`/api/v1/projects/${projectId}/members`)).body.can_manage).toBe(false);
    await service.db.run('UPDATE memberships SET role = ? WHERE workspace_id = ? AND user_id = ?', [
      'member',
      demoWorkspace,
      'user-sarah',
    ]);
  });
  it('archives and restores through tenant-scoped routes and keeps private archives hidden', async () => {
    expect((await member.post(`/api/v1/projects/${projectId}/archive`).set(csrf)).status).toBe(200);
    expect(
      (await owner.get('/api/v1/bootstrap')).body.projects.some(
        (p: { id: string }) => p.id === projectId,
      ),
    ).toBe(false);
    expect(
      (await member.get('/api/v1/administration/projects')).body.find(
        (p: { id: string }) => p.id === projectId,
      ).can_manage,
    ).toBe(true);
    const nonmember = request.agent(service.app);
    await nonmember
      .post('/api/v1/auth/login')
      .set(csrf)
      .send({ email: 'noah@grace.local', password: 'GraceDemo2026!' });
    expect(
      (await nonmember.get('/api/v1/administration/projects')).body.some(
        (p: { id: string }) => p.id === projectId,
      ),
    ).toBe(false);
    expect((await nonmember.post(`/api/v1/projects/${projectId}/restore`).set(csrf)).status).toBe(
      404,
    );
    expect((await outsider.post(`/api/v1/projects/${projectId}/restore`).set(csrf)).status).toBe(
      404,
    );
    expect((await member.post(`/api/v1/projects/${projectId}/restore`).set(csrf)).status).toBe(200);
    expect(
      (await member.get('/api/v1/bootstrap')).body.projects.some(
        (p: { id: string }) => p.id === projectId,
      ),
    ).toBe(true);
    expect((await member.post(`/api/v1/projects/${projectId}/restore`).set(csrf)).status).toBe(409);
  });
  it('removes explicit membership and closes private project access immediately', async () => {
    expect(
      (await owner.delete(`/api/v1/projects/${projectId}/members/user-sarah`).set(csrf)).status,
    ).toBe(200);
    expect((await member.get(`/api/v1/projects/${projectId}/members`)).status).toBe(404);
  });
});

describe('Issue trash boundaries and 30-day recovery', () => {
  it('recovers deleted issues with history retained and requires workspace administration', async () => {
    const created = await owner
      .post('/api/v1/issues')
      .set(csrf)
      .send({ project_id: 'project-platform', summary: 'Recover this issue' });
    const issueId = created.body.id;
    expect((await owner.delete(`/api/v1/issues/${issueId}`).set(csrf)).status).toBe(200);
    expect((await owner.get(`/api/v1/issues/${issueId}`)).status).toBe(404);
    expect((await member.get('/api/v1/administration/trash')).status).toBe(403);
    expect(
      (await member.post(`/api/v1/administration/trash/${issueId}/restore`).set(csrf)).status,
    ).toBe(403);
    expect((await outsider.get('/api/v1/administration/trash')).body).toEqual([]);
    expect(
      (await outsider.post(`/api/v1/administration/trash/${issueId}/restore`).set(csrf)).status,
    ).toBe(404);
    const trash = await owner.get('/api/v1/administration/trash');
    expect(trash.status).toBe(200);
    expect(trash.body.find((issue: { id: string }) => issue.id === issueId)).toMatchObject({
      summary: 'Recover this issue',
      recoverable: true,
      project_archived: false,
    });
    expect(
      (await owner.post(`/api/v1/administration/trash/${issueId}/restore`).set(csrf)).status,
    ).toBe(200);
    expect((await owner.get(`/api/v1/issues/${issueId}`)).body.issue.summary).toBe(
      'Recover this issue',
    );
    expect(
      await service.db.one('SELECT id FROM audit_log WHERE action = ? AND target_id = ?', [
        'issue.restored',
        issueId,
      ]),
    ).toBeDefined();
    const history = await service.db.all<{ field: string; old_value: string; new_value: string }>(
      'SELECT field,old_value,new_value FROM history WHERE workspace_id = ? AND issue_id = ? AND field = ?',
      [demoWorkspace, issueId, 'deleted_at'],
    );
    expect(history).toHaveLength(2);
    expect(history.some((row) => row.old_value !== '\"\"' && row.new_value === '\"\"')).toBe(true);
    expect(
      (await owner.post(`/api/v1/administration/trash/${issueId}/restore`).set(csrf)).status,
    ).toBe(404);
  });
  it('refuses expired recovery and requires archived projects to be restored first', async () => {
    const created = await owner
      .post('/api/v1/issues')
      .set(csrf)
      .send({ project_id: 'project-platform', summary: 'Expired issue recovery' });
    const issueId = created.body.id;
    await service.db.run('UPDATE issues SET deleted_at = ? WHERE id = ?', [
      new Date(Date.now() - 31 * 86400000).toISOString(),
      issueId,
    ]);
    expect(
      (await owner.post(`/api/v1/administration/trash/${issueId}/restore`).set(csrf)).status,
    ).toBe(404);
    await service.db.run('UPDATE issues SET deleted_at = ? WHERE id = ?', [now(), issueId]);
    await owner.post('/api/v1/projects/project-platform/archive').set(csrf);
    const list = await owner.get('/api/v1/administration/trash');
    expect(list.body.find((issue: { id: string }) => issue.id === issueId)).toMatchObject({
      project_archived: true,
      recoverable: false,
    });
    expect(
      (await owner.post(`/api/v1/administration/trash/${issueId}/restore`).set(csrf)).status,
    ).toBe(404);
    expect((await owner.post('/api/v1/projects/project-platform/restore').set(csrf)).status).toBe(
      200,
    );
    expect(
      (await owner.post(`/api/v1/administration/trash/${issueId}/restore`).set(csrf)).status,
    ).toBe(200);
  });
});
