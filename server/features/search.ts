import type { Express, Request } from 'express';
import { z } from 'zod';
import type { Database } from '../db.js';
import { now } from '../seed.js';
import { HttpError } from '../auth.js';
export async function applySearchMigration(db: Database) {
  const applied = await db.one('SELECT version FROM schema_migrations WHERE version=5');
  if (
    db.driver === 'mysql' &&
    !(await db.one(
      "SELECT INDEX_NAME FROM information_schema.statistics WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='issues' AND INDEX_NAME='issues_fulltext' LIMIT 1",
    ))
  )
    try {
      await db.run('ALTER TABLE issues ADD FULLTEXT INDEX issues_fulltext (summary,description)');
    } catch (error) {
      if ((error as { errno?: number }).errno !== 1061) throw error;
    }
  if (applied) return;
  if (!(await db.one('SELECT version FROM schema_migrations WHERE version=5')))
    try {
      await db.insert('schema_migrations', { version: 5, applied_at: now() });
    } catch (error) {
      if (!(await db.one('SELECT version FROM schema_migrations WHERE version=5'))) throw error;
    }
}
const schema = z.object({
  q: z.string().trim().max(160).default(''),
  project_id: z.string().max(64).optional(),
  cursor: z.string().max(512).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});
export function visibilityScope(req: Request) {
  return {
    sql: `i.workspace_id=? AND i.deleted_at IS NULL AND EXISTS (SELECT 1 FROM projects p WHERE p.id=i.project_id AND p.workspace_id=i.workspace_id AND p.archived_at IS NULL ${['owner', 'admin'].includes(req.user.role) ? '' : "AND (p.visibility='workspace' OR p.lead_id=? OR EXISTS (SELECT 1 FROM project_members pm WHERE pm.project_id=p.id AND pm.user_id=? AND pm.workspace_id=p.workspace_id))"})`,
    params: [
      req.workspaceId,
      ...(['owner', 'admin'].includes(req.user.role) ? [] : [req.user.id, req.user.id]),
    ],
  };
}
export async function queryIssuePage(db: Database, req: Request, raw: unknown) {
  const input = schema.parse(raw);
  let cursor: { rank: number; id: string } | undefined;
  if (input.cursor)
    try {
      cursor = z
        .object({ rank: z.number().finite(), id: z.string().max(64) })
        .parse(JSON.parse(Buffer.from(input.cursor, 'base64url').toString()));
    } catch {
      throw new HttpError(400, 'Invalid cursor.');
    }
  const scope = visibilityScope(req);
  const conditions = [scope.sql];
  const params: unknown[] = [...scope.params];
  if (input.project_id) {
    conditions.push('i.project_id=?');
    params.push(input.project_id);
  }
  if (input.q) {
    conditions.push(
      db.driver === 'mysql'
        ? '(MATCH(i.summary,i.description) AGAINST (? IN NATURAL LANGUAGE MODE) OR i.`key` LIKE ?)'
        : '(LOWER(i.summary) LIKE LOWER(?) OR LOWER(i.description) LIKE LOWER(?) OR i.`key` LIKE ?)',
    );
    params.push(
      ...(db.driver === 'mysql'
        ? [input.q, `%${input.q}%`]
        : [`%${input.q}%`, `%${input.q}%`, `%${input.q}%`]),
    );
  }
  if (cursor) {
    conditions.push('(i.`rank`>? OR (i.`rank`=? AND i.id>?))');
    params.push(cursor.rank, cursor.rank, cursor.id);
  }
  const rows = await db.all<Record<string, unknown> & { id: string; rank: number; labels: string }>(
    `SELECT i.* FROM issues i WHERE ${conditions.join(' AND ')} ORDER BY i.\`rank\`,i.id LIMIT ${input.limit + 1}`,
    params,
  );
  const hasMore = rows.length > input.limit;
  const items = rows
    .slice(0, input.limit)
    .map((row) => ({ ...row, labels: JSON.parse(String(row.labels)) }));
  const last = items.at(-1);
  return {
    items,
    nextCursor:
      hasMore && last
        ? Buffer.from(JSON.stringify({ rank: last.rank, id: last.id })).toString('base64url')
        : null,
    engine: db.driver === 'mysql' ? 'mysql-fulltext' : 'sqlite-like',
  };
}
export function registerSearchRoutes(app: Express, db: Database) {
  app.get('/api/v1/search/issues', async (req, res) =>
    res.json(await queryIssuePage(db, req, req.query)),
  );
  app.get('/api/v1/reports/summary', async (req, res) => {
    const input = z
      .object({
        project_id: z.string().optional(),
        days: z.coerce.number().int().min(1).max(366).default(30),
      })
      .parse(req.query);
    const scope = visibilityScope(req);
    const where = scope.sql + (input.project_id ? ' AND i.project_id=?' : '');
    const params = [...scope.params, ...(input.project_id ? [input.project_id] : [])];
    const start = new Date(Date.now() - input.days * 86400000).toISOString();
    const [summary, byStatus, byAssignee, time, period, created, completed] = await db.transaction(
      () =>
        Promise.all([
          db.one(
            `SELECT COUNT(*) total,COALESCE(SUM(CASE WHEN s.category='done' THEN 1 ELSE 0 END),0) completed,COALESCE(SUM(i.story_points),0) total_points,COALESCE(SUM(CASE WHEN s.category='done' THEN i.story_points ELSE 0 END),0) completed_points,COALESCE(SUM(CASE WHEN i.flagged=1 AND s.category!='done' THEN 1 ELSE 0 END),0) flagged FROM issues i JOIN statuses s ON s.id=i.status_id WHERE ${where}`,
            params,
          ),
          db.all(
            `SELECT i.status_id,COUNT(*) count FROM issues i WHERE ${where} GROUP BY i.status_id LIMIT 500`,
            params,
          ),
          db.all(
            `SELECT i.assignee_id,COUNT(*) count,SUM(i.story_points) points,SUM(CASE WHEN s.category='done' THEN 1 ELSE 0 END) completed FROM issues i JOIN statuses s ON s.id=i.status_id WHERE ${where} GROUP BY i.assignee_id LIMIT 1000`,
            params,
          ),
          db.one(
            `SELECT COALESCE(SUM(w.minutes),0) minutes FROM worklogs w JOIN issues i ON i.id=w.issue_id WHERE ${where} AND w.created_at>=?`,
            [...params, start],
          ),
          db.one(
            `SELECT COUNT(*) completed,COALESCE(SUM(i.story_points),0) points FROM issues i JOIN statuses s ON s.id=i.status_id WHERE ${where} AND s.category='done' AND EXISTS (SELECT 1 FROM history h WHERE h.issue_id=i.id AND h.workspace_id=i.workspace_id AND h.field='status_id' AND h.new_value=i.status_id AND h.created_at>=?)`,
            [...params, start],
          ),
          db.all(
            `SELECT SUBSTR(i.created_at,1,10) date,COUNT(*) count FROM issues i WHERE ${where} AND i.created_at>=? GROUP BY SUBSTR(i.created_at,1,10) ORDER BY date LIMIT 366`,
            [...params, start],
          ),
          db.all(
            `SELECT SUBSTR(h.created_at,1,10) date,COUNT(DISTINCT i.id) count FROM history h JOIN issues i ON i.id=h.issue_id JOIN statuses s ON s.id=h.new_value WHERE ${where} AND h.field='status_id' AND s.category='done' AND h.created_at>=? GROUP BY SUBSTR(h.created_at,1,10) ORDER BY date LIMIT 366`,
            [...params, start],
          ),
        ]),
    );
    res.json({
      summary,
      by_status: byStatus,
      by_assignee: byAssignee,
      time,
      period,
      created,
      completed,
      days: input.days,
    });
  });
}
