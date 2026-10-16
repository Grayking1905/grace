import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../server/app.js';
import { Database } from '../server/db.js';
import { applyPlanningMigrations } from '../server/migrations.js';
import { demoWorkspace, id } from '../server/seed.js';
import type { Issue, Status } from '../shared/types.js';
import type { ProjectModule, SprintAnalytics } from '../shared/planning.js';

let app: Awaited<ReturnType<typeof createApp>>;
let owner: ReturnType<typeof request.agent>;
let member: ReturnType<typeof request.agent>;
let outsider: ReturnType<typeof request.agent>;
const csrf = { 'X-Grace-CSRF': '1' };
let projectId: string;
let todo: Status;
let done: Status;

async function createIssue(summary: string, extra: Record<string, unknown> = {}) {
  const response = await owner
    .post('/api/v1/issues')
    .set(csrf)
    .send({ project_id: projectId, summary, ...extra });
  expect(response.status).toBe(201);
  return response.body as Issue;
}
async function detail(issueId: string) {
  const response = await owner.get(`/api/v1/issues/${issueId}`);
  expect(response.status).toBe(200);
  return response.body;
}
const dateAt = (offset: number) =>
  new Date(Date.now() + offset * 86400000).toISOString().slice(0, 10);

beforeAll(async () => {
  app = await createApp({ db: new Database('sqlite', ':memory:'), seed: true });
  owner = request.agent(app.app);
  member = request.agent(app.app);
  outsider = request.agent(app.app);
  expect((await owner.post('/api/v1/auth/demo').set(csrf)).status).toBe(200);
  expect(
    (
      await member
        .post('/api/v1/auth/login')
        .set(csrf)
        .send({ email: 'sarah@grace.local', password: 'GraceDemo2026!' })
    ).status,
  ).toBe(200);
  expect(
    (
      await outsider.post('/api/v1/auth/register').set(csrf).send({
        email: 'planning-outsider@example.test',
        password: 'LongPassword123!',
        name: 'Other Workspace',
        workspace: 'Another tenant',
      })
    ).status,
  ).toBe(201);
  const created = await owner
    .post('/api/v1/projects')
    .set(csrf)
    .send({ name: 'Planning tests', key: 'PLAN' });
  expect(created.status).toBe(201);
  projectId = created.body.id;
  const statuses = await app.db.all<Status>(
    'SELECT * FROM statuses WHERE project_id = ? ORDER BY position',
    [projectId],
  );
  todo = statuses.find((status) => status.category === 'todo')!;
  done = statuses.find((status) => status.category === 'done')!;
});

afterAll(async () => {
  app.io.close();
  await app.db.close();
});

describe('Project modules', () => {
  it('persists many-to-many issue membership, computes progress, and preserves omitted fields', async () => {
    const first = await createIssue('Module unfinished', { story_points: 5, labels: ['release'] });
    const second = await createIssue('Module finished', { status_id: done.id, story_points: 3 });
    const created = await owner
      .post('/api/v1/modules')
      .set(csrf)
      .send({
        project_id: projectId,
        name: 'Release preparation',
        description: 'Own the complete release',
        lead_id: 'user-sarah',
        start_date: dateAt(0),
        end_date: dateAt(7),
        issue_ids: [first.id, second.id],
      });
    expect(created.status).toBe(201);
    const module = created.body as ProjectModule;
    expect(module).toMatchObject({
      total_issues: 2,
      completed_issues: 1,
      total_points: 8,
      completed_points: 3,
      progress: 50,
      version: 1,
    });
    const secondModule = await owner
      .post('/api/v1/modules')
      .set(csrf)
      .send({ project_id: projectId, name: 'QA track', issue_ids: [first.id] });
    expect(secondModule.status).toBe(201);
    expect((await owner.get(`/api/v1/modules/${secondModule.body.id}`)).body.issues[0].id).toBe(
      first.id,
    );
    const edited = await owner
      .patch(`/api/v1/modules/${module.id}`)
      .set(csrf)
      .send({ version: 1, name: 'Ship confidently' });
    expect(edited.status).toBe(200);
    expect(edited.body).toMatchObject({
      name: 'Ship confidently',
      description: 'Own the complete release',
      lead_id: 'user-sarah',
      start_date: dateAt(0),
      total_issues: 2,
      version: 2,
    });
    expect(new Set(edited.body.issue_ids)).toEqual(new Set([first.id, second.id]));
    expect(
      (
        await owner
          .patch(`/api/v1/modules/${module.id}`)
          .set(csrf)
          .send({ version: 1, name: 'Stale overwrite' })
      ).status,
    ).toBe(409);
    expect(
      (
        await owner
          .patch(`/api/v1/modules/${module.id}`)
          .set(csrf)
          .send({ version: 2, state: 'completed' })
      ).status,
    ).toBe(400);
    expect(
      (
        await owner
          .patch(`/api/v1/issues/${first.id}`)
          .set(csrf)
          .send({ version: first.version, status_id: done.id })
      ).status,
    ).toBe(200);
    const completed = await owner
      .patch(`/api/v1/modules/${module.id}`)
      .set(csrf)
      .send({ version: 2, state: 'completed' });
    expect(completed.status).toBe(200);
    expect(completed.body).toMatchObject({
      progress: 100,
      completed_issues: 2,
      state: 'completed',
    });
    const archived = await owner
      .delete(`/api/v1/modules/${module.id}`)
      .set(csrf)
      .send({ version: 3 });
    expect(archived.status).toBe(200);
    expect(archived.body.archived_at).toBeTruthy();
    expect(
      (await owner.get(`/api/v1/modules?project_id=${projectId}`)).body.some(
        (item: ProjectModule) => item.id === module.id,
      ),
    ).toBe(false);
    expect(
      (await owner.get(`/api/v1/modules?project_id=${projectId}&include_archived=true`)).body.some(
        (item: ProjectModule) => item.id === module.id,
      ),
    ).toBe(true);
    expect(
      (
        await owner
          .patch(`/api/v1/modules/${module.id}`)
          .set(csrf)
          .send({ version: 4, archived: false })
      ).status,
    ).toBe(200);
  });

  it('rejects wrong-project membership, invalid dates and foreign leads without partial data', async () => {
    const other = await owner
      .post('/api/v1/issues')
      .set(csrf)
      .send({ project_id: 'project-mobile', summary: 'Different module project' });
    const existing = (await owner.get(`/api/v1/modules?project_id=${projectId}`)).body.length;
    for (const fields of [
      { issue_ids: [other.body.id] },
      { start_date: dateAt(5), end_date: dateAt(0) },
      { lead_id: (await outsider.get('/api/v1/auth/me')).body.id },
    ]) {
      expect(
        (
          await owner
            .post('/api/v1/modules')
            .set(csrf)
            .send({ project_id: projectId, name: 'Invalid module', ...fields })
        ).status,
      ).toBe(400);
    }
    expect((await owner.get(`/api/v1/modules?project_id=${projectId}`)).body).toHaveLength(
      existing,
    );
  });

  it('enforces private project visibility and viewer permissions for every module route', async () => {
    const privateProject = await owner
      .post('/api/v1/projects')
      .set(csrf)
      .send({ name: 'Private modules', key: 'PMOD', visibility: 'private' });
    const created = await owner
      .post('/api/v1/modules')
      .set(csrf)
      .send({ project_id: privateProject.body.id, name: 'Private initiative' });
    expect(created.status).toBe(201);
    expect((await outsider.get(`/api/v1/modules/${created.body.id}`)).status).toBe(404);
    expect((await member.get(`/api/v1/modules/${created.body.id}`)).status).toBe(404);
    expect(
      (await member.get('/api/v1/modules?include_archived=true')).body.some(
        (item: ProjectModule) => item.id === created.body.id,
      ),
    ).toBe(false);
    await app.db.run('UPDATE memberships SET role = ? WHERE workspace_id = ? AND user_id = ?', [
      'viewer',
      demoWorkspace,
      'user-sarah',
    ]);
    try {
      expect(
        (
          await member
            .post('/api/v1/modules')
            .set(csrf)
            .send({ project_id: projectId, name: 'Viewer edit' })
        ).status,
      ).toBe(403);
    } finally {
      await app.db.run('UPDATE memberships SET role = ? WHERE workspace_id = ? AND user_id = ?', [
        'member',
        demoWorkspace,
        'user-sarah',
      ]);
    }
  });
});

describe('Transactional bulk work item updates', () => {
  it('accepts one competing batch and rejects the stale batch without mixing their values', async () => {
    const first = await createIssue('Concurrent batch first');
    const second = await createIssue('Concurrent batch second');
    const responses = await Promise.all(
      ['high', 'critical'].map((priority) =>
        owner
          .post('/api/v1/issues/bulk')
          .set(csrf)
          .send({
            items: [
              { id: first.id, version: 1 },
              { id: second.id, version: 1 },
            ],
            changes: { priority },
          }),
      ),
    );
    expect(responses.map((response) => response.status).sort()).toEqual([200, 409]);
    const [firstDetail, secondDetail] = await Promise.all([detail(first.id), detail(second.id)]);
    expect(firstDetail.issue.version).toBe(2);
    expect(secondDetail.issue.version).toBe(2);
    expect(firstDetail.issue.priority).toBe(secondDetail.issue.priority);
    expect(
      firstDetail.history.filter((entry: { field: string }) => entry.field === 'priority'),
    ).toHaveLength(1);
    expect(
      secondDetail.history.filter((entry: { field: string }) => entry.field === 'priority'),
    ).toHaveLength(1);
  });

  it('updates requested fields and history while preserving every unspecified field', async () => {
    const first = await createIssue('Bulk first', {
      description: '<p>Keep this description</p>',
      assignee_id: 'user-james',
      labels: ['existing'],
      story_points: 8,
      flagged: 1,
      due_date: dateAt(5),
    });
    const second = await createIssue('Bulk second', { story_points: 3 });
    const updated = await owner
      .post('/api/v1/issues/bulk')
      .set(csrf)
      .send({
        items: [
          { id: first.id, version: first.version },
          { id: second.id, version: second.version },
        ],
        changes: { priority: 'high' },
      });
    expect(updated.status).toBe(200);
    expect(updated.body.issues).toHaveLength(2);
    const read = await detail(first.id);
    expect(read.issue).toMatchObject({
      summary: first.summary,
      description: first.description,
      assignee_id: 'user-james',
      labels: ['existing'],
      story_points: 8,
      flagged: 1,
      due_date: first.due_date,
      priority: 'high',
      version: 2,
    });
    expect(
      read.history.filter((history: { field: string }) => history.field === 'priority'),
    ).toHaveLength(1);
    const assigned = await owner
      .post('/api/v1/issues/bulk')
      .set(csrf)
      .send({
        items: [{ id: first.id, version: 2 }],
        changes: { assignee_id: null, labels: ['launch'] },
      });
    expect(assigned.status).toBe(200);
    expect(assigned.body.issues[0]).toMatchObject({
      assignee_id: null,
      labels: ['launch'],
      story_points: 8,
    });
  });

  it('rolls back the entire batch on a late version conflict or invalid relation', async () => {
    const first = await createIssue('Atomic first');
    const second = await createIssue('Atomic second');
    for (const invalid of [
      {
        items: [
          { id: first.id, version: 1 },
          { id: second.id, version: 99 },
        ],
        changes: { priority: 'critical' },
      },
      {
        items: [
          { id: first.id, version: 1 },
          { id: second.id, version: 1 },
        ],
        changes: { sprint_id: 'not-a-sprint' },
      },
      {
        items: [
          { id: first.id, version: 1 },
          { id: first.key, version: 1 },
        ],
        changes: { priority: 'critical' },
      },
    ]) {
      const response = await owner.post('/api/v1/issues/bulk').set(csrf).send(invalid);
      expect([400, 409]).toContain(response.status);
      expect((await detail(first.id)).issue).toMatchObject({
        priority: 'medium',
        version: 1,
        sprint_id: null,
      });
      expect((await detail(first.id)).history).toHaveLength(1);
    }
    const differentStatus = await app.db.one<Status>(
      'SELECT * FROM statuses WHERE project_id = ? LIMIT 1',
      ['project-mobile'],
    );
    expect(
      (
        await owner
          .post('/api/v1/issues/bulk')
          .set(csrf)
          .send({
            items: [{ id: first.id, version: 1 }],
            changes: { status_id: differentStatus!.id },
          })
      ).status,
    ).toBe(400);
    expect(
      (
        await owner
          .post('/api/v1/issues/bulk')
          .set(csrf)
          .send({ items: [{ id: first.id, version: 1 }], changes: {} })
      ).status,
    ).toBe(400);
  });

  it('checks every selected issue’s project permissions and never mutates an earlier issue', async () => {
    const first = await createIssue('Accessible before denied');
    const privateProject = await owner
      .post('/api/v1/projects')
      .set(csrf)
      .send({ name: 'Private bulk project', key: 'BPRV', visibility: 'private' });
    const hidden = await owner
      .post('/api/v1/issues')
      .set(csrf)
      .send({ project_id: privateProject.body.id, summary: 'Hidden issue' });
    const batch = await member
      .post('/api/v1/issues/bulk')
      .set(csrf)
      .send({
        items: [
          { id: first.id, version: 1 },
          { id: hidden.body.id, version: 1 },
        ],
        changes: { priority: 'critical' },
      });
    expect(batch.status).toBe(404);
    expect((await detail(first.id)).issue).toMatchObject({ priority: 'medium', version: 1 });
    expect(
      (
        await outsider
          .post('/api/v1/issues/bulk')
          .set(csrf)
          .send({ items: [{ id: first.id, version: 1 }], changes: { priority: 'high' } })
      ).status,
    ).toBe(404);
    await app.db.insert('project_members', {
      workspace_id: demoWorkspace,
      project_id: projectId,
      user_id: 'user-sarah',
      role: 'viewer',
    });
    try {
      expect(
        (
          await member
            .post('/api/v1/issues/bulk')
            .set(csrf)
            .send({ items: [{ id: first.id, version: 1 }], changes: { priority: 'high' } })
        ).status,
      ).toBe(403);
    } finally {
      await app.db.run('DELETE FROM project_members WHERE project_id = ? AND user_id = ?', [
        projectId,
        'user-sarah',
      ]);
    }
  });

  it('soft deletes with version checks and retains audit history for recovery', async () => {
    const first = await createIssue('Bulk deleted first');
    const second = await createIssue('Bulk deleted second');
    const deleted = await owner
      .post('/api/v1/issues/bulk')
      .set(csrf)
      .send({
        items: [
          { id: first.id, version: 1 },
          { id: second.id, version: 1 },
        ],
        changes: { deleted: true },
      });
    expect(deleted.status).toBe(200);
    expect(deleted.body.issues).toEqual([]);
    expect(new Set(deleted.body.deleted_ids)).toEqual(new Set([first.id, second.id]));
    expect((await owner.get(`/api/v1/issues/${first.id}`)).status).toBe(404);
    expect(
      await app.db.one('SELECT id FROM history WHERE issue_id = ? AND field = ?', [
        first.id,
        'deleted_at',
      ]),
    ).toBeTruthy();
    expect((await owner.post(`/api/v1/issues/${first.id}/restore`).set(csrf)).status).toBe(200);
    expect((await detail(first.id)).issue.deleted_at).toBeNull();
  });
});

describe('Recorded sprint analytics and additive migrations', () => {
  it('serializes competing cycle starts and preserves one active cycle per project', async () => {
    const cycles = await Promise.all(
      ['Concurrent cycle A', 'Concurrent cycle B'].map((name) =>
        owner
          .post('/api/v1/sprints')
          .set(csrf)
          .send({ project_id: projectId, name, start_date: dateAt(0), end_date: dateAt(7) }),
      ),
    );
    const attempts = await Promise.all(
      cycles.map((cycle) => owner.post(`/api/v1/sprints/${cycle.body.id}/start`).set(csrf)),
    );
    expect(attempts.map((response) => response.status).sort()).toEqual([200, 409]);
    const active = await app.db.all<{ id: string }>(
      'SELECT id FROM sprints WHERE project_id = ? AND state = ?',
      [projectId, 'active'],
    );
    expect(active).toHaveLength(1);
    expect((await owner.post(`/api/v1/sprints/${active[0].id}/complete`).set(csrf)).status).toBe(
      200,
    );
  });

  it('freezes final cycle scope before carryover and later edits', async () => {
    const cycle = await owner
      .post('/api/v1/sprints')
      .set(csrf)
      .send({
        project_id: projectId,
        name: 'Final scope snapshot',
        start_date: dateAt(0),
        end_date: dateAt(7),
      });
    const destination = await owner
      .post('/api/v1/sprints')
      .set(csrf)
      .send({
        project_id: projectId,
        name: 'Carryover destination',
        start_date: dateAt(8),
        end_date: dateAt(14),
      });
    const unfinished = await createIssue('Carry this unfinished work', {
      sprint_id: cycle.body.id,
      story_points: 5,
    });
    const finished = await createIssue('Completed before closing', {
      sprint_id: cycle.body.id,
      status_id: done.id,
      story_points: 3,
    });
    expect((await owner.post(`/api/v1/sprints/${cycle.body.id}/start`).set(csrf)).status).toBe(200);
    expect(
      (
        await owner
          .post(`/api/v1/sprints/${cycle.body.id}/complete`)
          .set(csrf)
          .send({ destination_id: destination.body.id })
      ).status,
    ).toBe(200);
    const read = await owner.get(`/api/v1/sprints/${cycle.body.id}/analytics`);
    expect(read.status).toBe(200);
    const snapshot = read.body as SprintAnalytics;
    expect(snapshot.summary_basis).toBe('completion_snapshot');
    expect(snapshot.summary).toMatchObject({
      total_issues: 2,
      completed_issues: 1,
      total_points: 8,
      completed_points: 3,
      remaining_points: 5,
      completion_percent: 50,
    });
    expect(snapshot.burndown.find((day) => day.date === dateAt(0))).toMatchObject({
      scope_points: 8,
      remaining_points: 5,
      completed_points: 3,
      remaining_issues: 1,
    });
    expect(
      snapshot.scope_events.some(
        (event) => event.issue_id === unfinished.id && event.type === 'removed',
      ),
    ).toBe(false);
    expect((await detail(unfinished.id)).issue).toMatchObject({
      sprint_id: destination.body.id,
      carry_over: 1,
    });
    // Work can continue in the next cycle without rewriting a completed cycle's report.
    expect(
      (
        await owner
          .patch(`/api/v1/issues/${unfinished.id}`)
          .set(csrf)
          .send({ version: 2, story_points: 13, status_id: done.id })
      ).status,
    ).toBe(200);
    expect(
      (
        await owner
          .patch(`/api/v1/issues/${finished.id}`)
          .set(csrf)
          .send({ version: 1, summary: 'Clarified after closing', story_points: 21 })
      ).status,
    ).toBe(200);
    const after = await owner.get(`/api/v1/sprints/${cycle.body.id}/analytics`);
    expect(after.body.summary).toEqual(snapshot.summary);
    expect(after.body.burndown.find((day: { date: string }) => day.date === dateAt(0))).toEqual(
      snapshot.burndown.find((day) => day.date === dateAt(0)),
    );
    expect(
      await app.db.all('SELECT phase FROM sprint_snapshots WHERE sprint_id = ?', [cycle.body.id]),
    ).toHaveLength(2);
  });

  it('protects closed source cycles consistently across bulk updates while allowing non-scope edits', async () => {
    const closedCycle = await owner
      .post('/api/v1/sprints')
      .set(csrf)
      .send({
        project_id: projectId,
        name: 'Closed bulk source',
        start_date: dateAt(-5),
        end_date: dateAt(-1),
      });
    const closedIssue = await createIssue('Preserve completed cycle membership', {
      sprint_id: closedCycle.body.id,
    });
    const other = await createIssue('Earlier selected issue must remain unchanged');
    await app.db.run('UPDATE sprints SET state = ? WHERE id = ?', ['closed', closedCycle.body.id]);
    const prohibited = await owner
      .post('/api/v1/issues/bulk')
      .set(csrf)
      .send({
        items: [
          { id: other.id, version: 1 },
          { id: closedIssue.id, version: 1 },
        ],
        changes: { sprint_id: null, priority: 'critical' },
      });
    expect(prohibited.status).toBe(400);
    expect((await detail(other.id)).issue).toMatchObject({ version: 1, priority: 'medium' });
    const allowed = await owner
      .post('/api/v1/issues/bulk')
      .set(csrf)
      .send({
        items: [{ id: closedIssue.id, version: 1 }],
        changes: { sprint_id: closedCycle.body.id, priority: 'high' },
      });
    expect(allowed.status).toBe(200);
    expect(allowed.body.issues[0]).toMatchObject({
      sprint_id: closedCycle.body.id,
      priority: 'high',
    });
    const analytics = await owner.get(`/api/v1/sprints/${closedCycle.body.id}/analytics`);
    expect(analytics.body.summary_basis).toBe('current_scope');
    expect(analytics.body.history_note).toContain('no completion snapshot');
  });

  it('applies mixed cycle scope changes atomically and rejects stale, closed or cross-project work', async () => {
    const cycle = await owner
      .post('/api/v1/sprints')
      .set(csrf)
      .send({
        project_id: projectId,
        name: 'Scope editing',
        start_date: dateAt(0),
        end_date: dateAt(10),
      });
    const cycleId = cycle.body.id as string;
    const remove = await createIssue('Remove from scope', { sprint_id: cycleId });
    const add = await createIssue('Add to scope');
    const input = {
      items: [
        { id: remove.id, version: 1, sprint_id: null },
        { id: add.id, version: 1, sprint_id: cycleId },
      ],
    };
    const stale = await owner
      .post(`/api/v1/sprints/${cycleId}/scope`)
      .set(csrf)
      .send({ items: [{ ...input.items[0] }, { ...input.items[1], version: 999 }] });
    expect(stale.status).toBe(409);
    expect((await detail(remove.id)).issue).toMatchObject({ sprint_id: cycleId, version: 1 });
    const applied = await owner.post(`/api/v1/sprints/${cycleId}/scope`).set(csrf).send(input);
    expect(applied.status).toBe(200);
    expect(applied.body.ok).toBe(true);
    expect((await detail(remove.id)).issue).toMatchObject({ sprint_id: null, version: 2 });
    expect((await detail(add.id)).issue).toMatchObject({ sprint_id: cycleId, version: 2 });
    expect(
      (await owner.post(`/api/v1/sprints/${cycleId}/scope`).set(csrf).send({ items: [] })).status,
    ).toBe(200);
    const elsewhere = await owner
      .post('/api/v1/issues')
      .set(csrf)
      .send({ project_id: 'project-mobile', summary: 'Wrong cycle project' });
    expect(
      (
        await owner
          .post(`/api/v1/sprints/${cycleId}/scope`)
          .set(csrf)
          .send({ items: [{ id: elsewhere.body.id, version: 1, sprint_id: cycleId }] })
      ).status,
    ).toBe(400);
    const closed = await owner
      .post('/api/v1/sprints')
      .set(csrf)
      .send({
        project_id: projectId,
        name: 'Closed source',
        start_date: dateAt(-10),
        end_date: dateAt(-1),
      });
    const closedWork = await createIssue('Closed cycle work', { sprint_id: closed.body.id });
    await app.db.run('UPDATE sprints SET state = ? WHERE id = ?', ['closed', closed.body.id]);
    expect(
      (
        await owner
          .post(`/api/v1/sprints/${cycleId}/scope`)
          .set(csrf)
          .send({ items: [{ id: closedWork.id, version: 1, sprint_id: cycleId }] })
      ).status,
    ).toBe(400);
    expect(
      (await owner.post(`/api/v1/sprints/${closed.body.id}/scope`).set(csrf).send({ items: [] }))
        .status,
    ).toBe(400);
    expect(
      (await outsider.post(`/api/v1/sprints/${cycleId}/scope`).set(csrf).send({ items: [] }))
        .status,
    ).toBe(404);
  });

  it('returns missing history as null rather than a fabricated burndown', async () => {
    const response = await owner.get('/api/v1/sprints/sprint-0-current/analytics');
    expect(response.status).toBe(200);
    const analytics = response.body as SprintAnalytics;
    expect(analytics.tracking_started_at).toBeTruthy();
    expect(
      analytics.burndown
        .filter((day) => day.date < analytics.tracking_started_at.slice(0, 10))
        .every((day) => day.remaining_points === null),
    ).toBe(true);
    expect(analytics.history_note).toContain('baseline');
    expect((await outsider.get('/api/v1/sprints/sprint-0-current/analytics')).status).toBe(404);
  });

  it('reconstructs actual daily scope, estimates, completion and removal from recorded changes', async () => {
    const created = await owner
      .post('/api/v1/sprints')
      .set(csrf)
      .send({
        project_id: projectId,
        name: 'Recorded cycle',
        start_date: dateAt(-3),
        end_date: dateAt(1),
      });
    expect(created.status).toBe(201);
    const sprintId = created.body.id as string;
    const originalMigration = await app.db.one<{ applied_at: string }>(
      'SELECT applied_at FROM schema_migrations WHERE version = 2',
    );
    await app.db.run('UPDATE schema_migrations SET applied_at = ? WHERE version = 2', [
      `${dateAt(-5)}T00:00:00.000Z`,
    ]);
    try {
      const item = await createIssue('Recorded historical scope', {
        sprint_id: sprintId,
        story_points: 5,
      });
      await app.db.run('UPDATE issues SET created_at = ? WHERE id = ?', [
        `${dateAt(-3)}T08:00:00.000Z`,
        item.id,
      ]);
      expect(
        (
          await owner
            .patch(`/api/v1/issues/${item.id}`)
            .set(csrf)
            .send({ version: 1, story_points: 8 })
        ).status,
      ).toBe(200);
      await app.db.run('UPDATE history SET created_at = ? WHERE issue_id = ? AND field = ?', [
        `${dateAt(-2)}T09:00:00.000Z`,
        item.id,
        'story_points',
      ]);
      expect(
        (
          await owner
            .patch(`/api/v1/issues/${item.id}`)
            .set(csrf)
            .send({ version: 2, status_id: done.id })
        ).status,
      ).toBe(200);
      await app.db.run('UPDATE history SET created_at = ? WHERE issue_id = ? AND field = ?', [
        `${dateAt(-2)}T10:00:00.000Z`,
        item.id,
        'status_id',
      ]);
      expect(
        (
          await owner
            .post('/api/v1/issues/bulk')
            .set(csrf)
            .send({ items: [{ id: item.id, version: 3 }], changes: { sprint_id: null } })
        ).status,
      ).toBe(200);
      await app.db.run('UPDATE history SET created_at = ? WHERE issue_id = ? AND field = ?', [
        `${dateAt(-1)}T10:00:00.000Z`,
        item.id,
        'sprint_id',
      ]);
      const response = await owner.get(`/api/v1/sprints/${sprintId}/analytics`);
      expect(response.status).toBe(200);
      const analytics = response.body as SprintAnalytics;
      expect(analytics.burndown.find((day) => day.date === dateAt(-3))).toMatchObject({
        scope_points: 5,
        remaining_points: 5,
        completed_points: 0,
      });
      expect(analytics.burndown.find((day) => day.date === dateAt(-2))).toMatchObject({
        scope_points: 8,
        remaining_points: 0,
        completed_points: 8,
      });
      expect(analytics.burndown.find((day) => day.date === dateAt(-1))).toMatchObject({
        scope_points: 0,
        remaining_points: 0,
      });
      expect(analytics.burndown.find((day) => day.date === dateAt(1))!.remaining_points).toBeNull();
      expect(
        analytics.scope_events.map((event) => ({ type: event.type, delta: event.points_delta })),
      ).toEqual([
        { type: 'removed', delta: -8 },
        { type: 'estimate_changed', delta: 3 },
        { type: 'added', delta: 5 },
      ]);
      expect(analytics.summary).toMatchObject({
        added_points: 8,
        removed_points: 8,
        total_points: 0,
      });
    } finally {
      await app.db.run('UPDATE schema_migrations SET applied_at = ? WHERE version = 2', [
        originalMigration!.applied_at,
      ]);
    }
  });

  it('is idempotent and preserves custom columns, custom statuses and baseline values', async () => {
    await app.db.run('ALTER TABLE issues ADD COLUMN xyz TEXT');
    const item = await createIssue('User-customized schema');
    await app.db.run('UPDATE issues SET xyz = ? WHERE id = ?', ['preserve my value', item.id]);
    const statusId = id();
    await app.db.insert('statuses', {
      id: statusId,
      workspace_id: demoWorkspace,
      project_id: projectId,
      name: 'xyz',
      category: 'active',
      color: '#9876ab',
      position: 9,
    });
    const original = await app.db.one('SELECT * FROM planning_baselines WHERE issue_id = ?', [
      'issue-0-0',
    ]);
    await app.db.migrate();
    await applyPlanningMigrations(app.db);
    await applyPlanningMigrations(app.db);
    expect(
      (await app.db.one<{ xyz: string }>('SELECT xyz FROM issues WHERE id = ?', [item.id]))!.xyz,
    ).toBe('preserve my value');
    expect(
      await app.db.one('SELECT id FROM statuses WHERE id = ? AND name = ?', [statusId, 'xyz']),
    ).toBeTruthy();
    expect(
      await app.db.one('SELECT * FROM planning_baselines WHERE issue_id = ?', ['issue-0-0']),
    ).toEqual(original);
    expect(
      await app.db.all('SELECT version FROM schema_migrations WHERE version = 2'),
    ).toHaveLength(1);
  });
});
