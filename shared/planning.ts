import type { Issue, Priority, Sprint } from './types.js';

export type ModuleState = 'planned' | 'in_progress' | 'paused' | 'completed' | 'cancelled';

export interface ProjectModule {
  id: string;
  workspace_id: string;
  project_id: string;
  name: string;
  description: string;
  lead_id: string | null;
  state: ModuleState;
  start_date: string;
  end_date: string;
  version: number;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
  issue_ids: string[];
  total_issues: number;
  completed_issues: number;
  total_points: number;
  completed_points: number;
  /** Percentage of non-deleted work items in a done status, rounded to an integer. */
  progress: number;
}

export interface ModuleInput {
  project_id: string;
  name: string;
  description?: string;
  lead_id?: string | null;
  state?: ModuleState;
  start_date?: string;
  end_date?: string;
  issue_ids?: string[];
}

export interface ModulePatch extends Partial<Omit<ModuleInput, 'project_id'>> {
  version: number;
  archived?: boolean;
}

export interface ModuleDetail {
  module: ProjectModule;
  issues: Issue[];
}

export interface BulkIssueInput {
  items: { id: string; version: number }[];
  changes: {
    status_id?: string;
    assignee_id?: string | null;
    priority?: Priority;
    sprint_id?: string | null;
    labels?: string[];
    deleted?: true;
  };
}

export interface BulkIssueResult {
  issues: Issue[];
  deleted_ids: string[];
}

export interface SprintScopeInput {
  items: { id: string; version: number; sprint_id: string | null }[];
}

export interface SprintBurndownDay {
  date: string;
  /** Null before reliable tracking began, and for future dates. */
  remaining_points: number | null;
  scope_points: number | null;
  completed_points: number | null;
  remaining_issues: number | null;
  ideal_points: number;
}

export interface SprintScopeEvent {
  id: string;
  issue_id: string;
  issue_key: string;
  summary: string;
  type: 'added' | 'removed' | 'estimate_changed';
  points_delta: number;
  created_at: string;
}

export interface SprintAnalytics {
  sprint: Sprint;
  summary_basis: 'current_scope' | 'completion_snapshot';
  summary: {
    total_issues: number;
    completed_issues: number;
    total_points: number;
    completed_points: number;
    remaining_points: number;
    completion_percent: number;
    added_points: number;
    removed_points: number;
  };
  burndown: SprintBurndownDay[];
  scope_events: SprintScopeEvent[];
  tracking_started_at: string;
  /** Explains the baseline and any unavailable historic values without inventing data. */
  history_note: string;
}
