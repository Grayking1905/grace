import type { Express, Request } from 'express';
import { z } from 'zod';
import type { Database } from '../db.js';
import { canAdmin, canWrite, HttpError } from '../auth.js';
import { id, now } from '../seed.js';
import { requireActiveMember } from './accounts.js';
import type { createNotifications } from './notifications.js';
import type { Issue, Project, Sprint, Status } from '../../shared/types.js';
import type {
  ProjectModule,
  SprintAnalytics,
  SprintBurndownDay,
  SprintScopeEvent,
} from '../../shared/planning.js';

export interface PlanningContext {
  app: Express;
  db: Database;
  project(req: Request, projectId: string, write?: boolean): Promise<Project>;
  issue(req: Request, issueId: string, write?: boolean): Promise<Issue>;
  scopedIssues(req: Request, projectId?: string): Promise<Issue[]>;
  visibleProjects(req: Request, includeArchived?: boolean): Promise<Project[]>;
  addHistory(
    req: Request,
    issueId: string,
    field: string,
    before: unknown,
    after: unknown,
  ): Promise<void>;
  audit(req: Request, action: string, target: string, detail?: string): Promise<void>;
  broadcast(req: Request): void;
  notify: ReturnType<typeof createNotifications>;
}

const moduleSchema = z
  .object({
    project_id: z.string().min(1),
    name: z.string().trim().min(1).max(120),
    description: z.string().trim().max(10000).default(''),
    lead_id: z.string().min(1).nullable().default(null),
    state: z
      .enum(['planned', 'in_progress', 'paused', 'completed', 'cancelled'])
      .default('planned'),
    start_date: z.union([z.iso.date(), z.literal('')]).default(''),
    end_date: z.union([z.iso.date(), z.literal('')]).default(''),
    issue_ids: z.array(z.string().min(1)).max(500).default([]),
  })
  .strict();
const bulkSchema = z
  .object({
    items: z
      .array(z.object({ id: z.string().min(1), version: z.number().int().positive() }).strict())
      .min(1)
      .max(100),
    changes: z
      .object({
        status_id: z.string().min(1).optional(),
        assignee_id: z.string().min(1).nullable().optional(),
        priority: z.enum(['critical', 'high', 'medium', 'low', 'lowest']).optional(),
        sprint_id: z.string().min(1).nullable().optional(),
        labels: z.array(z.string().trim().min(1).max(40)).max(20).optional(),
        deleted: z.literal(true).optional(),
      })
      .strict()
      .refine((value) => Object.keys(value).length > 0, 'Choose at least one change.'),
  })
  .strict();

const conflict = () =>
  new HttpError(
    409,
    'This work changed while you were editing. Refresh and try again.',
    'EDIT_CONFLICT',
  );
const parseIssue = (row: Record<string, unknown>) =>
  ({ ...row, labels: JSON.parse(String(row.labels || '[]')) }) as Issue;

type SnapshotIssue = Pick<Issue, 'id' | 'key' | 'summary' | 'status_id' | 'story_points'> & {
  category: string;
};
interface SprintSnapshot {
  sprint_id: string;
  phase: 'start' | 'complete';
  workspace_id: string;
  total_issues: number;
  completed_issues: number;
  total_points: number;
  completed_points: number;
  recorded_at: string;
}
interface FrozenSprintIssue {
  issue_id: string;
  issue_key: string;
  summary: string;
  status_id: string;
  story_points: number;
  category: string;
}

/** Call inside sprint lifecycle transactions, before carrying unfinished work away. */
export async function captureSprintSnapshot(
  db: Database,
  workspaceId: string,
  sprintId: string,
  phase: 'start' | 'complete',
  items?: SnapshotIssue[],
): Promise<void> {
  await db.transaction(async () => {
    if (
      await db.one(
        'SELECT sprint_id FROM sprint_snapshots WHERE sprint_id = ? AND phase = ? AND workspace_id = ?',
        [sprintId, phase, workspaceId],
      )
    )
      return;
    const scope =
      items ??
      (await db.all<SnapshotIssue>(
        'SELECT i.id,i.`key`,i.summary,i.status_id,i.story_points,s.category FROM issues i JOIN statuses s ON s.id=i.status_id WHERE i.sprint_id = ? AND i.workspace_id = ? AND i.deleted_at IS NULL' +
          (db.driver === 'mysql' ? ' FOR UPDATE' : ''),
        [sprintId, workspaceId],
      ));
    const completed = scope.filter((item) => item.category === 'done');
    await db.insert('sprint_snapshots', {
      sprint_id: sprintId,
      phase,
      workspace_id: workspaceId,
      total_issues: scope.length,
      completed_issues: completed.length,
      total_points: scope.reduce((sum, item) => sum + item.story_points, 0),
      completed_points: completed.reduce((sum, item) => sum + item.story_points, 0),
      recorded_at: now(),
    });
    for (const item of scope)
      await db.insert('sprint_issue_snapshots', {
        sprint_id: sprintId,
        phase,
        workspace_id: workspaceId,
        issue_id: item.id,
        issue_key: item.key,
        summary: item.summary,
        status_id: item.status_id,
        story_points: item.story_points,
        category: item.category,
      });
  });
}

export function registerPlanningRoutes(ctx: PlanningContext) {
  const { app, db, project, issue, scopedIssues, visibleProjects, addHistory, audit, broadcast } =
    ctx;

  async function moduleRow(req: Request, moduleId: string, write = false) {
    const row = await db.one<ProjectModule>(
      'SELECT * FROM project_modules WHERE id = ? AND workspace_id = ?',
      [moduleId, req.workspaceId],
    );
    if (!row) throw new HttpError(404, 'Module not found.');
    await project(req, row.project_id, write);
    return row;
  }

  async function enrichModule(row: ProjectModule): Promise<ProjectModule> {
    const items = await db.all<{ id: string; story_points: number; category: string }>(
      'SELECT i.id,i.story_points,s.category FROM module_issues mi JOIN issues i ON i.id=mi.issue_id JOIN statuses s ON s.id=i.status_id WHERE mi.module_id = ? AND mi.workspace_id = ? AND i.workspace_id = ? AND i.deleted_at IS NULL ORDER BY i.`rank`',
      [row.id, row.workspace_id, row.workspace_id],
    );
    const completed = items.filter((item) => item.category === 'done');
    return {
      ...row,
      issue_ids: items.map((item) => item.id),
      total_issues: items.length,
      completed_issues: completed.length,
      total_points: items.reduce((sum, item) => sum + item.story_points, 0),
      completed_points: completed.reduce((sum, item) => sum + item.story_points, 0),
      progress: items.length ? Math.round((completed.length / items.length) * 100) : 0,
    };
  }

  async function validateModule(req: Request, value: z.infer<typeof moduleSchema>) {
    const prj = await project(req, value.project_id, true);
    if (value.start_date && value.end_date && value.end_date < value.start_date)
      throw new HttpError(400, 'The module end date must follow its start date.');
    if (new Set(value.issue_ids).size !== value.issue_ids.length)
      throw new HttpError(400, 'An issue can only appear once in a module.');
    if (value.lead_id) {
      const lead = await db.one<{ role: string }>(
        'SELECT role FROM memberships WHERE workspace_id = ? AND user_id = ?',
        [req.workspaceId, value.lead_id],
      );
      if (!lead) throw new HttpError(400, 'Choose a module lead from this workspace.');
      if (
        prj.visibility === 'private' &&
        !['owner', 'admin'].includes(lead.role) &&
        prj.lead_id !== value.lead_id &&
        !(await db.one(
          'SELECT user_id FROM project_members WHERE project_id = ? AND user_id = ? AND workspace_id = ?',
          [prj.id, value.lead_id, req.workspaceId],
        ))
      )
        throw new HttpError(400, 'The module lead needs access to this private project.');
    }
    for (const issueId of value.issue_ids) {
      const item = await issue(req, issueId, true);
      if (item.id !== issueId) throw new HttpError(400, 'Module membership requires issue IDs.');
      if (item.project_id !== value.project_id)
        throw new HttpError(400, 'Module issues must belong to the same project.');
      if (value.state === 'completed') {
        const status = await db.one<Status>(
          'SELECT * FROM statuses WHERE id = ? AND workspace_id = ?',
          [item.status_id, req.workspaceId],
        );
        if (status?.category !== 'done')
          throw new HttpError(400, 'Finish every linked issue before completing this module.');
      }
    }
  }

  async function replaceModuleIssues(req: Request, moduleId: string, issueIds: string[]) {
    await db.run('DELETE FROM module_issues WHERE module_id = ? AND workspace_id = ?', [
      moduleId,
      req.workspaceId,
    ]);
    for (const issueId of issueIds)
      await db.insert('module_issues', {
        workspace_id: req.workspaceId,
        module_id: moduleId,
        issue_id: issueId,
        added_at: now(),
      });
  }

  app.get('/api/v1/modules', async (req, res) => {
    const projectId = typeof req.query.project_id === 'string' ? req.query.project_id : undefined;
    if (projectId) await project(req, projectId);
    const visible = new Set((await visibleProjects(req)).map((item) => item.id));
    const rows = await db.all<ProjectModule>(
      'SELECT * FROM project_modules WHERE workspace_id = ?' +
        (projectId ? ' AND project_id = ?' : '') +
        (req.query.include_archived === 'true' ? '' : ' AND archived_at IS NULL') +
        ' ORDER BY created_at DESC,name',
      projectId ? [req.workspaceId, projectId] : [req.workspaceId],
    );
    res.json(
      await Promise.all(rows.filter((row) => visible.has(row.project_id)).map(enrichModule)),
    );
  });

  app.post('/api/v1/modules', async (req, res) => {
    canWrite(req);
    const body = moduleSchema.parse(req.body);
    const moduleId = id();
    const result = await db.transaction(async () => {
      await validateModule(req, body);
      const { issue_ids, ...fields } = body;
      const timestamp = now();
      await db.insert('project_modules', {
        ...fields,
        id: moduleId,
        workspace_id: req.workspaceId,
        created_at: timestamp,
        updated_at: timestamp,
      });
      await replaceModuleIssues(req, moduleId, issue_ids);
      await audit(req, 'module.created', moduleId, body.name);
      return enrichModule(await moduleRow(req, moduleId));
    });
    broadcast(req);
    res.status(201).json(result);
  });

  app.get('/api/v1/modules/:id', async (req, res) => {
    const module = await enrichModule(await moduleRow(req, String(req.params.id)));
    const items = await scopedIssues(req, module.project_id);
    res
      .set('X-Resource-Version', String(module.version))
      .json({ module, issues: items.filter((item) => module.issue_ids.includes(item.id)) });
  });

  async function updateModule(req: Request, archiveOnly = false) {
    const parsed = moduleSchema
      .omit({ project_id: true })
      .partial()
      .extend({ version: z.number().int().positive(), archived: z.boolean().optional() })
      .strict()
      .parse(req.body);
    const patch = Object.fromEntries(
      Object.entries(parsed).filter(([key]) => Object.hasOwn(req.body, key)),
    ) as typeof parsed;
    if (archiveOnly && Object.keys(patch).some((key) => key !== 'version'))
      throw new HttpError(400, 'Only the current version is needed to archive a module.');
    return db.transaction(async () => {
      const current = await enrichModule(await moduleRow(req, String(req.params.id), true));
      if (current.version !== patch.version) throw conflict();
      const archived = archiveOnly ? true : patch.archived;
      if (archived !== undefined) {
        const prj = await project(req, current.project_id, true);
        if (prj.lead_id !== req.user.id) canAdmin(req);
      }
      if (current.archived_at && archived !== false)
        throw new HttpError(400, 'Restore this archived module before editing it.');
      const { version, archived: _archived, issue_ids, ...changes } = patch;
      const effective = { ...current, ...changes, issue_ids: issue_ids ?? current.issue_ids };
      await validateModule(req, effective);
      const changed = await db.run(
        'UPDATE project_modules SET version = version + 1, updated_at = ? WHERE id = ? AND workspace_id = ? AND version = ?',
        [now(), current.id, req.workspaceId, version],
      );
      if (!changed) throw conflict();
      for (const [key, value] of Object.entries(changes))
        await db.run(
          `UPDATE project_modules SET \`${key}\` = ? WHERE id = ? AND workspace_id = ?`,
          [value, current.id, req.workspaceId],
        );
      if (archived !== undefined)
        await db.run(
          'UPDATE project_modules SET archived_at = ? WHERE id = ? AND workspace_id = ?',
          [archived ? now() : null, current.id, req.workspaceId],
        );
      if (issue_ids !== undefined) await replaceModuleIssues(req, current.id, issue_ids);
      await audit(
        req,
        archived === true
          ? 'module.archived'
          : archived === false
            ? 'module.restored'
            : 'module.updated',
        current.id,
      );
      return enrichModule(await moduleRow(req, current.id));
    });
  }

  app.patch('/api/v1/modules/:id', async (req, res) => {
    const result = await updateModule(req);
    broadcast(req);
    res.json(result);
  });
  app.delete('/api/v1/modules/:id', async (req, res) => {
    const result = await updateModule(req, true);
    broadcast(req);
    res.json(result);
  });

  // Register before the generic /issues/:id PATCH route.
  app.post('/api/v1/issues/bulk', async (req, res) => {
    canWrite(req);
    const body = bulkSchema.parse(req.body);
    if (new Set(body.items.map((item) => item.id)).size !== body.items.length)
      throw new HttpError(400, 'Select each issue only once.');
    const result = await db.transaction(async () => {
      const selected: Issue[] = [];
      for (const entry of body.items) {
        const current = await issue(req, entry.id, true);
        if (body.changes.assignee_id)
          await requireActiveMember(db, req.workspaceId, body.changes.assignee_id);
        if (selected.some((item) => item.id === current.id))
          throw new HttpError(400, 'Select each issue only once.');
        if (current.version !== entry.version) throw conflict();
        selected.push(current);
        if (
          body.changes.status_id &&
          !(await db.one(
            'SELECT id FROM statuses WHERE id = ? AND project_id = ? AND workspace_id = ?',
            [body.changes.status_id, current.project_id, req.workspaceId],
          ))
        )
          throw new HttpError(
            400,
            'The selected status must belong to every selected issue’s project.',
          );
        if (
          body.changes.assignee_id &&
          !(await db.one('SELECT user_id FROM memberships WHERE user_id = ? AND workspace_id = ?', [
            body.changes.assignee_id,
            req.workspaceId,
          ]))
        )
          throw new HttpError(400, 'Choose an assignee from this workspace.');
        const changesCycle =
          Object.hasOwn(body.changes, 'sprint_id') && body.changes.sprint_id !== current.sprint_id;
        if (changesCycle && current.sprint_id) {
          const source = await db.one<Sprint>(
            'SELECT * FROM sprints WHERE id = ? AND workspace_id = ?' +
              (db.driver === 'mysql' ? ' FOR SHARE' : ''),
            [current.sprint_id, req.workspaceId],
          );
          if (source?.state === 'closed')
            throw new HttpError(400, 'Issues from a completed cycle cannot be moved.');
        }
        if (
          changesCycle &&
          body.changes.sprint_id &&
          !(await db.one(
            'SELECT id FROM sprints WHERE id = ? AND project_id = ? AND workspace_id = ? AND state != ?' +
              (db.driver === 'mysql' ? ' FOR SHARE' : ''),
            [body.changes.sprint_id, current.project_id, req.workspaceId, 'closed'],
          ))
        )
          throw new HttpError(400, 'Choose an open cycle from every selected issue’s project.');
      }
      const updated: Issue[] = [];
      const deletedIds: string[] = [];
      for (const current of selected) {
        const changed = await db.run(
          'UPDATE issues SET version = version + 1, updated_at = ? WHERE id = ? AND workspace_id = ? AND version = ? AND deleted_at IS NULL',
          [now(), current.id, req.workspaceId, current.version],
        );
        if (!changed) throw conflict();
        for (const [field, value] of Object.entries(body.changes)) {
          if (field === 'deleted') continue;
          const previous = current[field as keyof Issue];
          if (JSON.stringify(previous) === JSON.stringify(value)) continue;
          await db.run(`UPDATE issues SET \`${field}\` = ? WHERE id = ? AND workspace_id = ?`, [
            field === 'labels' ? JSON.stringify(value) : value,
            current.id,
            req.workspaceId,
          ]);
          await addHistory(req, current.id, field, previous, value);
        }
        if (body.changes.deleted) {
          const timestamp = now();
          await db.run('UPDATE issues SET deleted_at = ? WHERE id = ? AND workspace_id = ?', [
            timestamp,
            current.id,
            req.workspaceId,
          ]);
          await addHistory(req, current.id, 'deleted_at', null, timestamp);
          await audit(req, 'issue.deleted', current.id, 'Bulk operation');
          deletedIds.push(current.id);
        } else {
          if (
            body.changes.assignee_id &&
            body.changes.assignee_id !== current.assignee_id &&
            body.changes.assignee_id !== req.user.id
          )
            await ctx.notify(
              req,
              body.changes.assignee_id,
              current.id,
              `${current.key} was assigned to you`,
              current.summary,
              'assignment',
            );
          if (body.changes.status_id && body.changes.status_id !== current.status_id) {
            const watchers = await db.all<{ user_id: string }>(
              'SELECT user_id FROM watchers WHERE issue_id = ? AND workspace_id = ?',
              [current.id, req.workspaceId],
            );
            const status = await db.one<Status>('SELECT * FROM statuses WHERE id = ?', [
              body.changes.status_id,
            ]);
            for (const watcher of watchers.filter((watcher) => watcher.user_id !== req.user.id))
              await ctx.notify(
                req,
                watcher.user_id,
                current.id,
                `${current.key} moved to ${status!.name}`,
                current.summary,
                'status',
              );
          }
          updated.push(await issue(req, current.id));
        }
      }
      await audit(
        req,
        'issues.bulk_updated',
        selected[0].project_id,
        JSON.stringify({
          issue_ids: selected.map((item) => item.id),
          fields: Object.keys(body.changes),
        }),
      );
      return { issues: updated, deleted_ids: deletedIds };
    });
    broadcast(req);
    res.json(result);
  });

  app.get('/api/v1/sprints/:id/analytics', async (req, res) => {
    const result = await db.transaction(async () => {
      const sprint = await db.one<Sprint>(
        'SELECT * FROM sprints WHERE id = ? AND workspace_id = ?',
        [String(req.params.id), req.workspaceId],
      );
      if (!sprint) throw new HttpError(404, 'Cycle not found.');
      await project(req, sprint.project_id);
      return buildSprintAnalytics(db, req.workspaceId, sprint);
    });
    res.json(result);
  });

  app.post('/api/v1/sprints/:id/scope', async (req, res) => {
    canWrite(req);
    const body = z
      .object({
        items: z
          .array(
            z
              .object({
                id: z.string().min(1),
                version: z.number().int().positive(),
                sprint_id: z.string().min(1).nullable(),
              })
              .strict(),
          )
          .max(100),
      })
      .strict()
      .parse(req.body);
    const sprintId = String(req.params.id);
    const result = await db.transaction(async () => {
      const sprint = await db.one<Sprint>(
        'SELECT * FROM sprints WHERE id = ? AND workspace_id = ?' +
          (db.driver === 'mysql' ? ' FOR SHARE' : ''),
        [sprintId, req.workspaceId],
      );
      if (!sprint) throw new HttpError(404, 'Cycle not found.');
      await project(req, sprint.project_id, true);
      if (sprint.state === 'closed')
        throw new HttpError(400, 'A completed cycle’s scope cannot be changed.');
      const selected: { current: Issue; sprint_id: string | null }[] = [];
      for (const entry of body.items) {
        if (entry.sprint_id !== null && entry.sprint_id !== sprintId)
          throw new HttpError(400, 'Add issues to this cycle or remove them to the backlog.');
        const current = await issue(req, entry.id, true);
        if (current.project_id !== sprint.project_id)
          throw new HttpError(400, 'Cycle issues must belong to the same project.');
        if (selected.some((item) => item.current.id === current.id))
          throw new HttpError(400, 'Select each issue only once.');
        if (current.version !== entry.version) throw conflict();
        if (entry.sprint_id === null && current.sprint_id !== sprintId)
          throw new HttpError(400, 'Only remove issues that belong to this cycle.');
        if (current.sprint_id && current.sprint_id !== sprintId) {
          const source = await db.one<Sprint>(
            'SELECT * FROM sprints WHERE id = ? AND workspace_id = ?' +
              (db.driver === 'mysql' ? ' FOR SHARE' : ''),
            [current.sprint_id, req.workspaceId],
          );
          if (source?.state === 'closed')
            throw new HttpError(400, 'Issues from a completed cycle cannot be moved.');
        }
        selected.push({ current, sprint_id: entry.sprint_id });
      }
      const updated: Issue[] = [];
      for (const entry of selected) {
        if (entry.current.sprint_id === entry.sprint_id) continue;
        const changed = await db.run(
          'UPDATE issues SET sprint_id = ?, version = version + 1, updated_at = ? WHERE id = ? AND workspace_id = ? AND version = ? AND deleted_at IS NULL',
          [entry.sprint_id, now(), entry.current.id, req.workspaceId, entry.current.version],
        );
        if (!changed) throw conflict();
        await addHistory(
          req,
          entry.current.id,
          'sprint_id',
          entry.current.sprint_id,
          entry.sprint_id,
        );
        updated.push(await issue(req, entry.current.id));
      }
      if (updated.length)
        await audit(
          req,
          'sprint.scope_updated',
          sprintId,
          JSON.stringify(updated.map((item) => item.id)),
        );
      return { ok: true, issues: updated, deleted_ids: [] };
    });
    if (result.issues.length) broadcast(req);
    res.json(result);
  });
}

interface PlanningState {
  sprint_id: string | null;
  status_id: string;
  story_points: number;
  deleted_at: string | null;
}
interface PlanningHistory {
  id: string;
  issue_id: string;
  field: string;
  old_value: string;
  new_value: string;
  created_at: string;
}
interface Baseline extends PlanningState {
  issue_id: string;
  recorded_at: string;
}
interface TimelineEvent {
  at: string;
  issue: Issue;
  before: PlanningState | null;
  after: PlanningState;
  historyId: string;
}

function historyValue(field: string, value: string): string | number | null {
  if (field === 'story_points') return Number(value) || 0;
  if (['', 'null', '""'].includes(value)) return null;
  return value;
}
function withHistory(
  state: PlanningState,
  history: PlanningHistory,
  reverse = false,
): PlanningState {
  return {
    ...state,
    [history.field]: historyValue(history.field, reverse ? history.old_value : history.new_value),
  };
}
const isInSprint = (state: PlanningState | null, sprintId: string) =>
  !!state && state.sprint_id === sprintId && !state.deleted_at;

/** UUID order is not write order. Resolve same-millisecond edits from their old/new value chain. */
function chronologicalHistory(changes: PlanningHistory[], current: PlanningState) {
  const descending = [...changes].sort((a, b) => b.created_at.localeCompare(a.created_at));
  const reversed: PlanningHistory[] = [];
  let state = { ...current };
  while (descending.length) {
    const timestamp = descending[0].created_at;
    const group = descending.splice(
      0,
      descending.findIndex((change) => change.created_at !== timestamp) < 0
        ? descending.length
        : descending.findIndex((change) => change.created_at !== timestamp),
    );
    while (group.length) {
      const matching = group.findIndex(
        (change) =>
          state[change.field as keyof PlanningState] ===
          historyValue(change.field, change.new_value),
      );
      const [change] = group.splice(matching < 0 ? group.length - 1 : matching, 1);
      reversed.push(change);
      state = withHistory(state, change, true);
    }
  }
  return reversed.reverse();
}

export async function buildSprintAnalytics(
  db: Database,
  workspaceId: string,
  sprint: Sprint,
): Promise<SprintAnalytics> {
  const migration = await db.one<{ applied_at: string }>(
    'SELECT applied_at FROM schema_migrations WHERE version = 2',
  );
  const trackingStart = migration?.applied_at || now();
  const [rows, histories, baselines, statuses, completion, frozenIssues] = await Promise.all([
    db.all<Record<string, unknown>>(
      'SELECT * FROM issues WHERE workspace_id = ? AND project_id = ?',
      [workspaceId, sprint.project_id],
    ),
    db.all<PlanningHistory>(
      'SELECT h.* FROM history h JOIN issues i ON i.id=h.issue_id WHERE h.workspace_id = ? AND i.workspace_id = ? AND i.project_id = ? AND h.created_at >= ? AND h.field IN (?,?,?,?) ORDER BY h.created_at,h.id',
      [
        workspaceId,
        workspaceId,
        sprint.project_id,
        trackingStart,
        'sprint_id',
        'status_id',
        'story_points',
        'deleted_at',
      ],
    ),
    db.all<Baseline>('SELECT * FROM planning_baselines WHERE workspace_id = ? AND project_id = ?', [
      workspaceId,
      sprint.project_id,
    ]),
    db.all<Status>('SELECT * FROM statuses WHERE workspace_id = ? AND project_id = ?', [
      workspaceId,
      sprint.project_id,
    ]),
    db.one<SprintSnapshot>(
      'SELECT * FROM sprint_snapshots WHERE sprint_id = ? AND workspace_id = ? AND phase = ?',
      [sprint.id, workspaceId, 'complete'],
    ),
    db.all<FrozenSprintIssue>(
      'SELECT * FROM sprint_issue_snapshots WHERE sprint_id = ? AND workspace_id = ? AND phase = ?',
      [sprint.id, workspaceId, 'complete'],
    ),
  ]);
  const completedSnapshot = sprint.state === 'closed' ? completion : undefined;
  const frozenIds = new Set(frozenIssues.map((item) => item.issue_id));
  const items = rows.map(parseIssue);
  const baselineMap = new Map(baselines.map((baseline) => [baseline.issue_id, baseline]));
  const done = new Set(
    statuses.filter((status) => status.category === 'done').map((status) => status.id),
  );
  const timeline: TimelineEvent[] = [];
  for (const item of items) {
    const changes = chronologicalHistory(
      histories.filter((history) => history.issue_id === item.id),
      item,
    );
    const baseline = baselineMap.get(item.id);
    let initial: PlanningState = baseline
      ? {
          sprint_id: baseline.sprint_id,
          status_id: baseline.status_id,
          story_points: baseline.story_points,
          deleted_at: baseline.deleted_at,
        }
      : {
          sprint_id: item.sprint_id,
          status_id: item.status_id,
          story_points: item.story_points,
          deleted_at: item.deleted_at,
        };
    // Reconstruct creation state only for work created after baseline; no invented older history.
    if (!baseline)
      for (const change of [...changes].reverse()) initial = withHistory(initial, change, true);
    const initialAt = baseline
      ? baseline.recorded_at
      : item.created_at > trackingStart
        ? item.created_at
        : trackingStart;
    timeline.push({
      at: initialAt,
      issue: item,
      before: null,
      after: initial,
      historyId: `baseline:${item.id}`,
    });
    let state = initial;
    for (const change of changes) {
      if (change.created_at < initialAt) continue;
      const next = withHistory(state, change);
      timeline.push({
        at: change.created_at,
        issue: item,
        before: state,
        after: next,
        historyId: change.id,
      });
      state = next;
    }
  }
  timeline.sort((a, b) => a.at.localeCompare(b.at));
  const events: SprintScopeEvent[] = [];
  const sprintStart = `${sprint.start_date}T00:00:00.000Z`;
  const sprintEnd = `${sprint.end_date}T23:59:59.999Z`;
  for (const event of timeline) {
    if (event.at < sprintStart || event.at > sprintEnd) continue;
    // Lifecycle carry-over changes future ownership, rather than rewriting final scope.
    if (
      completedSnapshot &&
      (event.at > completedSnapshot.recorded_at ||
        (event.at === completedSnapshot.recorded_at &&
          frozenIds.has(event.issue.id) &&
          isInSprint(event.before, sprint.id) &&
          !isInSprint(event.after, sprint.id)))
    )
      continue;
    const before = isInSprint(event.before, sprint.id);
    const after = isInSprint(event.after, sprint.id);
    const baseline = event.historyId.startsWith('baseline:') && event.at === trackingStart;
    if (baseline) continue;
    const delta =
      (after ? event.after.story_points : 0) - (before ? event.before!.story_points : 0);
    if (before === after && (!after || delta === 0)) continue;
    events.push({
      id: event.historyId,
      issue_id: event.issue.id,
      issue_key: event.issue.key,
      summary: event.issue.summary,
      type: !before && after ? 'added' : before && !after ? 'removed' : 'estimate_changed',
      points_delta: delta,
      created_at: event.at,
    });
  }
  const current = items.filter((item) => isInSprint(item, sprint.id));
  const completed = current.filter((item) => done.has(item.status_id));
  const totalIssues = completedSnapshot?.total_issues ?? current.length;
  const completedIssues = completedSnapshot?.completed_issues ?? completed.length;
  const totalPoints =
    completedSnapshot?.total_points ?? current.reduce((sum, item) => sum + item.story_points, 0);
  const completedPoints =
    completedSnapshot?.completed_points ??
    completed.reduce((sum, item) => sum + item.story_points, 0);
  const dayCount =
    Math.round((Date.parse(sprint.end_date) - Date.parse(sprint.start_date)) / 86400000) + 1;
  if (!Number.isFinite(dayCount) || dayCount < 1 || dayCount > 731)
    throw new HttpError(400, 'Cycle analytics needs a valid date range of at most two years.');
  const observedAt = now();
  const trackingDate = trackingStart.slice(0, 10);
  const today = observedAt.slice(0, 10);
  const firstObserved = timeline.filter(
    (event) => event.at <= (sprintStart > trackingStart ? sprintStart : trackingStart),
  );
  const firstState = new Map<string, PlanningState>();
  for (const event of firstObserved) firstState.set(event.issue.id, event.after);
  const observedScope = [...firstState.values()]
    .filter((state) => isInSprint(state, sprint.id))
    .reduce((sum, state) => sum + state.story_points, 0);
  const idealStart = sprint.state === 'future' ? observedScope : sprint.committed_points;
  const daily: SprintBurndownDay[] = [];
  const stateByIssue = new Map<string, PlanningState>();
  let cursor = 0;
  for (let day = 0; day < dayCount; day++) {
    const date = new Date(Date.parse(sprint.start_date) + day * 86400000)
      .toISOString()
      .slice(0, 10);
    const cutoff = date === today ? observedAt : `${date}T23:59:59.999Z`;
    while (cursor < timeline.length && timeline[cursor].at <= cutoff) {
      stateByIssue.set(timeline[cursor].issue.id, timeline[cursor].after);
      cursor++;
    }
    const known = date >= trackingDate && date <= today;
    const scoped = [...stateByIssue.values()].filter((state) => isInSprint(state, sprint.id));
    const useCompletion = completedSnapshot && cutoff >= completedSnapshot.recorded_at;
    const scopePoints = useCompletion
      ? completedSnapshot.total_points
      : scoped.reduce((sum, state) => sum + state.story_points, 0);
    const finished = scoped.filter((state) => done.has(state.status_id));
    const donePoints = useCompletion
      ? completedSnapshot.completed_points
      : finished.reduce((sum, state) => sum + state.story_points, 0);
    daily.push({
      date,
      remaining_points: known ? scopePoints - donePoints : null,
      scope_points: known ? scopePoints : null,
      completed_points: known ? donePoints : null,
      remaining_issues: known
        ? useCompletion
          ? completedSnapshot.total_issues - completedSnapshot.completed_issues
          : scoped.length - finished.length
        : null,
      ideal_points:
        Math.round(idealStart * (dayCount === 1 ? 0 : 1 - day / (dayCount - 1)) * 100) / 100,
    });
  }
  return {
    sprint,
    summary_basis: completedSnapshot ? 'completion_snapshot' : 'current_scope',
    summary: {
      total_issues: totalIssues,
      completed_issues: completedIssues,
      total_points: totalPoints,
      completed_points: completedPoints,
      remaining_points: totalPoints - completedPoints,
      completion_percent: totalIssues ? Math.round((completedIssues / totalIssues) * 100) : 0,
      added_points: events.reduce((sum, event) => sum + Math.max(0, event.points_delta), 0),
      removed_points: events.reduce((sum, event) => sum + Math.max(0, -event.points_delta), 0),
    },
    burndown: daily,
    scope_events: events.reverse(),
    tracking_started_at: trackingStart,
    history_note:
      'Actuals use the saved planning baseline and recorded issue changes. Dates before tracking began and future dates have no actual value. The ideal line is a planning guide, not recorded progress.' +
      (completedSnapshot
        ? ' Final scope is frozen at completion, including unfinished work carried forward.'
        : sprint.state === 'closed'
          ? ' This older completed cycle has no completion snapshot, so summary totals show current membership.'
          : ''),
  };
}
