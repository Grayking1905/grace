import type { Express, Request, Response } from 'express';
import { z } from 'zod';
import type { Database } from '../db.js';
import { HttpError } from '../auth.js';
import { id, now } from '../seed.js';
import type { ProjectDocument } from '../../shared/types.js';

const docSchema = z.object({
  title: z.string().trim().min(2).max(200),
  content: z.string().default(''),
  category: z.enum(['guide', 'api', 'architecture', 'notes']).default('guide'),
});

export function registerProjectDocsRoutes(
  app: Express,
  db: Database,
  broadcast?: (req: Request) => void,
) {
  // GET /api/v1/projects/:projectId/documents — list project docs
  app.get('/api/v1/projects/:projectId/documents', async (req: Request, res: Response) => {
    if (!req.user) throw new HttpError(401, 'Not authenticated');
    const { projectId } = req.params;
    const wid = req.workspaceId;

    const rows = await db.all<{
      id: string;
      workspace_id: string;
      project_id: string;
      title: string;
      content: string;
      category: 'guide' | 'api' | 'architecture' | 'notes';
      author_id: string;
      author_name: string;
      created_at: string;
      updated_at: string;
    }>(
      `SELECT d.*, u.name AS author_name
       FROM project_documents d
       JOIN users u ON u.id = d.author_id
       WHERE d.project_id = ? AND d.workspace_id = ?
       ORDER BY d.updated_at DESC`,
      [projectId, wid],
    );

    res.json(rows);
  });

  // POST /api/v1/projects/:projectId/documents — create doc
  app.post('/api/v1/projects/:projectId/documents', async (req: Request, res: Response) => {
    if (!req.user) throw new HttpError(401, 'Not authenticated');
    const { projectId } = req.params;
    const wid = req.workspaceId;
    const body = docSchema.parse(req.body);

    const docId = id();
    const timestamp = now();
    await db.insert('project_documents', {
      id: docId,
      workspace_id: wid,
      project_id: projectId,
      title: body.title,
      content: body.content,
      category: body.category,
      author_id: req.user.id,
      created_at: timestamp,
      updated_at: timestamp,
    });

    const doc = await db.one<ProjectDocument>(
      `SELECT d.*, u.name AS author_name FROM project_documents d JOIN users u ON u.id = d.author_id WHERE d.id = ?`,
      [docId],
    );

    if (broadcast) broadcast(req);
    res.status(201).json(doc);
  });

  // PUT /api/v1/projects/:projectId/documents/:docId — update doc
  app.put('/api/v1/projects/:projectId/documents/:docId', async (req: Request, res: Response) => {
    if (!req.user) throw new HttpError(401, 'Not authenticated');
    const { projectId, docId } = req.params;
    const wid = req.workspaceId;
    const body = docSchema.parse(req.body);

    const existing = await db.one(
      'SELECT id FROM project_documents WHERE id = ? AND project_id = ? AND workspace_id = ?',
      [docId, projectId, wid],
    );
    if (!existing) throw new HttpError(404, 'Document not found');

    const timestamp = now();
    await db.run(
      'UPDATE project_documents SET title = ?, content = ?, category = ?, updated_at = ? WHERE id = ? AND workspace_id = ?',
      [body.title, body.content, body.category, timestamp, docId, wid],
    );

    const doc = await db.one<ProjectDocument>(
      `SELECT d.*, u.name AS author_name FROM project_documents d JOIN users u ON u.id = d.author_id WHERE d.id = ?`,
      [docId],
    );

    if (broadcast) broadcast(req);
    res.json(doc);
  });

  // DELETE /api/v1/projects/:projectId/documents/:docId — delete doc
  app.delete('/api/v1/projects/:projectId/documents/:docId', async (req: Request, res: Response) => {
    if (!req.user) throw new HttpError(401, 'Not authenticated');
    const { projectId, docId } = req.params;
    const wid = req.workspaceId;

    await db.run(
      'DELETE FROM project_documents WHERE id = ? AND project_id = ? AND workspace_id = ?',
      [docId, projectId, wid],
    );

    if (broadcast) broadcast(req);
    res.json({ ok: true });
  });

  // GET /api/v1/projects/:projectId/shared-resources — cross-team shared resources & progress
  app.get('/api/v1/projects/:projectId/shared-resources', async (req: Request, res: Response) => {
    if (!req.user) throw new HttpError(401, 'Not authenticated');
    const { projectId } = req.params;
    const wid = req.workspaceId;

    const project = await db.one<{
      id: string;
      name: string;
      key: string;
      description: string;
      archived_at: string | null;
      lead_id: string;
    }>('SELECT id, name, `key`, description, archived_at, lead_id FROM projects WHERE id = ? AND workspace_id = ?', [
      projectId,
      wid,
    ]);
    if (!project) throw new HttpError(404, 'Project not found');

    // Collaborating teams assigned to this project
    const teams = await db.all<{
      id: string;
      name: string;
      slug: string;
      color: string;
      description: string;
    }>(
      `SELECT t.id, t.name, t.slug, t.color, t.description
       FROM project_team_assignments pta
       JOIN organization_teams t ON t.id = pta.team_id
       WHERE pta.project_id = ? AND pta.workspace_id = ?`,
      [projectId, wid],
    );

    // Documents
    const docs = await db.all<{ id: string; title: string; category: string; updated_at: string }>(
      'SELECT id, title, category, updated_at FROM project_documents WHERE project_id = ? AND workspace_id = ? ORDER BY updated_at DESC',
      [projectId, wid],
    );

    // Connected BRDs & daily tasks
    const workItems = await db.all<{
      id: string;
      title: string;
      kind: string;
      state: string;
      team_id: string;
      owner_id: string;
    }>(
      `SELECT id, title, kind, state, team_id, owner_id
       FROM organization_work
       WHERE project_id = ? AND workspace_id = ?
       ORDER BY updated_at DESC`,
      [projectId, wid],
    );

    // Project chat channel
    const channel = await db.one<{ id: string; name: string }>(
      `SELECT id, name FROM chat_channels WHERE project_id = ? AND workspace_id = ? LIMIT 1`,
      [projectId, wid],
    );

    // Team progress breakdown
    const teamProgress = await Promise.all(
      teams.map(async (t) => {
        // Members of this team
        const members = await db.all<{ user_id: string }>(
          'SELECT user_id FROM employee_profiles WHERE team_id = ? AND workspace_id = ?',
          [t.id, wid],
        );
        const memberIds = members.map((m) => m.user_id);
        let totalIssues = 0;
        let completedIssues = 0;
        let totalPoints = 0;

        if (memberIds.length > 0) {
          const placeholders = memberIds.map(() => '?').join(',');
          const issues = await db.all<{ status_id: string; story_points: number }>(
            `SELECT status_id, story_points FROM issues
             WHERE project_id = ? AND workspace_id = ? AND deleted_at IS NULL
               AND (assignee_id IN (${placeholders}) OR reporter_id IN (${placeholders}))`,
            [projectId, wid, ...memberIds, ...memberIds],
          );
          totalIssues = issues.length;
          totalPoints = issues.reduce((s, i) => s + (i.story_points || 0), 0);

          const doneStatuses = await db.all<{ id: string }>(
            'SELECT id FROM statuses WHERE project_id = ? AND category = ?',
            [projectId, 'done'],
          );
          const doneIds = new Set(doneStatuses.map((s) => s.id));
          completedIssues = issues.filter((i) => doneIds.has(i.status_id)).length;
        }

        const teamWork = workItems.filter((w) => w.team_id === t.id);

        return {
          team_id: t.id,
          team_name: t.name,
          team_color: t.color,
          member_count: memberIds.length,
          total_issues: totalIssues,
          completed_issues: completedIssues,
          story_points: totalPoints,
          completion_pct: totalIssues > 0 ? Math.round((completedIssues / totalIssues) * 100) : 0,
          brds_count: teamWork.filter((w) => w.kind === 'brd').length,
          daily_count: teamWork.filter((w) => w.kind === 'daily').length,
        };
      }),
    );

    res.json({
      project,
      teams,
      documents: docs,
      work_items: workItems,
      channel_id: channel?.id || null,
      team_progress: teamProgress,
    });
  });
}
