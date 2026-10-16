import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import request from 'supertest';
import { Database } from '../server/db.js';
import { createApp } from '../server/app.js';
import { id, now, demoWorkspace, demoUser } from '../server/seed.js';

let app: Awaited<ReturnType<typeof createApp>>;
let owner: ReturnType<typeof request.agent>;
let outsider: ReturnType<typeof request.agent>;
const csrf = { 'X-Grace-CSRF': '1' };
let createdId: string;
beforeAll(async () => {
  app = await createApp({ db: new Database('sqlite', ':memory:'), seed: true });
  owner = request.agent(app.app);
  outsider = request.agent(app.app);
  expect((await owner.post('/api/v1/auth/demo').set(csrf)).status).toBe(200);
  expect(
    (
      await outsider.post('/api/v1/auth/register').set(csrf).send({
        email: 'other@example.test',
        password: 'LongPassword123!',
        name: 'Other Person',
        workspace: 'Separate workspace',
      })
    ).status,
  ).toBe(201);
});
afterAll(async () => {
  app.io.close();
  await app.db.close();
});
describe('Authentication and tenant boundaries', () => {
  it('does not HTTP-cache authenticated workspace or aggregate issue data', async () => {
    const response = await owner.get('/api/v1/issues/issue-0-0');
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.headers.etag).toBeUndefined();
    expect(response.headers['x-resource-version']).toBe('1');
  });
  it('requires authentication', async () => {
    expect((await request(app.app).get('/api/v1/bootstrap')).status).toBe(401);
  });
  it('requires a CSRF header and rejects foreign origins', async () => {
    expect((await owner.post('/api/v1/issues').send({})).status).toBe(403);
    expect(
      (
        await owner
          .post('/api/v1/issues')
          .set(csrf)
          .set('Origin', 'https://untrusted.example')
          .send({})
      ).status,
    ).toBe(403);
  });
  it('starts a new account with a separate empty workspace', async () => {
    const response = await outsider.get('/api/v1/bootstrap');
    expect(response.status).toBe(200);
    expect(response.body.issues).toHaveLength(0);
    expect(response.body.members).toHaveLength(1);
    expect(response.body.workspace.id).not.toBe(demoWorkspace);
  });
  it('does not expose another workspace’s issues or projects', async () => {
    expect((await outsider.get('/api/v1/issues/issue-0-0')).status).toBe(404);
    expect(
      (
        await outsider
          .post('/api/v1/issues')
          .set(csrf)
          .send({ project_id: 'project-platform', summary: 'Tenant escape' })
      ).status,
    ).toBe(404);
  });
  it('enforces viewer permissions at the API', async () => {
    await app.db.run('UPDATE memberships SET role = ? WHERE workspace_id = ? AND user_id = ?', [
      'viewer',
      demoWorkspace,
      'user-sarah',
    ]);
    const viewer = request.agent(app.app);
    await viewer
      .post('/api/v1/auth/login')
      .set(csrf)
      .send({ email: 'sarah@grace.local', password: 'GraceDemo2026!' });
    expect(
      (
        await viewer
          .post('/api/v1/issues')
          .set(csrf)
          .send({ project_id: 'project-platform', summary: 'Forbidden' })
      ).status,
    ).toBe(403);
    expect(
      (
        await viewer
          .patch('/api/v1/issues/issue-0-0')
          .set(csrf)
          .send({ summary: 'Forbidden', version: 1 })
      ).status,
    ).toBe(403);
    expect((await viewer.get('/api/v1/bootstrap')).status).toBe(200);
    await app.db.run('UPDATE memberships SET role = ? WHERE workspace_id = ? AND user_id = ?', [
      'member',
      demoWorkspace,
      'user-sarah',
    ]);
  });
  it('hides private projects and their pages, issues, and activity from nonmembers', async () => {
    const created = await owner
      .post('/api/v1/projects')
      .set(csrf)
      .send({ name: 'Private initiative', key: 'PVT', visibility: 'private' });
    await owner
      .post('/api/v1/issues')
      .set(csrf)
      .send({ project_id: created.body.id, summary: 'Private work' });
    await owner
      .post('/api/v1/pages')
      .set(csrf)
      .send({ project_id: created.body.id, title: 'Private page' });
    const member = request.agent(app.app);
    await member
      .post('/api/v1/auth/login')
      .set(csrf)
      .send({ email: 'sarah@grace.local', password: 'GraceDemo2026!' });
    const bootstrap = await member.get('/api/v1/bootstrap');
    expect(bootstrap.body.projects.some((p: { id: string }) => p.id === created.body.id)).toBe(
      false,
    );
    expect(
      bootstrap.body.issues.some((i: { summary: string }) => i.summary === 'Private work'),
    ).toBe(false);
    expect(bootstrap.body.pages.some((p: { title: string }) => p.title === 'Private page')).toBe(
      false,
    );
  });
  it('rotates refresh tokens and invalidates access after logout', async () => {
    const session = request.agent(app.app);
    const login = await session.post('/api/v1/auth/demo').set(csrf);
    const oldRefresh = (login.headers['set-cookie'] as unknown as string[])
      .find((c) => c.startsWith('grace_refresh='))!
      .split(';')[0];
    expect((await session.post('/api/v1/auth/refresh').set(csrf)).status).toBe(200);
    expect(
      (await request(app.app).post('/api/v1/auth/refresh').set(csrf).set('Cookie', oldRefresh))
        .status,
    ).toBe(401);
    await session.post('/api/v1/auth/logout').set(csrf);
    expect((await session.get('/api/v1/bootstrap')).status).toBe(401);
  });
});
describe('Issues and concurrency', () => {
  it('creates sequential immutable keys and persists rich text safely', async () => {
    const result = await owner.post('/api/v1/issues').set(csrf).send({
      project_id: 'project-platform',
      summary: 'Integration test issue',
      description: '<p>Safe text</p><script>alert(1)</script><img src=x onerror=alert(1)>',
    });
    expect(result.status).toBe(201);
    createdId = result.body.id;
    expect(result.body.key).toBe('GRC-13');
    expect(result.body.description).toBe('<p>Safe text</p>');
    expect((await owner.get(`/api/v1/issues/${createdId}`)).body.issue.summary).toBe(
      'Integration test issue',
    );
  });
  it('allocates unique issue keys during concurrent creates', async () => {
    const responses = await Promise.all(
      Array.from({ length: 8 }, (_, i) =>
        owner
          .post('/api/v1/issues')
          .set(csrf)
          .send({ project_id: 'project-platform', summary: `Concurrent ${i}` }),
      ),
    );
    expect(responses.every((r) => r.status === 201)).toBe(true);
    expect(new Set(responses.map((r) => r.body.key)).size).toBe(8);
  });
  it('rejects cross-project statuses and cross-tenant assignees', async () => {
    const status = await app.db.one<{ id: string }>(
      'SELECT id FROM statuses WHERE project_id = ?',
      ['project-mobile'],
    );
    const external = (await outsider.get('/api/v1/auth/me')).body.id;
    expect(
      (
        await owner
          .patch(`/api/v1/issues/${createdId}`)
          .set(csrf)
          .send({ version: 1, status_id: status!.id })
      ).status,
    ).toBe(400);
    expect(
      (
        await owner
          .patch(`/api/v1/issues/${createdId}`)
          .set(csrf)
          .send({ version: 1, assignee_id: external })
      ).status,
    ).toBe(400);
  });
  it('applies one concurrent update and rejects a stale edit without changing history', async () => {
    const responses = await Promise.all(
      ['First update', 'Second update'].map((summary) =>
        owner.patch(`/api/v1/issues/${createdId}`).set(csrf).send({ version: 1, summary }),
      ),
    );
    expect(responses.map((r) => r.status).sort()).toEqual([200, 409]);
    const detail = await owner.get(`/api/v1/issues/${createdId}`);
    expect(detail.body.issue.version).toBe(2);
    expect(
      detail.body.history.filter((h: { field: string }) => h.field === 'summary'),
    ).toHaveLength(1);
  });
  it('persists comments, auto-watches, and logs time', async () => {
    expect(
      (
        await owner
          .post(`/api/v1/issues/${createdId}/comments`)
          .set(csrf)
          .send({ body: 'A useful update.' })
      ).status,
    ).toBe(201);
    expect(
      (
        await owner
          .post(`/api/v1/issues/${createdId}/worklogs`)
          .set(csrf)
          .send({ minutes: 30, note: 'API validation' })
      ).status,
    ).toBe(201);
    const detail = await owner.get(`/api/v1/issues/${createdId}`);
    expect(detail.body.comments).toHaveLength(1);
    expect(detail.body.worklogs[0].minutes).toBe(30);
    expect(detail.body.watchers).toContain(demoUser);
  });
  it('changes one field without resetting unspecified issue properties', async () => {
    const created = await owner
      .post('/api/v1/issues')
      .set(csrf)
      .send({
        project_id: 'project-platform',
        summary: 'Preserve partial updates',
        description: '<p>Keep this context</p>',
        type: 'story',
        priority: 'high',
        assignee_id: demoUser,
        sprint_id: 'sprint-0-current',
        story_points: 8,
        labels: ['Keep me'],
        flagged: 1,
        due_date: '2026-11-01',
        start_date: '2026-10-15',
      });
    const target = await app.db.one<{ id: string }>(
      'SELECT id FROM statuses WHERE project_id = ? AND category = ?',
      ['project-platform', 'done'],
    );
    const changed = await owner
      .patch(`/api/v1/issues/${created.body.id}`)
      .set(csrf)
      .send({ status_id: target!.id, version: 1 });
    expect(changed.status).toBe(200);
    for (const field of [
      'summary',
      'description',
      'type',
      'priority',
      'assignee_id',
      'sprint_id',
      'story_points',
      'labels',
      'flagged',
      'due_date',
      'start_date',
    ])
      expect(changed.body[field]).toEqual(created.body[field]);
    expect(changed.body.status_id).toBe(target!.id);
    expect(changed.body.version).toBe(2);
  });
  it('soft-deletes and restores an issue', async () => {
    expect((await owner.delete(`/api/v1/issues/${createdId}`).set(csrf)).status).toBe(200);
    expect((await owner.get(`/api/v1/issues/${createdId}`)).status).toBe(404);
    expect((await owner.post(`/api/v1/issues/${createdId}/restore`).set(csrf)).status).toBe(200);
    expect((await owner.get(`/api/v1/issues/${createdId}`)).status).toBe(200);
  });
  it('rejects invalid issue hierarchies', async () => {
    const parent = await owner
      .post('/api/v1/issues')
      .set(csrf)
      .send({ project_id: 'project-platform', summary: 'Epic', type: 'epic' });
    expect(
      (
        await owner.post('/api/v1/issues').set(csrf).send({
          project_id: 'project-platform',
          summary: 'Invalid subtask',
          type: 'subtask',
          parent_id: parent.body.id,
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await owner.post('/api/v1/issues').set(csrf).send({
          project_id: 'project-platform',
          summary: 'Valid story',
          type: 'story',
          parent_id: parent.body.id,
        })
      ).status,
    ).toBe(201);
  });
});
describe('Planning, queries, imports and documents', () => {
  it('creates an email-bound invitation and lets a new account join the existing workspace', async () => {
    const invited = await owner
      .post('/api/v1/invites')
      .set(csrf)
      .send({ email: 'invited@example.test', role: 'viewer' });
    expect(invited.status).toBe(201);
    const token = new URL(invited.body.url).searchParams.get('token');
    const info = await request(app.app).get(`/api/v1/auth/invite?token=${token}`);
    expect(info.body.email).toBe('invited@example.test');
    const bad = await request(app.app).post('/api/v1/auth/register').set(csrf).send({
      email: 'wrong@example.test',
      password: 'LongPassword123!',
      name: 'Wrong Person',
      invite_token: token,
    });
    expect(bad.status).toBe(400);
    const joined = request.agent(app.app);
    const response = await joined.post('/api/v1/auth/register').set(csrf).send({
      email: 'invited@example.test',
      password: 'LongPassword123!',
      name: 'Invited Person',
      invite_token: token,
    });
    expect(response.status).toBe(201);
    const bootstrap = await joined.get('/api/v1/bootstrap');
    expect(bootstrap.body.workspace.id).toBe(demoWorkspace);
    expect(bootstrap.body.user.role).toBe('viewer');
    expect((await request(app.app).get(`/api/v1/auth/invite?token=${token}`)).status).toBe(404);
  });
  it('allows an existing invited user to accept and switch workspaces', async () => {
    const invited = await owner
      .post('/api/v1/invites')
      .set(csrf)
      .send({ email: 'other@example.test', role: 'member' });
    const token = new URL(invited.body.url).searchParams.get('token');
    expect((await outsider.post('/api/v1/invites/accept').set(csrf).send({ token })).status).toBe(
      200,
    );
    expect((await outsider.get('/api/v1/bootstrap')).body.workspace.id).toBe(demoWorkspace);
  });
  it('rejects a second active sprint and records carry-over on completion', async () => {
    const planned = await owner.post('/api/v1/sprints').set(csrf).send({
      project_id: 'project-platform',
      name: 'Next sprint',
      start_date: '2026-10-20',
      end_date: '2026-11-03',
    });
    expect((await owner.post(`/api/v1/sprints/${planned.body.id}/start`).set(csrf)).status).toBe(
      409,
    );
    expect(
      (
        await owner
          .post('/api/v1/sprints/sprint-0-current/complete')
          .set(csrf)
          .send({ destination_id: planned.body.id })
      ).status,
    ).toBe(200);
    const items = await app.db.all<{ carry_over: number; sprint_id: string }>(
      'SELECT carry_over,sprint_id FROM issues WHERE sprint_id = ?',
      [planned.body.id],
    );
    expect(items.length).toBeGreaterThan(0);
    expect(items.every((i) => i.carry_over === 1)).toBe(true);
    expect((await owner.post(`/api/v1/sprints/${planned.body.id}/start`).set(csrf)).status).toBe(
      200,
    );
  });
  it('parses nested GQL, currentUser, lists, and sorting without evaluating code', async () => {
    const response = await owner.post('/api/v1/search/gql').set(csrf).send({
      query:
        "project = GRC AND (priority in ('high','critical') OR assignee = currentUser()) ORDER BY points DESC",
    });
    expect(response.status).toBe(200);
    expect(response.body.length).toBeGreaterThan(0);
    expect(response.body.every((i: IssueShape) => i.project_id === 'project-platform')).toBe(true);
    expect(
      (
        await owner
          .post('/api/v1/search/gql')
          .set(csrf)
          .send({ query: 'project = GRC; DROP TABLE issues' })
      ).status,
    ).toBe(400);
    expect(
      (await owner.post('/api/v1/search/gql').set(csrf).send({ query: 'mystery = 4' })).status,
    ).toBe(400);
  });
  it('previews Jira import without writing, then imports atomically', async () => {
    const before = await app.db.one<{ total: number }>('SELECT COUNT(*) as total FROM issues');
    const body = {
      project_id: 'project-platform',
      format: 'csv',
      content:
        'Issue key,Summary,Status,Issue Type,Priority,Story Points\r\nOLD-1,Imported issue,Done,Bug,High,3',
    };
    const preview = await owner.post('/api/v1/import/jira').set(csrf).send(body);
    expect(preview.status).toBe(200);
    expect(preview.body.rows[0].sourceKey).toBe('OLD-1');
    expect(
      (await app.db.one<{ total: number }>('SELECT COUNT(*) as total FROM issues'))!.total,
    ).toBe(before!.total);
    const imported = await owner
      .post('/api/v1/import/jira')
      .set(csrf)
      .send({ ...body, confirm: true });
    expect(imported.body.imported).toBe(1);
    expect(
      (await app.db.one<{ total: number }>('SELECT COUNT(*) as total FROM issues'))!.total,
    ).toBe(before!.total + 1);
  });
  it('rejects invalid imports without partial writes', async () => {
    const before = await app.db.one<{ total: number }>('SELECT COUNT(*) as total FROM issues');
    const result = await owner.post('/api/v1/import/jira').set(csrf).send({
      project_id: 'project-platform',
      format: 'csv',
      content: 'Summary\nValid issue\n""',
      confirm: true,
    });
    expect(result.status).toBe(400);
    expect(
      (await app.db.one<{ total: number }>('SELECT COUNT(*) as total FROM issues'))!.total,
    ).toBe(before!.total);
  });
  it('keeps page versions and rejects stale page updates', async () => {
    const created = await owner.post('/api/v1/pages').set(csrf).send({ title: 'Test page' });
    const pageId = created.body.id;
    expect(
      (
        await owner.patch(`/api/v1/pages/${pageId}`).set(csrf).send({
          title: 'Updated',
          content: '<p>Saved</p><script>bad()</script>',
          version: 1,
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await owner
          .patch(`/api/v1/pages/${pageId}`)
          .set(csrf)
          .send({ title: 'Stale', content: '<p>Wrong</p>', version: 1 })
      ).status,
    ).toBe(409);
    const versions = await owner.get(`/api/v1/pages/${pageId}/versions`);
    expect(versions.body).toHaveLength(1);
    expect(versions.body[0].title).toBe('Test page');
    const current = await app.db.one<{ content: string }>(
      'SELECT content FROM pages WHERE id = ?',
      [pageId],
    );
    expect(current!.content).toBe('<p>Saved</p>');
  });
});
type IssueShape = { project_id: string };
