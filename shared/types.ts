export type Role = 'owner' | 'admin' | 'member' | 'viewer';
export interface User {
  id: string;
  name: string;
  email: string;
  color: string;
  role: Role;
  capacity: number;
  email_verified?: boolean;
  verification_required?: boolean;
  active?: boolean | number;
}
export interface Workspace {
  id: string;
  name: string;
  slug: string;
}
export interface Project {
  id: string;
  workspace_id: string;
  name: string;
  key: string;
  description: string;
  color: string;
  icon: string;
  lead_id: string;
  template: string;
  visibility: string;
  favorite: number;
  archived_at: string | null;
  created_at: string;
  can_write?: boolean;
  can_admin?: boolean;
  issue_types?: IssueType[];
  default_type?: IssueType;
  cycles_enabled?: boolean;
}
export interface Status {
  id: string;
  project_id: string;
  name: string;
  category: 'todo' | 'active' | 'done';
  color: string;
  position: number;
  wip_limit: number;
}
export interface Sprint {
  id: string;
  project_id: string;
  name: string;
  goal: string;
  state: 'future' | 'active' | 'closed';
  start_date: string;
  end_date: string;
  committed_points: number;
  completed_points: number;
}
export type Priority = 'critical' | 'high' | 'medium' | 'low' | 'lowest';
export type IssueType = 'task' | 'story' | 'bug' | 'epic' | 'subtask';
export interface Issue {
  id: string;
  workspace_id: string;
  project_id: string;
  number: number;
  key: string;
  summary: string;
  description: string;
  type: IssueType;
  status_id: string;
  priority: Priority;
  assignee_id: string | null;
  reporter_id: string;
  parent_id: string | null;
  sprint_id: string | null;
  labels: string[];
  story_points: number;
  due_date: string;
  start_date: string;
  rank: number;
  flagged: number;
  carry_over: number;
  version: number;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}
export interface Activity {
  id: string;
  issue_id: string;
  issue_key?: string;
  issue_summary?: string;
  actor_id: string;
  field: string;
  old_value: string;
  new_value: string;
  created_at: string;
}
export interface Comment {
  id: string;
  issue_id: string;
  author_id: string;
  body: string;
  created_at: string;
  edited_at: string | null;
}
export interface Worklog {
  id: string;
  issue_id: string;
  user_id: string;
  minutes: number;
  note: string;
  created_at: string;
}
export interface Page {
  id: string;
  project_id: string | null;
  title: string;
  content: string;
  icon: string;
  author_id: string;
  version: number;
  updated_at: string;
}
export interface Notification {
  id: string;
  user_id: string;
  issue_id: string | null;
  title: string;
  body: string;
  read_at: string | null;
  created_at: string;
}
export interface SavedView {
  id: string;
  name: string;
  query: string;
  owner_id: string;
  sharing: string;
}
export interface Standup {
  id: string;
  user_id: string;
  yesterday: string;
  today: string;
  blockers: string;
  created_at: string;
}
export interface Risk {
  id: string;
  project_id: string | null;
  title: string;
  severity: string;
  state: string;
  owner_id: string;
  created_at: string;
}
export interface Bootstrap {
  user: User;
  workspace: Workspace;
  members: User[];
  projects: Project[];
  statuses: Status[];
  sprints: Sprint[];
  issues: Issue[];
  activity: Activity[];
  pages: Page[];
  views: SavedView[];
  notifications: Notification[];
  standups: Standup[];
  risks: Risk[];
  database: string;
}
export interface Attachment {
  id: string;
  name: string;
  size: number;
  mime: string;
  created_at: string;
}
export interface IssueDetail {
  issue: Issue;
  comments: Comment[];
  history: Activity[];
  worklogs: Worklog[];
  attachments: Attachment[];
  links: {
    id: string;
    target_id: string;
    type: string;
    key: string;
    summary: string;
  }[];
  watchers: string[];
}
