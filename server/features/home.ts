import type { Express, Request } from 'express';
import { z } from 'zod';
import type { Database } from '../db.js';
import type { Project } from '../../shared/types.js';
import type { HomeCounts, HomeOverview, HomeEvent } from '../../shared/home.js';
import { canAdmin, HttpError } from '../auth.js';
import { organizationContext } from '../organization.js';
import { now } from '../seed.js';
type Context = {
  app: Express;
  db: Database;
  visibleProjects: (req: Request) => Promise<Project[]>;
  project: (req: Request, id: string, write?: boolean) => Promise<Project>;
  audit: (req: Request, action: string, target: string, detail?: string) => Promise<void>;
  broadcast: (req: Request) => void;
  online: (workspaceId: string) => Set<string>;
};
const scopeInput = z.object({
  team_id: z.string().max(64).optional(),
  project_id: z.string().max(64).optional(),
});
const emptyCounts = (): HomeCounts => ({
  total: 0,
  completed: 0,
  active: 0,
  todo: 0,
  overdue: 0,
  bugs: 0,
  flagged: 0,
  points: 0,
  completed_points: 0,
});
const countSql = `COUNT(*) AS total,SUM(CASE WHEN s.category='done' THEN 1 ELSE 0 END) AS completed,SUM(CASE WHEN s.category='active' THEN 1 ELSE 0 END) AS active,SUM(CASE WHEN s.category='todo' THEN 1 ELSE 0 END) AS todo,SUM(CASE WHEN s.category<>'done' AND i.due_date<>'' AND i.due_date<? THEN 1 ELSE 0 END) AS overdue,SUM(CASE WHEN i.type='bug' AND s.category<>'done' THEN 1 ELSE 0 END) AS bugs,SUM(CASE WHEN i.flagged=1 AND s.category<>'done' THEN 1 ELSE 0 END) AS flagged,COALESCE(SUM(i.story_points),0) AS points,COALESCE(SUM(CASE WHEN s.category='done' THEN i.story_points ELSE 0 END),0) AS completed_points`;
const numbers = (row: Partial<HomeCounts> | undefined): HomeCounts =>
  Object.fromEntries(
    Object.keys(emptyCounts()).map((k) => [k, Number(row?.[k as keyof HomeCounts] || 0)]),
  ) as unknown as HomeCounts;
const marks = (ids: string[]) => (ids.length ? ids.map(() => '?').join(',') : 'NULL');
export function registerHomeRoutes({
  app,
  db,
  visibleProjects,
  project,
  audit,
  broadcast,
  online,
}: Context) {
  const isAdmin = (req: Request) => ['owner', 'admin'].includes(req.user.role);
  async function scope(req: Request, input: z.infer<typeof scopeInput>) {
    const organization = await organizationContext(db, req.workspaceId, req.user.id, req.user.role);
    const teamId = isAdmin(req) ? input.team_id || null : req.user.team_id || null;
    if (input.team_id && !organization.teams.some((t) => t.id === input.team_id))
      throw new HttpError(404, 'Team not found.');
    const visible = (await visibleProjects(req)).filter((p) => !p.archived_at);
    const linked = teamId
      ? await db.all<{ id: string }>(
          `SELECT p.id FROM projects p WHERE p.workspace_id=? AND p.archived_at IS NULL AND (
   EXISTS(SELECT 1 FROM project_team_assignments a WHERE a.project_id=p.id AND a.workspace_id=p.workspace_id AND a.team_id=?) OR
   EXISTS(SELECT 1 FROM employee_profiles e WHERE e.workspace_id=p.workspace_id AND e.team_id=? AND (e.user_id=p.lead_id OR EXISTS(SELECT 1 FROM project_members pm WHERE pm.project_id=p.id AND pm.user_id=e.user_id AND pm.workspace_id=p.workspace_id))) OR
   EXISTS(SELECT 1 FROM issues i JOIN employee_profiles e ON e.workspace_id=i.workspace_id AND e.user_id=COALESCE(i.assignee_id,i.reporter_id) WHERE i.project_id=p.id AND i.deleted_at IS NULL AND e.team_id=?) OR
   EXISTS(SELECT 1 FROM organization_work w WHERE w.project_id=p.id AND w.workspace_id=p.workspace_id AND w.team_id=?))`,
          [req.workspaceId, teamId, teamId, teamId, teamId],
        )
      : [];
    const projectIds = new Set(linked.map((p) => p.id));
    const projects = visible.filter((p) => !teamId || projectIds.has(p.id));
    if (input.project_id && !projects.some((p) => p.id === input.project_id))
      throw new HttpError(404, 'Project not found in this overview.');
    const selected = projects.filter((p) => !input.project_id || p.id === input.project_id);
    const ids = selected.map((p) => p.id);
    const where = `i.workspace_id=? AND i.deleted_at IS NULL AND i.project_id IN (${marks(ids)})${teamId ? ' AND ep.team_id=?' : ''}`;
    const params: unknown[] = [req.workspaceId, ...ids, ...(teamId ? [teamId] : [])];
    return {
      organization,
      teamId,
      projects: selected,
      availableProjects: projects,
      ids,
      where,
      params,
    };
  }
  const issueJoin =
    'FROM issues i JOIN statuses s ON s.id=i.status_id LEFT JOIN employee_profiles ep ON ep.workspace_id=i.workspace_id AND ep.user_id=COALESCE(i.assignee_id,i.reporter_id)';
  app.get('/api/v1/organization/overview', async (req, res) => {
    const input = scopeInput
      .extend({
        days: z.coerce
          .number()
          .refine((n) => [7, 14, 30].includes(n))
          .default(14),
      })
      .parse(req.query);
    const current = await scope(req, input);
    const { teamId, projects, ids, where, params, organization } = current;
    const today = now().slice(0, 10);
    const start = new Date(`${today}T00:00:00Z`);
    start.setUTCDate(start.getUTCDate() - input.days + 1);
    const since = start.toISOString();
    const summary = numbers(
      await db.one<HomeCounts>(`SELECT ${countSql} ${issueJoin} WHERE ${where}`, [
        today,
        ...params,
      ]),
    );
    const teamRows = await db.all<HomeCounts & { team_id: string }>(
      `SELECT ep.team_id,${countSql} ${issueJoin} WHERE ${where} GROUP BY ep.team_id`,
      [today, ...params],
    );
    const projectRows = await db.all<HomeCounts & { project_id: string }>(
      `SELECT i.project_id,${countSql} ${issueJoin} WHERE ${where} GROUP BY i.project_id`,
      [today, ...params],
    );
    const assignments = await db.all<{ project_id: string; team_id: string }>(
      'SELECT project_id,team_id FROM project_team_assignments WHERE workspace_id=?',
      [req.workspaceId],
    );
    const versions = await db.all<{ project_id: string; version: number }>(
      'SELECT project_id,version FROM project_team_settings WHERE workspace_id=?',
      [req.workspaceId],
    );
    const linkedTeams = await db.all<{ project_id: string; team_id: string }>(
      `SELECT DISTINCT i.project_id,ep.team_id ${issueJoin} WHERE ${where}
       UNION SELECT pm.project_id,e.team_id FROM project_members pm JOIN employee_profiles e ON e.workspace_id=pm.workspace_id AND e.user_id=pm.user_id WHERE pm.workspace_id=? AND pm.project_id IN (${marks(ids)})${teamId ? ' AND e.team_id=?' : ''}
       UNION SELECT p.id AS project_id,e.team_id FROM projects p JOIN employee_profiles e ON e.workspace_id=p.workspace_id AND e.user_id=p.lead_id WHERE p.workspace_id=? AND p.id IN (${marks(ids)})${teamId ? ' AND e.team_id=?' : ''}
       UNION SELECT w.project_id,w.team_id FROM organization_work w WHERE w.workspace_id=? AND w.project_id IN (${marks(ids)})${teamId ? ' AND w.team_id=?' : ''}`,
      [
        ...params,
        ...Array.from({ length: 3 }, () => [
          req.workspaceId,
          ...ids,
          ...(teamId ? [teamId] : []),
        ]).flat(),
      ],
    );
    const peopleRows = await db.all<{
      id: string;
      name: string;
      color: string;
      team_id: string;
      team_role: HomeOverview['people'][number]['team_role'];
      organization_role: HomeOverview['people'][number]['organization_role'];
      last_login: string | null;
    }>(
      `SELECT u.id,u.name,u.color,e.team_id,e.team_role,m.role AS organization_role,(SELECT MAX(h.created_at) FROM home_events h WHERE h.workspace_id=e.workspace_id AND h.actor_id=u.id AND h.action IN ('auth.login','member.joined')) AS last_login FROM memberships m JOIN users u ON u.id=m.user_id JOIN employee_profiles e ON e.workspace_id=m.workspace_id AND e.user_id=m.user_id WHERE m.workspace_id=? AND NOT EXISTS(SELECT 1 FROM member_deactivations md WHERE md.workspace_id=m.workspace_id AND md.user_id=m.user_id)${teamId ? ' AND e.team_id=?' : ''} ORDER BY u.name`,
      [req.workspaceId, ...(teamId ? [teamId] : [])],
    );
    const workloads = await db.all<{ assignee_id: string; open: number; completed: number }>(
      `SELECT i.assignee_id,SUM(CASE WHEN s.category='done' THEN 0 ELSE 1 END) AS open,SUM(CASE WHEN s.category='done' THEN 1 ELSE 0 END) AS completed ${issueJoin} WHERE ${where} GROUP BY i.assignee_id`,
      params,
    );
    const connected = online(req.workspaceId);
    const people = peopleRows.map((p) => ({
      ...p,
      online: connected.has(p.id),
      open: Number(workloads.find((w) => w.assignee_id === p.id)?.open || 0),
      completed: Number(workloads.find((w) => w.assignee_id === p.id)?.completed || 0),
    }));
    const workRows = await db.all<{
      team_id: string;
      total: number;
      completed: number;
      overdue: number;
    }>(
      `SELECT w.team_id,COUNT(*) AS total,SUM(CASE WHEN w.state='done' THEN 1 ELSE 0 END) AS completed,SUM(CASE WHEN w.state<>'done' AND w.due_date<>'' AND w.due_date<? THEN 1 ELSE 0 END) AS overdue FROM organization_work w WHERE w.workspace_id=?${teamId ? ' AND w.team_id=?' : ''} AND (w.project_id IN (${marks(ids)})${input.project_id ? '' : ' OR w.project_id IS NULL'}) GROUP BY w.team_id`,
      [today, req.workspaceId, ...(teamId ? [teamId] : []), ...ids],
    );
    const created = await db.all<{ date: string; n: number }>(
      `SELECT SUBSTR(i.created_at,1,10) AS date,COUNT(*) AS n ${issueJoin} WHERE ${where} AND i.created_at>=? GROUP BY SUBSTR(i.created_at,1,10)`,
      [...params, since],
    );
    const completed = await db.all<{ date: string; n: number }>(
      `SELECT SUBSTR(h.created_at,1,10) AS date,COUNT(DISTINCT i.id) AS n ${issueJoin} JOIN history h ON h.issue_id=i.id AND h.workspace_id=i.workspace_id JOIN statuses target ON target.id=h.new_value WHERE ${where} AND h.field='status_id' AND target.category='done' AND h.created_at>=? AND NOT EXISTS(SELECT 1 FROM statuses previous WHERE previous.id=h.old_value AND previous.category='done') GROUP BY SUBSTR(h.created_at,1,10)`,
      [...params, since],
    );
    const trend = Array.from({ length: input.days }, (_, offset) => {
      const day = new Date(start);
      day.setUTCDate(day.getUTCDate() + offset);
      const date = day.toISOString().slice(0, 10);
      return {
        date,
        created: Number(created.find((r) => r.date === date)?.n || 0),
        completed: Number(completed.find((r) => r.date === date)?.n || 0),
      };
    });
    const attention = await db.all<HomeOverview['attention'][number]>(
      `SELECT i.id,i.\`key\`,i.summary,i.priority,i.due_date,i.flagged,i.assignee_id ${issueJoin} WHERE ${where} AND s.category<>'done' AND (i.flagged=1 OR i.priority IN ('critical','high') OR (i.due_date<>'' AND i.due_date<?)) ORDER BY i.flagged DESC,CASE WHEN i.due_date='' THEN '9999' ELSE i.due_date END,i.updated_at DESC LIMIT 8`,
      [...params, today],
    );
    const scopedTeams = organization.teams.filter((t) => !teamId || t.id === teamId);
    const body: HomeOverview = {
      scope: isAdmin(req) && !teamId ? 'organization' : 'team',
      team_id: teamId,
      generated_at: now(),
      days: input.days,
      available_projects: current.availableProjects.map((p) => ({ id: p.id, name: p.name })),
      summary: {
        ...summary,
        projects: projects.length,
        people: people.length,
        online: people.filter((p) => p.online).length,
        team_work: workRows.reduce((n, w) => n + Number(w.total), 0),
        team_work_done: workRows.reduce((n, w) => n + Number(w.completed), 0),
        team_work_overdue: workRows.reduce((n, w) => n + Number(w.overdue), 0),
      },
      teams: scopedTeams.map((t) => ({
        ...numbers(teamRows.find((r) => r.team_id === t.id)),
        id: t.id,
        name: t.name,
        color: t.color,
        people: people.filter((p) => p.team_id === t.id).length,
        online: people.filter((p) => p.team_id === t.id && p.online).length,
        projects: new Set(
          [...assignments, ...linkedTeams]
            .filter((a) => a.team_id === t.id && ids.includes(a.project_id))
            .map((a) => a.project_id),
        ).size,
        work: Number(workRows.find((w) => w.team_id === t.id)?.total || 0),
        work_done: Number(workRows.find((w) => w.team_id === t.id)?.completed || 0),
      })),
      projects: projects.map((p) => ({
        ...numbers(projectRows.find((r) => r.project_id === p.id)),
        id: p.id,
        name: p.name,
        key: p.key,
        color: p.color,
        lead_id: p.lead_id,
        team_ids: assignments
          .filter(
            (a) =>
              a.project_id === p.id &&
              (isAdmin(req) || scopedTeams.some((t) => t.id === a.team_id)),
          )
          .map((a) => a.team_id),
        linked_team_ids: linkedTeams
          .filter(
            (a) =>
              a.project_id === p.id && a.team_id && scopedTeams.some((t) => t.id === a.team_id),
          )
          .map((a) => a.team_id),
        assignment_version: Number(versions.find((v) => v.project_id === p.id)?.version || 0),
      })),
      people,
      trend,
      attention,
    };
    res.json(body);
  });
  app.get('/api/v1/organization/activity', async (req, res) => {
    const input = scopeInput
      .extend({
        kind: z.enum(['all', 'signins', 'work']).default('all'),
        days: z.coerce
          .number()
          .refine((n) => [7, 14, 30].includes(n))
          .default(14),
        actor_id: z.string().max(64).optional(),
        limit: z.coerce.number().int().min(1).max(50).default(20),
        cursor: z.string().max(512).optional(),
      })
      .parse(req.query);
    const current = await scope(req, input);
    const { teamId, ids } = current;
    const allAdmin = isAdmin(req) && !teamId && !input.project_id;
    const clauses = [
      'h.workspace_id=?',
      allAdmin
        ? '(h.project_id IS NULL OR EXISTS(SELECT 1 FROM projects p WHERE p.id=h.project_id AND p.workspace_id=h.workspace_id))'
        : `(h.project_id IS NULL OR h.project_id IN (${marks(ids)}))`,
    ];
    const params: unknown[] = [req.workspaceId, ...(allAdmin ? [] : ids)];
    const since = new Date(`${now().slice(0, 10)}T00:00:00Z`);
    since.setUTCDate(since.getUTCDate() - input.days + 1);
    clauses.push('h.created_at>=?');
    params.push(since.toISOString());
    if (!isAdmin(req)) {
      clauses.push(
        `(h.entity_type<>'issue' OR EXISTS(SELECT 1 FROM issues current_issue WHERE current_issue.id=h.entity_id AND current_issue.workspace_id=h.workspace_id AND current_issue.project_id IN (${marks(ids)})))`,
      );
      params.push(...ids);
    }
    if (teamId) {
      clauses.push(`(h.team_id=? OR ep.team_id=? OR h.project_id IN (${marks(ids)}))`);
      params.push(teamId, teamId, ...ids);
    }
    if (input.project_id) {
      clauses.push('h.project_id=?');
      params.push(input.project_id);
    }
    if (input.actor_id) {
      if (
        !(await db.one(
          `SELECT e.user_id FROM employee_profiles e WHERE e.workspace_id=? AND e.user_id=?${teamId ? ' AND e.team_id=?' : ''}`,
          [req.workspaceId, input.actor_id, ...(teamId ? [teamId] : [])],
        ))
      )
        throw new HttpError(404, 'Member not found.');
      clauses.push('h.actor_id=?');
      params.push(input.actor_id);
    }
    if (input.kind === 'signins')
      clauses.push("h.action IN ('auth.login','auth.logout','member.joined')");
    if (input.kind === 'work')
      clauses.push("h.action NOT IN ('auth.login','auth.logout','member.joined')");
    if (input.cursor) {
      let cursor: { date: string; id: string };
      try {
        cursor = z
          .object({ date: z.iso.datetime(), id: z.string().min(1).max(64) })
          .parse(JSON.parse(Buffer.from(input.cursor, 'base64url').toString()));
      } catch {
        throw new HttpError(400, 'Invalid activity cursor.');
      }
      clauses.push('(h.created_at<? OR (h.created_at=? AND h.id<?))');
      params.push(cursor.date, cursor.date, cursor.id);
    }
    const rows = await db.all<HomeEvent>(
      `SELECT h.*,u.name AS actor_name,u.color AS actor_color FROM home_events h JOIN users u ON u.id=h.actor_id LEFT JOIN employee_profiles ep ON ep.workspace_id=h.workspace_id AND ep.user_id=h.actor_id WHERE ${clauses.join(' AND ')} ORDER BY h.created_at DESC,h.id DESC LIMIT ${input.limit + 1}`,
      params,
    );
    const items = rows.slice(0, input.limit);
    const last = items.at(-1);
    res.json({
      items,
      next_cursor:
        rows.length > input.limit && last
          ? Buffer.from(JSON.stringify({ date: last.created_at, id: last.id })).toString(
              'base64url',
            )
          : null,
    });
  });
  app.put('/api/v1/projects/:id/teams', async (req, res) => {
    canAdmin(req);
    const projectId = String(req.params.id);
    const body = z
      .object({
        team_ids: z
          .array(z.string().min(1).max(64))
          .max(100)
          .transform((v) => [...new Set(v)]),
        version: z.number().int().min(0),
      })
      .strict()
      .parse(req.body);
    await db.transaction(async () => {
      await db.run('UPDATE workspaces SET name=name WHERE id=?', [req.workspaceId]);
      await project(req, projectId, true);
      const teams = await db.all<{ id: string }>(
        'SELECT id FROM organization_teams WHERE workspace_id=?',
        [req.workspaceId],
      );
      if (body.team_ids.some((id) => !teams.some((t) => t.id === id)))
        throw new HttpError(404, 'Choose teams from this organization.');
      const previous = await db.one<{ version: number }>(
        'SELECT version FROM project_team_settings WHERE project_id=? AND workspace_id=?',
        [projectId, req.workspaceId],
      );
      if ((previous?.version || 0) !== body.version)
        throw new HttpError(
          409,
          'Project team assignments changed. Refresh before saving.',
          'EDIT_CONFLICT',
        );
      if (previous)
        await db.run(
          'UPDATE project_team_settings SET version=version+1 WHERE project_id=? AND workspace_id=?',
          [projectId, req.workspaceId],
        );
      else
        await db.insert('project_team_settings', {
          workspace_id: req.workspaceId,
          project_id: projectId,
          version: 1,
        });
      await db.run('DELETE FROM project_team_assignments WHERE project_id=? AND workspace_id=?', [
        projectId,
        req.workspaceId,
      ]);
      for (const teamId of body.team_ids)
        await db.insert('project_team_assignments', {
          workspace_id: req.workspaceId,
          project_id: projectId,
          team_id: teamId,
        });
      await audit(req, 'project.teams.assigned', projectId);
    });
    broadcast(req);
    res.json({ team_ids: body.team_ids, version: body.version + 1 });
  });
}
