import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import request from 'supertest';
import mysql from 'mysql2/promise';
import { randomBytes } from 'node:crypto';
import { Database } from '../server/db.js';
import { createApp } from '../server/app.js';
import { applyPlanningMigrations } from '../server/migrations.js';
import { applyExpansionMigrations } from '../server/expansion-migrations.js';
import { applySearchMigration } from '../server/features/search.js';
import { createBackup, restoreBackup } from '../server/backup.js';
let instance: Awaited<ReturnType<typeof createApp>>;
let owner: ReturnType<typeof request.agent>;
const csrf = { 'X-Grace-CSRF': '1' };
const enabled = process.env.GRACE_MYSQL_TEST === 'true';
describe.skipIf(!enabled)('Real MySQL 8 integration', () => {
  beforeAll(async () => {
    process.env.DATABASE_URL = process.env.GRACE_MYSQL_URL;
    instance = await createApp({ db: new Database('mysql'), seed: true, mailer: async () => {} });
    owner = request.agent(instance.app);
    expect((await owner.post('/api/v1/auth/demo').set(csrf)).status).toBe(200);
  }, 60000);
  afterAll(async () => {
    if (instance) {
      await instance.accounts.flush();
      instance.io.close();
      await instance.db.close();
    }
  });
  it('uses MySQL 8 and applies migrations idempotently without removing custom states', async () => {
    const result = await instance.db.one<{ version: string }>('SELECT VERSION() AS version');
    expect(result?.version).toMatch(/^8\./);
    await instance.db.migrate();
    await applyPlanningMigrations(instance.db);
    await applyExpansionMigrations(instance.db);
    await applySearchMigration(instance.db);
    const versions = await instance.db.all<{ version: number }>(
      'SELECT version FROM schema_migrations ORDER BY version',
    );
    expect(versions.map((v) => v.version)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });
  it('uses the actual MySQL full-text index and bounded keyset pagination', async () => {
    const marker = `searchable-${randomBytes(3).toString('hex')}`;
    const created = await owner
      .post('/api/v1/issues')
      .set(csrf)
      .send({ project_id: 'project-platform', summary: `Coral integration ${marker}` });
    expect(created.status).toBe(201);
    const found = await owner.get('/api/v1/search/issues').query({ q: 'Coral' });
    expect(found.status).toBe(200);
    expect(found.body.engine).toBe('mysql-fulltext');
    expect(found.body.items.some((i: { id: string }) => i.id === created.body.id)).toBe(true);
    const first = await owner.get('/api/v1/search/issues').query({ limit: 2 });
    expect(first.body.items).toHaveLength(2);
    const next = await owner
      .get('/api/v1/search/issues')
      .query({ limit: 2, cursor: first.body.nextCursor });
    expect(
      next.body.items.every(
        (i: { id: string }) => !first.body.items.some((j: { id: string }) => i.id === j.id),
      ),
    ).toBe(true);
  });
  it('allocates unique issue keys under competing writes and rolls back stale bulk edits', async () => {
    const result = await Promise.all(
      Array.from({ length: 8 }, (_, n) =>
        owner
          .post('/api/v1/issues')
          .set(csrf)
          .send({ project_id: 'project-platform', summary: `MySQL concurrency ${n}` }),
      ),
    );
    expect(result.every((r) => r.status === 201)).toBe(true);
    expect(new Set(result.map((r) => r.body.key)).size).toBe(8);
    const [a, b] = result.map((r) => r.body);
    expect(
      (
        await owner
          .patch(`/api/v1/issues/${b.id}`)
          .set(csrf)
          .send({ version: b.version, summary: 'Edited elsewhere' })
      ).status,
    ).toBe(200);
    expect(
      (
        await owner
          .post('/api/v1/issues/bulk')
          .set(csrf)
          .send({
            items: [
              { id: a.id, version: a.version },
              { id: b.id, version: b.version },
            ],
            changes: { priority: 'critical' },
          })
      ).status,
    ).toBe(409);
    expect((await owner.get(`/api/v1/issues/${a.id}`)).body.issue.priority).toBe('medium');
  });
  it('moves issue identity and resolves aliases on the real SQL adapter', async () => {
    const created = await owner
      .post('/api/v1/issues')
      .set(csrf)
      .send({ project_id: 'project-platform', summary: 'MySQL move', type: 'task' });
    const moved = await owner
      .post(`/api/v1/issues/${created.body.id}/move`)
      .set(csrf)
      .send({ project_id: 'project-mobile', version: created.body.version });
    expect(moved.status).toBe(200);
    expect((await owner.get(`/api/v1/issues/${created.body.key}`)).body.issue.key).toBe(
      moved.body.key,
    );
  });
  it('persists organization assignments, team work and concurrency checks on MySQL', async () => {
    const bootstrap = (await owner.get('/api/v1/bootstrap')).body;
    expect(bootstrap.organization.teams).toHaveLength(6);
    const team = bootstrap.organization.teams.find((t: { slug: string }) => t.slug === 'frontend');
    const created = await owner.post('/api/v1/organization/work').set(csrf).send({
      team_id: team.id,
      kind: 'brd',
      title: 'MySQL business requirements',
      owner_id: 'user-sarah',
      content: '<h2>Requirements</h2><p>Persist in MySQL</p>',
    });
    expect(created.status).toBe(201);
    const updated = await owner
      .patch(`/api/v1/organization/work/${created.body.id}`)
      .set(csrf)
      .send({ ...created.body, state: 'review' });
    expect(updated.status).toBe(200);
    expect(updated.body.version).toBe(2);
    expect(
      (
        await owner
          .patch(`/api/v1/organization/work/${created.body.id}`)
          .set(csrf)
          .send(created.body)
      ).status,
    ).toBe(409);
    const employee = request.agent(instance.app);
    expect(
      (
        await employee.post('/api/v1/auth/login').set(csrf).send({
          employee_id: bootstrap.user.employee_id,
          organization: bootstrap.workspace.slug,
          password: 'GraceDemo2026!',
        })
      ).status,
    ).toBe(200);
    expect(
      (await employee.get('/api/v1/organization/work')).body.some(
        (w: { id: string }) => w.id === created.body.id,
      ),
    ).toBe(true);
  });
  it('persists team manager access and limits layout changes to the assigned team', async () => {
    const organization = (await owner.get('/api/v1/organization')).body;
    const team = organization.teams.find((t: { slug: string }) => t.slug === 'frontend');
    const email = `manager-${randomBytes(3).toString('hex')}@example.test`;
    const invite = await owner
      .post('/api/v1/invites')
      .set(csrf)
      .send({
        email,
        employee_id: `MANAGER-${randomBytes(3).toString('hex')}`,
        team_id: team.id,
        team_role: 'manager',
      });
    expect(invite.status).toBe(201);
    const manager = request.agent(instance.app);
    expect(
      (
        await manager
          .post('/api/v1/auth/register')
          .set(csrf)
          .send({
            email,
            name: 'MySQL Team Manager',
            password: 'StrongPassword2026!',
            invite_token: new URL(invite.body.url).searchParams.get('token'),
          })
      ).status,
    ).toBe(201);
    const context = (await manager.get('/api/v1/organization')).body;
    expect(context).toMatchObject({ can_admin: false, can_manage_team: true });
    expect(context.teams.map((t: { id: string }) => t.id)).toEqual([team.id]);
    const layout = {
      name: team.name,
      description: 'MySQL manager layout',
      color: team.color,
      sections: team.sections,
      version: team.version,
    };
    const updated = await manager
      .patch(`/api/v1/organization/teams/${team.id}/layout`)
      .set(csrf)
      .send(layout);
    expect(updated.status).toBe(200);
    expect(updated.body.permissions).toEqual(team.permissions);
    expect(
      (await manager.patch(`/api/v1/organization/teams/${team.id}/layout`).set(csrf).send(layout))
        .status,
    ).toBe(409);
    expect(
      (
        await manager
          .patch(`/api/v1/organization/teams/${team.id}`)
          .set(csrf)
          .send({ ...layout, permissions: team.permissions })
      ).status,
    ).toBe(403);
  });
  it('queries Home analytics and persists versioned project team assignments and activity', async () => {
    const home = await owner.get('/api/v1/organization/overview?days=7');
    expect(home.status).toBe(200);
    expect(home.body.trend).toHaveLength(7);
    const frontend = home.body.teams.find((t: { name: string }) => t.name === 'Frontend');
    const project = home.body.projects.find((p: { id: string }) => p.id === 'project-platform');
    expect(
      (
        await owner
          .put('/api/v1/projects/project-platform/teams')
          .set(csrf)
          .send({ team_ids: [frontend.id], version: project.assignment_version })
      ).status,
    ).toBe(200);
    const updated = (await owner.get('/api/v1/organization/overview')).body;
    expect(
      updated.projects.find((p: { id: string }) => p.id === 'project-platform').team_ids,
    ).toEqual([frontend.id]);
    const feed = await owner.get('/api/v1/organization/activity?limit=2');
    expect(feed.status).toBe(200);
    expect(feed.body.items).toHaveLength(2);
    expect(
      feed.body.items.some((e: { action: string }) => e.action === 'project.teams.assigned'),
    ).toBe(true);
    const next = await owner
      .get('/api/v1/organization/activity')
      .query({ limit: 2, cursor: feed.body.next_cursor });
    expect(next.status).toBe(200);
    expect(
      next.body.items.every(
        (e: { id: string }) => !feed.body.items.some((f: { id: string }) => e.id === f.id),
      ),
    ).toBe(true);
  });
  it('encrypts backups, rejects modified data, and refuses nonempty restore targets', async () => {
    const key = randomBytes(32).toString('hex');
    const backup = await createBackup(instance.db, key);
    expect(backup.toString()).not.toContain('alex@grace.local');
    await expect(
      restoreBackup(instance.db, backup, 'wrong-key-that-is-at-least-32-characters'),
    ).rejects.toThrow('authenticated');
    await expect(restoreBackup(instance.db, backup, key)).rejects.toThrow('empty target');
  });
  it('restores encrypted data into a fresh MySQL schema with hierarchy and foreign keys intact', async () => {
    const connection = await mysql.createConnection(process.env.GRACE_MYSQL_URL!);
    const name = `grace_test_restore_${randomBytes(4).toString('hex')}`;
    await connection.query(`CREATE DATABASE ${name} CHARACTER SET utf8mb4`);
    const previous = process.env.DATABASE_URL;
    const url = new URL(previous!);
    url.pathname = `/${name}`;
    process.env.DATABASE_URL = url.toString();
    const restored = new Database('mysql');
    process.env.DATABASE_URL = previous;
    try {
      const key = randomBytes(32).toString('hex');
      await restoreBackup(restored, await createBackup(instance.db, key), key);
      const count = await restored.one<{ n: number }>('SELECT COUNT(*) n FROM issues');
      expect(count?.n).toBeGreaterThan(28);
      expect(await restored.one('SELECT alias_key FROM issue_aliases LIMIT 1')).toBeDefined();
    } finally {
      await restored.close();
      await connection.query(`DROP DATABASE ${name}`);
      await connection.end();
    }
  }, 60000);
});
