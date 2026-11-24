import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../server/app.js';
import { Database } from '../server/db.js';
import type { Issue } from '../shared/types.js';

let app: Awaited<ReturnType<typeof createApp>>;
let owner: ReturnType<typeof request.agent>;
let outsider: ReturnType<typeof request.agent>;
const csrf = { 'X-Grace-CSRF': '1' };
let projectId: string;
let sprintId: string;
let issueA: Issue;
let issueB: Issue;
let issueC: Issue;

beforeAll(async () => {
  app = await createApp({ db: new Database('sqlite', ':memory:'), seed: true });
  owner = request.agent(app.app);
  outsider = request.agent(app.app);

  expect((await owner.post('/api/v1/auth/demo').set(csrf)).status).toBe(200);
  expect(
    (
      await outsider.post('/api/v1/auth/register').set(csrf).send({
        email: 'dep-outsider@example.test',
        password: 'LongPassword123!',
        name: 'Outsider User',
        workspace: 'Other Workspace',
      })
    ).status,
  ).toBe(201);

  const projRes = await owner
    .post('/api/v1/projects')
    .set(csrf)
    .send({ name: 'Dep Cap Project', key: 'DCP' });
  expect(projRes.status).toBe(201);
  projectId = projRes.body.id;

  const sprintRes = await owner
    .post('/api/v1/sprints')
    .set(csrf)
    .send({
      project_id: projectId,
      name: 'Sprint 1 - Launch',
      goal: 'Deliver dependency features',
      start_date: '2026-11-20',
      end_date: '2026-12-04',
    });
  expect(sprintRes.status).toBe(201);
  sprintId = sprintRes.body.id;

  const create = async (summary: string, points = 3) => {
    const res = await owner
      .post('/api/v1/issues')
      .set(csrf)
      .send({ project_id: projectId, summary, story_points: points, sprint_id: sprintId });
    expect(res.status).toBe(201);
    return res.body as Issue;
  };

  issueA = await create('Design UI mocks', 5);
  issueB = await create('Develop backend API', 8);
  issueC = await create('Integration testing', 3);
});

afterAll(async () => {
  app.io.close();
  await app.db.close();
});

describe('Dependency Management', () => {
  let linkId: string;

  it('creates dependency link between work items', async () => {
    const res = await owner
      .post(`/api/v1/issues/${issueA.id}/links`)
      .set(csrf)
      .send({ target_id: issueB.id, type: 'blocks' });

    expect(res.status).toBe(201);
    expect(res.body.ok).toBe(true);
    expect(res.body.id).toBeTruthy();
    linkId = res.body.id;
  });

  it('rejects self-linking', async () => {
    const res = await owner
      .post(`/api/v1/issues/${issueA.id}/links`)
      .set(csrf)
      .send({ target_id: issueA.id, type: 'blocks' });

    expect(res.status).toBe(400);
  });

  it('rejects invalid link types', async () => {
    const res = await owner
      .post(`/api/v1/issues/${issueA.id}/links`)
      .set(csrf)
      .send({ target_id: issueB.id, type: 'invalid-type' });

    expect(res.status).toBe(400);
  });

  it('retrieves incoming and outgoing dependencies for an issue', async () => {
    // issueA blocks issueB => issueA has outgoing 'blocks', issueB has incoming 'blocks'
    const outRes = await owner.get(`/api/v1/issues/${issueA.id}/links`).set(csrf);
    expect(outRes.status).toBe(200);
    expect(outRes.body.outgoing).toHaveLength(1);
    expect(outRes.body.outgoing[0].target_id).toBe(issueB.id);
    expect(outRes.body.outgoing[0].type).toBe('blocks');

    const inRes = await owner.get(`/api/v1/issues/${issueB.id}/links`).set(csrf);
    expect(inRes.status).toBe(200);
    expect(inRes.body.incoming).toHaveLength(1);
    expect(inRes.body.incoming[0].source_id).toBe(issueA.id);
  });

  it('queries project-level dependency graph (nodes and edges)', async () => {
    // Add second link: issueB blocks issueC
    await owner
      .post(`/api/v1/issues/${issueB.id}/links`)
      .set(csrf)
      .send({ target_id: issueC.id, type: 'blocks' });

    const graphRes = await owner
      .get(`/api/v1/projects/${projectId}/dependency-graph`)
      .set(csrf);

    expect(graphRes.status).toBe(200);
    expect(graphRes.body.nodes.length).toBeGreaterThanOrEqual(3);
    expect(graphRes.body.edges.length).toBeGreaterThanOrEqual(2);
  });

  it('deletes a dependency link', async () => {
    const delRes = await owner.delete(`/api/v1/issue-links/${linkId}`).set(csrf);
    expect(delRes.status).toBe(200);
    expect(delRes.body.ok).toBe(true);

    const outRes = await owner.get(`/api/v1/issues/${issueA.id}/links`).set(csrf);
    expect(outRes.body.outgoing).toHaveLength(0);
  });
});

describe('Capacity Management', () => {
  it('retrieves capacity summary for a sprint', async () => {
    const res = await owner.get(`/api/v1/sprints/${sprintId}/capacity`).set(csrf);
    expect(res.status).toBe(200);
    expect(res.body.sprint.id).toBe(sprintId);
    expect(Array.isArray(res.body.capacity)).toBe(true);
  });

  it('updates member sprint capacity and focus factor', async () => {
    const demoUser = await app.db.one<{ id: string }>(
      `SELECT id FROM users WHERE email = 'alex@grace.local'`,
    );
    expect(demoUser).toBeTruthy();

    const putRes = await owner
      .put(`/api/v1/sprints/${sprintId}/capacity/${demoUser!.id}`)
      .set(csrf)
      .send({ available_hours: 32, focus_factor: 0.8 });

    expect(putRes.status).toBe(200);
    expect(putRes.body.ok).toBe(true);

    const checkRes = await owner.get(`/api/v1/sprints/${sprintId}/capacity`).set(csrf);
    const memberCap = checkRes.body.capacity.find(
      (m: { user_id: string }) => m.user_id === demoUser!.id,
    );
    expect(memberCap?.available_hours).toBe(32);
    expect(memberCap?.focus_factor).toBe(0.8);
  });

  it('retrieves multi-sprint project capacity trend', async () => {
    const trendRes = await owner.get(`/api/v1/projects/${projectId}/capacity`).set(csrf);
    expect(trendRes.status).toBe(200);
    expect(Array.isArray(trendRes.body.sprints)).toBe(true);
    expect(trendRes.body.sprints.length).toBeGreaterThanOrEqual(1);
    expect(trendRes.body.sprints[0].id).toBe(sprintId);
  });
});
