import type { Role, User, Workspace, Project } from './types';

export interface WorkspaceMembership extends Workspace {
  role: Role;
  current: boolean;
}
export interface WorkspaceInvite {
  id: string;
  email: string;
  role: Exclude<Role, 'owner'>;
  expires_at: string;
  created_at: string;
  accepted_at: string | null;
  state: 'pending' | 'expired' | 'accepted';
}
export interface ActiveSession {
  id: string;
  workspace_id: string;
  workspace_name: string;
  created_at: string;
  expires_at: string;
  current: boolean;
}
export type ProjectMemberRole = 'admin' | 'member' | 'viewer';
export interface ProjectMember extends Omit<User, 'role'> {
  role: ProjectMemberRole;
  workspace_role: Role;
}
export interface ProjectMemberships {
  members: ProjectMember[];
  can_manage: boolean;
  lead_id: string;
}
export interface ArchivedProject extends Project {
  can_manage: boolean;
}
export interface TrashedIssue {
  id: string;
  key: string;
  summary: string;
  project_id: string;
  project_name: string;
  project_archived: boolean;
  deleted_at: string;
  recover_until: string;
  recoverable: boolean;
}
