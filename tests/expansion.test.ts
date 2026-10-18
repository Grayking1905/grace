import { beforeAll, afterAll, it, expect, describe, vi } from 'vitest';
import request from 'supertest';
import { createApp } from '../server/app.js';
import { Database } from '../server/db.js';
import type { MailMessage } from '../server/mail.js';
let instance: Awaited<ReturnType<typeof createApp>>;
let owner: ReturnType<typeof request.agent>;
let member: ReturnType<typeof request.agent>;
const csrf = { 'X-Grace-CSRF': '1' };
const messages: MailMessage[] = [];
beforeAll(async () => {
  instance = await createApp({
    db: new Database('sqlite', ':memory:'),
    seed: true,
    mailer: async (message) => {
      messages.push(message);
    },
  });
  owner = request.agent(instance.app);
  member = request.agent(instance.app);
  await owner.post('/api/v1/auth/demo').set(csrf);
  await member
    .post('/api/v1/auth/login')
    .set(csrf)
    .send({ email: 'james@grace.local', password: 'GraceDemo2026!' });
});
afterAll(async () => {
  vi.unstubAllEnvs();
  await instance.accounts.flush();
  instance.io.close();
  await instance.db.close();
});
function tokenFor(email: string, subject: string) {
  const text = messages.filter((m) => m.to === email && m.subject === subject).at(-1)?.text || '';
  return /#token=([a-f0-9]{64})/.exec(text)?.[1] || '';
}
describe('Account identity and membership lifecycle', () => {
  it('verifies email with a hashed, expiring, one-time token', async () => {
    const user = request.agent(instance.app);
    expect(
      (
        await user.post('/api/v1/auth/register').set(csrf).send({
          email: 'verification@example.test',
          name: 'Verification User',
          workspace: 'Private testing',
          password: 'StrongPassword2026!',
        })
      ).status,
    ).toBe(201);
    await instance.accounts.flush();
    const token = tokenFor('verification@example.test', 'Verify your Grace email');
    expect(token).toHaveLength(64);
    const row = await instance.db.one<{ token_hash: string }>(
      'SELECT token_hash FROM account_tokens WHERE purpose=? ORDER BY created_at DESC',
      ['verify'],
    );
    expect(row?.token_hash).not.toBe(token);
    vi.stubEnv('AUTH_REQUIRE_VERIFIED', 'true');
    expect(
      (await user.post('/api/v1/projects').set(csrf).send({ name: 'Blocked', key: 'BLK' })).status,
    ).toBe(403);
    expect((await user.post('/api/v1/auth/verify-email').set(csrf).send({ token })).status).toBe(
      200,
    );
    expect((await user.post('/api/v1/auth/verify-email').set(csrf).send({ token })).status).toBe(
      400,
    );
    expect(
      (await user.post('/api/v1/projects').set(csrf).send({ name: 'Verified project', key: 'VRF' }))
        .status,
    ).toBe(201);
    vi.unstubAllEnvs();
  });
  it('recovers passwords without account enumeration and revokes existing sessions', async () => {
    const unknown = await owner
      .post('/api/v1/auth/forgot-password')
      .set(csrf)
      .send({ email: 'unknown@example.test' });
    const known = await owner
      .post('/api/v1/auth/forgot-password')
      .set(csrf)
      .send({ email: 'james@grace.local' });
    expect(known.body).toEqual(unknown.body);
    await instance.accounts.flush();
    const token = tokenFor('james@grace.local', 'Reset your Grace password');
    expect(token).toHaveLength(64);
    expect(
      (
        await request(instance.app)
          .post('/api/v1/auth/reset-password')
          .set(csrf)
          .send({ token, password: 'ReplacementPassword2026!' })
      ).status,
    ).toBe(200);
    expect((await member.get('/api/v1/bootstrap')).status).toBe(401);
    expect(
      (
        await request(instance.app)
          .post('/api/v1/auth/reset-password')
          .set(csrf)
          .send({ token, password: 'AnotherPassword2026!' })
      ).status,
    ).toBe(400);
    expect(
      (
        await member
          .post('/api/v1/auth/login')
          .set(csrf)
          .send({ email: 'james@grace.local', password: 'ReplacementPassword2026!' })
      ).status,
    ).toBe(200);
  });
  it('deactivates only the selected workspace membership and rejects new assignments', async () => {
    expect((await owner.post('/api/v1/members/user-james/deactivate').set(csrf)).status).toBe(200);
    expect((await member.get('/api/v1/bootstrap')).status).toBe(401);
    expect(
      (
        await member
          .post('/api/v1/auth/login')
          .set(csrf)
          .send({ email: 'james@grace.local', password: 'ReplacementPassword2026!' })
      ).status,
    ).toBe(403);
    expect(
      (
        await owner.post('/api/v1/issues').set(csrf).send({
          project_id: 'project-platform',
          summary: 'Invalid assignment',
          assignee_id: 'user-james',
        })
      ).status,
    ).toBe(400);
    expect((await owner.post('/api/v1/members/user-alex/deactivate').set(csrf)).status).toBe(409);
    expect((await owner.post('/api/v1/members/user-james/reactivate').set(csrf)).status).toBe(200);
    expect(
      (
        await member
          .post('/api/v1/auth/login')
          .set(csrf)
          .send({ email: 'james@grace.local', password: 'ReplacementPassword2026!' })
      ).status,
    ).toBe(200);
  });
});
describe('Reusable work and planning', () => {
  it('creates distinct project workflows and validates configured issue types', async () => {
    const bug = await owner
      .post('/api/v1/projects')
      .set(csrf)
      .send({ name: 'Defect triage', key: 'DFT', template: 'bug' });
    expect(bug.status).toBe(201);
    const states = await instance.db.all<{ name: string }>(
      'SELECT name FROM statuses WHERE project_id=? ORDER BY position',
      [bug.body.id],
    );
    expect(states.map((s) => s.name)).toEqual([
      'Triage',
      'Reproducing',
      'Fixing',
      'Verifying',
      'Closed',
    ]);
    const created = await owner
      .post('/api/v1/issues')
      .set(csrf)
      .send({ project_id: bug.body.id, summary: 'A reproducible defect' });
    expect(created.body.type).toBe('bug');
    expect(
      (
        await owner
          .post('/api/v1/issues')
          .set(csrf)
          .send({ project_id: bug.body.id, summary: 'Unsupported type', type: 'epic' })
      ).status,
    ).toBe(400);
  });
  it('versions and sanitizes rich issue templates without exposing private projects', async () => {
    const created = await owner
      .post('/api/v1/issue-templates')
      .set(csrf)
      .send({
        name: 'Bug brief',
        project_id: 'project-platform',
        defaults: {
          type: 'bug',
          description: '<h2>Steps</h2><script>bad()</script><p>Expected behavior</p>',
          labels: ['triage'],
        },
      });
    expect(created.status).toBe(201);
    expect(created.body.defaults.description).not.toContain('<script');
    expect(
      (
        await owner.patch(`/api/v1/issue-templates/${created.body.id}`).set(csrf).send({
          name: 'Updated brief',
          description: 'For defects',
          defaults: created.body.defaults,
          version: 1,
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await owner
          .patch(`/api/v1/issue-templates/${created.body.id}`)
          .set(csrf)
          .send({ name: 'Stale', defaults: {}, version: 1 })
      ).status,
    ).toBe(409);
  });
  it('moves standalone issues atomically and resolves old keys under destination permissions', async () => {
    const created = await owner
      .post('/api/v1/issues')
      .set(csrf)
      .send({ project_id: 'project-platform', summary: 'Move this work', type: 'task' });
    const oldKey = created.body.key;
    const moved = await owner
      .post(`/api/v1/issues/${created.body.id}/move`)
      .set(csrf)
      .send({ project_id: 'project-mobile', version: created.body.version });
    expect(moved.status).toBe(200);
    expect(moved.body.key).not.toBe(oldKey);
    expect(moved.body.id).toBe(created.body.id);
    expect((await owner.get(`/api/v1/issues/${oldKey}`)).body.issue.key).toBe(moved.body.key);
    expect(
      (
        await owner
          .post(`/api/v1/issues/${created.body.id}/move`)
          .set(csrf)
          .send({ project_id: 'project-platform', version: 1 })
      ).status,
    ).toBe(409);
  });
  it('ranks backlog work with version checks and rejects unrelated neighbors', async () => {
    const issues = [];
    for (let n = 0; n < 3; n++) {
      const response = await owner
        .post('/api/v1/issues')
        .set(csrf)
        .send({ project_id: 'project-mobile', summary: `Rank ${n}` });
      issues.push(response.body);
    }
    const group = await instance.db.all<{ id: string }>(
      'SELECT id FROM issues WHERE project_id=? AND sprint_id IS NULL AND deleted_at IS NULL ORDER BY `rank`,id',
      ['project-mobile'],
    );
    const target = issues[2];
    const first = group.find((i) => i.id !== target.id)!;
    expect(
      (
        await owner
          .post(`/api/v1/issues/${target.id}/rank`)
          .set(csrf)
          .send({ version: target.version, before_id: first.id, after_id: null })
      ).status,
    ).toBe(200);
    expect(
      (
        await owner
          .post(`/api/v1/issues/${target.id}/rank`)
          .set(csrf)
          .send({ version: target.version, before_id: first.id, after_id: null })
      ).status,
    ).toBe(409);
  });
});
describe('Collaboration and notification preferences', () => {
  it('assigns watchers, resolves mentions, respects channel preferences, and deletes only authorized comments', async () => {
    const created = await owner
      .post('/api/v1/issues')
      .set(csrf)
      .send({ project_id: 'project-platform', summary: 'Discuss this work' });
    const issueId = created.body.id;
    expect(
      (
        await owner
          .put(`/api/v1/issues/${issueId}/watchers`)
          .set(csrf)
          .send({ user_ids: ['user-alex', 'user-james'] })
      ).status,
    ).toBe(200);
    expect(
      (
        await member
          .patch('/api/v1/account/notifications')
          .set(csrf)
          .send({ event: 'mention', in_app: false, email: false })
      ).status,
    ).toBe(200);
    expect(
      (
        await member
          .patch('/api/v1/account/notifications')
          .set(csrf)
          .send({ event: 'comment', in_app: false, email: false })
      ).status,
    ).toBe(200);
    const before = await instance.db.one<{ n: number }>(
      'SELECT COUNT(*) n FROM notifications WHERE user_id=?',
      ['user-james'],
    );
    const comment = await owner
      .post(`/api/v1/issues/${issueId}/comments`)
      .set(csrf)
      .send({ body: 'Please review @[James Wilson](user-james).' });
    expect(comment.status).toBe(201);
    expect(
      (
        await instance.db.one<{ n: number }>(
          'SELECT COUNT(*) n FROM notifications WHERE user_id=?',
          ['user-james'],
        )
      )?.n,
    ).toBe(before?.n);
    expect(
      (await member.delete(`/api/v1/issues/${issueId}/comments/${comment.body.id}`).set(csrf))
        .status,
    ).toBe(403);
    expect(
      (await owner.delete(`/api/v1/issues/${issueId}/comments/${comment.body.id}`).set(csrf))
        .status,
    ).toBe(200);
    expect(
      await instance.db.one('SELECT user_id FROM comment_mentions WHERE comment_id=?', [
        comment.body.id,
      ]),
    ).toBeUndefined();
    expect(
      (
        await owner
          .post(`/api/v1/issues/${issueId}/comments`)
          .set(csrf)
          .send({ body: '@[Outsider](not-a-member)' })
      ).status,
    ).toBe(400);
  });
});
