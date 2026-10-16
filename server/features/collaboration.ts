import type { Express, Request } from 'express';
import { z } from 'zod';
import type { Database } from '../db.js';
import type { Issue } from '../../shared/types.js';
import { canAdmin, HttpError } from '../auth.js';
import { audienceMember, type createNotifications } from './notifications.js';
import { id, now } from '../seed.js';
type Context = {
  app: Express;
  db: Database;
  issue: (req: Request, id: string, write?: boolean) => Promise<Issue>;
  notify: ReturnType<typeof createNotifications>;
  audit: (req: Request, action: string, target: string, detail?: string) => Promise<void>;
  addHistory: (
    req: Request,
    id: string,
    field: string,
    before: unknown,
    after: unknown,
  ) => Promise<void>;
  broadcast: (req: Request) => void;
};
export function registerCollaborationRoutes({
  app,
  db,
  issue,
  notify,
  audit,
  addHistory,
  broadcast,
}: Context) {
  const bodySchema = z.object({ body: z.string().trim().min(1).max(20000) });
  app.get('/api/v1/issues/:id/people', async (req, res) => {
    const current = await issue(req, String(req.params.id));
    res.json(
      await db.all(
        `SELECT u.id,u.name,u.email,u.color,u.capacity,m.role FROM memberships m JOIN users u ON u.id=m.user_id JOIN projects p ON p.workspace_id=m.workspace_id WHERE m.workspace_id=? AND p.id=? AND NOT EXISTS (SELECT 1 FROM member_deactivations md WHERE md.workspace_id=m.workspace_id AND md.user_id=m.user_id) AND (p.visibility='workspace' OR m.role IN ('owner','admin') OR p.lead_id=m.user_id OR EXISTS (SELECT 1 FROM project_members pm WHERE pm.project_id=p.id AND pm.user_id=m.user_id AND pm.workspace_id=m.workspace_id)) ORDER BY u.name LIMIT 1000`,
        [req.workspaceId, current.project_id],
      ),
    );
  });
  async function mentionIds(req: Request, current: Issue, body: string) {
    const ids = [
      ...new Set(
        [...body.matchAll(/@\[[^\]\r\n]{1,120}\]\(([a-zA-Z0-9_-]{1,64})\)/g)].map(
          (match) => match[1],
        ),
      ),
    ];
    if (ids.length > 30) throw new HttpError(400, 'Mention up to 30 people in one comment.');
    for (const userId of ids)
      if (!(await audienceMember(db, req.workspaceId, current.project_id, userId)))
        throw new HttpError(400, 'Mention only active members who can access this project.');
    return ids;
  }
  app.put('/api/v1/issues/:id/watchers', async (req, res) => {
    const current = await issue(req, String(req.params.id), true);
    const { user_ids } = z.object({ user_ids: z.array(z.string()).max(100) }).parse(req.body);
    const ids = [...new Set(user_ids)];
    await db.transaction(async () => {
      await db.run('UPDATE issues SET version=version WHERE id=?', [current.id]);
      for (const userId of ids)
        if (!(await audienceMember(db, req.workspaceId, current.project_id, userId)))
          throw new HttpError(400, 'Watchers must be active members with project access.');
      const previous = await db.all<{ user_id: string }>(
        'SELECT user_id FROM watchers WHERE workspace_id=? AND issue_id=?',
        [req.workspaceId, current.id],
      );
      await db.run('DELETE FROM watchers WHERE workspace_id=? AND issue_id=?', [
        req.workspaceId,
        current.id,
      ]);
      for (const userId of ids) {
        await db.insert('watchers', {
          workspace_id: req.workspaceId,
          issue_id: current.id,
          user_id: userId,
        });
        if (!previous.some((p) => p.user_id === userId))
          await notify(
            req,
            userId,
            current.id,
            `You are watching ${current.key}`,
            current.summary,
            'watcher',
          );
      }
      await audit(req, 'issue.watchers.updated', current.id, JSON.stringify(ids));
    });
    broadcast(req);
    res.json({ ok: true });
  });
  app.post('/api/v1/issues/:id/comments', async (req, res) => {
    const current = await issue(req, String(req.params.id), true);
    const { body } = bodySchema.parse(req.body);
    const commentId = id();
    await db.transaction(async () => {
      const mentions = await mentionIds(req, current, body);
      await db.insert('comments', {
        id: commentId,
        workspace_id: req.workspaceId,
        issue_id: current.id,
        author_id: req.user.id,
        body,
        created_at: now(),
      });
      for (const userId of mentions)
        await db.insert('comment_mentions', {
          workspace_id: req.workspaceId,
          comment_id: commentId,
          user_id: userId,
        });
      for (const userId of mentions)
        if (
          !(await db.one('SELECT user_id FROM watchers WHERE issue_id=? AND user_id=?', [
            current.id,
            userId,
          ]))
        )
          await db.insert('watchers', {
            workspace_id: req.workspaceId,
            issue_id: current.id,
            user_id: userId,
          });
      if (
        !(await db.one('SELECT user_id FROM watchers WHERE issue_id=? AND user_id=?', [
          current.id,
          req.user.id,
        ]))
      )
        await db.insert('watchers', {
          workspace_id: req.workspaceId,
          issue_id: current.id,
          user_id: req.user.id,
        });
      const watchers = await db.all<{ user_id: string }>(
        'SELECT user_id FROM watchers WHERE issue_id=?',
        [current.id],
      );
      const notified = new Set<string>();
      for (const userId of mentions)
        if (
          await notify(
            req,
            userId,
            current.id,
            `${req.user.name} mentioned you on ${current.key}`,
            body.slice(0, 200),
            'mention',
          )
        )
          notified.add(userId);
      for (const watcher of watchers)
        if (!notified.has(watcher.user_id))
          await notify(
            req,
            watcher.user_id,
            current.id,
            `${req.user.name} commented on ${current.key}`,
            body.slice(0, 200),
            'comment',
          );
      await addHistory(req, current.id, 'comment', '', body.slice(0, 200));
    });
    broadcast(req);
    res.status(201).json({ id: commentId });
  });
  app.patch('/api/v1/issues/:id/comments/:commentId', async (req, res) => {
    const current = await issue(req, String(req.params.id), true);
    const { body } = bodySchema.parse(req.body);
    const commentId = String(req.params.commentId);
    await db.transaction(async () => {
      const comment = await db.one<{ author_id: string }>(
        'SELECT author_id FROM comments WHERE id=? AND issue_id=? AND workspace_id=?',
        [commentId, current.id, req.workspaceId],
      );
      if (!comment) throw new HttpError(404, 'Comment not found.');
      if (comment.author_id !== req.user.id) canAdmin(req);
      const mentions = await mentionIds(req, current, body);
      const previous = await db.all<{ user_id: string }>(
        'SELECT user_id FROM comment_mentions WHERE comment_id=?',
        [commentId],
      );
      await db.run('UPDATE comments SET body=?,edited_at=? WHERE id=?', [body, now(), commentId]);
      await db.run('DELETE FROM comment_mentions WHERE comment_id=?', [commentId]);
      for (const userId of mentions) {
        if (
          !(await db.one('SELECT user_id FROM watchers WHERE issue_id=? AND user_id=?', [
            current.id,
            userId,
          ]))
        )
          await db.insert('watchers', {
            workspace_id: req.workspaceId,
            issue_id: current.id,
            user_id: userId,
          });
        await db.insert('comment_mentions', {
          workspace_id: req.workspaceId,
          comment_id: commentId,
          user_id: userId,
        });
        if (!previous.some((p) => p.user_id === userId))
          await notify(
            req,
            userId,
            current.id,
            `${req.user.name} mentioned you on ${current.key}`,
            body.slice(0, 200),
            'mention',
          );
      }
      await audit(req, 'comment.updated', commentId);
    });
    broadcast(req);
    res.json({ ok: true });
  });
  app.delete('/api/v1/issues/:id/comments/:commentId', async (req, res) => {
    const current = await issue(req, String(req.params.id), true);
    const commentId = String(req.params.commentId);
    await db.transaction(async () => {
      const comment = await db.one<{ author_id: string }>(
        'SELECT author_id FROM comments WHERE id=? AND issue_id=? AND workspace_id=?',
        [commentId, current.id, req.workspaceId],
      );
      if (!comment) throw new HttpError(404, 'Comment not found.');
      if (comment.author_id !== req.user.id) canAdmin(req);
      await db.run('DELETE FROM comment_mentions WHERE comment_id=?', [commentId]);
      await db.run('DELETE FROM comments WHERE id=?', [commentId]);
      await audit(req, 'comment.deleted', commentId);
    });
    broadcast(req);
    res.json({ ok: true });
  });
}
