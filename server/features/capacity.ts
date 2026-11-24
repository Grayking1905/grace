import type { Express, Request, Response } from 'express';
import type { Database } from '../db.js';
import { z } from 'zod';
import { HttpError } from '../auth.js';

function canWrite(req: Request) {
  if (!req.user) throw new HttpError(401, 'Not authenticated');
}

const upsertCapacitySchema = z.object({
  available_hours: z.number().int().min(0).max(336).optional(),
  focus_factor: z.number().min(0).max(1).optional(),
});

export function registerCapacityRoutes(
  app: Express,
  db: Database,
  broadcast?: (req: Request) => void,
) {
  // GET /api/v1/sprints/:id/capacity — per-member capacity for a sprint
  app.get('/api/v1/sprints/:sprintId/capacity', async (req: Request, res: Response) => {
    if (!req.user) throw new HttpError(401, 'Not authenticated');
    const sprintId = String(req.params.sprintId);
    const wid = req.workspaceId;

    // Check sprint belongs to workspace
    const sprint = await db.one<{
      id: string;
      name: string;
      project_id: string;
      state: string;
      start_date: string;
      end_date: string;
      committed_points: number;
      completed_points: number;
    }>(
      `SELECT id, name, project_id, state, start_date, end_date, committed_points, completed_points
       FROM sprints WHERE id = ? AND workspace_id = ?`,
      [sprintId, wid],
    );
    if (!sprint) {
      res.status(404).json({ error: 'Sprint not found' });
      return;
    }

    // Members of the project
    const members = await db.all<{
      user_id: string;
      name: string;
      color: string;
    }>(
      `SELECT pm.user_id, u.name, u.color
       FROM project_members pm
       JOIN users u ON pm.user_id = u.id
       WHERE pm.project_id = ? AND pm.workspace_id = ?`,
      [sprint.project_id, wid],
    );

    // Per-sprint capacity overrides
    const overrides = await db.all<{
      user_id: string;
      available_hours: number;
      focus_factor: number;
      committed_points: number;
    }>(
      `SELECT user_id, available_hours, focus_factor, committed_points
       FROM sprint_capacity WHERE sprint_id = ? AND workspace_id = ?`,
      [sprintId, wid],
    );
    const overrideMap = new Map(overrides.map((o) => [o.user_id, o]));

    // Assigned story points per member in this sprint
    const assigned = await db.all<{ assignee_id: string; total_points: number }>(
      `SELECT assignee_id, SUM(story_points) AS total_points
       FROM issues
       WHERE sprint_id = ? AND workspace_id = ? AND deleted_at IS NULL AND assignee_id IS NOT NULL
       GROUP BY assignee_id`,
      [sprintId, wid],
    );
    const assignedMap = new Map(assigned.map((a) => [a.assignee_id, a.total_points]));

    const capacity = members.map((m) => {
      const ov = overrideMap.get(m.user_id);
      return {
        sprint_id: sprintId,
        user_id: m.user_id,
        workspace_id: wid,
        available_hours: ov?.available_hours ?? 40,
        focus_factor: ov?.focus_factor ?? 0.7,
        committed_points: ov?.committed_points ?? 0,
        user_name: m.name,
        user_color: m.color,
        assigned_points: assignedMap.get(m.user_id) ?? 0,
      };
    });

    res.json({ sprint, capacity });
  });

  // PUT /api/v1/sprints/:id/capacity/:userId — upsert a member's capacity entry
  app.put('/api/v1/sprints/:sprintId/capacity/:userId', async (req: Request, res: Response) => {
    canWrite(req);
    const sprintId = String(req.params.sprintId);
    const userId = String(req.params.userId);
    const wid = req.workspaceId;
    const body = upsertCapacitySchema.parse(req.body);

    // Verify sprint
    const sprint = await db.one<{ id: string }>(
      `SELECT id FROM sprints WHERE id = ? AND workspace_id = ?`,
      [sprintId, wid],
    );
    if (!sprint) {
      res.status(404).json({ error: 'Sprint not found' });
      return;
    }

    // Verify user is a workspace member
    const member = await db.one<{ user_id: string }>(
      `SELECT user_id FROM memberships WHERE user_id = ? AND workspace_id = ?`,
      [userId, wid],
    );
    if (!member) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    const existing = await db.one<{
      available_hours: number;
      focus_factor: number;
      committed_points: number;
    }>(
      `SELECT available_hours, focus_factor, committed_points FROM sprint_capacity WHERE sprint_id = ? AND user_id = ?`,
      [sprintId, userId],
    );

    if (existing) {
      await db.run(
        `UPDATE sprint_capacity SET available_hours = ?, focus_factor = ?, committed_points = ? WHERE sprint_id = ? AND user_id = ?`,
        [
          body.available_hours ?? existing.available_hours,
          body.focus_factor ?? existing.focus_factor,
          existing.committed_points,
          sprintId,
          userId,
        ],
      );
    } else {
      await db.insert('sprint_capacity', {
        sprint_id: sprintId,
        user_id: userId,
        workspace_id: wid,
        available_hours: body.available_hours ?? 40,
        focus_factor: body.focus_factor ?? 0.7,
        committed_points: 0,
      });
    }

    if (broadcast) broadcast(req);
    res.json({ ok: true });
  });

  // GET /api/v1/projects/:id/capacity — multi-sprint capacity trend
  app.get('/api/v1/projects/:projectId/capacity', async (req: Request, res: Response) => {
    if (!req.user) throw new HttpError(401, 'Not authenticated');
    const projectId = String(req.params.projectId);
    const wid = req.workspaceId;

    const sprints = await db.all<{
      id: string;
      name: string;
      state: string;
      start_date: string;
      end_date: string;
      committed_points: number;
      completed_points: number;
    }>(
      `SELECT id, name, state, start_date, end_date, committed_points, completed_points
       FROM sprints WHERE project_id = ? AND workspace_id = ?
       ORDER BY start_date DESC LIMIT 8`,
      [projectId, wid],
    );

    const result = await Promise.all(
      sprints.map(async (s) => {
        const totalCapacity = await db.one<{ total_hours: number }>(
          `SELECT SUM(available_hours) AS total_hours FROM sprint_capacity WHERE sprint_id = ? AND workspace_id = ?`,
          [s.id, wid],
        );
        const totalPoints = await db.one<{ total_points: number }>(
          `SELECT SUM(story_points) AS total_points FROM issues WHERE sprint_id = ? AND workspace_id = ? AND deleted_at IS NULL`,
          [s.id, wid],
        );
        return {
          ...s,
          total_capacity_hours: totalCapacity?.total_hours ?? 0,
          total_assigned_points: totalPoints?.total_points ?? 0,
        };
      }),
    );

    res.json({ sprints: result.reverse() });
  });
}
