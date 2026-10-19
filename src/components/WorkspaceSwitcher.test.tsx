// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, expect, it, vi } from 'vitest';
import { WorkspaceSwitcher } from './WorkspaceSwitcher';
import { GraceProvider, type AppContextValue } from '../context';
import type { Bootstrap } from '../../shared/types';
import { api, post } from '../lib/api';

vi.mock('../lib/api', () => ({ api: vi.fn(), post: vi.fn() }));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const name = 'Grace Product Engineering and Customer Experience Organization';
const workspaces = [
  { id: 'grace', name, role: 'owner', current: true },
  { id: 'studio', name: 'Design Studio', role: 'member', current: false },
];
let root: Root;
let host: HTMLDivElement;
let client: QueryClient;
const toast = vi.fn();
async function render() {
  vi.mocked(api).mockResolvedValue(workspaces);
  host = document.createElement('div');
  host.className = 'sidebar';
  document.body.append(host);
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  root = createRoot(host);
  await act(async () => {
    root.render(
      <QueryClientProvider client={client}>
        <MemoryRouter>
          <GraceProvider
            value={
              {
                data: {
                  user: { id: 'user', role: 'owner' },
                  workspace: { id: 'grace', name },
                } as Bootstrap,
                toast,
              } as unknown as AppContextValue
            }
          >
            <WorkspaceSwitcher />
          </GraceProvider>
        </MemoryRouter>
      </QueryClientProvider>,
    );
  });
}
function trigger() {
  return host.querySelector<HTMLButtonElement>('.workspace-switch')!;
}
async function click(element: Element) {
  await act(async () => {
    (element as HTMLElement).click();
  });
}
async function open() {
  await click(trigger());
  await vi.waitFor(() =>
    expect(document.querySelectorAll('.administration-workspace-option')).toHaveLength(2),
  );
}
afterEach(async () => {
  if (root) await act(async () => root.unmount());
  host?.remove();
  client?.clear();
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

it('renders the organization picker outside the clipped sidebar and preserves long names accessibly', async () => {
  await render();
  await open();
  const menu = document.querySelector<HTMLElement>('#workspace-options')!;
  expect(menu.parentElement).toBe(document.body);
  expect(host.contains(menu)).toBe(false);
  expect(trigger().getAttribute('aria-expanded')).toBe('true');
  expect(trigger().getAttribute('aria-label')).toContain(name);
  expect(trigger().querySelector('strong')?.title).toBe(name);
  expect(menu.querySelector('input')).toBe(document.activeElement);
  expect(menu.querySelector('button:disabled')?.getAttribute('aria-label')).toContain(
    'current organization',
  );
  await act(async () =>
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })),
  );
  expect(document.querySelector('#workspace-options')).toBeNull();
  expect(document.activeElement).toBe(trigger());
});

it('keeps the menu inside the viewport after resizing and allows clicks inside its portal', async () => {
  await render();
  vi.spyOn(trigger(), 'getBoundingClientRect').mockReturnValue({
    left: 900,
    bottom: 800,
  } as DOMRect);
  await open();
  vi.spyOn(window, 'innerWidth', 'get').mockReturnValue(390);
  vi.spyOn(window, 'innerHeight', 'get').mockReturnValue(600);
  await act(async () => window.dispatchEvent(new Event('resize')));
  const menu = document.querySelector<HTMLElement>('#workspace-options')!;
  const x = Number.parseFloat(menu.style.left),
    y = Number.parseFloat(menu.style.top);
  expect(x).toBeGreaterThanOrEqual(12);
  expect(x + Number.parseFloat(menu.style.width)).toBeLessThanOrEqual(378);
  expect(y + Number.parseFloat(menu.style.maxHeight)).toBeLessThanOrEqual(588);
  await act(async () => menu.dispatchEvent(new Event('pointerdown', { bubbles: true })));
  expect(document.querySelector('#workspace-options')).toBe(menu);
  await act(async () => document.body.dispatchEvent(new Event('pointerdown', { bubbles: true })));
  expect(document.querySelector('#workspace-options')).toBeNull();
});

it('filters organizations and resets the search when reopening the picker', async () => {
  await render();
  await open();
  const input = document.querySelector<HTMLInputElement>('#workspace-options input')!;
  const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
  await act(async () => {
    set.call(input, 'no matches');
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  expect(document.querySelector('.administration-workspace-options')?.textContent).toContain(
    'No organizations match',
  );
  await click(trigger());
  await open();
  expect(document.querySelector<HTMLInputElement>('#workspace-options input')?.value).toBe('');
});

it('keeps the shell and cached data during a failed switch, and permits retrying', async () => {
  await render();
  await open();
  client.setQueryData(['bootstrap'], { workspace: 'grace' });
  const clear = vi.spyOn(client, 'clear');
  vi.mocked(post).mockRejectedValue(new Error('Unable to switch organization'));
  await click(document.querySelectorAll('.administration-workspace-option')[1]);
  expect(post).toHaveBeenCalledWith('/workspaces/studio/switch', undefined);
  expect(clear).not.toHaveBeenCalled();
  expect(client.getQueryData(['bootstrap'])).toEqual({ workspace: 'grace' });
  expect(toast).toHaveBeenCalledWith('Unable to switch organization', true);
  expect(trigger().disabled).toBe(false);
});

it('opens organization creation in an unclipped portal and closes it without making changes', async () => {
  await render();
  await open();
  await click(document.querySelector('.administration-menu-action')!);
  const modal = document.querySelector<HTMLElement>('[aria-label="Create an organization"]')!;
  expect(modal).not.toBeNull();
  expect(host.contains(modal)).toBe(false);
  expect(document.querySelector('#workspace-options')).toBeNull();
  await click(modal.querySelector('[aria-label="Close dialog"]')!);
  expect(document.querySelector('[aria-label="Create an organization"]')).toBeNull();
  expect(post).not.toHaveBeenCalled();
});
