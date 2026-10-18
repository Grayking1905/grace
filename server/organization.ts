import type { Database } from './db.js';
import { id, now } from './seed.js';
import {
  dashboardSections,
  defaultTeamPermissions,
  type EmployeeProfile,
  type OrganizationTeam,
} from '../shared/organization.js';

export function parseTeam(row: Record<string, unknown>): OrganizationTeam {
  return {
    ...row,
    sections: JSON.parse(String(row.sections)),
    permissions: JSON.parse(String(row.permissions)),
  } as OrganizationTeam;
}
export async function ensureOrganization(db: Database, workspaceId: string) {
  await db.transaction(async () => {
    // Serialize provisioning against membership and team updates on both SQL adapters.
    await db.run('UPDATE workspaces SET name=name WHERE id=?', [workspaceId]);
    let teams = await db.all<{ id: string; slug: string }>(
      'SELECT id,slug FROM organization_teams WHERE workspace_id=?',
      [workspaceId],
    );
    if (!teams.length) {
      for (const [name, slug, color] of [
        ['Frontend', 'frontend', '#e8e2f5'],
        ['Backend', 'backend', '#dcebea'],
        ['Quality assurance', 'tester', '#f6e7d3'],
        ['Human resources', 'human-resources', '#f1dfE5'],
        ['Administration', 'admin', '#dce8da'],
        ['General', 'general', '#e5e9ef'],
      ]) {
        const teamId = id();
        await db.insert('organization_teams', {
          id: teamId,
          workspace_id: workspaceId,
          name,
          slug,
          description: `${name} team workspace`,
          color,
          sections: JSON.stringify(dashboardSections),
          permissions: JSON.stringify(defaultTeamPermissions),
          version: 1,
          created_at: now(),
          updated_at: now(),
        });
      }
      teams = await db.all('SELECT id,slug FROM organization_teams WHERE workspace_id=?', [
        workspaceId,
      ]);
    }
    const members = await db.all<{ user_id: string; role: string }>(
      'SELECT m.user_id,m.role FROM memberships m WHERE m.workspace_id=? AND NOT EXISTS (SELECT 1 FROM employee_profiles e WHERE e.workspace_id=m.workspace_id AND e.user_id=m.user_id)',
      [workspaceId],
    );
    for (const member of members) {
      const demoTeam: Record<string, string> = {
        'user-sarah': 'frontend',
        'user-james': 'backend',
        'user-noah': 'tester',
      };
      const slug = ['owner', 'admin'].includes(member.role)
        ? 'admin'
        : workspaceId === 'workspace-grace'
          ? demoTeam[member.user_id] || 'general'
          : 'general';
      const team = teams.find((t) => t.slug === slug) || teams[0];
      await db.insert('employee_profiles', {
        workspace_id: workspaceId,
        user_id: member.user_id,
        employee_id: `EMP-${id().replaceAll('-', '').slice(0, 16).toUpperCase()}`,
        team_id: team.id,
        team_role: ['owner', 'admin'].includes(member.role)
          ? 'lead'
          : member.role === 'viewer'
            ? 'viewer'
            : 'member',
        version: 1,
      });
    }
  });
}
export async function applyOrganizationMigration(db: Database) {
  const workspaces = await db.all<{ id: string }>('SELECT id FROM workspaces');
  for (const workspace of workspaces) await ensureOrganization(db, workspace.id);
  if (!(await db.one('SELECT version FROM schema_migrations WHERE version=7')))
    await db.insert('schema_migrations', { version: 7, applied_at: now() });
}
export async function organizationContext(
  db: Database,
  workspaceId: string,
  userId: string,
  role: string,
) {
  const employee = await db.one<EmployeeProfile>(
    'SELECT user_id,employee_id,team_id,team_role,version FROM employee_profiles WHERE workspace_id=? AND user_id=?',
    [workspaceId, userId],
  );
  const canAdmin = ['owner', 'admin'].includes(role);
  const teams = await db.all<Record<string, unknown>>(
    'SELECT * FROM organization_teams WHERE workspace_id=?' +
      (canAdmin ? '' : ' AND id=?') +
      ' ORDER BY name',
    canAdmin ? [workspaceId] : [workspaceId, employee?.team_id || ''],
  );
  return { teams: teams.map(parseTeam), employee: employee!, can_admin: canAdmin };
}
