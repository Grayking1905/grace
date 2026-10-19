import type { Request } from 'express';
import type { Database } from './db.js';
import { id, now } from './seed.js';
type EventInput = {
  workspace_id: string;
  actor_id: string;
  action: string;
  entity_type: string;
  entity_id: string;
  title: string;
  project_id?: string | null;
  team_id?: string | null;
  id?: string;
  created_at?: string;
};
export async function recordHomeEvent(db: Database, input: EventInput) {
  await db.insert('home_events', {
    id: input.id || id(),
    workspace_id: input.workspace_id,
    actor_id: input.actor_id,
    action: input.action,
    entity_type: input.entity_type,
    entity_id: input.entity_id,
    title: input.title.slice(0, 255),
    project_id: input.project_id || null,
    team_id: input.team_id || null,
    created_at: input.created_at || now(),
  });
}
export async function recordSignIn(
  db: Database,
  userId: string,
  workspaceId: string,
  action = 'auth.login',
) {
  const employee = await db.one<{ team_id: string }>(
    'SELECT team_id FROM employee_profiles WHERE workspace_id=? AND user_id=?',
    [workspaceId, userId],
  );
  await recordHomeEvent(db, {
    workspace_id: workspaceId,
    actor_id: userId,
    action,
    entity_type: 'member',
    entity_id: userId,
    title:
      action === 'member.joined'
        ? 'Joined the organization'
        : action === 'auth.logout'
          ? 'Signed out'
          : 'Signed in',
    team_id: employee?.team_id,
  });
}
export async function recordIssueEvent(
  db: Database,
  req: Pick<Request, 'workspaceId' | 'user'>,
  issueId: string,
  field: string,
  eventId?: string,
  createdAt?: string,
) {
  const issue = await db.one<{
    id: string;
    project_id: string;
    summary: string;
    key: string;
    type: string;
    team_id: string | null;
  }>(
    'SELECT i.id,i.project_id,i.summary,i.`key`,i.type,e.team_id FROM issues i LEFT JOIN employee_profiles e ON e.workspace_id=i.workspace_id AND e.user_id=COALESCE(i.assignee_id,i.reporter_id) WHERE i.id=? AND i.workspace_id=?',
    [issueId, req.workspaceId],
  );
  if (issue)
    await recordHomeEvent(db, {
      id: eventId,
      workspace_id: req.workspaceId,
      actor_id: req.user.id,
      action:
        field === 'created' && issue.type === 'bug'
          ? 'bug.created'
          : field === 'created' && issue.type === 'story'
            ? 'feature.created'
            : `issue.${field}`,
      entity_type: 'issue',
      entity_id: issue.id,
      title: `${issue.key} · ${issue.summary}`,
      project_id: issue.project_id,
      team_id: issue.team_id,
      created_at: createdAt,
    });
}
export async function recordAuditEvent(db: Database, req: Request, action: string, target: string) {
  const [kind] = action.split('.');
  let record:
    { id: string; title: string; project_id?: string | null; team_id?: string | null } | undefined;
  let entityType = kind;
  if (kind === 'issue' || kind === 'comment') {
    if (action === 'issue.deleted' || action === 'issue.restored') return; // Already captured by issue history.
    let issueId = target;
    if (kind === 'comment') issueId = String(req.params.id || '');
    record = await db.one(
      'SELECT i.id,i.summary AS title,i.project_id,e.team_id FROM issues i LEFT JOIN employee_profiles e ON e.workspace_id=i.workspace_id AND e.user_id=COALESCE(i.assignee_id,i.reporter_id) WHERE (i.id=? OR i.`key`=?) AND i.workspace_id=?',
      [issueId, issueId, req.workspaceId],
    );
    entityType = 'issue';
  } else if (kind === 'project' || kind === 'jira') {
    record = await db.one(
      'SELECT id,name AS title,id AS project_id FROM projects WHERE id=? AND workspace_id=?',
      [target, req.workspaceId],
    );
    entityType = 'project';
  } else if (['brd', 'daily', 'version'].includes(kind)) {
    record = await db.one(
      'SELECT id,title,project_id,team_id FROM organization_work WHERE id=? AND workspace_id=?',
      [target, req.workspaceId],
    );
  } else if (kind === 'team') {
    record = await db.one(
      'SELECT id,name AS title,id AS team_id FROM organization_teams WHERE id=? AND workspace_id=?',
      [target, req.workspaceId],
    );
  } else if (kind === 'employee' || (kind === 'member' && !action.includes('invited'))) {
    record = await db.one(
      'SELECT e.user_id AS id,u.name AS title,e.team_id FROM employee_profiles e JOIN users u ON u.id=e.user_id WHERE e.user_id=? AND e.workspace_id=?',
      [target, req.workspaceId],
    );
    entityType = 'member';
  } else if (kind === 'module') {
    record = await db.one(
      'SELECT id,name AS title,project_id FROM project_modules WHERE id=? AND workspace_id=?',
      [target, req.workspaceId],
    );
  } else if (kind === 'sprint' || kind === 'cycle') {
    record = await db.one(
      'SELECT id,name AS title,project_id FROM sprints WHERE id=? AND workspace_id=?',
      [target, req.workspaceId],
    );
    entityType = 'cycle';
  } else if (kind === 'status') {
    record = await db.one(
      'SELECT id,name AS title,project_id FROM statuses WHERE id=? AND workspace_id=?',
      [target, req.workspaceId],
    );
  } else if (kind === 'page') {
    record = await db.one('SELECT id,title,project_id FROM pages WHERE id=? AND workspace_id=?', [
      target,
      req.workspaceId,
    ]);
  } else if (kind === 'risk') {
    record = await db.one('SELECT id,title,project_id FROM risks WHERE id=? AND workspace_id=?', [
      target,
      req.workspaceId,
    ]);
  } else if (kind === 'standup') {
    record = { id: target, title: 'Daily check-in', team_id: req.user.team_id };
  }
  if (record)
    await recordHomeEvent(db, {
      workspace_id: req.workspaceId,
      actor_id: req.user.id,
      action,
      entity_type: entityType,
      entity_id: record.id,
      title: record.title,
      project_id: record.project_id,
      team_id: record.team_id,
    });
}
export async function applyHomeMigration(db: Database) {
  if (await db.one('SELECT version FROM schema_migrations WHERE version=9')) return;
  await db.transaction(async () => {
    // Import recent safe metadata only; never copy comment text, descriptions or audit details.
    const history = await db.all<{
      id: string;
      issue_id: string;
      actor_id: string;
      workspace_id: string;
      field: string;
      created_at: string;
    }>(
      'SELECT id,issue_id,actor_id,workspace_id,field,created_at FROM history ORDER BY created_at DESC,id DESC LIMIT 1000',
    );
    for (const row of history)
      await recordIssueEvent(
        db,
        { workspaceId: row.workspace_id, user: { id: row.actor_id } as Request['user'] },
        row.issue_id,
        row.field,
        `history-${row.id}`,
        row.created_at,
      );
    await db.insert('schema_migrations', { version: 9, applied_at: now() });
  });
}
