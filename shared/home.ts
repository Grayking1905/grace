import type { TeamRole } from './organization';
export interface HomeCounts {
  total: number;
  completed: number;
  active: number;
  todo: number;
  overdue: number;
  bugs: number;
  flagged: number;
  points: number;
  completed_points: number;
}
export interface HomeProject extends HomeCounts {
  id: string;
  name: string;
  key: string;
  color: string;
  lead_id: string;
  team_ids: string[];
  linked_team_ids: string[];
  assignment_version: number;
}
export interface HomePerson {
  id: string;
  name: string;
  color: string;
  team_id: string;
  team_role: TeamRole;
  organization_role?: import('./types').Role;
  online: boolean;
  open: number;
  completed: number;
  last_login: string | null;
}
export interface HomeOverview {
  scope: 'organization' | 'team';
  team_id: string | null;
  generated_at: string;
  days: number;
  summary: HomeCounts & {
    projects: number;
    people: number;
    online: number;
    team_work: number;
    team_work_done: number;
    team_work_overdue: number;
  };
  teams: (HomeCounts & {
    id: string;
    name: string;
    color: string;
    people: number;
    online: number;
    projects: number;
    work: number;
    work_done: number;
  })[];
  projects: HomeProject[];
  available_projects: { id: string; name: string }[];
  people: HomePerson[];
  trend: { date: string; created: number; completed: number }[];
  attention: {
    id: string;
    key: string;
    summary: string;
    priority: string;
    due_date: string;
    flagged: number;
    assignee_id: string | null;
  }[];
}
export interface HomeEvent {
  id: string;
  action: string;
  entity_type: string;
  entity_id: string;
  title: string;
  project_id: string | null;
  team_id: string | null;
  actor_id: string;
  actor_name: string;
  actor_color: string;
  created_at: string;
}
export interface HomeActivityPage {
  items: HomeEvent[];
  next_cursor: string | null;
}
