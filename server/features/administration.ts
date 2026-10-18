import type { Express, Request } from 'express';
import { z } from 'zod';
import type { Database } from '../db.js';
import type { Issue, Project, Role, Workspace } from '../../shared/types.js';
import type {
  WorkspaceInvite,
  WorkspaceMembership,
  ActiveSession,
  ProjectMember,
} from '../../shared/administration.js';
import { canAdmin, canWrite, clearCookies, createSession, HttpError } from '../auth.js';
import { id, now } from '../seed.js';
import { requireActiveMember } from './accounts.js';

interface AdministrationContext {
  app: Express;
  db: Database;
  project: (req: Request, id: string, write?: boolean) => Promise<Project>;
  visibleProjects: (req: Request, includeArchived?: boolean) => Promise<Project[]>;
  issue: (req: Request, id: string, write?: boolean) => Promise<Issue>;
  audit: (req: Request, action: string, target: string, detail?: string) => Promise<void>;
  broadcast: (req: Request) => void;
}
const projectRole = z.enum(['admin', 'member', 'viewer']);
const administrator = (req: Request) => ['owner', 'admin'].includes(req.user.role);
const recoveryDays = 30 * 86400_000;

export function registerAdministrationRoutes(ctx: AdministrationContext) {
  const { app, db, project, visibleProjects, audit, broadcast } = ctx;
  async function mayManage(req: Request, record: Project) {
    if (req.user.role === 'viewer') return false;
    if (administrator(req) || record.lead_id === req.user.id) return true;
    const member = await db.one<{ role: string }>(
      'SELECT role FROM project_members WHERE workspace_id = ? AND project_id = ? AND user_id = ?',
      [req.workspaceId, record.id, req.user.id],
    );
    return member?.role === 'admin';
  }
  async function managedProject(req: Request, projectId: string, archived = false) {
    canWrite(req);
    const record = archived
      ? (await visibleProjects(req, true)).find((p) => p.id === projectId)
      : await project(req, projectId, true);
    if (!record) throw new HttpError(404, 'Project not found.');
    if (!(await mayManage(req, record)))
      throw new HttpError(
        403,
        'A project lead or administrator must make this change.',
        'FORBIDDEN',
      );
    return record;
  }
  app.get('/api/v1/workspaces', async (req, res) => {
    const rows = await db.all<Workspace & { role: Role }>(
      'SELECT w.id,w.name,w.slug,m.role FROM workspaces w JOIN memberships m ON m.workspace_id = w.id WHERE m.user_id = ? AND NOT EXISTS (SELECT 1 FROM member_deactivations md WHERE md.workspace_id=m.workspace_id AND md.user_id=m.user_id) ORDER BY w.name,w.id',
      [req.user.id],
    );
    res.json(rows.map((w): WorkspaceMembership => ({ ...w, current: w.id === req.workspaceId })));
  });
  app.post('/api/v1/workspaces', async (req, res) => {
    const body = z.object({ name: z.string().trim().min(2).max(120) }).parse(req.body);
    const workspaceId = id();
    const slugBase =
      body.name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '')
        .slice(0, 80) || 'workspace';
    const workspace = {
      id: workspaceId,
      name: body.name,
      slug: `${slugBase}-${workspaceId.slice(0, 8)}`,
      created_at: now(),
    };
    await db.transaction(async () => {
      await db.insert('workspaces', workspace);
      await db.insert('memberships', {
        workspace_id: workspaceId,
        user_id: req.user.id,
        role: 'owner',
      });
      await db.insert('audit_log', {
        id: id(),
        workspace_id: workspaceId,
        actor_id: req.user.id,
        action: 'workspace.created',
        target_id: workspaceId,
        detail: body.name,
        created_at: now(),
      });
      await db.run('DELETE FROM sessions WHERE id = ? AND user_id = ?', [
        req.sessionId,
        req.user.id,
      ]);
      await createSession(db, res, req.user.id, workspaceId);
    });
    res.status(201).json(workspace);
  });
  app.post('/api/v1/workspaces/:id/switch', async (req, res) => {
    const workspaceId = String(req.params.id);
    await db.transaction(async () => {
      if (
        !(await db.one('SELECT user_id FROM memberships WHERE workspace_id = ? AND user_id = ?', [
          workspaceId,
          req.user.id,
        ]))
      )
        throw new HttpError(404, 'Workspace not found.');
      await db.run('DELETE FROM sessions WHERE id = ? AND user_id = ?', [
        req.sessionId,
        req.user.id,
      ]);
      await createSession(db, res, req.user.id, workspaceId);
    });
    res.json({ ok: true });
  });
  app.get('/api/v1/invites', async (req, res) => {
    canAdmin(req);
    const invites = await db.all<Omit<WorkspaceInvite, 'state'>>(
      'SELECT id,email,role,expires_at,created_at,accepted_at FROM invites WHERE workspace_id = ? ORDER BY created_at DESC',
      [req.workspaceId],
    );
    res.json(
      invites.map((invite): WorkspaceInvite => ({
        ...invite,
        state: invite.accepted_at ? 'accepted' : invite.expires_at <= now() ? 'expired' : 'pending',
      })),
    );
  });
  app.delete('/api/v1/invites/:id', async (req, res) => {
    canAdmin(req);
    await db.transaction(async () => {
      await db.run(
        'DELETE FROM employee_invites WHERE invite_id IN (SELECT id FROM invites WHERE id=? AND workspace_id=? AND accepted_at IS NULL)',
        [String(req.params.id), req.workspaceId],
      );
      const removed = await db.run(
        'DELETE FROM invites WHERE id = ? AND workspace_id = ? AND accepted_at IS NULL',
        [String(req.params.id), req.workspaceId],
      );
      if (!removed) throw new HttpError(404, 'This invitation is no longer pending.');
      await audit(req, 'invite.revoked', String(req.params.id));
    });
    broadcast(req);
    res.json({ ok: true });
  });
  app.get('/api/v1/sessions', async (req, res) => {
    const rows = await db.all<Omit<ActiveSession, 'current'>>(
      'SELECT s.id,s.workspace_id,w.name AS workspace_name,s.created_at,s.expires_at FROM sessions s JOIN workspaces w ON w.id = s.workspace_id WHERE s.user_id = ? AND s.expires_at > ? ORDER BY s.created_at DESC',
      [req.user.id, now()],
    );
    res.json(
      rows.map((session): ActiveSession => ({ ...session, current: session.id === req.sessionId })),
    );
  });
  app.post('/api/v1/sessions/revoke-others', async (req, res) => {
    const revoked = await db.transaction(async () => {
      const count = await db.run('DELETE FROM sessions WHERE user_id = ? AND id <> ?', [
        req.user.id,
        req.sessionId,
      ]);
      await audit(req, 'sessions.revoked', req.user.id, String(count));
      return count;
    });
    res.json({ ok: true, revoked });
  });
  app.post('/api/v1/sessions/revoke-all', async (req, res) => {
    const revoked = await db.transaction(async () => {
      const count = await db.run('DELETE FROM sessions WHERE user_id = ?', [req.user.id]);
      await audit(req, 'sessions.all.revoked', req.user.id, String(count));
      return count;
    });
    clearCookies(res);
    res.json({ ok: true, revoked });
  });
  app.delete('/api/v1/sessions/:id', async (req, res) => {
    const sessionId = String(req.params.id);
    if (sessionId === req.sessionId)
      throw new HttpError(409, 'Use Sign out to end your current session.');
    await db.transaction(async () => {
      if (
        !(await db.run('DELETE FROM sessions WHERE id = ? AND user_id = ?', [
          sessionId,
          req.user.id,
        ]))
      )
        throw new HttpError(404, 'Session not found.');
      await audit(req, 'session.revoked', sessionId);
    });
    res.json({ ok: true });
  });
  app.get('/api/v1/projects/:id/members', async (req, res) => {
    const record = await project(req, String(req.params.id));
    const members = await db.all<ProjectMember>(
      'SELECT u.id,u.name,u.email,u.color,u.capacity,pm.role,m.role AS workspace_role FROM project_members pm JOIN users u ON u.id = pm.user_id JOIN memberships m ON m.workspace_id = pm.workspace_id AND m.user_id = pm.user_id WHERE pm.workspace_id = ? AND pm.project_id = ? ORDER BY u.name',
      [req.workspaceId, record.id],
    );
    res.json({ members, can_manage: await mayManage(req, record), lead_id: record.lead_id });
  });
  app.post('/api/v1/projects/:id/members', async (req, res) => {
    const record = await managedProject(req, String(req.params.id));
    const body = z
      .object({ user_id: z.string().min(1), role: projectRole.default('member') })
      .parse(req.body);
    await requireActiveMember(db, req.workspaceId, body.user_id, 404);
    await db.transaction(async () => {
      if (
        !(await db.one('SELECT user_id FROM memberships WHERE workspace_id = ? AND user_id = ?', [
          req.workspaceId,
          body.user_id,
        ]))
      )
        throw new HttpError(404, 'Workspace member not found.');
      if (
        await db.one(
          'SELECT user_id FROM project_members WHERE project_id = ? AND user_id = ? AND workspace_id = ?',
          [record.id, body.user_id, req.workspaceId],
        )
      )
        throw new HttpError(409, 'This person already belongs to the project.');
      await db.insert('project_members', {
        workspace_id: req.workspaceId,
        project_id: record.id,
        ...body,
      });
      await audit(req, 'project.member.added', record.id, JSON.stringify(body));
    });
    broadcast(req);
    res.status(201).json({ ok: true });
  });
  app.patch('/api/v1/projects/:id/members/:userId', async (req, res) => {
    const record = await managedProject(req, String(req.params.id));
    const userId = String(req.params.userId);
    const body = z.object({ role: projectRole }).parse(req.body);
    if (userId === record.lead_id && body.role !== 'admin')
      throw new HttpError(409, 'Change the project lead before reducing their project access.');
    await db.transaction(async () => {
      if (
        !(await db.one(
          'SELECT user_id FROM project_members WHERE project_id = ? AND user_id = ? AND workspace_id = ?',
          [record.id, userId, req.workspaceId],
        ))
      )
        throw new HttpError(404, 'Project member not found.');
      await db.run(
        'UPDATE project_members SET role = ? WHERE project_id = ? AND user_id = ? AND workspace_id = ?',
        [body.role, record.id, userId, req.workspaceId],
      );
      await audit(
        req,
        'project.member.role.changed',
        record.id,
        JSON.stringify({ user_id: userId, ...body }),
      );
    });
    broadcast(req);
    res.json({ ok: true });
  });
  app.delete('/api/v1/projects/:id/members/:userId', async (req, res) => {
    const record = await managedProject(req, String(req.params.id));
    const userId = String(req.params.userId);
    if (userId === record.lead_id)
      throw new HttpError(409, 'Choose another project lead before removing this person.');
    await db.transaction(async () => {
      if (
        !(await db.run(
          'DELETE FROM project_members WHERE project_id = ? AND user_id = ? AND workspace_id = ?',
          [record.id, userId, req.workspaceId],
        ))
      )
        throw new HttpError(404, 'Project member not found.');
      await audit(req, 'project.member.removed', record.id, userId);
    });
    broadcast(req);
    res.json({ ok: true });
  });
  app.patch('/api/v1/projects/:id/administration', async (req, res) => {
    const record = await managedProject(req, String(req.params.id));
    const body = z
      .object({
        name: z.string().trim().min(2).max(120).optional(),
        description: z.string().trim().max(2000).optional(),
        visibility: z.enum(['workspace', 'private']).optional(),
        lead_id: z.string().min(1).optional(),
      })
      .refine((v) => Object.keys(v).length > 0, 'Choose at least one setting to update.')
      .parse(req.body);
    await db.transaction(async () => {
      if (body.lead_id && body.lead_id !== record.lead_id) {
        await requireActiveMember(db, req.workspaceId, body.lead_id);
        const lead = await db.one<{ role: string }>(
          'SELECT role FROM memberships WHERE workspace_id = ? AND user_id = ?',
          [req.workspaceId, body.lead_id],
        );
        if (!lead || lead.role === 'viewer')
          throw new HttpError(400, 'Choose a workspace member with permission to edit.');
        const membership = await db.one(
          'SELECT user_id FROM project_members WHERE project_id = ? AND user_id = ? AND workspace_id = ?',
          [record.id, body.lead_id, req.workspaceId],
        );
        if (!membership)
          await db.insert('project_members', {
            project_id: record.id,
            workspace_id: req.workspaceId,
            user_id: body.lead_id,
            role: 'admin',
          });
        else
          await db.run(
            'UPDATE project_members SET role = ? WHERE project_id = ? AND user_id = ? AND workspace_id = ?',
            ['admin', record.id, body.lead_id, req.workspaceId],
          );
      }
      for (const [field, value] of Object.entries(body))
        await db.run(`UPDATE projects SET ${field} = ? WHERE id = ? AND workspace_id = ?`, [
          value,
          record.id,
          req.workspaceId,
        ]);
      await audit(req, 'project.settings.updated', record.id, JSON.stringify(body));
    });
    broadcast(req);
    res.json({ ok: true });
  });
  app.get('/api/v1/administration/projects', async (req, res) => {
    const projects = await visibleProjects(req, true);
    res.json(
      await Promise.all(
        projects
          .filter((p) => p.archived_at)
          .map(async (p) => ({ ...p, can_manage: await mayManage(req, p) })),
      ),
    );
  });
  app.post('/api/v1/projects/:id/archive', async (req, res) => {
    const record = await managedProject(req, String(req.params.id));
    await db.transaction(async () => {
      await db.run('UPDATE projects SET archived_at = ? WHERE id = ? AND workspace_id = ?', [
        now(),
        record.id,
        req.workspaceId,
      ]);
      await audit(req, 'project.archived', record.id, record.name);
    });
    broadcast(req);
    res.json({ ok: true });
  });
  app.post('/api/v1/projects/:id/restore', async (req, res) => {
    const record = await managedProject(req, String(req.params.id), true);
    if (!record.archived_at) throw new HttpError(409, 'This project is already active.');
    await db.transaction(async () => {
      await db.run('UPDATE projects SET archived_at = NULL WHERE id = ? AND workspace_id = ?', [
        record.id,
        req.workspaceId,
      ]);
      await audit(req, 'project.restored', record.id, record.name);
    });
    broadcast(req);
    res.json({ ok: true });
  });
  app.get('/api/v1/administration/trash', async (req, res) => {
    canAdmin(req);
    const projects = await visibleProjects(req, true);
    const rows = await db.all<{
      id: string;
      key: string;
      summary: string;
      project_id: string;
      deleted_at: string;
    }>(
      'SELECT id,`key`,summary,project_id,deleted_at FROM issues WHERE workspace_id = ? AND deleted_at IS NOT NULL ORDER BY deleted_at DESC',
      [req.workspaceId],
    );
    res.json(
      rows
        .filter((row) => projects.some((p) => p.id === row.project_id))
        .map((row) => {
          const parent = projects.find((p) => p.id === row.project_id)!;
          const deadline = Date.parse(row.deleted_at) + recoveryDays;
          return {
            ...row,
            project_name: parent.name,
            project_archived: !!parent.archived_at,
            recover_until: new Date(deadline).toISOString(),
            recoverable: deadline >= Date.now() && !parent.archived_at,
          };
        }),
    );
  });
  app.post('/api/v1/administration/trash/:id/restore', async (req, res) => {
    canAdmin(req);
    await db.transaction(async () => {
      const record = await db.one<{ id: string; project_id: string; deleted_at: string }>(
        'SELECT id,project_id,deleted_at FROM issues WHERE workspace_id = ? AND id = ? AND deleted_at IS NOT NULL',
        [req.workspaceId, String(req.params.id)],
      );
      if (!record || Date.now() - Date.parse(record.deleted_at) > recoveryDays)
        throw new HttpError(
          404,
          'This issue is outside its 30-day recovery period or is no longer in the trash.',
        );
      await project(req, record.project_id, true);
      await db.run(
        'UPDATE issues SET deleted_at = NULL, version = version + 1, updated_at = ? WHERE id = ? AND workspace_id = ?',
        [now(), record.id, req.workspaceId],
      );
      await db.insert('history', {
        id: id(),
        workspace_id: req.workspaceId,
        issue_id: record.id,
        actor_id: req.user.id,
        field: 'deleted_at',
        old_value: record.deleted_at,
        new_value: JSON.stringify(''),
        created_at: now(),
      });
      await audit(req, 'issue.restored', record.id);
    });
    broadcast(req);
    res.json({ ok: true });
  });
}
