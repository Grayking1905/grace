import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import request from 'supertest';
import { Database } from '../server/db.js';
import { createApp } from '../server/app.js';
import { demoWorkspace } from '../server/seed.js';

let service: Awaited<ReturnType<typeof createApp>>;
let owner: ReturnType<typeof request.agent>;
let member: ReturnType<typeof request.agent>;
let secondMember: ReturnType<typeof request.agent>;
let outsider: ReturnType<typeof request.agent>;
const csrf = { 'X-Grace-CSRF': '1' };
beforeAll(async () => {
  service = await createApp({ db: new Database('sqlite', ':memory:'), seed: true });
  owner = request.agent(service.app);
  member = request.agent(service.app);
  secondMember = request.agent(service.app);
  outsider = request.agent(service.app);
  await owner.post('/api/v1/auth/demo').set(csrf);
  await member
    .post('/api/v1/auth/login')
    .set(csrf)
    .send({ email: 'sarah@grace.local', password: 'GraceDemo2026!' });
  await secondMember
    .post('/api/v1/auth/login')
    .set(csrf)
    .send({ email: 'james@grace.local', password: 'GraceDemo2026!' });
  await outsider.post('/api/v1/auth/register').set(csrf).send({
    email: 'views-outsider@example.test',
    password: 'ViewPassword12345!',
    name: 'Outside Owner',
    workspace: 'Outside views',
  });
});
afterAll(async () => {
  service.io.close();
  await service.db.close();
});

describe('Saved view editing and query validation', () => {
  it('validates GQL before creating or changing a saved view, including on an empty workspace', async () => {
    const before = (await service.db.one<{ total: number }>(
      'SELECT COUNT(*) AS total FROM saved_views',
    ))!.total;
    for (const query of [
      'priority =',
      'no_such_field = high',
      'assignee = noSuchFunction()',
      'priority = high ORDER BY nonexistent',
    ]) {
      const response = await outsider
        .post('/api/v1/views')
        .set(csrf)
        .send({ name: 'Invalid view', query });
      expect(response.status).toBe(400);
      expect(response.body.code).toBe('INVALID_QUERY');
    }
    expect(
      (await service.db.one<{ total: number }>('SELECT COUNT(*) AS total FROM saved_views'))!.total,
    ).toBe(before);
    const created = await member.post('/api/v1/views').set(csrf).send({
      name: 'Valid query',
      query: 'priority = high AND assignee = currentUser()',
      sharing: 'private',
    });
    expect(created.status).toBe(201);
    const invalid = await member
      .patch(`/api/v1/views/${created.body.id}`)
      .set(csrf)
      .send({ name: 'Do not persist', query: 'points >' });
    expect(invalid.status).toBe(400);
    expect(invalid.body.code).toBe('INVALID_QUERY');
    expect(
      await service.db.one('SELECT name,query FROM saved_views WHERE id = ?', [created.body.id]),
    ).toEqual({ name: 'Valid query', query: 'priority = high AND assignee = currentUser()' });
  });
  it('updates name, query, and sharing in place while keeping its identifier and ownership', async () => {
    const created = await member
      .post('/api/v1/views')
      .set(csrf)
      .send({ name: 'Original name', query: '', sharing: 'private' });
    expect(created.status).toBe(201);
    const viewId = created.body.id;
    const updated = await member.patch(`/api/v1/views/${viewId}`).set(csrf).send({
      name: '  Urgent work  ',
      query: "priority in ('critical', 'high') ORDER BY points DESC",
      sharing: 'workspace',
    });
    expect(updated.status).toBe(200);
    expect(updated.body).toMatchObject({
      id: viewId,
      name: 'Urgent work',
      owner_id: 'user-sarah',
      sharing: 'workspace',
      query: "priority in ('critical', 'high') ORDER BY points DESC",
    });
    const bootstrap = await secondMember.get('/api/v1/bootstrap');
    expect(bootstrap.body.views.find((view: { id: string }) => view.id === viewId).name).toBe(
      'Urgent work',
    );
    const rename = await member
      .patch(`/api/v1/views/${viewId}`)
      .set(csrf)
      .send({ name: 'Renamed view' });
    expect(rename.status).toBe(200);
    expect(rename.body.query).toBe(updated.body.query);
    expect(rename.body.sharing).toBe('workspace');
    const rows = await secondMember
      .post('/api/v1/search/gql')
      .set(csrf)
      .send({ query: rename.body.query });
    expect(rows.status).toBe(200);
    expect(
      rows.body.every((issue: { priority: string }) =>
        ['high', 'critical'].includes(issue.priority),
      ),
    ).toBe(true);
    const audit = await service.db.all<{ action: string; detail: string }>(
      'SELECT action,detail FROM audit_log WHERE workspace_id = ? AND target_id = ? ORDER BY created_at',
      [demoWorkspace, viewId],
    );
    expect(audit.map((entry) => entry.action)).toEqual([
      'view.created',
      'view.updated',
      'view.updated',
    ]);
    expect(JSON.stringify(audit)).not.toContain('Urgent work');
  });
  it('allows workspace administrators to edit shared views while forbidding unrelated members', async () => {
    const created = await member
      .post('/api/v1/views')
      .set(csrf)
      .send({ name: 'Team priorities', query: '', sharing: 'workspace' });
    expect(
      (
        await secondMember
          .patch(`/api/v1/views/${created.body.id}`)
          .set(csrf)
          .send({ query: 'type = bug' })
      ).status,
    ).toBe(403);
    const update = await owner
      .patch(`/api/v1/views/${created.body.id}`)
      .set(csrf)
      .send({ query: 'type = bug', name: 'Team defects' });
    expect(update.status).toBe(200);
    expect(update.body.owner_id).toBe('user-sarah');
    expect((await owner.delete(`/api/v1/views/${created.body.id}`).set(csrf)).status).toBe(200);
  });
  it('keeps private views private from other members, admins, and other workspaces', async () => {
    const secretName = 'Private attention list';
    const secretQuery = 'summary ~ confidential';
    const created = await member
      .post('/api/v1/views')
      .set(csrf)
      .send({ name: secretName, query: secretQuery });
    expect(created.status).toBe(201);
    for (const actor of [secondMember, owner, outsider]) {
      expect(
        (await actor.get('/api/v1/bootstrap')).body.views.some(
          (view: { id: string }) => view.id === created.body.id,
        ),
      ).toBe(false);
      const update = await actor
        .patch(`/api/v1/views/${created.body.id}`)
        .set(csrf)
        .send({ query: '', sharing: 'workspace' });
      expect(update.status).toBe(404);
      expect(JSON.stringify(update.body)).not.toContain(secretName);
      expect((await actor.delete(`/api/v1/views/${created.body.id}`).set(csrf)).status).toBe(404);
    }
    const audit = await owner.get('/api/v1/audit');
    expect(JSON.stringify(audit.body)).not.toContain(secretName);
    expect(JSON.stringify(audit.body)).not.toContain(secretQuery);
    expect((await member.delete(`/api/v1/views/${created.body.id}`).set(csrf)).status).toBe(200);
    expect(
      (await owner.get('/api/v1/audit')).body.some((row: { detail: string }) =>
        row.detail.includes(secretName),
      ),
    ).toBe(false);
  });
  it('makes private sharing changes immediately remove access for other members', async () => {
    const created = await member
      .post('/api/v1/views')
      .set(csrf)
      .send({ name: 'Previously shared', query: 'type = task', sharing: 'workspace' });
    expect(
      (await secondMember.get('/api/v1/bootstrap')).body.views.some(
        (view: { id: string }) => view.id === created.body.id,
      ),
    ).toBe(true);
    expect(
      (
        await member
          .patch(`/api/v1/views/${created.body.id}`)
          .set(csrf)
          .send({ sharing: 'private' })
      ).status,
    ).toBe(200);
    expect(
      (await secondMember.get('/api/v1/bootstrap')).body.views.some(
        (view: { id: string }) => view.id === created.body.id,
      ),
    ).toBe(false);
    expect(
      (
        await owner
          .patch(`/api/v1/views/${created.body.id}`)
          .set(csrf)
          .send({ sharing: 'workspace' })
      ).status,
    ).toBe(404);
  });
  it('forbids viewer changes, ownership reassignment, empty patches, and foreign workspace edits', async () => {
    const created = await member
      .post('/api/v1/views')
      .set(csrf)
      .send({ name: 'Permission test', query: '', sharing: 'workspace' });
    expect(
      (
        await outsider
          .patch(`/api/v1/views/${created.body.id}`)
          .set(csrf)
          .send({ name: 'Tenant escape' })
      ).status,
    ).toBe(404);
    for (const patch of [{}, { owner_id: 'user-alex' }, { name: ' ' }, { sharing: 'public' }])
      expect(
        (await member.patch(`/api/v1/views/${created.body.id}`).set(csrf).send(patch)).status,
      ).toBe(400);
    await service.db.run('UPDATE memberships SET role = ? WHERE workspace_id = ? AND user_id = ?', [
      'viewer',
      demoWorkspace,
      'user-sarah',
    ]);
    expect(
      (await member.patch(`/api/v1/views/${created.body.id}`).set(csrf).send({ query: '' })).status,
    ).toBe(403);
    expect(
      (await member.post('/api/v1/views').set(csrf).send({ name: 'Viewer creation', query: '' }))
        .status,
    ).toBe(403);
    expect((await member.delete(`/api/v1/views/${created.body.id}`).set(csrf)).status).toBe(403);
    await service.db.run('UPDATE memberships SET role = ? WHERE workspace_id = ? AND user_id = ?', [
      'member',
      demoWorkspace,
      'user-sarah',
    ]);
  });
});
