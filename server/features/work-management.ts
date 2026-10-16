import type { Express, Request } from 'express';
import { z } from 'zod';
import type { Database } from '../db.js';
import type { Issue, Project, Status } from '../../shared/types.js';
import { projectTemplates, type IssueTemplate } from '../../shared/templates.js';
import { canAdmin, canWrite, HttpError } from '../auth.js';
import { sanitizeRichText } from '../richtext.js';
import { id, now } from '../seed.js';
import type {createNotifications} from './notifications.js';
type Context = {
  app: Express;
  db: Database;
  project: (req: Request, id: string, write?: boolean) => Promise<Project>;
  issue: (req: Request, id: string, write?: boolean) => Promise<Issue>;
  visibleProjects: (req: Request) => Promise<Project[]>;
  audit: (req: Request, action: string, target: string, detail?: string) => Promise<void>;
  addHistory: (
    req: Request,
    id: string,
    field: string,
    before: unknown,
    after: unknown,
  ) => Promise<void>;
  broadcast: (req: Request) => void;
  notify:ReturnType<typeof createNotifications>;
};
const defaults = z
  .object({
    summary: z.string().max(255).optional(),
    description: z.string().max(100000).transform(sanitizeRichText).optional(),
    type: z.enum(['task', 'story', 'bug', 'epic', 'subtask']).optional(),
    priority: z.enum(['critical', 'high', 'medium', 'low', 'lowest']).optional(),
    labels: z.array(z.string().trim().min(1).max(40)).max(20).optional(),
    story_points: z.number().int().min(0).max(1000).optional(),
  })
  .strict();
const templateSchema = z.object({
  name: z.string().trim().min(1).max(120),
  description: z.string().max(2000).default(''),
  project_id: z.string().nullable().default(null),
  defaults,
});
const conflict = () =>
  new HttpError(409, 'This work changed. Refresh and try again.', 'EDIT_CONFLICT');
export function registerWorkManagementRoutes({
  app,
  db,
  project,
  issue,
  visibleProjects,
  audit,
  addHistory,
  broadcast,
  notify,
}: Context) {
  app.get('/api/v1/project-templates', (_req, res) => res.json(projectTemplates));
  const parseTemplate = (row: Record<string, unknown>) => {
    const { defaults_json, ...value } = row;
    return { ...value, defaults: JSON.parse(String(defaults_json)) } as unknown as IssueTemplate;
  };
  async function template(req: Request, templateId: string, write = false) {
    const row = await db.one<Record<string, unknown>>(
      'SELECT * FROM issue_templates WHERE id=? AND workspace_id=?',
      [templateId, req.workspaceId],
    );
    if (!row) throw new HttpError(404, 'Template not found.');
    if (row.project_id) await project(req, String(row.project_id), write);
    else if (write) canAdmin(req);
    if (write && row.created_by !== req.user.id && !['owner', 'admin'].includes(req.user.role))
      throw new HttpError(
        403,
        'Only the author or a workspace administrator can edit this template.',
      );
    return row;
  }
  app.get('/api/v1/issue-templates', async (req, res) => {
    const projectId = typeof req.query.project_id === 'string' ? req.query.project_id : null;
    if (projectId) await project(req, projectId);
    const visible = new Set((await visibleProjects(req)).map((p) => p.id));
    const rows = await db.all<Record<string, unknown>>(
      'SELECT * FROM issue_templates WHERE workspace_id=? ORDER BY name LIMIT 500',
      [req.workspaceId],
    );
    res.json(
      rows
        .filter((t) => !t.project_id || visible.has(String(t.project_id)))
        .filter((t) => !projectId || !t.project_id || t.project_id === projectId)
        .map(parseTemplate),
    );
  });
  app.post('/api/v1/issue-templates', async (req, res) => {
    canWrite(req);
    const body = templateSchema.parse(req.body);
    if (body.project_id) await project(req, body.project_id, true);
    else canAdmin(req);
    const templateId = id();
    await db.transaction(async () => {
      await db.insert('issue_templates', {
        id: templateId,
        workspace_id: req.workspaceId,
        project_id: body.project_id,
        name: body.name,
        description: body.description,
        defaults_json: JSON.stringify(body.defaults),
        created_by: req.user.id,
        created_at: now(),
        updated_at: now(),
      });
      await audit(req, 'template.created', templateId);
    });
    broadcast(req);
    res.status(201).json(parseTemplate((await template(req, templateId))!));
  });
  app.patch('/api/v1/issue-templates/:id', async (req, res) => {
    const body = templateSchema
      .omit({ project_id: true })
      .extend({ version: z.number().int().positive() })
      .strict()
      .parse(req.body);
    await db.transaction(async () => {
      const current = await template(req, String(req.params.id), true);
      if (current.version !== body.version) throw conflict();
      if (
        !(await db.run(
          'UPDATE issue_templates SET name=?,description=?,defaults_json=?,version=version+1,updated_at=? WHERE id=? AND workspace_id=? AND version=?',
          [
            body.name,
            body.description,
            JSON.stringify(body.defaults),
            now(),
            current.id,
            req.workspaceId,
            body.version,
          ],
        ))
      )
        throw conflict();
      await audit(req, 'template.updated', String(current.id));
    });
    broadcast(req);
    res.json(parseTemplate(await template(req, String(req.params.id))));
  });
  app.delete('/api/v1/issue-templates/:id', async (req, res) => {
    const { version } = z.object({ version: z.number().int().positive() }).parse(req.body);
    await db.transaction(async () => {
      const current = await template(req, String(req.params.id), true);
      if (
        !(await db.run('DELETE FROM issue_templates WHERE id=? AND workspace_id=? AND version=?', [
          current.id,
          req.workspaceId,
          version,
        ]))
      )
        throw conflict();
      await audit(req, 'template.deleted', String(current.id));
    });
    broadcast(req);
    res.json({ ok: true });
  });
  app.post('/api/v1/issues/:id/move', async (req, res) => {
    const body = z
      .object({
        project_id: z.string(),
        version: z.number().int().positive(),
        status_id: z.string().optional(),
      })
      .strict()
      .parse(req.body);
    const known = await issue(req, String(req.params.id), true);
    if (known.project_id === body.project_id)
      throw new HttpError(400, 'Choose a different destination project.');
    await project(req, body.project_id, true);
    const moved = await db.transaction(async () => {
      for (const projectId of [known.project_id, body.project_id].sort())
        await db.run('UPDATE projects SET next_number=next_number WHERE id=? AND workspace_id=?', [
          projectId,
          req.workspaceId,
        ]);
      const raw = await db.one<Record<string, unknown>>(
        'SELECT * FROM issues WHERE id=? AND workspace_id=? AND deleted_at IS NULL' +
          (db.driver === 'mysql' ? ' FOR UPDATE' : ''),
        [known.id, req.workspaceId],
      );
      if (!raw) throw new HttpError(404, 'Issue not found.');
      const current = { ...raw, labels: JSON.parse(String(raw.labels)) } as unknown as Issue;
      if (current.version !== body.version || current.project_id !== known.project_id)
        throw conflict();
      if (
        current.parent_id ||
        (await db.one(
          'SELECT id FROM issues WHERE parent_id=? AND workspace_id=? AND deleted_at IS NULL',
          [current.id, req.workspaceId],
        ))
      )
        throw new HttpError(
          409,
          'Move standalone issues only. Detach or move related hierarchy work first.',
        );
      if (
        current.sprint_id &&
        (await db.one(
          'SELECT id FROM sprints WHERE id=? AND state=?' +
            (db.driver === 'mysql' ? ' FOR SHARE' : ''),
          [current.sprint_id, 'closed'],
        ))
      )
        throw new HttpError(409, 'Completed cycle membership is preserved.');
      const config = await db.one<{ issue_types: string }>(
        'SELECT issue_types FROM project_configuration WHERE project_id=?',
        [body.project_id],
      );
      if (config && !JSON.parse(config.issue_types).includes(current.type))
        throw new HttpError(400, 'This issue type is not enabled in the destination project.');
      const destination = await project(req, body.project_id, true);
      const category = await db.one<Status>('SELECT * FROM statuses WHERE id=?', [
        current.status_id,
      ]);
      const status = body.status_id
        ? await db.one<Status>(
            'SELECT * FROM statuses WHERE id=? AND project_id=? AND workspace_id=?',
            [body.status_id, body.project_id, req.workspaceId],
          )
        : await db.one<Status>(
            'SELECT * FROM statuses WHERE project_id=? AND category=? ORDER BY position LIMIT 1',
            [body.project_id, category?.category || 'todo'],
          );
      if (!status) throw new HttpError(400, 'Choose a valid destination status.');
      await db.run('UPDATE projects SET next_number=next_number+1 WHERE id=?', [body.project_id]);
      const counter = await db.one<{ next_number: number }>(
        'SELECT next_number FROM projects WHERE id=?',
        [body.project_id],
      );
      const number = counter!.next_number - 1;
      const key = `${destination.key}-${number}`;
      await db.insert('issue_aliases', {
        workspace_id: req.workspaceId,
        alias_key: current.key,
        issue_id: current.id,
        created_at: now(),
      });
      if (
        !(await db.run(
          'UPDATE issues SET project_id=?,number=?,`key`=?,status_id=?,sprint_id=NULL,carry_over=0,version=version+1,updated_at=? WHERE id=? AND version=?',
          [body.project_id, number, key, status.id, now(), current.id, current.version],
        ))
      )
        throw conflict();
      await db.run('DELETE FROM module_issues WHERE issue_id=? AND workspace_id=?', [
        current.id,
        req.workspaceId,
      ]);
      for (const [field, before, after] of [
        ['project_id', current.project_id, body.project_id],
        ['key', current.key, key],
        ['status_id', current.status_id, status.id],
        ['sprint_id', current.sprint_id, null],
      ])
        if (before !== after) await addHistory(req, current.id, String(field), before, after);
      await audit(req, 'issue.moved', current.id, JSON.stringify({ from: current.key, to: key }));
      const watchers=await db.all<{user_id:string}>('SELECT user_id FROM watchers WHERE issue_id=? AND workspace_id=?',[current.id,req.workspaceId]);
      for(const watcher of watchers)await notify(req,watcher.user_id,current.id,`${current.key} moved to ${key}`,current.summary,'move');
      return issue(req, current.id);
    });
    broadcast(req);
    res.json(moved);
  });
  app.post('/api/v1/issues/:id/rank', async (req, res) => {
    const body = z
      .object({
        version: z.number().int().positive(),
        before_id: z.string().nullable(),
        after_id: z.string().nullable(),
      })
      .strict()
      .parse(req.body);
    const known = await issue(req, String(req.params.id), true);
    await db.transaction(async () => {
      await db.run('UPDATE projects SET next_number=next_number WHERE id=?', [known.project_id]);
      const current = await issue(req, known.id, true);
      if (current.version !== body.version) throw conflict();
      const items = await db.all<Issue>(
        'SELECT * FROM issues WHERE workspace_id=? AND project_id=? AND deleted_at IS NULL AND ' +
          (current.sprint_id ? 'sprint_id=?' : 'sprint_id IS NULL') +
          ' ORDER BY `rank`,id' +
          (db.driver === 'mysql' ? ' FOR UPDATE' : ''),
        current.sprint_id
          ? [req.workspaceId, current.project_id, current.sprint_id]
          : [req.workspaceId, current.project_id],
      );
      if (items.length > 5000) throw new HttpError(400, 'Rank a smaller planning group.');
      const others = items.filter((i) => i.id !== current.id);
      const beforeIndex = body.before_id
        ? others.findIndex((i) => i.id === body.before_id)
        : others.length;
      const afterIndex = body.after_id ? others.findIndex((i) => i.id === body.after_id) : -1;
      if (
        (body.before_id && beforeIndex < 0) ||
        (body.after_id && afterIndex < 0) ||
        beforeIndex !== afterIndex + 1
      )
        throw new HttpError(409, 'The planning order changed. Refresh and try again.');
      let low = afterIndex < 0 ? (others[0]?.rank || 1024) - 2048 : others[afterIndex].rank;
      let high = beforeIndex === others.length ? low + 2048 : others[beforeIndex].rank;
      if (high - low < 0.01) {
        for (let n = 0; n < others.length; n++) {
          others[n].rank = (n + 1) * 1024;
          await db.run('UPDATE issues SET `rank`=?,version=version+1,updated_at=? WHERE id=?', [
            others[n].rank,
            now(),
            others[n].id,
          ]);
        }
        low = afterIndex < 0 ? 0 : others[afterIndex].rank;
        high = beforeIndex === others.length ? low + 2048 : others[beforeIndex].rank;
      }
      const rank = (low + high) / 2;
      if (
        !(await db.run(
          'UPDATE issues SET `rank`=?,version=version+1,updated_at=? WHERE id=? AND version=?',
          [rank, now(), current.id, current.version],
        ))
      )
        throw conflict();
      await addHistory(req, current.id, 'rank', current.rank, rank);
    });
    broadcast(req);
    res.json({ ok: true });
  });
}
