import type { IssueType } from './types';
export const projectTemplates = {
  scrum: {
    name: 'Scrum',
    description: 'Time-boxed delivery with review and estimation.',
    types: ['epic', 'story', 'task', 'bug', 'subtask'] as IssueType[],
    defaultType: 'story' as IssueType,
    cycles: true,
    statuses: [
      ['To do', 'todo', '#9c9fa8'],
      ['In progress', 'active', '#c99b36'],
      ['In review', 'active', '#9172c4'],
      ['Done', 'done', '#4c9f7a'],
    ],
  },
  kanban: {
    name: 'Kanban',
    description: 'Continuous flow with a small work-in-progress limit.',
    types: ['epic', 'story', 'task', 'bug', 'subtask'] as IssueType[],
    defaultType: 'task' as IssueType,
    cycles: false,
    statuses: [
      ['Backlog', 'todo', '#9c9fa8'],
      ['Ready', 'todo', '#8a9c78'],
      ['Doing', 'active', '#c99b36'],
      ['Done', 'done', '#4c9f7a'],
    ],
  },
  bug: {
    name: 'Bug tracking',
    description: 'Triage, reproduce, fix, and verify defects.',
    types: ['bug', 'task', 'subtask'] as IssueType[],
    defaultType: 'bug' as IssueType,
    cycles: false,
    statuses: [
      ['Triage', 'todo', '#9c9fa8'],
      ['Reproducing', 'active', '#c99b36'],
      ['Fixing', 'active', '#b67b83'],
      ['Verifying', 'active', '#9172c4'],
      ['Closed', 'done', '#4c9f7a'],
    ],
  },
  basic: {
    name: 'Basic',
    description: 'A simple task workflow for everyday work.',
    types: ['task', 'subtask'] as IssueType[],
    defaultType: 'task' as IssueType,
    cycles: false,
    statuses: [
      ['To do', 'todo', '#9c9fa8'],
      ['Doing', 'active', '#c99b36'],
      ['Done', 'done', '#4c9f7a'],
    ],
  },
  blank: {
    name: 'Minimal',
    description: 'Three essential states, ready for your own columns.',
    types: ['task', 'story', 'bug', 'epic', 'subtask'] as IssueType[],
    defaultType: 'task' as IssueType,
    cycles: false,
    statuses: [
      ['Open', 'todo', '#9c9fa8'],
      ['Active', 'active', '#c99b36'],
      ['Closed', 'done', '#4c9f7a'],
    ],
  },
} as const;
export interface IssueTemplate {
  id: string;
  project_id: string | null;
  name: string;
  description: string;
  defaults: {
    summary?: string;
    description?: string;
    type?: IssueType;
    priority?: string;
    labels?: string[];
    story_points?: number;
  };
  version: number;
  created_by: string;
}
