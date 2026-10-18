import express, { type Request } from 'express';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import bcrypt from 'bcryptjs';
import multer from 'multer';
import Papa from 'papaparse';
import { sanitizeRichText } from './richtext.js';
import { registerPlanningRoutes, captureSprintSnapshot } from './features/planning.js';
import { registerAdministrationRoutes } from './features/administration.js';
import { registerViewRoutes } from './features/views.js';
import { applyPlanningMigrations } from './migrations.js';
import { applyExpansionMigrations } from './expansion-migrations.js';
import {
  createAccounts,
  registerPublicAccountRoutes,
  registerAccountRoutes,
  activeMembership,
  requireActiveMember,
} from './features/accounts.js';
import type { MailSender } from './mail.js';
import { createNotifications, registerNotificationRoutes } from './features/notifications.js';
import { registerCollaborationRoutes } from './features/collaboration.js';
import type { NotificationEvent } from '../shared/notifications.js';
import { registerWorkManagementRoutes } from './features/work-management.js';
import { applySearchMigration, registerSearchRoutes, queryIssuePage } from './features/search.js';
import { applyPortfolioMigration, registerPortfolioRoutes } from './features/portfolio.js';
import { applyOrganizationMigration, organizationContext } from './organization.js';
import {
  registerOrganizationRoutes,
  employeeIdSchema,
  teamRoleSchema,
  reserveEmployeeInvite,
  claimEmployeeInvite,
  requireWorkPrivilege,
} from './features/organization.js';
import { createServer } from 'node:http';
import { mkdirSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { randomBytes } from 'node:crypto';
import { Server } from 'socket.io';
import { z } from 'zod';
import { Database } from './db.js';
import { seed, id, now, createStatuses, demoUser, demoWorkspace } from './seed.js';
import {
  authenticate,
  canWrite,
  canAdmin,
  createSession,
  clearCookies,
  rotateSession,
  resolveUser,
  HttpError,
  production,
  hash,
} from './auth.js';
import { queryIssues, QueryError } from './gql.js';
import type { Issue, User, Project, Status, Sprint, Workspace } from '../shared/types.js';

const issueSchema = z.object({
  project_id: z.string().min(1),
  summary: z.string().trim().min(1).max(255),
  description: z.string().max(100000).transform(sanitizeRichText).default(''),
  type: z.enum(['task', 'story', 'bug', 'epic', 'subtask']).default('task'),
  status_id: z.string().optional(),
  priority: z.enum(['critical', 'high', 'medium', 'low', 'lowest']).default('medium'),
  assignee_id: z.string().nullable().default(null),
  parent_id: z.string().nullable().default(null),
  sprint_id: z.string().nullable().default(null),
  labels: z.array(z.string().trim().min(1).max(40)).max(20).default([]),
  story_points: z.number().int().min(0).max(1000).default(0),
  due_date: z
    .string()
    .refine((v) => !v || /^\d{4}-\d{2}-\d{2}$/.test(v), 'Use a date in YYYY-MM-DD format.')
    .default(''),
  start_date: z
    .string()
    .refine((v) => !v || /^\d{4}-\d{2}-\d{2}$/.test(v), 'Use a date in YYYY-MM-DD format.')
    .default(''),
  flagged: z.number().int().min(0).max(1).default(0),
  rank: z.number().finite().optional(),
});
const credentials = z.object({
  email: z
    .email()
    .max(254)
    .transform((v) => v.toLowerCase()),
  password: z.string().min(10).max(128),
});
const parseIssue = (row: Record<string, unknown>): Issue =>
  ({ ...row, labels: JSON.parse(String(row.labels || '[]')) }) as Issue;
export async function createApp(
  options: { db?: Database; seed?: boolean; mailer?: MailSender } = {},
) {
  const db = options.db || new Database();
  await db.migrate();
  const demoEnabled = !production && process.env.DEMO_MODE !== 'false';
  if (options.seed ?? (!production && process.env.SEED_DEMO !== 'false')) await seed(db);
  await applyPlanningMigrations(db);
  await applyExpansionMigrations(db);
  await applySearchMigration(db);
  await applyPortfolioMigration(db);
  await applyOrganizationMigration(db);
  const accounts = createAccounts(db, options.mailer);
  const dispatchNotification = createNotifications(db, accounts);
  const app = express();
  const httpServer = createServer(app);
  const origin = process.env.APP_ORIGIN || 'http://127.0.0.1:5173';
  const allowedOrigins = new Set([
    origin,
    ...(!production
      ? [
          `http://localhost:${process.env.WEB_PORT || 5173}`,
          `http://127.0.0.1:${process.env.PORT || 4000}`,
          `http://localhost:${process.env.PORT || 4000}`,
        ]
      : []),
  ]);
  const io = new Server(httpServer, {
    cors: { origin: [...allowedOrigins], credentials: true },
    maxHttpBufferSize: 1e5,
  });
  app.disable('x-powered-by');
  app.disable('etag');
  app.use('/api', (_req, res, next) => {
    res.set('Cache-Control', 'no-store');
    next();
  });
  app.use(helmet({ contentSecurityPolicy: production ? undefined : false }));
  app.use(express.json({ limit: '3mb' }));
  app.use(cookieParser());
  app.use(
    '/api',
    rateLimit({
      windowMs: 60000,
      limit: 600,
      standardHeaders: 'draft-8',
      legacyHeaders: false,
    }),
  );
  app.use('/api', (req, _res, next) => {
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
      if (
        req.headers['x-grace-csrf'] !== '1' ||
        (req.headers.origin && !allowedOrigins.has(req.headers.origin))
      )
        return next(new HttpError(403, 'This request could not be verified.', 'CSRF_REJECTED'));
    }
    next();
  });
  app.get('/api/health', (_req, res) =>
    res.json({ status: 'ok', database: db.driver, version: '0.1.0' }),
  );
  const authLimit = rateLimit({
    windowMs: 15 * 60000,
    limit: 30,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
  });
  function revokeUser(userId: string, workspaceId?: string) {
    for (const socket of io.sockets.sockets.values())
      if (
        socket.data.user?.id === userId &&
        (!workspaceId || socket.data.workspaceId === workspaceId)
      )
        socket.disconnect(true);
  }
  registerPublicAccountRoutes(app, db, accounts, revokeUser);
  app.post('/api/v1/auth/login', authLimit, async (req, res) => {
    const body = z
      .object({
        email: z
          .email()
          .transform((v) => v.toLowerCase())
          .optional(),
        employee_id: employeeIdSchema.optional(),
        organization: z.string().trim().max(120).optional(),
        password: z.string().min(10).max(128),
      })
      .refine(
        (v) => !!v.email || !!(v.employee_id && v.organization),
        'Enter your email, or employee ID and organization code.',
      )
      .parse(req.body);
    const user = await db.one<{ id: string; password_hash: string }>(
      body.email
        ? 'SELECT id,password_hash FROM users WHERE email = ?'
        : 'SELECT u.id,u.password_hash FROM users u JOIN employee_profiles e ON e.user_id=u.id JOIN workspaces w ON w.id=e.workspace_id WHERE e.employee_id=? AND w.slug=?',
      body.email ? [body.email] : [body.employee_id, body.organization],
    );
    if (!user || !(await bcrypt.compare(body.password, user.password_hash)))
      throw new HttpError(401, 'Your sign-in details are incorrect.');
    const membership = await db.one<{ workspace_id: string }>(
      'SELECT workspace_id FROM memberships m WHERE user_id = ? AND ' +
        activeMembership() +
        (body.email ? '' : ' AND workspace_id=(SELECT id FROM workspaces WHERE slug=?)') +
        ' ORDER BY workspace_id LIMIT 1',
      body.email ? [user.id] : [user.id, body.organization],
    );
    if (!membership) throw new HttpError(403, 'This account has no active workspace.');
    await db.transaction(async () => {
      await db.run('UPDATE workspaces SET name=name WHERE id=?', [membership.workspace_id]);
      const current = await db.one<{ password_hash: string }>(
        'SELECT password_hash FROM users WHERE id=?' + (db.driver === 'mysql' ? ' FOR UPDATE' : ''),
        [user.id],
      );
      if (current?.password_hash !== user.password_hash)
        throw new HttpError(401, 'Your credentials changed. Sign in again.');
      await createSession(db, res, user.id, membership.workspace_id);
    });
    res.json({ ok: true });
  });
  app.post('/api/v1/auth/register', authLimit, async (req, res) => {
    const body = credentials
      .extend({
        name: z.string().trim().min(2).max(120),
        workspace: z.string().trim().min(2).max(120).optional(),
        invite_token: z.string().max(128).optional(),
        employee_id: employeeIdSchema.optional(),
      })
      .parse(req.body);
    if (await db.one('SELECT id FROM users WHERE email = ?', [body.email]))
      throw new HttpError(409, 'An account with this email already exists.');
    const userId = id();
    let workspaceId: string = id();
    const passwordHash = await bcrypt.hash(body.password, 12);
    await db.transaction(async () => {
      let invite: { id: string; workspace_id: string; email: string; role: string } | undefined;
      if (body.invite_token) {
        invite = await db.one(
          'SELECT * FROM invites WHERE token_hash = ? AND accepted_at IS NULL AND expires_at > ?',
          [hash(body.invite_token), now()],
        );
        if (!invite || invite.email !== body.email)
          throw new HttpError(
            400,
            'This invitation is invalid, expired, or belongs to another email.',
          );
        workspaceId = invite.workspace_id;
        const accepted = await db.run(
          'UPDATE invites SET accepted_at = ? WHERE id = ? AND accepted_at IS NULL',
          [now(), invite.id],
        );
        if (!accepted) throw new HttpError(409, 'This invitation has already been used.');
      } else {
        if (!body.workspace) throw new HttpError(400, 'A workspace name is required.');
        await db.insert('workspaces', {
          id: workspaceId,
          name: body.workspace,
          slug: `${body.workspace.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${workspaceId.slice(0, 6)}`,
          created_at: now(),
        });
      }
      await db.insert('users', {
        id: userId,
        name: body.name,
        email: body.email,
        password_hash: passwordHash,
        color: '#e3eadd',
        created_at: now(),
      });
      await db.insert('memberships', {
        workspace_id: workspaceId,
        user_id: userId,
        role: invite?.role || 'owner',
      });
      if (invite) await claimEmployeeInvite(db, workspaceId, userId, invite.id, body.employee_id);
      await createSession(db, res, userId, workspaceId);
      if (!invite && body.employee_id)
        await db.run(
          'UPDATE employee_profiles SET employee_id=? WHERE workspace_id=? AND user_id=?',
          [body.employee_id, workspaceId, userId],
        );
    });
    await accounts.issueToken(userId, 'verify');
    res.status(201).json({ ok: true, verification_sent: true });
  });
  app.post('/api/v1/auth/demo', authLimit, async (_req, res) => {
    if (!demoEnabled || !(await db.one('SELECT id FROM users WHERE id = ?', [demoUser])))
      throw new HttpError(404, 'Demo login is disabled.');
    await createSession(db, res, demoUser, demoWorkspace);
    res.json({ ok: true });
  });
  app.post('/api/v1/auth/refresh', authLimit, async (req, res) => {
    await rotateSession(db, req, res);
    res.json({ ok: true });
  });
  app.get('/api/v1/auth/invite', authLimit, async (req, res) => {
    const token = z.string().min(32).max(128).parse(req.query.token);
    const invite = await db.one(
      'SELECT i.email,i.role,w.name AS workspace,w.slug AS organization,e.employee_id,t.name AS team FROM invites i JOIN workspaces w ON w.id=i.workspace_id LEFT JOIN employee_invites e ON e.invite_id=i.id LEFT JOIN organization_teams t ON t.id=e.team_id WHERE i.token_hash = ? AND i.accepted_at IS NULL AND i.expires_at > ?',
      [hash(token), now()],
    );
    if (!invite) throw new HttpError(404, 'This invitation is expired or has already been used.');
    res.json(invite);
  });
  app.use('/api/v1', authenticate(db));
  app.use('/api/v1/issues', (req, _res, next) => {
    try {
      if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method)) requireWorkPrivilege(req);
      next();
    } catch (error) {
      next(error);
    }
  });
  app.post('/api/v1/auth/logout', async (req, res) => {
    await db.run('DELETE FROM sessions WHERE id = ?', [req.sessionId]);
    clearCookies(res);
    res.json({ ok: true });
  });
  app.get('/api/v1/auth/me', (req, res) => res.json(req.user));
  app.post('/api/v1/invites', async (req, res) => {
    canAdmin(req);
    const body = z
      .object({
        email: z.email().transform((v) => v.toLowerCase()),
        role: z.enum(['admin', 'member', 'viewer']).default('member'),
        employee_id: employeeIdSchema.optional(),
        team_id: z.string().optional(),
        team_role: teamRoleSchema.optional(),
      })
      .parse(req.body);
    if (
      await db.one(
        'SELECT u.id FROM users u JOIN memberships m ON m.user_id=u.id WHERE m.workspace_id = ? AND u.email = ?',
        [req.workspaceId, body.email],
      )
    )
      throw new HttpError(409, 'This person already belongs to the workspace.');
    const token = randomBytes(32).toString('hex');
    const inviteId = id();
    await db.transaction(async () => {
      await db.insert('invites', {
        email: body.email,
        role: body.role,
        id: inviteId,
        workspace_id: req.workspaceId,
        token_hash: hash(token),
        expires_at: new Date(Date.now() + 7 * 86400000).toISOString(),
        created_at: now(),
      });
      await reserveEmployeeInvite(db, req.workspaceId, inviteId, body);
      await audit(req, 'member.invited', req.workspaceId, body.email);
    });
    res.status(201).json({ url: `${origin}/invite?token=${token}`, expires_in_days: 7 });
  });
  app.post('/api/v1/invites/accept', async (req, res) => {
    const body = z.object({ token: z.string().min(32).max(128) }).parse(req.body);
    await db.transaction(async () => {
      const invite = await db.one<{
        id: string;
        workspace_id: string;
        email: string;
        role: string;
      }>('SELECT * FROM invites WHERE token_hash = ? AND accepted_at IS NULL AND expires_at > ?', [
        hash(body.token),
        now(),
      ]);
      if (!invite) throw new HttpError(404, 'This invitation is expired or has already been used.');
      if (invite.email !== req.user.email)
        throw new HttpError(403, `Sign in as ${invite.email} to accept this invitation.`);
      const changed = await db.run(
        'UPDATE invites SET accepted_at = ? WHERE id = ? AND accepted_at IS NULL',
        [now(), invite.id],
      );
      if (!changed) throw new HttpError(409, 'This invitation has already been used.');
      if (
        !(await db.one('SELECT user_id FROM memberships WHERE workspace_id = ? AND user_id = ?', [
          invite.workspace_id,
          req.user.id,
        ]))
      )
        await db.insert('memberships', {
          workspace_id: invite.workspace_id,
          user_id: req.user.id,
          role: invite.role,
        });
      await db.run('DELETE FROM sessions WHERE id = ?', [req.sessionId]);
      await claimEmployeeInvite(db, invite.workspace_id, req.user.id, invite.id);
      await createSession(db, res, req.user.id, invite.workspace_id);
    });
    res.json({ ok: true });
  });

  async function visibleProjects(req: Request, includeArchived = false) {
    const projects = await db.all<Project>(
      'SELECT * FROM projects WHERE workspace_id = ?' +
        (includeArchived ? '' : ' AND archived_at IS NULL') +
        ' ORDER BY created_at,name',
      [req.workspaceId],
    );
    const admin = ['owner', 'admin'].includes(req.user.role);
    const configurations = await db.all<{
      project_id: string;
      issue_types: string;
      default_type: Issue['type'];
      cycles_enabled: number;
    }>(
      'SELECT c.* FROM project_configuration c JOIN projects p ON p.id=c.project_id WHERE p.workspace_id=?',
      [req.workspaceId],
    );
    const members = await db.all<{ project_id: string; role: string }>(
      'SELECT project_id,role FROM project_members WHERE workspace_id = ? AND user_id = ?',
      [req.workspaceId, req.user.id],
    );
    return projects
      .filter(
        (p) =>
          admin ||
          p.visibility !== 'private' ||
          p.lead_id === req.user.id ||
          members.some((m) => m.project_id === p.id),
      )
      .map((p) => ({
        ...p,
        issue_types: JSON.parse(
          configurations.find((c) => c.project_id === p.id)?.issue_types ||
            '["task","story","bug","epic","subtask"]',
        ),
        default_type:
          configurations.find((c) => c.project_id === p.id)?.default_type || ('task' as const),
        cycles_enabled: configurations.find((c) => c.project_id === p.id)?.cycles_enabled !== 0,
        can_write:
          !p.archived_at &&
          req.user.role !== 'viewer' &&
          (admin ||
            (req.user.team_role !== 'viewer' &&
              req.user.team_permissions?.includes('work') !== false)) &&
          (admin || members.find((m) => m.project_id === p.id)?.role !== 'viewer'),
        can_admin:
          req.user.role !== 'viewer' &&
          (admin ||
            p.lead_id === req.user.id ||
            members.find((m) => m.project_id === p.id)?.role === 'admin'),
      }));
  }
  async function project(req: Request, projectId: string, write = false) {
    const result = await db.one<Project>(
      'SELECT * FROM projects WHERE id = ? AND workspace_id = ?',
      [projectId, req.workspaceId],
    );
    if (!result || result.archived_at) throw new HttpError(404, 'Project not found.');
    const membership = await db.one<{ role: string }>(
      'SELECT role FROM project_members WHERE project_id = ? AND user_id = ? AND workspace_id = ?',
      [projectId, req.user.id, req.workspaceId],
    );
    const admin = ['owner', 'admin'].includes(req.user.role);
    if (result.visibility === 'private' && !admin && !membership && result.lead_id !== req.user.id)
      throw new HttpError(404, 'Project not found.');
    if (write) {
      canWrite(req);
      if (!admin && membership?.role === 'viewer')
        throw new HttpError(403, 'You have view-only access to this project.');
    }
    return result;
  }
  async function issue(req: Request, issueId: string, write = false) {
    const result = await db.one(
      'SELECT * FROM issues WHERE (id = ? OR `key` = ? OR EXISTS (SELECT 1 FROM issue_aliases a WHERE a.issue_id=issues.id AND a.alias_key=? AND a.workspace_id=?)) AND workspace_id = ? AND deleted_at IS NULL',
      [issueId, issueId, issueId, req.workspaceId, req.workspaceId],
    );
    if (!result) throw new HttpError(404, 'Issue not found.');
    const parsed = parseIssue(result);
    await project(req, parsed.project_id, write);
    return parsed;
  }
  async function scopedIssues(req: Request, projectId?: string) {
    const projects = await visibleProjects(req);
    const rows = await db.all(
      'SELECT * FROM issues WHERE workspace_id = ? AND deleted_at IS NULL' +
        (projectId ? ' AND project_id = ?' : '') +
        ' ORDER BY `rank`',
      projectId ? [req.workspaceId, projectId] : [req.workspaceId],
    );
    return rows.filter((r) => projects.some((p) => p.id === r.project_id)).map(parseIssue);
  }
  async function audit(req: Request, action: string, target: string, detail = '') {
    await db.insert('audit_log', {
      id: id(),
      workspace_id: req.workspaceId,
      actor_id: req.user.id,
      action,
      target_id: target,
      detail,
      created_at: now(),
    });
  }
  function broadcast(req: Request) {
    io.to(`workspace:${req.workspaceId}`).emit('workspace.updated');
  }
  async function addHistory(
    req: Request,
    issueId: string,
    field: string,
    oldValue: unknown,
    newValue: unknown,
  ) {
    await db.insert('history', {
      id: id(),
      workspace_id: req.workspaceId,
      issue_id: issueId,
      actor_id: req.user.id,
      field,
      old_value: typeof oldValue === 'string' ? oldValue : JSON.stringify(oldValue ?? ''),
      new_value: typeof newValue === 'string' ? newValue : JSON.stringify(newValue ?? ''),
      created_at: now(),
    });
  }
  async function notify(
    req: Request,
    userId: string | null,
    issueId: string,
    title: string,
    body: string,
    event: NotificationEvent = 'assignment',
  ) {
    return dispatchNotification(req, userId, issueId, title, body, event);
  }
  async function validateRelations(
    req: Request,
    body: z.infer<typeof issueSchema>,
    existingId?: string,
    previousSprintId?: string | null,
    previousAssigneeId?: string | null,
  ) {
    if (
      body.assignee_id &&
      (!existingId || body.assignee_id !== previousAssigneeId) &&
      !(await db.one('SELECT user_id FROM memberships WHERE workspace_id = ? AND user_id = ?', [
        req.workspaceId,
        body.assignee_id,
      ]))
    )
      throw new HttpError(400, 'Assignee must belong to this workspace.');
    if (body.assignee_id && (!existingId || body.assignee_id !== previousAssigneeId))
      await requireActiveMember(db, req.workspaceId, body.assignee_id);
    if (
      body.status_id &&
      !(await db.one(
        'SELECT id FROM statuses WHERE workspace_id = ? AND project_id = ? AND id = ?',
        [req.workspaceId, body.project_id, body.status_id],
      ))
    )
      throw new HttpError(400, 'Choose a status from this project.');
    if (
      existingId &&
      previousSprintId &&
      previousSprintId !== body.sprint_id &&
      (await db.one(
        'SELECT id FROM sprints WHERE id = ? AND workspace_id = ? AND state = ?' +
          (db.driver === 'mysql' ? ' FOR SHARE' : ''),
        [previousSprintId, req.workspaceId, 'closed'],
      ))
    )
      throw new HttpError(400, 'A completed cycle’s scope cannot be changed.');
    if (
      body.sprint_id &&
      (!existingId || body.sprint_id !== previousSprintId) &&
      !(await db.one(
        'SELECT id FROM sprints WHERE workspace_id = ? AND project_id = ? AND id = ? AND state != ?' +
          (db.driver === 'mysql' ? ' FOR SHARE' : ''),
        [req.workspaceId, body.project_id, body.sprint_id, 'closed'],
      ))
    )
      throw new HttpError(400, 'Choose an open sprint from this project.');
    if (body.parent_id) {
      const parent = await issue(req, body.parent_id);
      if (
        parent.id === existingId ||
        parent.project_id !== body.project_id ||
        !['epic', 'story', 'task', 'bug'].includes(parent.type)
      )
        throw new HttpError(400, 'Choose a valid parent from this project.');
      if (
        (body.type === 'subtask' && parent.type === 'epic') ||
        (body.type !== 'subtask' && parent.type !== 'epic') ||
        body.type === 'epic'
      )
        throw new HttpError(400, 'Hierarchy is Epic → Story/Task/Bug → Sub-task.');
    }
  }
  async function createIssue(req: Request, raw: unknown) {
    requireWorkPrivilege(req);
    const body = issueSchema.parse(raw);
    const configuration = await db.one<{ issue_types: string; default_type: Issue['type'] }>(
      'SELECT issue_types,default_type FROM project_configuration WHERE project_id=?',
      [body.project_id],
    );
    if (configuration) {
      if (!Object.hasOwn(raw as object, 'type')) body.type = configuration.default_type;
      if (!JSON.parse(configuration.issue_types).includes(body.type))
        throw new HttpError(400, 'This issue type is not enabled by the project configuration.');
    }
    const prj = await project(req, body.project_id, true);
    if (!body.status_id)
      body.status_id = (await db.one<Status>(
        'SELECT * FROM statuses WHERE project_id = ? ORDER BY position LIMIT 1',
        [prj.id],
      ))!.id;
    return db.transaction(async () => {
      await db.run(
        'UPDATE projects SET next_number = next_number + 1 WHERE id = ? AND workspace_id = ?',
        [prj.id, req.workspaceId],
      );
      await validateRelations(req, body);
      const counter = await db.one<{ next_number: number }>(
        'SELECT next_number FROM projects WHERE id = ?',
        [prj.id],
      );
      const number = counter!.next_number - 1;
      const issueId = id();
      await db.insert('issues', {
        ...body,
        id: issueId,
        workspace_id: req.workspaceId,
        number,
        key: `${prj.key}-${number}`,
        reporter_id: req.user.id,
        labels: JSON.stringify(body.labels),
        rank: body.rank ?? Date.now(),
        created_at: now(),
        updated_at: now(),
      });
      await addHistory(req, issueId, 'created', '', body.summary);
      await db.insert('watchers', {
        workspace_id: req.workspaceId,
        issue_id: issueId,
        user_id: req.user.id,
      });
      await notify(
        req,
        body.assignee_id,
        issueId,
        `${prj.key}-${number} was assigned to you`,
        body.summary,
      );
      return issue(req, issueId);
    });
  }
  registerPlanningRoutes({
    notify,
    app,
    db,
    project,
    issue,
    scopedIssues,
    visibleProjects,
    addHistory,
    audit,
    broadcast,
  });
  registerAdministrationRoutes({ app, db, project, visibleProjects, issue, audit, broadcast });
  registerViewRoutes({ app, db, audit, broadcast });
  registerAccountRoutes({ app, db, accounts, audit, broadcast, revokeUser });
  registerNotificationRoutes(app, db);
  registerCollaborationRoutes({ app, db, issue, notify, audit, addHistory, broadcast });
  registerWorkManagementRoutes({
    notify,
    app,
    db,
    issue,
    project,
    visibleProjects,
    audit,
    addHistory,
    broadcast,
  });

  registerSearchRoutes(app, db);
  registerPortfolioRoutes({ app, db, project, visibleProjects, audit, broadcast });
  registerOrganizationRoutes({ app, db, project, issue, visibleProjects, audit, broadcast });
  app.get('/api/v1/bootstrap', async (req, res) => {
    const issuePage =
      req.query.issue_limit !== undefined
        ? await queryIssuePage(db, req, {
            limit: req.query.issue_limit,
            cursor: req.query.issue_cursor,
            project_id: req.query.project_id,
          })
        : null;
    const projects = await visibleProjects(req);
    const projectIds = new Set(projects.map((p) => p.id));
    const [
      workspace,
      members,
      statuses,
      sprints,
      issues,
      activity,
      pages,
      views,
      notifications,
      standups,
      risks,
    ] = await Promise.all([
      db.one<Workspace>('SELECT * FROM workspaces WHERE id = ?', [req.workspaceId]),
      db.all<User>(
        'SELECT u.id,u.name,u.email,u.color,u.capacity,m.role,e.employee_id,e.team_id,e.team_role,CASE WHEN md.user_id IS NULL THEN 1 ELSE 0 END AS active FROM users u JOIN memberships m ON m.user_id=u.id LEFT JOIN employee_profiles e ON e.workspace_id=m.workspace_id AND e.user_id=m.user_id LEFT JOIN member_deactivations md ON md.workspace_id=m.workspace_id AND md.user_id=m.user_id WHERE m.workspace_id = ? ORDER BY u.name',
        [req.workspaceId],
      ),
      db.all<Status>('SELECT * FROM statuses WHERE workspace_id = ? ORDER BY position', [
        req.workspaceId,
      ]),
      db.all<Sprint>('SELECT * FROM sprints WHERE workspace_id = ? ORDER BY start_date', [
        req.workspaceId,
      ]),
      issuePage ? Promise.resolve(issuePage.items) : scopedIssues(req),
      db.all(
        'SELECT h.*,i.`key` as issue_key,i.summary as issue_summary,i.project_id FROM history h JOIN issues i ON i.id=h.issue_id WHERE h.workspace_id = ? AND i.deleted_at IS NULL ORDER BY h.created_at DESC LIMIT 100',
        [req.workspaceId],
      ),
      db.all('SELECT * FROM pages WHERE workspace_id = ? ORDER BY updated_at DESC', [
        req.workspaceId,
      ]),
      db.all('SELECT * FROM saved_views WHERE workspace_id = ? AND (sharing = ? OR owner_id = ?)', [
        req.workspaceId,
        'workspace',
        req.user.id,
      ]),
      db.all(
        'SELECT n.*,i.project_id FROM notifications n LEFT JOIN issues i ON i.id=n.issue_id WHERE n.workspace_id = ? AND n.user_id = ? ORDER BY n.created_at DESC LIMIT 100',
        [req.workspaceId, req.user.id],
      ),
      db.all('SELECT * FROM standups WHERE workspace_id = ? ORDER BY created_at DESC LIMIT 100', [
        req.workspaceId,
      ]),
      db.all('SELECT * FROM risks WHERE workspace_id = ? ORDER BY created_at DESC', [
        req.workspaceId,
      ]),
    ]);
    const visible = (r: Record<string, unknown>) =>
      !r.project_id || projectIds.has(String(r.project_id));
    res.json({
      user: req.user,
      workspace,
      members,
      projects,
      statuses: statuses.filter((s) => projectIds.has(s.project_id)),
      sprints: sprints.filter((s) => projectIds.has(s.project_id)),
      issues,
      activity: activity.filter(visible),
      pages: pages.filter(visible),
      views,
      notifications: notifications.filter(visible),
      standups,
      risks: risks.filter(visible),
      database: db.driver,
      organization: await organizationContext(db, req.workspaceId, req.user.id, req.user.role),
      ...(issuePage
        ? { issue_page: { nextCursor: issuePage.nextCursor, limit: issuePage.items.length } }
        : {}),
    });
  });
  app.get('/api/v1/projects', async (req, res) => res.json(await visibleProjects(req)));
  app.post('/api/v1/projects', async (req, res) => {
    canWrite(req);
    const body = z
      .object({
        name: z.string().trim().min(2).max(120),
        key: z.string().regex(/^[A-Z]{2,10}$/),
        description: z.string().max(2000).default(''),
        color: z
          .string()
          .regex(/^#[a-fA-F0-9]{6}$/)
          .default('#e9e3f5'),
        template: z.enum(['scrum', 'kanban', 'bug', 'basic', 'blank']).default('scrum'),
        visibility: z.enum(['workspace', 'private']).default('workspace'),
      })
      .parse(req.body);
    const projectId = id();
    await db.transaction(async () => {
      if (
        await db.one('SELECT id FROM projects WHERE workspace_id = ? AND `key` = ?', [
          req.workspaceId,
          body.key,
        ])
      )
        throw new HttpError(409, 'This project key is already in use.');
      await db.insert('projects', {
        ...body,
        id: projectId,
        workspace_id: req.workspaceId,
        lead_id: req.user.id,
        icon: 'layers',
        created_at: now(),
      });
      await db.insert('project_members', {
        workspace_id: req.workspaceId,
        project_id: projectId,
        user_id: req.user.id,
        role: 'admin',
      });
      await createStatuses(db, req.workspaceId, projectId, body.template);
      await audit(req, 'project.created', projectId);
    });
    broadcast(req);
    res.status(201).json(await project(req, projectId));
  });
  app.patch('/api/v1/projects/:id', async (req, res) => {
    const prj = await project(req, String(req.params.id), true);
    const body = z
      .object({
        name: z.string().trim().min(2).max(120).optional(),
        description: z.string().max(2000).optional(),
        favorite: z.number().int().min(0).max(1).optional(),
        archived: z.boolean().optional(),
      })
      .parse(req.body);
    if (body.name !== undefined || body.description !== undefined || body.archived !== undefined) {
      const membership = await db.one<{ role: string }>(
        'SELECT role FROM project_members WHERE workspace_id = ? AND project_id = ? AND user_id = ?',
        [req.workspaceId, prj.id, req.user.id],
      );
      if (
        !['owner', 'admin'].includes(req.user.role) &&
        prj.lead_id !== req.user.id &&
        membership?.role !== 'admin'
      )
        throw new HttpError(
          403,
          'A project lead or administrator must make this change.',
          'FORBIDDEN',
        );
    }
    await db.transaction(async () => {
      for (const [field, value] of Object.entries(body))
        await db.run(
          `UPDATE projects SET ${field === 'archived' ? 'archived_at' : field} = ? WHERE id = ? AND workspace_id = ?`,
          [field === 'archived' ? (value ? now() : null) : value, prj.id, req.workspaceId],
        );
      await audit(req, 'project.updated', prj.id, JSON.stringify(body));
    });
    broadcast(req);
    res.json({ ok: true });
  });
  app.get('/api/v1/issues', async (req, res) => {
    const all = await scopedIssues(
      req,
      typeof req.query.project_id === 'string' ? req.query.project_id : undefined,
    );
    const text = String(req.query.q || '').toLowerCase();
    const filtered = all.filter((i) =>
      `${i.key} ${i.summary} ${i.description.replace(/<[^>]*>/g, '')}`.toLowerCase().includes(text),
    );
    const offset = Math.max(0, Number(req.query.cursor) || 0);
    const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 100));
    res.json({
      items: filtered.slice(offset, offset + limit),
      nextCursor: offset + limit < filtered.length ? String(offset + limit) : null,
      total: filtered.length,
    });
  });
  app.post('/api/v1/issues', async (req, res) => {
    const created = await createIssue(req, req.body);
    broadcast(req);
    res.status(201).json(created);
  });
  app.get('/api/v1/issues/:id', async (req, res) => {
    const current = await issue(req, String(req.params.id));
    const [comments, history, worklogs, attachments, links, watchers] = await Promise.all([
      db.all('SELECT * FROM comments WHERE issue_id = ? AND workspace_id = ? ORDER BY created_at', [
        current.id,
        req.workspaceId,
      ]),
      db.all(
        'SELECT * FROM history WHERE issue_id = ? AND workspace_id = ? ORDER BY created_at DESC',
        [current.id, req.workspaceId],
      ),
      db.all(
        'SELECT * FROM worklogs WHERE issue_id = ? AND workspace_id = ? ORDER BY created_at DESC',
        [current.id, req.workspaceId],
      ),
      db.all(
        'SELECT id,name,size,mime,created_at FROM attachments WHERE issue_id = ? AND workspace_id = ?',
        [current.id, req.workspaceId],
      ),
      db.all(
        'SELECT l.id,l.target_id,l.type,i.`key`,i.summary,i.project_id FROM issue_links l JOIN issues i ON i.id=l.target_id WHERE l.source_id = ? AND l.workspace_id = ? AND i.deleted_at IS NULL',
        [current.id, req.workspaceId],
      ),
      db.all<{ user_id: string }>(
        'SELECT user_id FROM watchers WHERE issue_id = ? AND workspace_id = ?',
        [current.id, req.workspaceId],
      ),
    ]);
    const projects = await visibleProjects(req);
    res.set('X-Resource-Version', String(current.version)).json({
      issue: current,
      comments,
      history,
      worklogs,
      attachments,
      links: links.filter((l) => projects.some((p) => p.id === l.project_id)),
      watchers: watchers.map((w) => w.user_id),
    });
  });
  app.patch('/api/v1/issues/:id', async (req, res) => {
    const parsedPatch = issueSchema
      .omit({ project_id: true })
      .partial()
      .extend({ version: z.number().int().positive() })
      .strict()
      .parse(req.body);
    // Zod 4 applies nested defaults inside optional properties. A PATCH must only
    // change keys the caller explicitly supplied, even after schema validation.
    const patch = Object.fromEntries(
      Object.entries(parsedPatch).filter(([field]) => Object.hasOwn(req.body, field)),
    ) as typeof parsedPatch;
    const updated = await db.transaction(async () => {
      const current = await issue(req, String(req.params.id), true);
      if (current.version !== patch.version)
        throw new HttpError(
          409,
          'This issue changed while you were editing. Reload and try again.',
          'EDIT_CONFLICT',
        );
      const { version, ...changes } = patch;
      await validateRelations(
        req,
        { ...current, ...changes },
        current.id,
        current.sprint_id,
        current.assignee_id,
      );
      const claimed = await db.run(
        'UPDATE issues SET version = version + 1, updated_at = ? WHERE id = ? AND workspace_id = ? AND version = ?',
        [now(), current.id, req.workspaceId, version],
      );
      if (!claimed)
        throw new HttpError(
          409,
          'This issue changed while you were editing. Reload and try again.',
          'EDIT_CONFLICT',
        );
      if (changes.type && changes.type !== current.type) {
        const children = await db.all<Issue>(
          'SELECT * FROM issues WHERE parent_id = ? AND workspace_id = ? AND deleted_at IS NULL',
          [current.id, req.workspaceId],
        );
        if (children.length)
          throw new HttpError(400, 'Move child issues before changing this issue’s type.');
      }
      // The initial Simple workflow intentionally allows every configured status.
      for (const [field, value] of Object.entries(changes)) {
        if (JSON.stringify(value) === JSON.stringify(current[field as keyof Issue])) continue;
        await db.run(`UPDATE issues SET \`${field}\` = ? WHERE id = ? AND workspace_id = ?`, [
          field === 'labels' ? JSON.stringify(value) : value,
          current.id,
          req.workspaceId,
        ]);
        await addHistory(req, current.id, field, current[field as keyof Issue], value);
      }
      if (changes.assignee_id !== undefined && changes.assignee_id !== current.assignee_id)
        await notify(
          req,
          changes.assignee_id,
          current.id,
          `${current.key} was assigned to you`,
          current.summary,
        );
      if (changes.status_id && changes.status_id !== current.status_id) {
        const watchers = await db.all<{ user_id: string }>(
          'SELECT user_id FROM watchers WHERE issue_id = ?',
          [current.id],
        );
        const status = await db.one<Status>('SELECT * FROM statuses WHERE id = ?', [
          changes.status_id,
        ]);
        for (const watcher of watchers)
          await notify(
            req,
            watcher.user_id,
            current.id,
            `${current.key} moved to ${status!.name}`,
            current.summary,
            'status',
          );
      }
      return issue(req, current.id);
    });
    broadcast(req);
    res.json(updated);
  });
  app.delete('/api/v1/issues/:id', async (req, res) => {
    const current = await issue(req, String(req.params.id), true);
    await db.transaction(async () => {
      const timestamp = now();
      await db.run(
        'UPDATE issues SET deleted_at = ?, updated_at = ?, version = version + 1 WHERE id = ? AND workspace_id = ?',
        [timestamp, timestamp, current.id, req.workspaceId],
      );
      await addHistory(req, current.id, 'deleted_at', null, timestamp);
      await audit(req, 'issue.deleted', current.id);
    });
    broadcast(req);
    res.json({ ok: true });
  });
  app.post('/api/v1/issues/:id/restore', async (req, res) => {
    canAdmin(req);
    const current = await db.one<Issue>(
      'SELECT * FROM issues WHERE id = ? AND workspace_id = ? AND deleted_at IS NOT NULL',
      [String(req.params.id), req.workspaceId],
    );
    if (!current || Date.now() - Date.parse(current.deleted_at!) > 30 * 86400000)
      throw new HttpError(404, 'No recoverable issue was found.');
    await project(req, current.project_id, true);
    await db.transaction(async () => {
      await db.run(
        'UPDATE issues SET deleted_at = NULL, updated_at = ?, version = version + 1 WHERE id = ? AND workspace_id = ?',
        [now(), current.id, req.workspaceId],
      );
      await addHistory(req, current.id, 'deleted_at', current.deleted_at, null);
      await audit(req, 'issue.restored', current.id);
    });
    broadcast(req);
    res.json({ ok: true });
  });
  app.post('/api/v1/issues/:id/clone', async (req, res) => {
    const current = await issue(req, String(req.params.id));
    const created = await createIssue(req, {
      ...current,
      summary: `${current.summary.slice(0, 245)} (copy)`,
    });
    broadcast(req);
    res.status(201).json(created);
  });
  app.post('/api/v1/issues/:id/watch', async (req, res) => {
    const current = await issue(req, String(req.params.id));
    const body = z.object({ watching: z.boolean() }).parse(req.body);
    await db.transaction(async () => {
      await db.run('DELETE FROM watchers WHERE issue_id = ? AND user_id = ? AND workspace_id = ?', [
        current.id,
        req.user.id,
        req.workspaceId,
      ]);
      if (body.watching)
        await db.insert('watchers', {
          workspace_id: req.workspaceId,
          issue_id: current.id,
          user_id: req.user.id,
        });
    });
    broadcast(req);
    res.json({ ok: true });
  });
  app.post('/api/v1/issues/:id/worklogs', async (req, res) => {
    const current = await issue(req, String(req.params.id), true);
    const body = z
      .object({
        minutes: z.number().int().positive().max(1440),
        note: z.string().max(2000).default(''),
      })
      .parse(req.body);
    await db.insert('worklogs', {
      ...body,
      id: id(),
      workspace_id: req.workspaceId,
      issue_id: current.id,
      user_id: req.user.id,
      created_at: now(),
    });
    broadcast(req);
    res.status(201).json({ ok: true });
  });
  app.post('/api/v1/issues/:id/links', async (req, res) => {
    const current = await issue(req, String(req.params.id), true);
    const body = z
      .object({
        target_id: z.string(),
        type: z.enum(['blocks', 'relates to', 'duplicates']),
      })
      .parse(req.body);
    const target = await issue(req, body.target_id);
    if (target.id === current.id) throw new HttpError(400, 'An issue cannot link to itself.');
    if (
      !(await db.one(
        'SELECT id FROM issue_links WHERE source_id = ? AND target_id = ? AND type = ?',
        [current.id, target.id, body.type],
      ))
    )
      await db.insert('issue_links', {
        id: id(),
        workspace_id: req.workspaceId,
        source_id: current.id,
        target_id: target.id,
        type: body.type,
      });
    broadcast(req);
    res.status(201).json({ ok: true });
  });
  const uploadsDir = resolve('data/uploads');
  mkdirSync(uploadsDir, { recursive: true });
  const upload = multer({
    storage: multer.diskStorage({
      destination: uploadsDir,
      filename: (_req, _file, cb) => cb(null, id()),
    }),
    limits: { fileSize: 25 * 1024 * 1024, files: 1 },
  });
  app.post(
    '/api/v1/issues/:id/attachments',
    async (req, _res, next) => {
      await issue(req, String(req.params.id), true);
      next();
    },
    upload.single('file'),
    async (req, res) => {
      const current = await issue(req, String(req.params.id), true);
      if (!req.file) throw new HttpError(400, 'Choose a file to upload.');
      const attachmentId = id();
      await db.insert('attachments', {
        id: attachmentId,
        workspace_id: req.workspaceId,
        issue_id: current.id,
        uploader_id: req.user.id,
        name: req.file.originalname.slice(0, 255),
        path: req.file.filename,
        mime: req.file.mimetype,
        size: req.file.size,
        created_at: now(),
      });
      broadcast(req);
      res.status(201).json({ id: attachmentId });
    },
  );
  app.get('/api/v1/attachments/:id', async (req, res) => {
    const attachment = await db.one<{
      issue_id: string;
      path: string;
      name: string;
    }>('SELECT * FROM attachments WHERE id = ? AND workspace_id = ?', [
      String(req.params.id),
      req.workspaceId,
    ]);
    if (!attachment) throw new HttpError(404, 'Attachment not found.');
    await issue(req, attachment.issue_id);
    res.set('X-Content-Type-Options', 'nosniff');
    res.download(resolve(uploadsDir, attachment.path), attachment.name);
  });
  app.post('/api/v1/sprints', async (req, res) => {
    const body = z
      .object({
        project_id: z.string(),
        name: z.string().trim().min(1).max(120),
        goal: z.string().max(2000).default(''),
        start_date: z.iso.date(),
        end_date: z.iso.date(),
      })
      .parse(req.body);
    await project(req, body.project_id, true);
    if (body.end_date < body.start_date)
      throw new HttpError(400, 'The end date must follow the start date.');
    const sprintId = id();
    await db.insert('sprints', {
      ...body,
      id: sprintId,
      workspace_id: req.workspaceId,
      state: 'future',
    });
    broadcast(req);
    res.status(201).json({ id: sprintId });
  });
  app.post('/api/v1/sprints/:id/:action', async (req, res) => {
    const sprintId = String(req.params.id);
    const action = z.enum(['start', 'complete']).parse(req.params.action);
    const destination = z
      .object({ destination_id: z.string().nullable().default(null) })
      .parse(req.body || {});
    const knownSprint = await db.one<Sprint>(
      'SELECT * FROM sprints WHERE id = ? AND workspace_id = ?',
      [sprintId, req.workspaceId],
    );
    if (!knownSprint) throw new HttpError(404, 'Sprint not found.');
    await project(req, knownSprint.project_id, true);
    await db.transaction(async () => {
      // Project-first locking gives simultaneous cycle transitions one consistent order.
      await db.run(
        'UPDATE projects SET next_number = next_number WHERE id = ? AND workspace_id = ?',
        [knownSprint.project_id, req.workspaceId],
      );
      const sprint = await db.one<Sprint>(
        'SELECT * FROM sprints WHERE id = ? AND workspace_id = ?' +
          (db.driver === 'mysql' ? ' FOR UPDATE' : ''),
        [sprintId, req.workspaceId],
      );
      if (!sprint) throw new HttpError(404, 'Sprint not found.');
      if (action === 'start') {
        if (sprint.state !== 'future')
          throw new HttpError(400, 'Only a planned sprint can be started.');
        if (
          await db.one(
            'SELECT id FROM sprints WHERE project_id = ? AND state = ?' +
              (db.driver === 'mysql' ? ' FOR UPDATE' : ''),
            [sprint.project_id, 'active'],
          )
        )
          throw new HttpError(409, 'Complete the active sprint before starting another one.');
        const items = await db.all<Issue & { category: string }>(
          'SELECT i.*,s.category FROM issues i JOIN statuses s ON s.id=i.status_id WHERE i.sprint_id = ? AND i.workspace_id = ? AND i.deleted_at IS NULL ORDER BY i.id' +
            (db.driver === 'mysql' ? ' FOR UPDATE' : ''),
          [sprintId, req.workspaceId],
        );
        await captureSprintSnapshot(db, req.workspaceId, sprintId, 'start', items);
        await db.run(
          'UPDATE sprints SET state = ?, committed_points = ? WHERE id = ? AND workspace_id = ?',
          ['active', items.reduce((sum, i) => sum + i.story_points, 0), sprintId, req.workspaceId],
        );
      } else {
        if (sprint.state !== 'active')
          throw new HttpError(400, 'Only an active sprint can be completed.');
        if (
          destination.destination_id &&
          !(await db.one(
            'SELECT id FROM sprints WHERE id = ? AND project_id = ? AND workspace_id = ? AND state = ?' +
              (db.driver === 'mysql' ? ' FOR UPDATE' : ''),
            [destination.destination_id, sprint.project_id, req.workspaceId, 'future'],
          ))
        )
          throw new HttpError(400, 'Carry unfinished work into a planned sprint or the backlog.');
        const items = await db.all<Issue & { category: string }>(
          'SELECT i.*,s.category FROM issues i JOIN statuses s ON s.id=i.status_id WHERE i.sprint_id = ? AND i.workspace_id = ? AND i.deleted_at IS NULL ORDER BY i.id' +
            (db.driver === 'mysql' ? ' FOR UPDATE' : ''),
          [sprintId, req.workspaceId],
        );
        await captureSprintSnapshot(db, req.workspaceId, sprintId, 'complete', items);
        for (const item of items.filter((i) => i.category !== 'done')) {
          const claimed = await db.run(
            'UPDATE issues SET sprint_id = ?, carry_over = 1, version = version + 1, updated_at = ? WHERE id = ? AND workspace_id = ? AND version = ?',
            [destination.destination_id, now(), item.id, req.workspaceId, item.version],
          );
          if (!claimed)
            throw new HttpError(
              409,
              'Cycle work changed during completion. Refresh and try again.',
              'EDIT_CONFLICT',
            );
          await addHistory(req, item.id, 'sprint_id', sprintId, destination.destination_id);
        }
        await db.run(
          'UPDATE sprints SET state = ?, completed_points = ? WHERE id = ? AND workspace_id = ?',
          [
            'closed',
            items.filter((i) => i.category === 'done').reduce((sum, i) => sum + i.story_points, 0),
            sprintId,
            req.workspaceId,
          ],
        );
      }
      await audit(req, `sprint.${action}`, sprintId);
    });
    broadcast(req);
    res.json({ ok: true });
  });
  app.post('/api/v1/statuses', async (req, res) => {
    canAdmin(req);
    const body = z
      .object({
        project_id: z.string(),
        name: z.string().trim().min(1).max(80),
        category: z.enum(['todo', 'active', 'done']),
      })
      .parse(req.body);
    await project(req, body.project_id, true);
    const statusId = id();
    await db.transaction(async () => {
      const last = await db.one<{ position: number }>(
        'SELECT COALESCE(MAX(position),0) AS position FROM statuses WHERE project_id = ? AND workspace_id = ?',
        [body.project_id, req.workspaceId],
      );
      await db.insert('statuses', {
        ...body,
        id: statusId,
        workspace_id: req.workspaceId,
        position: last!.position + 1,
        color:
          body.category === 'done' ? '#4c9f7a' : body.category === 'active' ? '#9172c4' : '#9c9fa8',
      });
      await audit(req, 'status.created', statusId);
    });
    broadcast(req);
    res.status(201).json({ id: statusId });
  });
  app.patch('/api/v1/statuses/:id', async (req, res) => {
    canAdmin(req);
    const body = z
      .object({
        name: z.string().trim().min(1).max(80),
        wip_limit: z.number().int().min(0).max(100),
      })
      .parse(req.body);
    const status = await db.one<Status>(
      'SELECT * FROM statuses WHERE id = ? AND workspace_id = ?',
      [String(req.params.id), req.workspaceId],
    );
    if (!status) throw new HttpError(404, 'Status not found.');
    await project(req, status.project_id, true);
    await db.run('UPDATE statuses SET name = ?,wip_limit = ? WHERE id = ? AND workspace_id = ?', [
      body.name,
      body.wip_limit,
      status.id,
      req.workspaceId,
    ]);
    broadcast(req);
    res.json({ ok: true });
  });
  app.post('/api/v1/search/gql', async (req, res) => {
    const body = z.object({ query: z.string().max(4000) }).parse(req.body);
    const [projects, statuses, members, sprints, issues] = await Promise.all([
      visibleProjects(req),
      db.all<Status>('SELECT * FROM statuses WHERE workspace_id = ?', [req.workspaceId]),
      db.all<User>(
        'SELECT u.id,u.name,u.email FROM users u JOIN memberships m ON u.id=m.user_id WHERE m.workspace_id = ?',
        [req.workspaceId],
      ),
      db.all<Sprint>('SELECT * FROM sprints WHERE workspace_id = ?', [req.workspaceId]),
      scopedIssues(req),
    ]);
    res.json(
      queryIssues(body.query, issues, {
        user: req.user,
        projects,
        statuses,
        members,
        sprints,
      }),
    );
  });
  app.post('/api/v1/notifications/read', async (req, res) => {
    const body = z.object({ id: z.string().optional() }).parse(req.body || {});
    await db.run(
      'UPDATE notifications SET read_at = ? WHERE workspace_id = ? AND user_id = ?' +
        (body.id ? ' AND id = ?' : ''),
      [now(), req.workspaceId, req.user.id, ...(body.id ? [body.id] : [])],
    );
    broadcast(req);
    res.json({ ok: true });
  });
  app.post('/api/v1/pages', async (req, res) => {
    canWrite(req);
    const body = z
      .object({
        title: z.string().trim().min(1).max(255),
        project_id: z.string().nullable().default(null),
      })
      .parse(req.body);
    if (body.project_id) await project(req, body.project_id, true);
    const pageId = id();
    await db.insert('pages', {
      ...body,
      id: pageId,
      workspace_id: req.workspaceId,
      content: '<p></p>',
      icon: 'file',
      author_id: req.user.id,
      updated_at: now(),
    });
    broadcast(req);
    res.status(201).json({ id: pageId });
  });
  app.patch('/api/v1/pages/:id', async (req, res) => {
    canWrite(req);
    const body = z
      .object({
        title: z.string().trim().min(1).max(255),
        content: z.string().max(500000).transform(sanitizeRichText),
        version: z.number().int().positive(),
      })
      .parse(req.body);
    const saved = await db.transaction(async () => {
      const page = await db.one<{
        id: string;
        project_id: string | null;
        title: string;
        content: string;
        version: number;
      }>('SELECT * FROM pages WHERE id = ? AND workspace_id = ?', [
        String(req.params.id),
        req.workspaceId,
      ]);
      if (!page) throw new HttpError(404, 'Page not found.');
      if (page.project_id) await project(req, page.project_id, true);
      if (page.version !== body.version)
        throw new HttpError(
          409,
          'This page has changed. Reload it before saving.',
          'EDIT_CONFLICT',
        );
      await db.insert('page_versions', {
        id: id(),
        workspace_id: req.workspaceId,
        page_id: page.id,
        title: page.title,
        content: page.content,
        version: page.version,
        author_id: req.user.id,
        created_at: now(),
      });
      const changed = await db.run(
        'UPDATE pages SET title = ?,content = ?,version = version + 1,updated_at = ? WHERE id = ? AND workspace_id = ? AND version = ?',
        [body.title, body.content, now(), page.id, req.workspaceId, body.version],
      );
      if (!changed)
        throw new HttpError(
          409,
          'This page has changed. Reload it before saving.',
          'EDIT_CONFLICT',
        );
      return db.one('SELECT * FROM pages WHERE id = ? AND workspace_id = ?', [
        page.id,
        req.workspaceId,
      ]);
    });
    broadcast(req);
    res.json({ ok: true, page: saved });
  });
  app.get('/api/v1/pages/:id/versions', async (req, res) => {
    const page = await db.one<{ project_id: string | null }>(
      'SELECT project_id FROM pages WHERE id = ? AND workspace_id = ?',
      [String(req.params.id), req.workspaceId],
    );
    if (!page) throw new HttpError(404, 'Page not found.');
    if (page.project_id) await project(req, page.project_id);
    res.json(
      await db.all(
        'SELECT * FROM page_versions WHERE page_id = ? AND workspace_id = ? ORDER BY version DESC',
        [String(req.params.id), req.workspaceId],
      ),
    );
  });
  app.patch('/api/v1/workspace', async (req, res) => {
    canAdmin(req);
    const body = z.object({ name: z.string().trim().min(2).max(120) }).parse(req.body);
    await db.run('UPDATE workspaces SET name = ? WHERE id = ?', [body.name, req.workspaceId]);
    broadcast(req);
    res.json({ ok: true });
  });
  app.patch('/api/v1/members/:id', async (req, res) => {
    const target = String(req.params.id);
    if (target !== req.user.id) canAdmin(req);
    const body = z
      .object({
        role: z.enum(['admin', 'member', 'viewer']).optional(),
        capacity: z.number().int().min(0).max(80).optional(),
        name: z.string().trim().min(2).max(120).optional(),
      })
      .parse(req.body);
    if (body.role) canAdmin(req);
    const member = await db.one<{ role: string }>(
      'SELECT * FROM memberships WHERE workspace_id = ? AND user_id = ?',
      [req.workspaceId, target],
    );
    if (!member) throw new HttpError(404, 'Member not found.');
    if (member.role === 'owner' && body.role)
      throw new HttpError(400, 'Ownership transfer is not available yet.');
    await db.transaction(async () => {
      if (body.role)
        await db.run('UPDATE memberships SET role = ? WHERE workspace_id = ? AND user_id = ?', [
          body.role,
          req.workspaceId,
          target,
        ]);
      if (body.capacity !== undefined)
        await db.run('UPDATE users SET capacity = ? WHERE id = ?', [body.capacity, target]);
      if (body.name) await db.run('UPDATE users SET name = ? WHERE id = ?', [body.name, target]);
      await audit(req, 'member.updated', target, JSON.stringify(body));
    });
    broadcast(req);
    res.json({ ok: true });
  });
  app.post('/api/v1/standups', async (req, res) => {
    canWrite(req);
    const body = z
      .object({
        yesterday: z.string().max(4000),
        today: z.string().trim().min(1).max(4000),
        blockers: z.string().max(4000).default(''),
      })
      .parse(req.body);
    await db.insert('standups', {
      ...body,
      id: id(),
      workspace_id: req.workspaceId,
      user_id: req.user.id,
      created_at: now(),
    });
    broadcast(req);
    res.status(201).json({ ok: true });
  });
  app.post('/api/v1/risks', async (req, res) => {
    canWrite(req);
    const body = z
      .object({
        title: z.string().trim().min(1).max(255),
        severity: z.enum(['low', 'medium', 'high', 'critical']),
        project_id: z.string().nullable().default(null),
      })
      .parse(req.body);
    if (body.project_id) await project(req, body.project_id, true);
    await db.insert('risks', {
      ...body,
      id: id(),
      workspace_id: req.workspaceId,
      state: 'open',
      owner_id: req.user.id,
      created_at: now(),
    });
    broadcast(req);
    res.status(201).json({ ok: true });
  });
  app.patch('/api/v1/risks/:id', async (req, res) => {
    canWrite(req);
    const body = z.object({ state: z.enum(['open', 'mitigated', 'closed']) }).parse(req.body);
    const risk = await db.one<{ project_id: string | null }>(
      'SELECT * FROM risks WHERE id = ? AND workspace_id = ?',
      [String(req.params.id), req.workspaceId],
    );
    if (!risk) throw new HttpError(404, 'Risk not found.');
    if (risk.project_id) await project(req, risk.project_id, true);
    await db.run('UPDATE risks SET state = ? WHERE id = ? AND workspace_id = ?', [
      body.state,
      String(req.params.id),
      req.workspaceId,
    ]);
    broadcast(req);
    res.json({ ok: true });
  });
  app.get('/api/v1/audit', async (req, res) => {
    canAdmin(req);
    res.json(
      await db.all(
        'SELECT * FROM audit_log WHERE workspace_id = ? ORDER BY created_at DESC LIMIT 200',
        [req.workspaceId],
      ),
    );
  });
  app.post('/api/v1/import/jira', async (req, res) => {
    canAdmin(req);
    const body = z
      .object({
        project_id: z.string(),
        content: z.string().max(2_500_000),
        format: z.enum(['csv', 'json']),
        confirm: z.boolean().default(false),
      })
      .parse(req.body);
    await project(req, body.project_id, true);
    let rows: Record<string, unknown>[];
    try {
      if (body.format === 'json') {
        const json = JSON.parse(body.content);
        rows = Array.isArray(json) ? json : json.issues;
      } else {
        const parsed = Papa.parse<Record<string, unknown>>(body.content, {
          header: true,
          skipEmptyLines: true,
        });
        if (parsed.errors.length) throw new Error(parsed.errors[0].message);
        rows = parsed.data;
      }
      if (!Array.isArray(rows) || !rows.length || rows.length > 1000)
        throw new Error('Use an export containing 1–1,000 issues.');
      if (rows.some((row) => !row || typeof row !== 'object' || Array.isArray(row)))
        throw new Error('Each imported issue must be an object.');
    } catch (e) {
      throw new HttpError(400, `Cannot read this import. ${(e as Error).message}`);
    }
    const statuses = await db.all<Status>(
      'SELECT * FROM statuses WHERE workspace_id = ? AND project_id = ? ORDER BY position',
      [req.workspaceId, body.project_id],
    );
    const preview = rows.map((row, index) => {
      const fields = (row.fields || row) as Record<string, unknown>;
      const value = (...names: string[]) => {
        for (const n of names)
          if (fields[n] !== undefined) {
            const v = fields[n];
            return typeof v === 'object' && v
              ? String((v as { name?: string }).name || '')
              : String(v);
          }
        return '';
      };
      const summary = value('Summary', 'summary', 'title');
      const sourceKey = String(row.key || value('Issue key', 'Key', 'key'));
      const statusName = value('Status', 'status');
      const status = statuses.find((s) => s.name.toLowerCase() === statusName.toLowerCase());
      const typeName = value('Issue Type', 'issuetype', 'type').toLowerCase();
      const priorityName = value('Priority', 'priority').toLowerCase();
      return {
        row: index + 1,
        sourceKey,
        summary,
        status: status?.name || statuses[0].name,
        warning: statusName && !status ? `“${statusName}” mapped to ${statuses[0].name}` : '',
        error: !summary.trim()
          ? 'Summary is required'
          : summary.length > 255
            ? 'Summary exceeds 255 characters'
            : '',
        issue: {
          project_id: body.project_id,
          summary,
          description: `<p>Imported from ${sourceKey.replace(/[<>&"]/g, '') || 'Jira'}</p><p>${value('Description', 'description').replace(/[<>&]/g, '')}</p>`,
          type: ['task', 'story', 'bug', 'epic'].includes(typeName) ? typeName : 'task',
          status_id: (status || statuses[0]).id,
          priority: ['critical', 'high', 'medium', 'low', 'lowest'].includes(priorityName)
            ? priorityName
            : 'medium',
          story_points: Math.max(
            0,
            Math.min(
              1000,
              Number(value('Story Points', 'Story point estimate', 'story_points')) || 0,
            ),
          ),
          labels: ['Imported'],
        },
      };
    });
    if (body.confirm) {
      if (preview.some((r) => r.error))
        throw new HttpError(400, 'Resolve the invalid rows before importing.');
      await db.transaction(async () => {
        for (const row of preview) await createIssue(req, row.issue);
        await audit(req, 'jira.imported', body.project_id, `${preview.length} issues`);
      });
      broadcast(req);
    }
    res.json({
      rows: preview.map(({ issue: _issue, ...row }) => row),
      imported: body.confirm ? preview.length : 0,
    });
  });
  app.use('/api', (_req, _res) => {
    throw new HttpError(404, 'API endpoint not found.');
  });
  if (existsSync(resolve('dist/index.html'))) {
    app.use(express.static(resolve('dist')));
    app.get('/{*path}', (_req, res) => res.sendFile(resolve('dist/index.html')));
  }
  app.use((error: unknown, _req: Request, res: express.Response, _next: express.NextFunction) => {
    if (error instanceof z.ZodError)
      return res.status(400).json({
        code: 'VALIDATION_ERROR',
        message: error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '),
      });
    if (error instanceof QueryError)
      return res.status(400).json({ code: 'INVALID_QUERY', message: error.message });
    if (error instanceof HttpError)
      return res.status(error.status).json({ code: error.code, message: error.message });
    if (error instanceof multer.MulterError)
      return res.status(400).json({
        code: 'UPLOAD_ERROR',
        message:
          error.code === 'LIMIT_FILE_SIZE' ? 'Files must be 25 MB or smaller.' : error.message,
      });
    if (
      (error as { code?: string }).code === 'ER_DUP_ENTRY' ||
      (error as { code?: string }).code?.startsWith('SQLITE_CONSTRAINT')
    )
      return res.status(409).json({
        code: 'CONFLICT',
        message: 'This change conflicts with an existing record.',
      });
    if ((error as { type?: string }).type === 'entity.parse.failed')
      return res.status(400).json({
        code: 'INVALID_JSON',
        message: 'The request contains invalid JSON.',
      });
    console.error(error);
    res.status(500).json({
      code: 'INTERNAL_ERROR',
      message: 'Something went wrong. Please try again.',
    });
  });
  io.use(async (socket, next) => {
    try {
      const cookies = Object.fromEntries(
        (socket.handshake.headers.cookie || '').split(';').map((c) => c.trim().split('=')),
      );
      const auth = await resolveUser(db, cookies.grace_access);
      socket.data = auth;
      if (socket.handshake.headers.origin && !allowedOrigins.has(socket.handshake.headers.origin))
        throw new Error('Origin rejected');
      next();
    } catch {
      next(new Error('Authentication required'));
    }
  });
  io.on('connection', (socket) => {
    socket.join(`workspace:${socket.data.workspaceId}`);
    // Revalidate session and membership periodically; revoked sessions lose updates.
    const timer = setInterval(async () => {
      const session = await db
        .one('SELECT id FROM sessions WHERE id = ? AND expires_at > ?', [
          socket.data.sessionId,
          now(),
        ])
        .catch(() => undefined);
      if (!session) socket.disconnect(true);
    }, 30000);
    socket.on('disconnect', () => clearInterval(timer));
  });
  return { app, httpServer, io, db, accounts };
}
