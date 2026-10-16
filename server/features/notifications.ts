import type { Express, Request } from 'express';
import { z } from 'zod';
import type { Database } from '../db.js';
import type { Accounts } from './accounts.js';
import { activeMembership } from './accounts.js';
import { id, now } from '../seed.js';
import {
  notificationEvents,
  type NotificationEvent,
  type NotificationPreference,
} from '../../shared/notifications.js';
export async function audienceMember(
  db: Database,
  workspaceId: string,
  projectId: string,
  userId: string,
) {
  return !!(await db.one(
    `SELECT m.user_id FROM memberships m JOIN projects p ON p.workspace_id=m.workspace_id WHERE m.workspace_id=? AND p.id=? AND m.user_id=? AND ${activeMembership()} AND (p.visibility='workspace' OR m.role IN ('owner','admin') OR p.lead_id=m.user_id OR EXISTS (SELECT 1 FROM project_members pm WHERE pm.project_id=p.id AND pm.user_id=m.user_id AND pm.workspace_id=m.workspace_id))`,
    [workspaceId, projectId, userId],
  ));
}
export function createNotifications(db: Database, accounts: Accounts) {
  return async (
    req: Request,
    userId: string | null,
    issueId: string,
    title: string,
    body: string,
    event: NotificationEvent = 'assignment',
  ) => {
    if (!userId || userId === req.user.id) return false;
    const issue = await db.one<{ project_id: string }>(
      'SELECT project_id FROM issues WHERE workspace_id=? AND id=? AND deleted_at IS NULL',
      [req.workspaceId, issueId],
    );
    if (!issue || !(await audienceMember(db, req.workspaceId, issue.project_id, userId)))
      return false;
    const preference = await db.one<{ in_app: number; email: number }>(
      'SELECT in_app,email FROM notification_preferences WHERE workspace_id=? AND user_id=? AND event=?',
      [req.workspaceId, userId, event],
    );
    if (!preference || preference.in_app)
      await db.insert('notifications', {
        id: id(),
        workspace_id: req.workspaceId,
        user_id: userId,
        issue_id: issueId,
        title,
        body,
        created_at: now(),
      });
    if (preference?.email)
      await accounts.deliver(
        userId,
        'notification',
        title,
        `${body}\n\n${process.env.APP_ORIGIN || 'http://127.0.0.1:5173'}/?issue=${issueId}`,
      );
    return !preference || !!preference.in_app || !!preference.email;
  };
}
export function registerNotificationRoutes(app: Express, db: Database) {
  app.get('/api/v1/account/notifications', async (req, res) => {
    const rows = await db.all<{ event: NotificationEvent; in_app: number; email: number }>(
      'SELECT event,in_app,email FROM notification_preferences WHERE workspace_id=? AND user_id=?',
      [req.workspaceId, req.user.id],
    );
    res.json(
      notificationEvents.map((event) => {
        const row = rows.find((r) => r.event === event);
        return {
          event,
          in_app: row ? !!row.in_app : true,
          email: row ? !!row.email : false,
        } satisfies NotificationPreference;
      }),
    );
  });
  app.patch('/api/v1/account/notifications', async (req, res) => {
    const body = z
      .object({ event: z.enum(notificationEvents), in_app: z.boolean(), email: z.boolean() })
      .strict()
      .parse(req.body);
    await db.transaction(async () => {
      await db.run('UPDATE users SET name=name WHERE id=?', [req.user.id]);
      await db.run(
        'DELETE FROM notification_preferences WHERE workspace_id=? AND user_id=? AND event=?',
        [req.workspaceId, req.user.id, body.event],
      );
      await db.insert('notification_preferences', {
        workspace_id: req.workspaceId,
        user_id: req.user.id,
        event: body.event,
        in_app: body.in_app ? 1 : 0,
        email: body.email ? 1 : 0,
      });
    });
    res.json({ ok: true });
  });
}
