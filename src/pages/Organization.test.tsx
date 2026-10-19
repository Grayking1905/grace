// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, expect, it, vi } from 'vitest';
import axe from 'axe-core';
import { GraceProvider, type AppContextValue } from '../context';
import { OrganizationAdministration, OrganizationMyWork } from './Organization';
import { CreateHub, OrganizationWorkDialog } from '../components/CreateHub';
import { AppNavigation } from '../components/AppNavigation';
import { CopyButton } from '../components/CopyButton';
import { TeamDashboard } from './TeamDashboard';
import { FocusWorkList } from './Focus';
import App, { Login } from '../App';
import {
  defaultTeamPermissions,
  dashboardSections,
  type OrganizationTeam,
  type OrganizationWork,
} from '../../shared/organization';
import type { Bootstrap, Project } from '../../shared/types';
import { api, post, patch } from '../lib/api';
vi.mock('../lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/api')>()),
  api: vi.fn(),
  post: vi.fn(),
  patch: vi.fn(),
}));
vi.mock('../components/Editor', () => ({ Editor: () => <div>Editor</div> }));
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
const work: OrganizationWork = {
  id: 'brd',
  workspace_id: 'org',
  team_id: 'frontend',
  kind: 'brd',
  project_id: null,
  title: 'Onboarding requirements',
  content: '<p>Clear requirements</p>',
  owner_id: 'user',
  created_by: 'user',
  state: 'draft',
  due_date: '',
  version_tag: '',
  version: 1,
  created_at: '2026-10-19',
  updated_at: '2026-10-19',
  issue_ids: [],
};
const user = {
  id: 'user',
  name: 'Taylor Smith',
  email: 'taylor@example.test',
  employee_id: 'FRONT-42',
  team_id: team.id,
  team_role: 'member' as const,
  role: 'member' as const,
  color: '#dce8da',
  capacity: 40,
};
const data: Bootstrap = {
  user,
  workspace: { id: 'org', name: 'Acme', slug: 'acme' },
  members: [user],
  projects: [],
  statuses: [],
  sprints: [],
  issues: [],
  activity: [],
  pages: [],
  views: [],
  notifications: [],
  standups: [],
  risks: [],
  database: 'sqlite',
  organization: {
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
async function render(
  ui: React.ReactNode,
  administrator = false,
  path = '/',
  manager = false,
  overrides: Partial<Bootstrap> = {},
) {
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const context: AppContextValue = {
    data: administrator
      ? {
          ...data,
          user: { ...user, role: 'owner' },
          organization: { ...data.organization!, can_admin: true },
        }
      : manager
        ? {
            ...data,
            user: { ...user, team_role: 'manager' },
            organization: {
              ...data.organization!,
              employee: { ...data.organization!.employee, team_role: 'manager' },
              can_manage_team: true,
            },
          }
        : data,
    run: vi.fn(async (task) => task()),
    toast: vi.fn(),
    refresh: vi.fn(),
    openIssue: vi.fn(),
    openCreate: vi.fn(),
    openProjectCreate: vi.fn(),
    openWork: vi.fn(),
    openCreateMenu: vi.fn(),
  };
  context.data = { ...context.data, ...overrides };
  vi.mocked(api).mockImplementation(
    async (path) => (path.startsWith('/organization/work') ? [work] : []) as never,
  );
  await act(async () => {
    root.render(
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={[path]}>
          <GraceProvider value={context}>{ui}</GraceProvider>
        </MemoryRouter>
      </QueryClientProvider>,
    );
  });
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 25));
  });
  return context;
}
afterEach(async () => {
  if (root) await act(async () => root.unmount());
  host?.remove();
  client?.clear();
  vi.clearAllMocks();
});
it('keeps navigation effects safe under StrictMode when the browser scroll helper returns a promise', async () => {
  const scroll = vi.spyOn(window, 'scrollTo').mockImplementation(() => Promise.resolve() as never);
  const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
  try {
    await render(
      <React.StrictMode>
        <App />
      </React.StrictMode>,
      false,
      '/account/forgot',
    );
    expect(scroll).toHaveBeenCalledWith(0, 0);
    expect(host.querySelector('input[type="email"]')).not.toBeNull();
    expect(errors).not.toHaveBeenCalled();
  } finally {
    scroll.mockRestore();
    errors.mockRestore();
  }
});
it('opens BRDs from the whole My Work row and filters the unified work list', async () => {
  const context = await render(<OrganizationMyWork />);
  const card = host.querySelector<HTMLButtonElement>(
    '[aria-label="Open BRD: Onboarding requirements"]',
  );
  expect(card).not.toBeNull();
  await act(async () => card!.click());
  expect(context.openWork).toHaveBeenCalledWith('brd', team.id, work);
  await act(async () => {
    const filter = host.querySelector<HTMLSelectElement>('[aria-label="Work type"]')!;
    filter.value = 'daily';
    filter.dispatchEvent(new Event('change', { bubbles: true }));
  });
  expect(host.querySelector('[aria-label="Open BRD: Onboarding requirements"]')).toBeNull();
});
it('keeps advanced tools accessible through one disclosure and scopes manager navigation', async () => {
  const help = vi.fn();
  await render(<AppNavigation openHelp={help} />, false, '/', true);
  expect(host.querySelectorAll('.simple-primary-nav a')).toHaveLength(6);
  expect(host.querySelector('a[href="/templates"]')).toBeNull();
  expect(host.querySelector('a[href="/administration"]')).toBeNull();
  await act(async () =>
    host.querySelector<HTMLButtonElement>('[aria-controls="additional-tools"]')!.click(),
  );
  expect(host.querySelector('a[href="/organization"]')?.textContent).toContain('Manage my team');
  expect(host.querySelector('a[href="/templates"]')).not.toBeNull();
  expect(host.querySelector('a[href="/portfolio"]')).not.toBeNull();
  const helpButton = host.querySelector<HTMLButtonElement>('.nav-help')!;
  expect(helpButton.getAttribute('aria-label')).toBe('Help & shortcuts');
  await act(async () => helpButton.click());
  expect(help).toHaveBeenCalledOnce();
});
it('provides manual copy when clipboard access is denied instead of silently failing', async () => {
  const writeText = vi.fn().mockRejectedValue(new Error('Permission denied'));
  const original = Object.getOwnPropertyDescriptor(navigator, 'clipboard');
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
  try {
    const context = await render(
      <CopyButton text="https://grace.example.test/work/42" label="Copy link" />,
    );
    await act(async () => host.querySelector<HTMLButtonElement>('button')!.click());
    expect(host.querySelector<HTMLTextAreaElement>('[aria-label="Text to copy"]')?.value).toBe(
      'https://grace.example.test/work/42',
    );
    expect(context.toast).not.toHaveBeenCalled();
    await act(async () =>
      [...host.querySelectorAll<HTMLButtonElement>('button')]
        .find((b) => b.textContent === 'Done')!
        .click(),
    );
    expect(host.querySelector('[role="dialog"]')).toBeNull();
  } finally {
    if (original) Object.defineProperty(navigator, 'clipboard', original);
    else Reflect.deleteProperty(navigator, 'clipboard');
  }
});
it('lets a manager save their dashboard without submitting administrator-only privileges', async () => {
  await render(<OrganizationAdministration />, false, '/', true);
  vi.mocked(patch).mockResolvedValue({ ...team, version: 2 });
  await act(async () =>
    [...host.querySelectorAll<HTMLButtonElement>('button')]
      .find((b) => b.textContent?.includes('Configure'))!
      .click(),
  );
  const dialog = host.querySelector<HTMLElement>('[role="dialog"]')!;
  expect(dialog.textContent).not.toContain('Advanced role permissions');
  await act(async () =>
    dialog
      .querySelector('form')!
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })),
  );
  expect(patch).toHaveBeenCalledWith(
    `/organization/teams/${team.id}/layout`,
    expect.objectContaining({ name: team.name, sections: team.sections, version: 1 }),
  );
  expect(vi.mocked(patch).mock.calls[0][1]).not.toHaveProperty('permissions');
});
it('does not expand advanced tools merely because a team dashboard is open', async () => {
  await render(<AppNavigation openHelp={vi.fn()} />, false, `/teams/${team.id}`);
  expect(
    host.querySelector('[aria-controls="additional-tools"]')?.getAttribute('aria-expanded'),
  ).toBe('false');
  expect(host.querySelector('a[href="/team"]')).toBeNull();
  expect(host.querySelector(`a[href="/teams/${team.id}"]`)?.textContent).toContain('My team');
});
it('switches team sections and removes redundant type filters for a single work type', async () => {
  const context = await render(
    <Routes>
      <Route path="/teams/:teamId" element={<TeamDashboard />} />
    </Routes>,
    false,
    `/teams/${team.id}`,
  );
  await act(async () =>
    host.querySelector<HTMLButtonElement>('[role="tab"][aria-selected="false"]')!.click(),
  );
  const brdTab = [...host.querySelectorAll<HTMLButtonElement>('[role="tab"]')].find(
    (b) => b.textContent === 'BRDs',
  )!;
  await act(async () => brdTab.click());
  expect(brdTab.getAttribute('aria-selected')).toBe('true');
  expect(host.querySelector('[aria-label="Work type"]')).toBeNull();
  await act(async () =>
    host
      .querySelector<HTMLButtonElement>('[aria-label="Open BRD: Onboarding requirements"]')!
      .click(),
  );
  expect(context.openWork).toHaveBeenCalledWith('brd', team.id, work);
});
it('keeps the unified work controls accessible and named', async () => {
  await render(<OrganizationMyWork />);
  const result = await axe.run(host, {
    runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa'] },
    rules: { 'color-contrast': { enabled: false } },
  });
  expect(result.violations.map((v) => v.id)).toEqual([]);
});
it('keeps project-linked tasks readable without offering edits for read-only project access', async () => {
  const task = {
    ...work,
    kind: 'daily' as const,
    project_id: 'read-only',
    state: 'planned' as const,
  };
  await render(
    <>
      <FocusWorkList issues={[]} work={[task]} />
      <OrganizationWorkDialog kind="daily" item={task} onClose={vi.fn()} />
    </>,
    false,
    '/',
    true,
    { projects: [{ id: 'read-only', name: 'Restricted project', can_write: false } as Project] },
  );
  expect(host.querySelector('[aria-label="Complete Onboarding requirements"]')).toBeNull();
  expect(
    host.querySelector('[aria-label="Open Daily task: Onboarding requirements"]'),
  ).not.toBeNull();
  expect(host.querySelector('input[name="title"]')?.matches(':disabled')).toBe(true);
  expect([...host.querySelectorAll('button')].some((b) => b.textContent === 'Save changes')).toBe(
    false,
  );
});
it('offers the correct create actions and disables actions disallowed by team privileges', async () => {
  const close = vi.fn();
  const context = await render(<CreateHub onClose={close} />);
  const buttons = [...host.querySelectorAll<HTMLButtonElement>('.create-choice-grid > button')];
  expect(buttons).toHaveLength(6);
  expect(buttons.find((b) => b.textContent?.startsWith('Version'))?.disabled).toBe(true);
  await act(async () => buttons.find((b) => b.textContent?.startsWith('New feature'))!.click());
  expect(close).toHaveBeenCalledOnce();
  expect(context.openCreate).toHaveBeenCalledWith(
    expect.objectContaining({ type: 'story', creation_kind: 'New feature', labels: 'Feature' }),
  );
});
it('exposes labeled dashboard configuration and accessible role privilege controls', async () => {
  await render(<OrganizationAdministration />, true);
  await act(async () =>
    [...host.querySelectorAll<HTMLButtonElement>('button')]
      .find((b) => b.textContent?.includes('Create team dashboard'))!
      .click(),
  );
  const dialog = host.querySelector<HTMLElement>('[role="dialog"]')!;
  expect(dialog).not.toBeNull();
  const viewer = dialog.querySelector<HTMLInputElement>(
    '[aria-label="viewer can edit Business requirements"]',
  );
  expect(viewer?.disabled).toBe(true);
  const results = await axe.run(dialog, {
    runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa'] },
    rules: { 'color-contrast': { enabled: false } },
  });
  expect(results.violations.map((v) => v.id)).toEqual([]);
});
it('submits employee ID credentials with organization code and excludes the email credential field', async () => {
  const success = vi.fn(async () => {});
  await render(<Login onSuccess={success} />);
  vi.mocked(post).mockResolvedValue({ ok: true });
  await act(async () =>
    [...host.querySelectorAll<HTMLButtonElement>('.login-methods button')]
      .find((b) => b.textContent === 'Employee ID')!
      .click(),
  );
  const input = (name: string, value: string) => {
    const el = host.querySelector<HTMLInputElement>(`input[name="${name}"]`)!;
    el.value = value;
  };
  input('employee_id', 'FRONT-42');
  input('organization', 'acme');
  input('password', 'ExistingPassword2026!');
  expect(host.querySelector('input[name="email"]')).toBeNull();
  await act(async () =>
    host
      .querySelector('form')!
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })),
  );
  expect(post).toHaveBeenCalledWith('/auth/login', {
    employee_id: 'FRONT-42',
    organization: 'acme',
    password: 'ExistingPassword2026!',
  });
  expect(success).toHaveBeenCalledOnce();
});
