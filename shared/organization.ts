export const dashboardSections = [
  'issues',
  'bugs',
  'features',
  'brds',
  'daily',
  'versions',
] as const;
export type DashboardSection = (typeof dashboardSections)[number];
export const teamCapabilities = ['work', 'brds', 'daily', 'versions'] as const;
export type TeamCapability = (typeof teamCapabilities)[number];
export type TeamRole = 'lead' | 'member' | 'viewer';
export type TeamPermissions = Record<TeamRole, TeamCapability[]>;
export const defaultTeamPermissions: TeamPermissions = {
  lead: [...teamCapabilities],
  member: ['work', 'brds', 'daily'],
  viewer: [],
};
export interface OrganizationTeam {
  id: string;
  workspace_id: string;
  name: string;
  slug: string;
  description: string;
  color: string;
  sections: DashboardSection[];
  permissions: TeamPermissions;
  version: number;
  created_at: string;
  updated_at: string;
}
export interface EmployeeProfile {
  user_id: string;
  employee_id: string;
  team_id: string;
  team_role: TeamRole;
  version: number;
}
export interface OrganizationContext {
  teams: OrganizationTeam[];
  employee: EmployeeProfile;
  can_admin: boolean;
}
export type OrganizationWorkKind = 'brd' | 'daily' | 'version';
export const workStates = ['draft', 'planned', 'active', 'review', 'done'] as const;
export interface OrganizationWork {
  id: string;
  workspace_id: string;
  team_id: string;
  project_id: string | null;
  kind: OrganizationWorkKind;
  title: string;
  content: string;
  state: (typeof workStates)[number];
  owner_id: string;
  due_date: string;
  version_tag: string;
  version: number;
  created_by: string;
  created_at: string;
  updated_at: string;
  issue_ids: string[];
  has_hidden_links?: boolean;
}
export function canTeamCreate(
  context: OrganizationContext | undefined,
  capability: TeamCapability,
  teamId?: string,
) {
  if (!context) return true;
  if (context.can_admin) return true;
  const team = context.teams.find((t) => t.id === (teamId || context.employee.team_id));
  return (
    !!team &&
    team.id === context.employee.team_id &&
    team.permissions[context.employee.team_role].includes(capability)
  );
}
export const workKindLabels = { brd: 'BRD', daily: 'Daily task', version: 'Version' };
