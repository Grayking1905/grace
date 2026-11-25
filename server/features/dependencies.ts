import type { Express, Request, Response } from 'express';
import type { Database } from '../db.js';
import { z } from 'zod';
import { id } from '../seed.js';
import { recordIssueEvent } from '../home-events.js';
import { HttpError } from '../auth.js';

function canWrite(req: Request) {
  if (!req.user) throw new HttpError(401, 'Not authenticated');
}

const VALID_LINK_TYPES = new Set([
  'blocks',
  'is-blocked-by',
  'duplicates',
  'is-duplicated-by',
  'relates to',
  'relates-to',
  'causes',
  'is-caused-by',
]);

const addLinkSchema = z.object({
  target_id: z.string().min(1),
  type: z.string().min(1),
});

export function registerDependencyRoutes(
  app: Express,
  db: Database,
  broadcast?: (req: Request) => void,
  access?: {
    issue: (req: Request, id: string, write?: boolean) => Promise<{ id: string; project_id: string }>;
    visibleProjects: (req: Request) => Promise<{ id: string }[]>;
  },
) {
  // GET /api/v1/issues/:id/links — full dependency list for one issue
  app.get('/api/v1/issues/:issueId/links', async (req: Request, res: Response) => {
    if (!req.user) throw new HttpError(401, 'Not authenticated');
    const issueId = String(req.params.issueId);
    const wid = req.workspaceId;
    if (access) await access.issue(req, issueId, false);
    const visibleIds = access
      ? new Set((await access.visibleProjects(req)).map((p) => p.id))
      : null;

    // Outgoing links (this issue is source)
    const outgoing = await db.all<{
      id: string;
      target_id: string;
      type: string;
      key: string;
      summary: string;
      status_name: string;
      priority: string;
      project_id: string;
    }>(
      `SELECT il.id, il.target_id, il.type,
              i.\`key\` AS key,
              i.summary, i.priority, i.project_id,
              s.name AS status_name
       FROM issue_links il
       JOIN issues i ON il.target_id = i.id
       JOIN statuses s ON i.status_id = s.id
       WHERE il.workspace_id = ? AND il.source_id = ?
         AND i.deleted_at IS NULL`,
      [wid, issueId],
    );

    // Incoming links (this issue is target) — show inverse type label
    const incoming = await db.all<{
      id: string;
      source_id: string;
      type: string;
      key: string;
      summary: string;
      status_name: string;
      priority: string;
      project_id: string;
    }>(
      `SELECT il.id, il.source_id, il.type,
              i.\`key\` AS key,
              i.summary, i.priority, i.project_id,
              s.name AS status_name
       FROM issue_links il
       JOIN issues i ON il.source_id = i.id
       JOIN statuses s ON i.status_id = s.id
       WHERE il.workspace_id = ? AND il.target_id = ?
         AND i.deleted_at IS NULL`,
      [wid, issueId],
    );

    res.json({
      outgoing: (visibleIds ? outgoing.filter((l) => visibleIds.has(l.project_id)) : outgoing).map(
        ({ project_id: _pid, ...rest }) => rest,
      ),
      incoming: (visibleIds ? incoming.filter((l) => visibleIds.has(l.project_id)) : incoming).map(
        ({ project_id: _pid, ...rest }) => rest,
      ),
    });
  });

  // POST /api/v1/issues/:id/links — add dependency
  app.post('/api/v1/issues/:issueId/links', async (req: Request, res: Response) => {
    canWrite(req);
    const issueId = String(req.params.issueId);
    const wid = req.workspaceId;
    const body = addLinkSchema.parse(req.body);

    if (!VALID_LINK_TYPES.has(body.type)) {
      res.status(400).json({ error: 'Invalid link type' });
      return;
    }

    if (body.target_id === issueId) {
      res.status(400).json({ error: 'An issue cannot link to itself.' });
      return;
    }

    if (access) {
      await access.issue(req, issueId, true);
      await access.issue(req, body.target_id, false);
    } else {
      // Verify source and target belong to same workspace
      const src = await db.one<{ id: string }>(
        `SELECT id FROM issues WHERE id = ? AND workspace_id = ? AND deleted_at IS NULL`,
        [issueId, wid],
      );
      if (!src) {
        res.status(404).json({ error: 'Source issue not found' });
        return;
      }
      const tgt = await db.one<{ id: string }>(
        `SELECT id FROM issues WHERE id = ? AND workspace_id = ? AND deleted_at IS NULL`,
        [body.target_id, wid],
      );
      if (!tgt) {
        res.status(404).json({ error: 'Target issue not found' });
        return;
      }
    }

    const existing = await db.one<{ id: string }>(
      `SELECT id FROM issue_links WHERE source_id = ? AND target_id = ? AND type = ? AND workspace_id = ?`,
      [issueId, body.target_id, body.type, wid],
    );

    if (existing) {
      res.json({ ok: true, id: existing.id });
      return;
    }

    const linkId = id();
    try {
      await db.insert('issue_links', {
        id: linkId,
        workspace_id: wid,
        source_id: issueId,
        target_id: body.target_id,
        type: body.type,
      });
      await recordIssueEvent(db, req, issueId, 'link');
      if (broadcast) broadcast(req);
    } catch (e: unknown) {
      const err = e as { code?: string };
      if (err.code === 'SQLITE_CONSTRAINT' || (err.code && err.code.includes('ER_DUP'))) {
        res.status(409).json({ error: 'Link already exists' });
        return;
      }
      throw e;
    }

    res.status(201).json({ ok: true, id: linkId });
  });

  // DELETE /api/v1/issue-links/:id — remove dependency
  app.delete('/api/v1/issue-links/:linkId', async (req: Request, res: Response) => {
    canWrite(req);
    const linkId = String(req.params.linkId);
    const wid = req.workspaceId;

    const link = await db.one<{ source_id: string }>(
      `SELECT source_id FROM issue_links WHERE id = ? AND workspace_id = ?`,
      [linkId, wid],
    );

    await db.run(`DELETE FROM issue_links WHERE id = ? AND workspace_id = ?`, [linkId, wid]);

    if (link) {
      await recordIssueEvent(db, req, link.source_id, 'link');
    }
    if (broadcast) broadcast(req);

    res.json({ ok: true });
  });

  // GET /api/v1/projects/:id/dependency-graph — full project graph (nodes + edges)
  app.get('/api/v1/projects/:projectId/dependency-graph', async (req: Request, res: Response) => {
    if (!req.user) throw new HttpError(401, 'Not authenticated');
    const projectId = String(req.params.projectId);
    const wid = req.workspaceId;

    const issues = await db.all<{
      id: string;
      key: string;
      summary: string;
      status_name: string;
      status_category: string;
      priority: string;
      assignee_name: string | null;
      story_points: number;
    }>(
      `SELECT i.id,
              i.\`key\` AS key,
              i.summary, i.priority, i.story_points,
              s.name AS status_name, s.category AS status_category,
              u.name AS assignee_name
       FROM issues i
       JOIN statuses s ON i.status_id = s.id
       LEFT JOIN users u ON i.assignee_id = u.id
       WHERE i.project_id = ? AND i.workspace_id = ? AND i.deleted_at IS NULL`,
      [projectId, wid],
    );

    const issueIds = issues.map((i) => i.id);
    let links: { id: string; source_id: string; target_id: string; type: string }[] = [];
    if (issueIds.length > 0) {
      const placeholders = issueIds.map(() => '?').join(',');
      links = await db.all<{ id: string; source_id: string; target_id: string; type: string }>(
        `SELECT id, source_id, target_id, type FROM issue_links
         WHERE workspace_id = ? AND source_id IN (${placeholders})`,
        [wid, ...issueIds],
      );
    }

    res.json({ nodes: issues, edges: links });
  });
}
