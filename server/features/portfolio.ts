import type { Express, Request } from 'express';
import { z } from 'zod';
import type { Database } from '../db.js';
import type { Issue, Project, Sprint } from '../../shared/types.js';
import { canWrite, HttpError } from '../auth.js';
import { audienceMember } from './notifications.js';
import { requireActiveMember } from './accounts.js';
import { id, now } from '../seed.js';
type Context = {
  app: Express;
  db: Database;
  project: (req: Request, id: string, write?: boolean) => Promise<Project>;
  visibleProjects: (req: Request) => Promise<Project[]>;
  audit: (req: Request, action: string, target: string, detail?: string) => Promise<void>;
  broadcast: (req: Request) => void;
};
export async function applyPortfolioMigration(db: Database) {
  if (!(await db.one('SELECT version FROM schema_migrations WHERE version=6')))
    await db.insert('schema_migrations', { version: 6, applied_at: now() });
}
const initiativeSchema = z.object({
  name: z.string().trim().min(1).max(160),
  description: z.string().max(10000).default(''),
  state: z.enum(['planned', 'active', 'paused', 'completed']).default('planned'),
  lead_id: z.string().nullable().default(null),
  target_date: z.union([z.iso.date(), z.literal('')]).default(''),
  module_ids: z.array(z.string()).max(100).default([]),
});
export function registerPortfolioRoutes({
  app,
  db,
  project,
  visibleProjects,
  audit,
  broadcast,
}: Context) {
  async function module(req: Request, moduleId: string, write = false) {
    const record = await db.one<{
      id: string;
      project_id: string;
      version: number;
      archived_at: string | null;
    }>(
      'SELECT id,project_id,version,archived_at FROM project_modules WHERE id=? AND workspace_id=?',
      [moduleId, req.workspaceId],
    );
    if (!record) throw new HttpError(404, 'Module not found.');
    await project(req, record.project_id, write);
    if (write && record.archived_at)
      throw new HttpError(409, 'Restore the module before editing its plan.');
    return record;
  }
  app.get('/api/v1/modules/:id/planning', async (req, res) => {
    const current = await module(req, String(req.params.id));
    const visible = new Set((await visibleProjects(req)).map((p) => p.id));
    const dependencies = await db.all<{
      id: string;
      name: string;
      state: string;
      project_id: string;
    }>(
      'SELECT m.id,m.name,m.state,m.project_id FROM module_dependencies d JOIN project_modules m ON m.id=d.depends_on_id WHERE d.module_id=? AND d.workspace_id=?',
      [current.id, req.workspaceId],
    );
    const members = await db.all<{ user_id: string }>(
      'SELECT user_id FROM module_members WHERE module_id=?',
      [current.id],
    );
    const metrics = await db.one(
      "SELECT COUNT(*) AS total,SUM(CASE WHEN s.category='done' THEN 1 ELSE 0 END) AS completed,SUM(CASE WHEN s.category!='done' AND i.assignee_id IS NULL THEN 1 ELSE 0 END) AS unassigned,SUM(CASE WHEN s.category!='done' AND i.flagged=1 THEN 1 ELSE 0 END) AS flagged,SUM(CASE WHEN s.category!='done' AND i.due_date!='' AND i.due_date<? THEN 1 ELSE 0 END) AS overdue FROM module_issues mi JOIN issues i ON i.id=mi.issue_id JOIN statuses s ON s.id=i.status_id WHERE mi.module_id=? AND i.deleted_at IS NULL",
      [now().slice(0, 10), current.id],
    );
    res.json({
      version: current.version,
      members: members.map((m) => m.user_id),
      dependencies: dependencies.filter((d) => visible.has(d.project_id)),
      metrics,
      has_hidden_dependencies: dependencies.some((d) => !visible.has(d.project_id)),
    });
  });
  app.put('/api/v1/modules/:id/planning', async (req, res) => {
    const current = await module(req, String(req.params.id), true);
    const body = z
      .object({
        version: z.number().int().positive(),
        members: z.array(z.string()).max(100),
        depends_on: z.array(z.string()).max(100),
      })
      .strict()
      .parse(req.body);
    await db.transaction(async () => {
      await db.run('UPDATE workspaces SET name=name WHERE id=?', [req.workspaceId]);
      if (
        !(await db.run(
          'UPDATE project_modules SET version=version+1,updated_at=? WHERE id=? AND workspace_id=? AND version=?',
          [now(), current.id, req.workspaceId, body.version],
        ))
      )
        throw new HttpError(409, 'The module changed. Refresh and try again.');
      for (const memberId of new Set(body.members))
        if (!(await audienceMember(db, req.workspaceId, current.project_id, memberId)))
          throw new HttpError(400, 'Module members must be active and have project access.');
      for (const dependency of new Set(body.depends_on)) {
        if (dependency === current.id)
          throw new HttpError(400, 'A module cannot depend on itself.');
        await module(req, dependency);
      }
      const existing = await db.all<{ module_id: string; depends_on_id: string }>(
        'SELECT module_id,depends_on_id FROM module_dependencies WHERE workspace_id=?',
        [req.workspaceId],
      );
      if (existing.length > 5000)
        throw new HttpError(400, 'Dependency planning exceeds the current graph budget.');
      // Replacing a plan must not silently remove dependencies the editor cannot see.
      for (const edge of existing.filter((e) => e.module_id === current.id))
        await module(req, edge.depends_on_id);
      const graph = new Map<string, string[]>();
      for (const edge of existing.filter((e) => e.module_id !== current.id))
        graph.set(edge.module_id, [...(graph.get(edge.module_id) || []), edge.depends_on_id]);
      graph.set(current.id, [...new Set(body.depends_on)]);
      const visit = (node: string, path: Set<string>, done: Set<string>) => {
        if (path.size > 64) throw new HttpError(400, 'Dependency paths are limited to 64 modules.');
        if (path.has(node)) throw new HttpError(400, 'This dependency would create a cycle.');
        if (done.has(node)) return;
        const next = new Set(path);
        next.add(node);
        for (const dependency of graph.get(node) || []) visit(dependency, next, done);
        done.add(node);
      };
      visit(current.id, new Set(), new Set());
      await db.run('DELETE FROM module_members WHERE module_id=?', [current.id]);
      for (const userId of new Set(body.members))
        await db.insert('module_members', {
          workspace_id: req.workspaceId,
          module_id: current.id,
          user_id: userId,
        });
      await db.run('DELETE FROM module_dependencies WHERE module_id=?', [current.id]);
      for (const dependency of new Set(body.depends_on))
        await db.insert('module_dependencies', {
          workspace_id: req.workspaceId,
          module_id: current.id,
          depends_on_id: dependency,
        });
      await audit(req, 'module.plan.updated', current.id);
    });
    broadcast(req);
    res.json({ ok: true });
  });
  async function visibleInitiatives(req: Request) {
    const visible = new Set((await visibleProjects(req)).map((p) => p.id));
    const rows = await db.all<Record<string, unknown> & { id: string; created_by: string }>(
      'SELECT * FROM initiatives WHERE workspace_id=? ORDER BY created_at DESC LIMIT 500',
      [req.workspaceId],
    );
    const links = await db.all<{ initiative_id: string; module_id: string; project_id: string }>(
      'SELECT im.initiative_id,im.module_id,m.project_id FROM initiative_modules im JOIN project_modules m ON m.id=im.module_id WHERE im.workspace_id=?',
      [req.workspaceId],
    );
    return rows
      .filter((row) =>
        links.filter((l) => l.initiative_id === row.id).every((l) => visible.has(l.project_id)),
      )
      .map((row) => ({
        ...row,
        module_ids: links.filter((l) => l.initiative_id === row.id).map((l) => l.module_id),
      }));
  }
  app.get('/api/v1/initiatives', async (req, res) => res.json(await visibleInitiatives(req)));
  async function save(req: Request, existingId?: string) {
    canWrite(req);
    const body = initiativeSchema
      .extend(existingId ? { version: z.number().int().positive() } : {})
      .parse(req.body);
    const initiativeId = existingId || id();
    await db.transaction(async () => {
      if (existingId) {
        const current = (await visibleInitiatives(req)).find((i) => i.id === existingId);
        if (!current) throw new HttpError(404, 'Initiative not found.');
        if (current.created_by !== req.user.id && !['owner', 'admin'].includes(req.user.role))
          throw new HttpError(
            403,
            'Only the author or a workspace administrator can edit this initiative.',
          );
        if (
          !(await db.run('UPDATE initiatives SET version=version+1 WHERE id=? AND version=?', [
            existingId,
            (body as { version: number }).version,
          ]))
        )
          throw new HttpError(409, 'The initiative changed. Refresh and try again.');
      }
      if (body.lead_id) await requireActiveMember(db, req.workspaceId, body.lead_id);
      for (const moduleId of new Set(body.module_ids)) await module(req, moduleId, true);
      if (body.state === 'completed')
        for (const moduleId of new Set(body.module_ids)) {
          const row = await db.one<{ state: string }>(
            'SELECT state FROM project_modules WHERE id=?',
            [moduleId],
          );
          if (row?.state !== 'completed')
            throw new HttpError(
              409,
              'Complete the linked modules before completing this initiative.',
            );
        }
      const { module_ids, ...fields } = body;
      delete (fields as { version?: number }).version;
      if (!existingId)
        await db.insert('initiatives', {
          ...fields,
          id: initiativeId,
          workspace_id: req.workspaceId,
          created_by: req.user.id,
          created_at: now(),
          updated_at: now(),
        });
      else
        for (const [field, value] of Object.entries(fields))
          await db.run(`UPDATE initiatives SET ${field}=?,updated_at=? WHERE id=?`, [
            value,
            now(),
            initiativeId,
          ]);
      await db.run('DELETE FROM initiative_modules WHERE initiative_id=?', [initiativeId]);
      for (const moduleId of new Set(module_ids))
        await db.insert('initiative_modules', {
          workspace_id: req.workspaceId,
          initiative_id: initiativeId,
          module_id: moduleId,
        });
      await audit(req, existingId ? 'initiative.updated' : 'initiative.created', initiativeId);
    });
    broadcast(req);
    return (await visibleInitiatives(req)).find((i) => i.id === initiativeId);
  }
  app.post('/api/v1/initiatives', async (req, res) => res.status(201).json(await save(req)));
  app.patch('/api/v1/initiatives/:id', async (req, res) =>
    res.json(await save(req, String(req.params.id))),
  );
  async function cycle(req: Request, sprintId: string, write = false) {
    const sprint = await db.one<Sprint>('SELECT * FROM sprints WHERE id=? AND workspace_id=?', [
      sprintId,
      req.workspaceId,
    ]);
    if (!sprint) throw new HttpError(404, 'Cycle not found.');
    await project(req, sprint.project_id, write);
    return sprint;
  }
  app.get('/api/v1/sprints/:id/retrospectives', async (req, res) => {
    await cycle(req, String(req.params.id));
    res.json(
      await db.all(
        'SELECT * FROM cycle_retrospectives WHERE sprint_id=? AND workspace_id=? ORDER BY updated_at',
        [String(req.params.id), req.workspaceId],
      ),
    );
  });
  app.put('/api/v1/sprints/:id/retrospectives', async (req, res) => {
    const sprint = await cycle(req, String(req.params.id), true);
    if (sprint.state !== 'closed')
      throw new HttpError(409, 'Complete this cycle before sharing its retrospective.');
    const body = z
      .object({
        went_well: z.string().trim().max(10000),
        improve: z.string().trim().max(10000),
        actions: z.string().trim().max(10000),
        version: z.number().int().nonnegative(),
      })
      .refine((v) => !!(v.went_well || v.improve || v.actions), 'Write at least one reflection.')
      .parse(req.body);
    await db.transaction(async () => {
      await db.run('UPDATE users SET name=name WHERE id=?', [req.user.id]);
      const current = await db.one<{ id: string; version: number }>(
        'SELECT id,version FROM cycle_retrospectives WHERE sprint_id=? AND author_id=?',
        [sprint.id, req.user.id],
      );
      if ((current?.version || 0) !== body.version)
        throw new HttpError(409, 'Your retrospective changed. Refresh and try again.');
      if (current)
        await db.run(
          'UPDATE cycle_retrospectives SET went_well=?,improve=?,actions=?,version=version+1,updated_at=? WHERE id=?',
          [body.went_well, body.improve, body.actions, now(), current.id],
        );
      else
        await db.insert('cycle_retrospectives', {
          id: id(),
          workspace_id: req.workspaceId,
          sprint_id: sprint.id,
          author_id: req.user.id,
          went_well: body.went_well,
          improve: body.improve,
          actions: body.actions,
          updated_at: now(),
        });
      await audit(req, 'cycle.retrospective.saved', sprint.id);
    });
    broadcast(req);
    res.json({ ok: true });
  });
}
