/**
 * Admin Insights & Sandbox API routes
 */
import type { Express } from 'express';
import { z } from 'zod';
import type { Database } from '../db.js';
import { canAdmin, HttpError } from '../auth.js';
import { id, now } from '../seed.js';

function daysAgo(days: number) {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
}

// ─── Insights ───────────────────────────────────────────────────────────────

export function registerInsightsRoutes(app: Express, db: Database) {
  app.get('/api/v1/insights/summary', async (req, res) => {
    canAdmin(req);
    const wid = req.workspaceId;
    const [
      totalUsers,
      activeUsers30d,
      activeUsers7d,
      totalProjects,
      activeProjects,
      totalIssues,
      issuesThisMonth,
      twoStepEnabled,
    ] = await Promise.all([
      db.one<{ c: number }>('SELECT COUNT(*) c FROM memberships WHERE workspace_id=?', [wid]),
      db.one<{ c: number }>(
        'SELECT COUNT(DISTINCT reporter_id) c FROM issues WHERE workspace_id=? AND created_at>=?',
        [wid, daysAgo(30)],
      ),
      db.one<{ c: number }>(
        'SELECT COUNT(DISTINCT reporter_id) c FROM issues WHERE workspace_id=? AND created_at>=?',
        [wid, daysAgo(7)],
      ),
      db.one<{ c: number }>(
        "SELECT COUNT(*) c FROM projects WHERE workspace_id=? AND archived_at IS NULL",
        [wid],
      ),
      db.one<{ c: number }>(
        `SELECT COUNT(*) c FROM projects WHERE workspace_id=? AND archived_at IS NULL
         AND id IN (SELECT DISTINCT project_id FROM issues WHERE workspace_id=? AND created_at>=?)`,
        [wid, wid, daysAgo(90)],
      ),
      db.one<{ c: number }>(
        "SELECT COUNT(*) c FROM issues WHERE workspace_id=? AND deleted_at IS NULL",
        [wid],
      ),
      db.one<{ c: number }>(
        `SELECT COUNT(*) c FROM issues WHERE workspace_id=? AND deleted_at IS NULL AND created_at>=?`,
        [wid, `${new Date().toISOString().slice(0, 7)}-01`],
      ),
      // 2-step: check account_security or account_tokens table
      db.one<{ c: number }>(
        `SELECT COUNT(DISTINCT user_id) c FROM account_tokens
         WHERE purpose='totp' AND expires_at>'2099-01-01'`,
      ).catch(() =>
        db.one<{ c: number }>(`SELECT COUNT(*) c FROM account_security WHERE totp_enabled=1`).catch(() => ({ c: 0 }))
      ),
    ]);

    const totalUsersCount = totalUsers?.c ?? 0;
    res.json({
      total_users: totalUsersCount,
      active_users_30d: activeUsers30d?.c ?? 0,
      active_users_7d: activeUsers7d?.c ?? 0,
      total_projects: totalProjects?.c ?? 0,
      active_projects: activeProjects?.c ?? 0,
      total_issues: totalIssues?.c ?? 0,
      issues_this_month: issuesThisMonth?.c ?? 0,
      two_step_enabled: twoStepEnabled?.c ?? 0,
      two_step_pending: Math.max(0, totalUsersCount - (twoStepEnabled?.c ?? 0)),
    });
  });

  app.get('/api/v1/insights/activity', async (req, res) => {
    canAdmin(req);
    const wid = req.workspaceId;
    const days = 14;
    const result: Array<{
      date: string;
      issues_created: number;
      issues_resolved: number;
      logins: number;
    }> = [];

    for (let i = days - 1; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const date = d.toISOString().slice(0, 10);
      const nextDate = new Date(d);
      nextDate.setDate(nextDate.getDate() + 1);
      const nextDateStr = nextDate.toISOString().slice(0, 10);

      const [created, resolved, logins] = await Promise.all([
        db.one<{ c: number }>(
          'SELECT COUNT(*) c FROM issues WHERE workspace_id=? AND created_at>=? AND created_at<?',
          [wid, date, nextDateStr],
        ),
        db.one<{ c: number }>(
          `SELECT COUNT(*) c FROM issues i
           JOIN statuses s ON s.id=i.status_id
           WHERE i.workspace_id=? AND s.category='done'
           AND i.updated_at>=? AND i.updated_at<?`,
          [wid, date, nextDateStr],
        ),
        db
          .one<{ c: number }>(
            `SELECT COUNT(*) c FROM home_events
             WHERE workspace_id=? AND action='member.signed_in' AND created_at>=? AND created_at<?`,
            [wid, date, nextDateStr],
          )
          .catch(() => ({ c: 0 })),
      ]);
      result.push({
        date,
        issues_created: created?.c ?? 0,
        issues_resolved: resolved?.c ?? 0,
        logins: (logins as { c: number } | undefined)?.c ?? 0,
      });
    }
    res.json(result);
  });

  app.get('/api/v1/insights/apps', async (req, res) => {
    canAdmin(req);
    const wid = req.workspaceId;
    const totalRow = await db.one<{ c: number }>(
      'SELECT COUNT(*) c FROM memberships WHERE workspace_id=?',
      [wid],
    );
    const totalUsers = Math.max(totalRow?.c ?? 1, 1);

    const [boardUsers, sprintUsers, pageUsers, inboxUsers, viewUsers] = await Promise.all([
      db.one<{ c: number }>(
        'SELECT COUNT(DISTINCT reporter_id) c FROM issues WHERE workspace_id=?',
        [wid],
      ),
      db.one<{ c: number }>(
        `SELECT COUNT(DISTINCT reporter_id) c FROM issues WHERE workspace_id=? AND sprint_id IS NOT NULL`,
        [wid],
      ),
      db.one<{ c: number }>(
        'SELECT COUNT(DISTINCT author_id) c FROM pages WHERE workspace_id=?',
        [wid],
      ),
      db.one<{ c: number }>(
        'SELECT COUNT(DISTINCT user_id) c FROM notifications WHERE workspace_id=?',
        [wid],
      ),
      db.one<{ c: number }>(
        'SELECT COUNT(DISTINCT owner_id) c FROM saved_views WHERE workspace_id=?',
        [wid],
      ),
    ]);

    const pct = (n: number) => Math.min(100, Math.round((n / totalUsers) * 100));
    res.json([
      { name: 'Issue Board', active_users: boardUsers?.c ?? 0, total_actions: (boardUsers?.c ?? 0) * 15, adoption_pct: pct(boardUsers?.c ?? 0) },
      { name: 'Sprints & Backlog', active_users: sprintUsers?.c ?? 0, total_actions: (sprintUsers?.c ?? 0) * 20, adoption_pct: pct(sprintUsers?.c ?? 0) },
      { name: 'Documents / Pages', active_users: pageUsers?.c ?? 0, total_actions: (pageUsers?.c ?? 0) * 6, adoption_pct: pct(pageUsers?.c ?? 0) },
      { name: 'Inbox / Notifications', active_users: inboxUsers?.c ?? 0, total_actions: (inboxUsers?.c ?? 0) * 10, adoption_pct: pct(inboxUsers?.c ?? 0) },
      { name: 'Saved Views', active_users: viewUsers?.c ?? 0, total_actions: (viewUsers?.c ?? 0) * 5, adoption_pct: pct(viewUsers?.c ?? 0) },
    ]);
  });

  app.get('/api/v1/insights/users', async (req, res) => {
    canAdmin(req);
    const wid = req.workspaceId;
    const members = await db.all<{ id: string; name: string; email: string; role: string }>(
      `SELECT u.id, u.name, u.email, m.role
       FROM users u JOIN memberships m ON m.user_id=u.id
       WHERE m.workspace_id=?
       ORDER BY m.role, u.name`,
      [wid],
    );

    const result = await Promise.all(
      members.map(async (member) => {
        const [lastActive, projectCount, issueCount] = await Promise.all([
          db
            .one<{ ts: string }>(
              `SELECT MAX(created_at) ts FROM home_events WHERE workspace_id=? AND actor_id=?`,
              [wid, member.id],
            )
            .catch(() => null),
          db.one<{ c: number }>(
            `SELECT COUNT(DISTINCT project_id) c FROM issues WHERE workspace_id=? AND reporter_id=?`,
            [wid, member.id],
          ),
          db.one<{ c: number }>(
            `SELECT COUNT(*) c FROM issues WHERE workspace_id=? AND reporter_id=? AND deleted_at IS NULL`,
            [wid, member.id],
          ),
        ]);
        const lastTs = lastActive?.ts ?? null;
        const daysSince = lastTs
          ? Math.floor((Date.now() - new Date(lastTs).getTime()) / 86400000)
          : 9999;
        const status: 'active' | 'idle' | 'inactive' =
          daysSince <= 7 ? 'active' : daysSince <= 30 ? 'idle' : 'inactive';
        return {
          id: member.id,
          name: member.name,
          email: member.email,
          role: member.role,
          last_active: lastTs,
          two_step: false, // simplified - real 2SV check requires account_security table
          projects_count: projectCount?.c ?? 0,
          issues_count: issueCount?.c ?? 0,
          status,
        };
      }),
    );
    res.json(result);
  });
}

// ─── Sandbox ────────────────────────────────────────────────────────────────

export function registerSandboxRoutes(app: Express, db: Database) {
  app.get('/api/v1/sandboxes', async (req, res) => {
    canAdmin(req);
    const wid = req.workspaceId;
    const rows = await db.all<{
      id: string;
      name: string;
      description: string;
      status: string;
      production_snapshot: string;
      last_synced: string | null;
      created_by_id: string;
      created_by_name: string;
      created_by_color: string;
      created_at: string;
      updated_at: string;
    }>(
      `SELECT s.id, s.name, s.description, s.status, s.production_snapshot,
              s.last_synced, s.created_by_id, u.name created_by_name, u.color created_by_color,
              s.created_at, s.updated_at
       FROM sandboxes s JOIN users u ON u.id=s.created_by_id
       WHERE s.workspace_id=? AND s.status != 'deleted'
       ORDER BY s.created_at DESC`,
      [wid],
    );
    const enriched = await Promise.all(
      rows.map(async (row) => {
        const [pc, ic] = await Promise.all([
          db.one<{ c: number }>('SELECT COUNT(*) c FROM sandbox_projects WHERE sandbox_id=?', [row.id]),
          db.one<{ c: number }>('SELECT COUNT(*) c FROM sandbox_issues WHERE sandbox_id=?', [row.id]),
        ]);
        return { ...row, project_count: pc?.c ?? 0, issue_count: ic?.c ?? 0, workspace_count: 1 };
      }),
    );
    res.json(enriched);
  });

  app.post('/api/v1/sandboxes', async (req, res) => {
    canAdmin(req);
    const body = z
      .object({
        name: z.string().trim().min(2).max(80),
        description: z.string().trim().max(500).default(''),
      })
      .parse(req.body);
    const wid = req.workspaceId;
    const userId = req.user.id;
    const sandboxId = id();
    const snapshotId = id().slice(0, 12).toUpperCase();

    await db.insert('sandboxes', {
      id: sandboxId,
      workspace_id: wid,
      name: body.name,
      description: body.description,
      status: 'creating',
      production_snapshot: snapshotId,
      last_synced: null,
      created_by_id: userId,
      created_at: now(),
      updated_at: now(),
    });

    setImmediate(async () => {
      try {
        const projects = await db.all<{ id: string; name: string }>(
          'SELECT id, name FROM projects WHERE workspace_id=? AND archived_at IS NULL LIMIT 50',
          [wid],
        );
        for (const p of projects) {
          await db.insert('sandbox_projects', {
            id: id(),
            sandbox_id: sandboxId,
            source_project_id: p.id,
            name: p.name,
            created_at: now(),
          });
        }
        const issues = await db.all<{ id: string }>(
          'SELECT id FROM issues WHERE workspace_id=? AND deleted_at IS NULL LIMIT 500',
          [wid],
        );
        for (const issue of issues) {
          await db.insert('sandbox_issues', {
            id: id(),
            sandbox_id: sandboxId,
            source_issue_id: issue.id,
            created_at: now(),
          });
        }
        await db.run(
          "UPDATE sandboxes SET status='active', last_synced=?, updated_at=? WHERE id=?",
          [now(), now(), sandboxId],
        );
      } catch {
        await db.run("UPDATE sandboxes SET status='error', updated_at=? WHERE id=?", [
          now(), sandboxId,
        ]);
      }
    });

    res.status(201).json({ id: sandboxId });
  });

  app.post('/api/v1/sandboxes/:sandboxId/sync', async (req, res) => {
    canAdmin(req);
    const wid = req.workspaceId;
    const { sandboxId } = req.params;
    const sandbox = await db.one<{ id: string; workspace_id: string }>(
      "SELECT id, workspace_id FROM sandboxes WHERE id=? AND status='active'",
      [sandboxId],
    );
    if (!sandbox || sandbox.workspace_id !== wid)
      throw new HttpError(404, 'Sandbox not found or not active.');

    await db.run("UPDATE sandboxes SET status='syncing', updated_at=? WHERE id=?", [now(), sandboxId]);

    setImmediate(async () => {
      try {
        await db.run('DELETE FROM sandbox_projects WHERE sandbox_id=?', [sandboxId]);
        await db.run('DELETE FROM sandbox_issues WHERE sandbox_id=?', [sandboxId]);
        const projects = await db.all<{ id: string; name: string }>(
          'SELECT id, name FROM projects WHERE workspace_id=? AND archived_at IS NULL LIMIT 50',
          [wid],
        );
        for (const p of projects) {
          await db.insert('sandbox_projects', {
            id: id(), sandbox_id: sandboxId,
            source_project_id: p.id, name: p.name, created_at: now(),
          });
        }
        const issues = await db.all<{ id: string }>(
          'SELECT id FROM issues WHERE workspace_id=? AND deleted_at IS NULL LIMIT 500',
          [wid],
        );
        for (const issue of issues) {
          await db.insert('sandbox_issues', {
            id: id(), sandbox_id: sandboxId, source_issue_id: issue.id, created_at: now(),
          });
        }
        await db.run(
          "UPDATE sandboxes SET status='active', last_synced=?, updated_at=? WHERE id=?",
          [now(), now(), sandboxId],
        );
      } catch {
        await db.run("UPDATE sandboxes SET status='error', updated_at=? WHERE id=?", [now(), sandboxId]);
      }
    });
    res.json({ ok: true });
  });

  app.delete('/api/v1/sandboxes/:sandboxId', async (req, res) => {
    canAdmin(req);
    const wid = req.workspaceId;
    const { sandboxId } = req.params;
    const sandbox = await db.one<{ workspace_id: string }>(
      "SELECT workspace_id FROM sandboxes WHERE id=? AND status!='deleted'",
      [sandboxId],
    );
    if (!sandbox || sandbox.workspace_id !== wid)
      throw new HttpError(404, 'Sandbox not found.');
    await db.run('DELETE FROM sandbox_projects WHERE sandbox_id=?', [sandboxId]);
    await db.run('DELETE FROM sandbox_issues WHERE sandbox_id=?', [sandboxId]);
    await db.run('DELETE FROM sandbox_apps WHERE sandbox_id=?', [sandboxId]);
    await db.run("UPDATE sandboxes SET status='deleted', updated_at=? WHERE id=?", [now(), sandboxId]);
    res.json({ ok: true });
  });

  app.get('/api/v1/sandboxes/:sandboxId/apps', async (req, res) => {
    canAdmin(req);
    const wid = req.workspaceId;
    const { sandboxId } = req.params;
    const sandbox = await db.one<{ workspace_id: string }>(
      'SELECT workspace_id FROM sandboxes WHERE id=?',
      [sandboxId],
    );
    if (!sandbox || sandbox.workspace_id !== wid)
      throw new HttpError(404, 'Sandbox not found.');
    const apps = await db.all(
      'SELECT * FROM sandbox_apps WHERE sandbox_id=? ORDER BY installed_at DESC',
      [sandboxId],
    );
    res.json(apps);
  });
}
