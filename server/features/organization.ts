import type { Express, Request } from 'express';
import { z } from 'zod';
import type { Database } from '../db.js';
import { canAdmin, canWrite, HttpError } from '../auth.js';
import { id, now } from '../seed.js';
import { organizationContext, parseTeam } from '../organization.js';
import { sanitizeRichText } from '../richtext.js';
import { requireActiveMember } from './accounts.js';
import {
  dashboardSections,
  defaultTeamPermissions,
  teamCapabilities,
  workStates,
  type OrganizationWork,
  type TeamCapability,
} from '../../shared/organization.js';
import type { Issue, Project } from '../../shared/types.js';

export const employeeIdSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z0-9][A-Z0-9_-]{1,39}$/, 'Use 2–40 letters, numbers, hyphens or underscores.');
export const teamRoleSchema = z.enum(['manager', 'lead', 'member', 'viewer']);
const capabilities = z
  .array(z.enum(teamCapabilities))
  .max(4)
  .transform((v) => [...new Set(v)]);
const teamBody = z.object({
  name: z.string().trim().min(2).max(100),
  description: z.string().trim().max(2000).default(''),
  color: z
    .string()
    .regex(/^#[a-f\d]{6}$/i)
    .default('#dce8da'),
  sections: z
    .array(z.enum(dashboardSections))
    .min(1)
    .max(6)
    .transform((v) => [...new Set(v)]),
  permissions: z
    .object({
      manager: capabilities.default(defaultTeamPermissions.manager),
      lead: capabilities,
      member: capabilities,
      viewer: z.array(z.enum(teamCapabilities)).max(0),
    })
    .default(defaultTeamPermissions),
});
export async function reserveEmployeeInvite(
  db: Database,
  workspaceId: string,
  inviteId: string,
  body: { employee_id?: string; team_id?: string; team_role?: string },
) {
  if (!body.team_id && !body.employee_id) return;
  if (!body.team_id || !body.employee_id)
    throw new HttpError(400, 'Choose a team and employee ID together.');
  await db.run('UPDATE workspaces SET name=name WHERE id=?', [workspaceId]);
  if (
    !(await db.one('SELECT id FROM organization_teams WHERE id=? AND workspace_id=?', [
      body.team_id,
      workspaceId,
    ]))
  )
    throw new HttpError(404, 'Team not found.');
  await availableEmployeeId(db, workspaceId, body.employee_id);
  await db.insert('employee_invites', {
    invite_id: inviteId,
    workspace_id: workspaceId,
    employee_id: body.employee_id,
    team_id: body.team_id,
    team_role: body.team_role || 'member',
  });
}
async function availableEmployeeId(
  db: Database,
  workspaceId: string,
  employeeId: string,
  excludeUser = '',
) {
  if (
    (await db.one(
      'SELECT user_id FROM employee_profiles WHERE workspace_id=? AND employee_id=? AND user_id<>?',
      [workspaceId, employeeId, excludeUser],
    )) ||
    (await db.one(
      'SELECT e.invite_id FROM employee_invites e JOIN invites i ON i.id=e.invite_id WHERE e.workspace_id=? AND e.employee_id=? AND i.accepted_at IS NULL AND i.expires_at>?',
      [workspaceId, employeeId, now()],
    ))
  )
    throw new HttpError(
      409,
      'This employee ID is already assigned or reserved by a pending invitation.',
    );
}
export async function claimEmployeeInvite(
  db: Database,
  workspaceId: string,
  userId: string,
  inviteId: string,
  employeeId?: string,
) {
  const assignment = await db.one<{ employee_id: string; team_id: string; team_role: string }>(
    'SELECT employee_id,team_id,team_role FROM employee_invites WHERE invite_id=? AND workspace_id=?',
    [inviteId, workspaceId],
  );
  if (!assignment) return;
  if (employeeId && employeeId.toUpperCase() !== assignment.employee_id)
    throw new HttpError(400, 'Use the employee ID assigned in your invitation.');
  await db.run('UPDATE workspaces SET name=name WHERE id=?', [workspaceId]);
  if (
    await db.one(
      'SELECT user_id FROM employee_profiles WHERE workspace_id=? AND employee_id=? AND user_id<>?',
      [workspaceId, assignment.employee_id, userId],
    )
  )
    throw new HttpError(409, 'This employee ID is already assigned.');
  // The email-bound invitation is the authority; never derive a team from an ID prefix.
  await db.run('DELETE FROM employee_profiles WHERE workspace_id=? AND user_id=?', [
    workspaceId,
    userId,
  ]);
  await db.insert('employee_profiles', {
    workspace_id: workspaceId,
    user_id: userId,
    ...assignment,
    version: 1,
  });
}
export function requireWorkPrivilege(req: Request) {
  if (
    !['owner', 'admin'].includes(req.user.role) &&
    req.user.team_permissions &&
    !req.user.team_permissions.includes('work')
  )
    throw new HttpError(
      403,
      'Your team role cannot change project work. Ask an organization administrator.',
    );
}
type Context = {
  app: Express;
  db: Database;
  project: (req: Request, id: string, write?: boolean) => Promise<Project>;
  issue: (req: Request, id: string, write?: boolean) => Promise<Issue>;
  visibleProjects: (req: Request) => Promise<Project[]>;
  audit: (req: Request, action: string, target: string, detail?: string) => Promise<void>;
  broadcast: (req: Request) => void;
};
export function registerOrganizationRoutes({
  app,
  db,
  project,
  issue,
  visibleProjects,
  audit,
  broadcast,
}: Context) {
  const admin = (req: Request) => ['owner', 'admin'].includes(req.user.role);
  function manageTeam(req: Request) {
    canWrite(req);
    if (!admin(req) && req.user.team_role !== 'manager')
      throw new HttpError(
        403,
        'A team manager or organization administrator must make this change.',
      );
  }
  const context = (req: Request) =>
    organizationContext(db, req.workspaceId, req.user.id, req.user.role);
  async function team(req: Request, teamId: string, capability?: TeamCapability) {
    const row = await db.one<Record<string, unknown>>(
      'SELECT * FROM organization_teams WHERE workspace_id=? AND id=?',
      [req.workspaceId, teamId],
    );
    if (!row || (!admin(req) && req.user.team_id !== teamId))
      throw new HttpError(404, 'Team dashboard not found.');
    const record = parseTeam(row);
    if (capability) {
      canWrite(req);
      if (!admin(req) && !record.permissions[req.user.team_role || 'viewer'].includes(capability))
        throw new HttpError(
          403,
          'Your team role does not allow this action. Ask an organization administrator.',
        );
    }
    return record;
  }
  app.get('/api/v1/organization', async (req, res) => res.json(await context(req)));
  app.post('/api/v1/organization/teams', async (req, res) => {
    canAdmin(req);
    const body = teamBody.parse(req.body);
    const teamId = id();
    await db.transaction(async () => {
      await db.insert('organization_teams', {
        ...body,
        id: teamId,
        workspace_id: req.workspaceId,
        slug: `${body.name
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '-')
          .slice(0, 80)}-${teamId.slice(0, 8)}`,
        sections: JSON.stringify(body.sections),
        permissions: JSON.stringify(body.permissions),
        version: 1,
        created_at: now(),
        updated_at: now(),
      });
      await audit(req, 'team.created', teamId, body.name);
    });
    broadcast(req);
    res.status(201).json(await team(req, teamId));
  });
  app.patch('/api/v1/organization/teams/:id', async (req, res) => {
    canAdmin(req);
    const teamId = String(req.params.id);
    const body = teamBody.extend({ version: z.number().int().positive() }).parse(req.body);
    await db.transaction(async () => {
      await team(req, teamId);
      const changed = await db.run(
        'UPDATE organization_teams SET name=?,description=?,color=?,sections=?,permissions=?,version=version+1,updated_at=? WHERE id=? AND workspace_id=? AND version=?',
        [
          body.name,
          body.description,
          body.color,
          JSON.stringify(body.sections),
          JSON.stringify(body.permissions),
          now(),
          teamId,
          req.workspaceId,
          body.version,
        ],
      );
      if (!changed)
        throw new HttpError(409, 'This team changed. Refresh before saving.', 'EDIT_CONFLICT');
      await audit(req, 'team.updated', teamId, body.name);
    });
    broadcast(req);
    res.json(await team(req, teamId));
  });
  app.get('/api/v1/organization/employees', async (req, res) => {
    manageTeam(req);
    res.json(
      await db.all(
        'SELECT e.*,u.name,u.email,u.color,m.role,CASE WHEN md.user_id IS NULL THEN 1 ELSE 0 END AS active FROM employee_profiles e JOIN users u ON u.id=e.user_id JOIN memberships m ON m.workspace_id=e.workspace_id AND m.user_id=e.user_id LEFT JOIN member_deactivations md ON md.workspace_id=e.workspace_id AND md.user_id=e.user_id WHERE e.workspace_id=?' +
          (admin(req) ? '' : ' AND e.team_id=?') +
          ' ORDER BY u.name',
        admin(req) ? [req.workspaceId] : [req.workspaceId, req.user.team_id],
      ),
    );
  });
  app.put('/api/v1/organization/employees/:id', async (req, res) => {
    manageTeam(req);
    const userId = String(req.params.id);
    const body = z
      .object({
        employee_id: employeeIdSchema,
        team_id: z.string(),
        team_role: teamRoleSchema,
        version: z.number().int().positive(),
      })
      .parse(req.body);
    await db.transaction(async () => {
      await db.run('UPDATE workspaces SET name=name WHERE id=?', [req.workspaceId]);
      await team(req, body.team_id);
      await requireActiveMember(db, req.workspaceId, userId, 404);
      const old = await db.one<{
        team_id: string;
        employee_id: string;
        team_role: string;
        role: string;
      }>(
        'SELECT e.team_id,e.employee_id,e.team_role,m.role FROM employee_profiles e JOIN memberships m ON m.workspace_id=e.workspace_id AND m.user_id=e.user_id WHERE e.workspace_id=? AND e.user_id=?',
        [req.workspaceId, userId],
      );
      if (!old || (!admin(req) && old.team_id !== req.user.team_id))
        throw new HttpError(404, 'Employee not found.');
      if (
        !admin(req) &&
        (body.employee_id !== old.employee_id ||
          body.team_id !== old.team_id ||
          body.team_role === 'manager' ||
          old.team_role === 'manager' ||
          ['owner', 'admin'].includes(old.role) ||
          userId === req.user.id)
      )
        throw new HttpError(
          403,
          'Only organization admins can change employee IDs, teams or managers.',
        );
      await availableEmployeeId(db, req.workspaceId, body.employee_id, userId);
      if (
        old?.team_id !== body.team_id &&
        (await db.one(
          'SELECT id FROM organization_work WHERE workspace_id=? AND owner_id=? AND state<>?',
          [req.workspaceId, userId, 'done'],
        ))
      )
        throw new HttpError(
          409,
          'Reassign or complete this employee’s open BRDs, daily tasks and versions before changing teams.',
        );
      if (
        !(await db.run(
          'UPDATE employee_profiles SET employee_id=?,team_id=?,team_role=?,version=version+1 WHERE workspace_id=? AND user_id=? AND version=?',
          [body.employee_id, body.team_id, body.team_role, req.workspaceId, userId, body.version],
        ))
      )
        throw new HttpError(
          409,
          'This employee assignment changed. Refresh before saving.',
          'EDIT_CONFLICT',
        );
      await audit(req, 'employee.assigned', userId, JSON.stringify(body));
    });
    broadcast(req);
    res.json({ ok: true });
  });
  app.patch('/api/v1/organization/teams/:id/layout', async (req, res) => {
    manageTeam(req);
    const teamId = String(req.params.id);
    const body = teamBody
      .omit({ permissions: true })
      .extend({ version: z.number().int().positive() })
      .strict()
      .parse(req.body);
    await db.transaction(async () => {
      await team(req, teamId);
      if (
        !(await db.run(
          'UPDATE organization_teams SET name=?,description=?,color=?,sections=?,version=version+1,updated_at=? WHERE id=? AND workspace_id=? AND version=?',
          [
            body.name,
            body.description,
            body.color,
            JSON.stringify(body.sections),
            now(),
            teamId,
            req.workspaceId,
            body.version,
          ],
        ))
      )
        throw new HttpError(409, 'This dashboard changed. Refresh before saving.', 'EDIT_CONFLICT');
      await audit(req, 'team.layout.updated', teamId, body.name);
    });
    broadcast(req);
    res.json(await team(req, teamId));
  });
  const capabilityFor = (kind: string): TeamCapability =>
    kind === 'brd' ? 'brds' : kind === 'version' ? 'versions' : 'daily';
  const bodySchema = z.object({
    team_id: z.string().min(1),
    project_id: z.string().nullable().default(null),
    kind: z.enum(['brd', 'daily', 'version']),
    title: z.string().trim().min(2).max(200),
    content: z.string().max(100000).transform(sanitizeRichText).default(''),
    state: z.enum(workStates).default('draft'),
    owner_id: z.string().min(1),
    due_date: z
      .string()
      .refine((v) => !v || /^\d{4}-\d{2}-\d{2}$/.test(v), 'Use YYYY-MM-DD.')
      .default(''),
    version_tag: z.string().trim().max(60).default(''),
    issue_ids: z
      .array(z.string())
      .max(100)
      .transform((v) => [...new Set(v)])
      .default([]),
  });
  async function linked(req: Request, work: Record<string, unknown>) {
    const rows = await db.all<{ issue_id: string; project_id: string }>(
      'SELECT l.issue_id,i.project_id FROM organization_work_issues l JOIN issues i ON i.id=l.issue_id WHERE l.work_id=? AND i.deleted_at IS NULL',
      [work.id],
    );
    const visible = new Set((await visibleProjects(req)).map((p) => p.id));
    return {
      ...work,
      issue_ids: rows.filter((r) => visible.has(r.project_id)).map((r) => r.issue_id),
      has_hidden_links: rows.some((r) => !visible.has(r.project_id)),
    } as unknown as OrganizationWork;
  }
  async function record(req: Request, workId: string, write = false) {
    const row = await db.one<Record<string, unknown>>(
      'SELECT * FROM organization_work WHERE id=? AND workspace_id=?',
      [workId, req.workspaceId],
    );
    if (!row) throw new HttpError(404, 'Work item not found.');
    await team(req, String(row.team_id), write ? capabilityFor(String(row.kind)) : undefined);
    if (row.project_id) await project(req, String(row.project_id), write);
    if (
      write &&
      !admin(req) &&
      !['manager', 'lead'].includes(req.user.team_role || '') &&
      row.owner_id !== req.user.id &&
      row.created_by !== req.user.id
    )
      throw new HttpError(
        403,
        'Only the owner, author, team lead or Team Manager can edit this item.',
      );
    return row;
  }
  async function validate(req: Request, body: z.infer<typeof bodySchema>) {
    await team(req, body.team_id, capabilityFor(body.kind));
    if (body.project_id) await project(req, body.project_id, true);
    await requireActiveMember(db, req.workspaceId, body.owner_id);
    const owner = await db.one<{ team_id: string; role: string }>(
      'SELECT e.team_id,m.role FROM employee_profiles e JOIN memberships m ON m.workspace_id=e.workspace_id AND m.user_id=e.user_id WHERE e.workspace_id=? AND e.user_id=?',
      [req.workspaceId, body.owner_id],
    );
    if (!owner || (owner.team_id !== body.team_id && !['owner', 'admin'].includes(owner.role)))
      throw new HttpError(400, 'Choose an owner assigned to this team.');
    if (body.kind === 'version' && !body.version_tag)
      throw new HttpError(400, 'A version tag is required.');
    const canonicalIds: string[] = [];
    for (const issueId of body.issue_ids) {
      const value = await issue(req, issueId);
      if (body.project_id && value.project_id !== body.project_id)
        throw new HttpError(400, 'Linked issues must belong to the selected project.');
      canonicalIds.push(value.id);
    }
    body.issue_ids = [...new Set(canonicalIds)];
  }
  app.get('/api/v1/organization/work', async (req, res) => {
    const input = z
      .object({
        team_id: z.string().optional(),
        kind: z.enum(['brd', 'daily', 'version']).optional(),
        mine: z.enum(['true', 'false']).optional(),
      })
      .parse(req.query);
    if (input.team_id) await team(req, input.team_id);
    const clauses = ['workspace_id=?'];
    const params: unknown[] = [req.workspaceId];
    if (input.team_id || !admin(req)) {
      clauses.push('team_id=?');
      params.push(input.team_id || req.user.team_id || '');
    }
    if (input.kind) {
      clauses.push('kind=?');
      params.push(input.kind);
    }
    if (input.mine === 'true') {
      clauses.push('(owner_id=? OR created_by=?)');
      params.push(req.user.id, req.user.id);
    }
    const projects = new Set((await visibleProjects(req)).map((p) => p.id));
    clauses.push(
      `(project_id IS NULL${projects.size ? ` OR project_id IN (${[...projects].map(() => '?').join(',')})` : ''})`,
    );
    params.push(...projects);
    const rows = await db.all<Record<string, unknown>>(
      `SELECT * FROM organization_work WHERE ${clauses.join(' AND ')} ORDER BY updated_at DESC,id LIMIT 500`,
      params,
    );
    const links = rows.length
      ? await db.all<{ work_id: string; issue_id: string; project_id: string }>(
          `SELECT l.work_id,l.issue_id,i.project_id FROM organization_work_issues l JOIN issues i ON i.id=l.issue_id WHERE l.work_id IN (${rows.map(() => '?').join(',')}) AND i.deleted_at IS NULL`,
          rows.map((r) => r.id),
        )
      : [];
    res.json(
      rows.map((row) => ({
        ...row,
        issue_ids: links
          .filter((l) => l.work_id === row.id && projects.has(l.project_id))
          .map((l) => l.issue_id),
        has_hidden_links: links.some((l) => l.work_id === row.id && !projects.has(l.project_id)),
      })),
    );
  });
  app.get('/api/v1/organization/work/:id', async (req, res) =>
    res.json(await linked(req, await record(req, String(req.params.id)))),
  );
  app.post('/api/v1/organization/work', async (req, res) => {
    const body = bodySchema.parse(req.body);
    const workId = id();
    await db.transaction(async () => {
      await validate(req, body);
      const { issue_ids, ...fields } = body;
      await db.insert('organization_work', {
        ...fields,
        id: workId,
        workspace_id: req.workspaceId,
        version: 1,
        created_by: req.user.id,
        created_at: now(),
        updated_at: now(),
      });
      for (const issueId of issue_ids)
        await db.insert('organization_work_issues', { work_id: workId, issue_id: issueId });
      await audit(req, `${body.kind}.created`, workId, body.title);
    });
    broadcast(req);
    res.status(201).json(await linked(req, await record(req, workId)));
  });
  app.patch('/api/v1/organization/work/:id', async (req, res) => {
    const workId = String(req.params.id);
    const body = bodySchema.extend({ version: z.number().int().positive() }).parse(req.body);
    await db.transaction(async () => {
      const old = await record(req, workId, true);
      if (old.team_id !== body.team_id || old.kind !== body.kind)
        throw new HttpError(400, 'The team and work type cannot be changed.');
      await validate(req, body);
      const oldLinks = await db.all<{
        issue_id: string;
        project_id: string;
        deleted_at: string | null;
      }>(
        'SELECT l.issue_id,i.project_id,i.deleted_at FROM organization_work_issues l JOIN issues i ON i.id=l.issue_id WHERE l.work_id=?',
        [workId],
      );
      const visible = new Set((await visibleProjects(req)).map((p) => p.id));
      const retained = oldLinks
        .filter((l) => l.deleted_at || !visible.has(l.project_id))
        .map((l) => l.issue_id);
      if (retained.length && old.project_id !== body.project_id)
        throw new HttpError(
          409,
          'An administrator must change the project while restricted work is linked.',
        );
      const changed = await db.run(
        'UPDATE organization_work SET project_id=?,title=?,content=?,state=?,owner_id=?,due_date=?,version_tag=?,version=version+1,updated_at=? WHERE id=? AND workspace_id=? AND version=?',
        [
          body.project_id,
          body.title,
          body.content,
          body.state,
          body.owner_id,
          body.due_date,
          body.version_tag,
          now(),
          workId,
          req.workspaceId,
          body.version,
        ],
      );
      if (!changed)
        throw new HttpError(
          409,
          'This item changed. Your draft is still open; refresh before saving.',
          'EDIT_CONFLICT',
        );
      await db.run('DELETE FROM organization_work_issues WHERE work_id=?', [workId]);
      for (const issueId of [...new Set([...body.issue_ids, ...retained])])
        await db.insert('organization_work_issues', { work_id: workId, issue_id: issueId });
      await audit(req, `${body.kind}.updated`, workId, body.title);
    });
    broadcast(req);
    res.json(await linked(req, await record(req, workId)));
  });
  app.delete('/api/v1/organization/work/:id', async (req, res) => {
    const workId = String(req.params.id);
    const version = z.coerce.number().int().positive().parse(req.query.version);
    await db.transaction(async () => {
      const old = await record(req, workId, true);
      if (old.version !== version)
        throw new HttpError(409, 'This item changed. Refresh before deleting.', 'EDIT_CONFLICT');
      await audit(req, `${old.kind}.deleted`, workId, String(old.title));
      await db.run('DELETE FROM organization_work_issues WHERE work_id=?', [workId]);
      if (
        !(await db.run(
          'DELETE FROM organization_work WHERE id=? AND workspace_id=? AND version=?',
          [workId, req.workspaceId, version],
        ))
      )
        throw new HttpError(409, 'This item changed. Refresh before deleting.');
    });
    broadcast(req);
    res.json({ ok: true });
  });
}
