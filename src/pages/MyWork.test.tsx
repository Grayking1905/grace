// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { it, expect, vi, afterEach } from 'vitest';
import axe from 'axe-core';
import { OrganizationMyWork } from './MyWork';
import { GraceProvider, type AppContextValue } from '../context';
import type { Bootstrap, Issue, Project } from '../../shared/types';
import type { OrganizationTeam, OrganizationWork } from '../../shared/organization';
import { defaultTeamPermissions, dashboardSections } from '../../shared/organization';
import { api, post, patch } from '../lib/api';

vi.mock('../lib/api', () => ({
  api: vi.fn(),
  post: vi.fn(),
  patch: vi.fn(),
}));

vi.mock('recharts', () => ({
  ResponsiveContainer: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  AreaChart: () => null,
  Area: () => null,
  CartesianGrid: () => null,
  XAxis: () => null,
  YAxis: () => null,
  Tooltip: () => null,
  PieChart: () => null,
  Pie: () => null,
  Cell: () => null,
}));

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const team: OrganizationTeam = {
  id: 'frontend',
  workspace_id: 'org',
  name: 'Frontend',
  slug: 'frontend',
  color: '#e8e2f5',
  description: 'Interfaces and experience',
  sections: [...dashboardSections],
  permissions: defaultTeamPermissions,
  version: 1,
  created_at: '2026-10-19',
  updated_at: '2026-10-19',
};

const user = {
  id: 'member',
  workspace_id: 'org',
  name: 'Taylor Smith',
  email: 'taylor@example.test',
  role: 'member' as const,
  color: '#dfebda',
  capacity: 40,
  employee_id: 'EMP-100',
  team_id: 'frontend',
  team_role: 'member' as const,
  department: 'Engineering',
  title: 'Engineer',
  joined_at: '2026-10-19',
  password_set: true,
};

const project: Project = {
  id: 'project-1',
  workspace_id: 'org',
  name: 'Design System',
  key: 'DS',
  description: 'Shared design system',
  color: '#e1eddf',
  icon: 'layers',
  lead_id: 'member',
  template: 'scrum',
  visibility: 'workspace',
  favorite: 0,
  archived_at: null,
  created_at: '2026-10-19',
  can_write: true,
  can_admin: true,
};

const issues: Issue[] = [
  {
    id: 'issue-1',
    workspace_id: 'org',
    project_id: 'project-1',
    number: 1,
    key: 'DS-1',
    summary: 'Fix contrast on primary button',
    description: 'Ensure AAA contrast',
    type: 'bug',
    status_id: 's-todo',
    priority: 'high',
    assignee_id: 'member',
    reporter_id: 'other',
    parent_id: null,
    sprint_id: null,
    labels: ['accessibility'],
    story_points: 3,
    due_date: '2026-10-18', // overdue
    start_date: '',
    rank: 1,
    flagged: 1,
    carry_over: 0,
    version: 1,
    created_at: '2026-10-15T10:00:00Z',
    updated_at: '2026-10-19T10:00:00Z',
    deleted_at: null,
  },
  {
    id: 'issue-2',
    workspace_id: 'org',
    project_id: 'project-1',
    number: 2,
    key: 'DS-2',
    summary: 'Implement color tokens',
    description: 'HSL theme tokens',
    type: 'story',
    status_id: 's-active',
    priority: 'medium',
    assignee_id: 'member',
    reporter_id: 'member',
    parent_id: null,
    sprint_id: null,
    labels: [],
    story_points: 5,
    due_date: '2026-10-19', // due today
    start_date: '',
    rank: 2,
    flagged: 0,
    carry_over: 0,
    version: 1,
    created_at: '2026-10-18T10:00:00Z',
    updated_at: '2026-10-19T10:00:00Z',
    deleted_at: null,
  },
  {
    id: 'issue-3',
    workspace_id: 'org',
    project_id: 'project-1',
    number: 3,
    key: 'DS-3',
    summary: 'Dark mode variables',
    description: 'Root color scheme',
    type: 'task',
    status_id: 's-done',
    priority: 'low',
    assignee_id: 'member',
    reporter_id: 'member',
    parent_id: null,
    sprint_id: null,
    labels: [],
    story_points: 2,
    due_date: '2026-10-19',
    start_date: '',
    rank: 3,
    flagged: 0,
    carry_over: 0,
    version: 1,
    created_at: '2026-10-17T10:00:00Z',
    updated_at: '2026-10-19T11:00:00Z',
    deleted_at: null,
  },
];

const workItem: OrganizationWork = {
  id: 'daily-1',
  workspace_id: 'org',
  team_id: 'frontend',
  project_id: 'project-1',
  kind: 'daily',
  title: 'Prepare design system release notes',
  content: 'Write changelog',
  state: 'active',
  owner_id: 'member',
  created_by: 'member',
  version_tag: '',
  due_date: '2026-10-19',
  version: 1,
  created_at: '2026-10-19T08:00:00Z',
  updated_at: '2026-10-19T08:00:00Z',
  issue_ids: [],
  has_hidden_links: false,
};

const brdItem: OrganizationWork = {
  id: 'brd-1',
  workspace_id: 'org',
  team_id: 'frontend',
  project_id: 'project-1',
  kind: 'brd',
  title: 'Tokens architecture BRD',
  content: 'Specification',
  state: 'active',
  owner_id: 'member',
  created_by: 'member',
  version_tag: 'v1.0',
  due_date: '2026-10-25',
  version: 1,
  created_at: '2026-10-16T12:00:00Z',
  updated_at: '2026-10-19T12:00:00Z',
  issue_ids: [],
  has_hidden_links: false,
};

const testBootstrap: Bootstrap = {
  user,
  workspace: { id: 'org', name: 'Acme Corp', slug: 'acme' },
  members: [user],
  projects: [project],
  statuses: [
    { id: 's-todo', project_id: 'project-1', name: 'To Do', category: 'todo', color: '#cbd5e1', position: 1, wip_limit: 0 },
    { id: 's-active', project_id: 'project-1', name: 'In Progress', category: 'active', color: '#93c5fd', position: 2, wip_limit: 0 },
    { id: 's-done', project_id: 'project-1', name: 'Done', category: 'done', color: '#86efac', position: 3, wip_limit: 0 },
  ],
  sprints: [],
  issues,
  activity: [
    {
      id: 'act-1',
      issue_id: 'issue-3',
      issue_key: 'DS-3',
      issue_summary: 'Dark mode variables',
      actor_id: 'member',
      field: 'status_id',
      old_value: 's-active',
      new_value: 's-done',
      created_at: '2026-10-19T11:00:00Z',
    },
  ],
  pages: [],
  views: [],
  notifications: [],
  standups: [],
  risks: [],
  database: 'sqlite',
  organization: {
    can_manage_team: true,
    teams: [team],
    employee: {
      user_id: user.id,
      employee_id: user.employee_id,
      team_id: team.id,
      team_role: 'member',
      version: 1,
    },
    can_admin: false,
  },
};

let host: HTMLDivElement, root: Root, client: QueryClient;

function changeInput(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  if (setter) setter.call(input, value);
  else input.value = value;
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new Event('change', { bubbles: true }));
}

async function renderMyWork(overrides: Partial<Bootstrap> = {}) {
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });

  const context: AppContextValue = {
    data: { ...testBootstrap, ...overrides },
    connection: 'connected',
    run: vi.fn(async (task) => task()),
    toast: vi.fn(),
    refresh: vi.fn(),
    openIssue: vi.fn(),
    openCreate: vi.fn(),
    openProjectCreate: vi.fn(),
    openWork: vi.fn(),
    openCreateMenu: vi.fn(),
  };

  vi.mocked(api).mockImplementation(async (path) => {
    if (path.startsWith('/organization/work')) return [workItem, brdItem] as never;
    return [] as never;
  });

  await act(async () => {
    root.render(
      <QueryClientProvider client={client}>
        <GraceProvider value={context}>
          <MemoryRouter>
            <OrganizationMyWork />
          </MemoryRouter>
        </GraceProvider>
      </QueryClientProvider>,
    );
  });

  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 25));
  });

  return context;
}

afterEach(() => {
  root?.unmount();
  host?.remove();
  vi.clearAllMocks();
});

it('renders the 4 metric panels with open work, deadlines, delivery velocity and active projects', async () => {
  await renderMyWork();

  const metrics = host.querySelector('[aria-label="Personal work metrics"]');
  expect(metrics).not.toBeNull();
  expect(metrics?.textContent).toContain('Open work');
  expect(metrics?.textContent).toContain('Due soon & overdue');
  expect(metrics?.textContent).toContain('Personal delivery');
  expect(metrics?.textContent).toContain('Active projects');

  // Verify kicker and heading
  expect(host.querySelector('h1')?.textContent).toBe('My work');
  expect(host.textContent).toContain('Acme Corp');
  expect(host.textContent).toContain('Frontend');
});

it('switches tabs between assigned, created, completed, and needs attention', async () => {
  await renderMyWork();

  // Initially assigned to me
  expect(host.textContent).toContain('DS-1');
  expect(host.textContent).toContain('Fix contrast on primary button');

  // Switch to Completed
  const completedTab = host.querySelectorAll<HTMLButtonElement>('.mywork-tab-button')[2];
  expect(completedTab.textContent).toContain('Completed');

  await act(async () => {
    completedTab.click();
  });

  expect(host.textContent).toContain('DS-3');
  expect(host.textContent).toContain('Dark mode variables');
  expect(host.querySelector('[aria-label="Open Bug: Fix contrast on primary button"]')).toBeNull();

  // Switch to Needs Attention
  const attentionTab = host.querySelectorAll<HTMLButtonElement>('.mywork-tab-button')[3];
  expect(attentionTab.textContent).toContain('Needs attention');

  await act(async () => {
    attentionTab.click();
  });

  expect(host.textContent).toContain('Fix contrast on primary button');
});

it('filters work by type including BRDs and Daily tasks', async () => {
  const context = await renderMyWork();

  const openBRD = host.querySelector<HTMLButtonElement>(
    '[aria-label="Open BRD: Tokens architecture BRD"]',
  );
  expect(openBRD).not.toBeNull();

  await act(async () => {
    openBRD?.click();
  });
  expect(context.openWork).toHaveBeenCalledWith('brd', team.id, brdItem);

  // Filter to daily only
  const typeFilter = host.querySelector<HTMLSelectElement>('[aria-label="Work type"]')!;
  await act(async () => {
    typeFilter.value = 'daily';
    typeFilter.dispatchEvent(new Event('change', { bubbles: true }));
  });

  expect(host.querySelector('[aria-label="Open BRD: Tokens architecture BRD"]')).toBeNull();
  expect(
    host.querySelector('[aria-label="Open Daily task: Prepare design system release notes"]'),
  ).not.toBeNull();
});

it('filters work by search query', async () => {
  await renderMyWork();

  const searchInput = host.querySelector<HTMLInputElement>('[aria-label="Search work"]')!;
  await act(async () => {
    changeInput(searchInput, 'contrast');
  });

  const workList = host.querySelector('.focus-work-list');
  expect(workList?.textContent).toContain('Fix contrast on primary button');
  expect(workList?.textContent).not.toContain('Implement color tokens');
});

it('allows quick addition of a daily task', async () => {
  const context = await renderMyWork();

  const quickInput = host.querySelector<HTMLInputElement>(
    '[aria-label="Quick add a daily task"]',
  )!;
  const quickForm = host.querySelector<HTMLFormElement>('form[aria-label="Quick add task"]')!;

  await act(async () => {
    changeInput(quickInput, 'Review PR for navigation tokens');
  });

  await act(async () => {
    quickForm.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  });

  expect(context.run).toHaveBeenCalled();
  expect(post).toHaveBeenCalledWith(
    '/organization/work',
    expect.objectContaining({
      title: 'Review PR for navigation tokens',
      kind: 'daily',
      owner_id: user.id,
    }),
  );
});

it('renders the daily standup brief card with formatted text ready to copy', async () => {
  await renderMyWork();

  const standupCard = host.querySelector('[aria-label="Daily standup brief"]');
  expect(standupCard).not.toBeNull();
  expect(standupCard?.textContent).toContain('Daily standup brief');
  expect(standupCard?.textContent).toContain('Completed recently');
  expect(standupCard?.textContent).toContain('Today\'s focus');
  expect(standupCard?.textContent).toContain('Attention & Blockers');

  const copyButton = standupCard?.querySelector('button');
  expect(copyButton).not.toBeNull();
  expect(copyButton?.textContent).toContain('Copy brief');
});

it('renders project delivery progress tracks in the side column', async () => {
  await renderMyWork();

  const projectsCard = host.querySelector('[aria-label="My projects"]');
  expect(projectsCard).not.toBeNull();
  expect(projectsCard?.textContent).toContain('Design System');
  expect(projectsCard?.textContent).toContain('open for you');
});

it('completes an item when clicking the complete button', async () => {
  const context = await renderMyWork();

  const completeBtn = host.querySelector<HTMLButtonElement>(
    '[aria-label="Complete DS-1"]',
  );
  expect(completeBtn).not.toBeNull();

  await act(async () => {
    completeBtn?.click();
  });

  expect(context.run).toHaveBeenCalled();
  expect(patch).toHaveBeenCalledWith(
    '/issues/issue-1',
    expect.objectContaining({ status_id: 's-done' }),
  );
});

it('passes axe accessibility checks with 0 violations', async () => {
  await renderMyWork();

  const result = await axe.run(host, {
    runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa'] },
    rules: { 'color-contrast': { enabled: false } },
  });

  expect(result.violations.map((v) => v.id)).toEqual([]);
});
