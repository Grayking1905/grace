// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { it, expect, vi, afterEach } from 'vitest';
import axe from 'axe-core';
import { OrganizationHome } from './Home';
import { GraceProvider, type AppContextValue } from '../context';
import type { Bootstrap } from '../../shared/types';
import type { HomeOverview, HomeActivityPage } from '../../shared/home';
import { defaultTeamPermissions } from '../../shared/organization';
import { api } from '../lib/api';
vi.mock('../lib/api', () => ({ api: vi.fn() }));
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
const counts = {
  total: 20,
  completed: 8,
  active: 7,
  todo: 5,
  overdue: 2,
  bugs: 3,
  flagged: 1,
  points: 40,
  completed_points: 16,
};
const project = {
  ...counts,
  id: 'project',
  name: 'Grace delivery',
  key: 'GRC',
  color: '#e1eddf',
  lead_id: 'member',
  team_ids: [],
  linked_team_ids: ['frontend'],
  assignment_version: 0,
};
const overview: HomeOverview = {
  scope: 'organization',
  team_id: null,
  generated_at: '2026-10-19T12:00:00.000Z',
  days: 14,
  summary: {
    ...counts,
    projects: 1,
    people: 2,
    online: 1,
    team_work: 3,
    team_work_done: 1,
    team_work_overdue: 1,
  },
  teams: [
    {
      ...counts,
      id: 'frontend',
      name: 'Frontend',
      color: '#e5def1',
      people: 2,
      online: 1,
      projects: 1,
      work: 3,
      work_done: 1,
    },
  ],
  projects: [project],
  available_projects: [{ id: project.id, name: project.name }],
  people: [
    {
      id: 'member',
      name: 'Taylor Smith',
      color: '#dfebda',
      team_id: 'frontend',
      team_role: 'member',
      online: true,
      open: 3,
      completed: 2,
      last_login: '2026-10-19T12:00:00.000Z',
    },
  ],
  trend: [{ date: '2026-10-19', created: 3, completed: 2 }],
  attention: [
    {
      id: 'issue',
      key: 'GRC-1',
      summary: 'Review delivery risk',
      priority: 'high',
      due_date: '2026-10-18',
      flagged: 1,
      assignee_id: 'member',
    },
  ],
};
const feed: HomeActivityPage = {
  items: [
    {
      id: 'event',
      action: 'bug.created',
      entity_type: 'issue',
      entity_id: 'issue',
      title: 'GRC-1 · New defect',
      project_id: 'project',
      team_id: 'frontend',
      actor_id: 'member',
      actor_name: 'Taylor Smith',
      actor_color: '#dfebda',
      created_at: '2026-10-19T12:00:00.000Z',
    },
  ],
  next_cursor: null,
};
let host: HTMLDivElement, root: Root, client: QueryClient;
async function render(admin = true, activity = feed) {
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  const user = {
    id: 'member',
    name: 'Taylor Smith',
    email: 'taylor@example.test',
    color: '#dfebda',
    capacity: 40,
    role: admin ? ('owner' as const) : ('member' as const),
    team_id: 'frontend',
    team_role: 'member' as const,
  };
  const data: Bootstrap = {
    user,
    workspace: { id: 'org', name: 'Grace Studio', slug: 'grace-studio' },
    projects: [],
    issues: [],
    statuses: [],
    sprints: [],
    members: [user],
    activity: [],
    pages: [],
    notifications: [],
    views: [],
    risks: [],
    standups: [],
    database: 'sqlite',
    organization: {
      can_admin: admin,
      employee: {
        user_id: 'member',
        employee_id: 'FE-1',
        team_id: 'frontend',
        team_role: 'member',
        version: 1,
      },
      teams: [
        {
          id: 'frontend',
          workspace_id: 'org',
          name: 'Frontend',
          slug: 'frontend',
          description: 'Frontend team',
          color: '#e5def1',
          version: 1,
          created_at: '2026-10-19',
          updated_at: '2026-10-19',
          sections: ['issues', 'daily'],
          permissions: defaultTeamPermissions,
        },
      ],
    },
  };
  const context: AppContextValue = {
    data,
    connection: 'connected',
    refresh: vi.fn(async () => {}),
    run: vi.fn(async (task) => task()),
    toast: vi.fn(),
    openIssue: vi.fn(),
    openWork: vi.fn(),
    openCreate: vi.fn(),
    openProjectCreate: vi.fn(),
  };
  vi.mocked(api).mockImplementation(async (path, options) => {
    if (options?.method === 'PUT') return { version: 1 } as never;
    if (path.startsWith('/organization/overview'))
      return {
        ...overview,
        scope: admin ? 'organization' : 'team',
        team_id: admin ? null : 'frontend',
      } as never;
    return (
      path.includes('cursor=older')
        ? {
            items: [{ ...feed.items[0], id: 'older-event', title: 'Earlier issue' }],
            next_cursor: null,
          }
        : activity
    ) as never;
  });
  await act(async () =>
    root.render(
      <QueryClientProvider client={client}>
        <MemoryRouter>
          <GraceProvider value={context}>
            <OrganizationHome />
          </GraceProvider>
        </MemoryRouter>
      </QueryClientProvider>,
    ),
  );
  await act(async () => {
    await new Promise((done) => setTimeout(done, 30));
  });
  await vi.waitFor(
    async () => {
      await act(async () => {
        await new Promise((done) => setTimeout(done, 5));
      });
      expect(host.querySelector('.home-feed-event')).not.toBeNull();
    },
    { timeout: 1500, interval: 10 },
  );
  return context;
}
afterEach(async () => {
  if (root) await act(async () => root.unmount());
  client?.clear();
  host?.remove();
  vi.clearAllMocks();
});
it('renders real progress, scoped project summaries, presence and activity with accessible labels', async () => {
  await render();
  expect(host.querySelector('h1')?.textContent).toBe('Organization overview');
  expect(host.querySelector('.home-metric strong')?.textContent).toBe('40%');
  expect(host.querySelector('.home-donut-label strong')?.textContent).toBe('20');
  expect(host.textContent).toContain('reported a bug');
  expect(host.textContent).toContain('Online');
  const result = await axe.run(host, {
    runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa'] },
    rules: { 'color-contrast': { enabled: false } },
  });
  expect(result.violations.map((v) => v.id)).toEqual([]);
});
it('shows members their Home overview without redirecting or exposing admin assignment controls', async () => {
  await render(false);
  expect(host.querySelector('h1')?.textContent).toBe('Frontend overview');
  expect(host.querySelector('[aria-label="Overview team"]')).toBeNull();
  expect(host.querySelector('.home-assign-button')).toBeNull();
  expect(host.querySelector('a[href="/teams/frontend"]')).not.toBeNull();
  expect(
    vi
      .mocked(api)
      .mock.calls.some(
        ([path]) => path.includes('/organization/activity?') && path.includes('team_id=frontend'),
      ),
  ).toBe(true);
});
it('opens issues from live activity and attention rows', async () => {
  const context = await render();
  await act(async () => host.querySelector<HTMLButtonElement>('button.home-feed-event')!.click());
  expect(context.openIssue).toHaveBeenCalledWith('issue');
  await act(async () => host.querySelector<HTMLButtonElement>('.home-attention > button')!.click());
  expect(context.openIssue).toHaveBeenCalledTimes(2);
});
it('submits explicit project team assignments and their concurrency version', async () => {
  await render();
  await act(async () => host.querySelector<HTMLButtonElement>('.home-assign-button')!.click());
  const dialog = host.querySelector('[role="dialog"]')!;
  await act(async () => dialog.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click());
  await act(async () =>
    dialog
      .querySelector('form')!
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })),
  );
  expect(api).toHaveBeenCalledWith('/projects/project/teams', {
    method: 'PUT',
    body: JSON.stringify({ team_ids: ['frontend'], version: 0 }),
  });
  expect(host.querySelector('[role="dialog"]')).toBeNull();
});
it('applies the activity filter and period selector to the corresponding endpoints', async () => {
  await render();
  await act(async () => {
    const select = host.querySelector<HTMLSelectElement>('[aria-label="Activity type"]')!;
    select.value = 'signins';
    select.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await act(async () => {
    const select = host.querySelector<HTMLSelectElement>('[aria-label="Overview period"]')!;
    select.value = '30';
    select.dispatchEvent(new Event('change', { bubbles: true }));
  });
  expect(
    vi
      .mocked(api)
      .mock.calls.some(
        ([path]) => path.includes('/organization/activity?') && path.includes('kind=signins'),
      ),
  ).toBe(true);
  expect(
    vi.mocked(api).mock.calls.some(([path]) => path.includes('/organization/overview?days=30')),
  ).toBe(true);
});
it('refreshes Home and loads earlier activity with the server cursor', async () => {
  const context = await render(true, { ...feed, next_cursor: 'older' });
  await act(async () =>
    host.querySelector<HTMLButtonElement>('[aria-label="Refresh overview"]')!.click(),
  );
  expect(context.refresh).toHaveBeenCalledOnce();
  await act(async () => host.querySelector<HTMLButtonElement>('.home-load-more')!.click());
  await act(async () => {
    await new Promise((done) => setTimeout(done, 20));
  });
  expect(host.textContent).toContain('Earlier issue');
  expect(host.querySelectorAll('.home-feed-event')).toHaveLength(2);
  expect(host.querySelector('.home-load-more')).toBeNull();
});
