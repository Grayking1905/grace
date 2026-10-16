// @vitest-environment jsdom
import React, { act, StrictMode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Bootstrap, Page } from '../../shared/types';
import type { AppContextValue } from '../context';
import type { RichEditorProps } from '../components/RichEditor';
import { patch } from '../lib/api';
import { PagesPage } from './Tools';

let context: AppContextValue;
let draftHtml = '';
vi.mock('../context', () => ({ useGrace: () => context }));
vi.mock('../components/Editor', () => ({
  Editor: ({ content, onChange }: RichEditorProps) => (
    <div>
      <output data-testid="document-content">{content}</output>
      <button onClick={() => onChange?.(draftHtml)}>Edit document</button>
    </div>
  ),
}));
vi.mock('../lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/api')>()),
  patch: vi.fn(),
}));

let host: HTMLDivElement;
let root: Root;
let client: QueryClient;
const initialPage = {
  id: 'page-one',
  title: 'A useful plan',
  content: '<p>Saved context</p>',
  version: 1,
  project_id: null,
  author_id: 'user-one',
  updated_at: '2026-10-15T00:00:00.000Z',
} as Page;
function render() {
  root.render(
    <StrictMode>
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={['/pages/page-one']}>
          <Routes>
            <Route path="/pages/:pageId" element={<PagesPage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    </StrictMode>,
  );
}
function button(name: string) {
  const found = [...host.querySelectorAll('button')].find(
    (element) => element.textContent?.trim() === name,
  );
  expect(found).toBeDefined();
  return found!;
}
beforeEach(async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.clearAllMocks();
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  context = {
    data: {
      user: { id: 'user-one', name: 'Editor', role: 'owner' },
      pages: [initialPage],
      projects: [],
      members: [],
    } as unknown as Bootstrap,
    run: async (task) => {
      try {
        const result = await task();
        const saved = (result as { page?: Page }).page;
        if (saved) {
          context = { ...context, data: { ...context.data, pages: [saved] } };
          render();
        }
        return result;
      } catch {
        return undefined;
      }
    },
    refresh: async () => {},
    toast: vi.fn(),
    openIssue: vi.fn(),
    openCreate: vi.fn(),
    openProjectCreate: vi.fn(),
  };
  await act(async () => render());
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  client.clear();
});

describe('Page draft and save state', () => {
  it('marks server-normalized HTML as saved instead of leaving an unsaved warning', async () => {
    draftHtml = '<p style="color:red">A useful update</p>';
    const canonical = { ...initialPage, content: '<p>A useful update</p>', version: 2 };
    vi.mocked(patch).mockResolvedValue({ ok: true, page: canonical });
    await act(async () => button('Edit document').click());
    expect(host.textContent).toContain('Unsaved changes');
    await act(async () => button('Save').click());
    expect(button('Save').disabled).toBe(true);
    expect(host.textContent).not.toContain('Unsaved changes');
    expect(host.querySelector('[data-testid="document-content"]')?.textContent).toBe(
      canonical.content,
    );
  });

  it('preserves typing made while a save is pending', async () => {
    let finish!: (value: unknown) => void;
    vi.mocked(patch).mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    draftHtml = '<p>First edit</p>';
    await act(async () => button('Edit document').click());
    await act(async () => button('Save').click());
    draftHtml = '<p>New typing while saving</p>';
    await act(async () => button('Edit document').click());
    await act(async () =>
      finish({ ok: true, page: { ...initialPage, content: '<p>First edit</p>', version: 2 } }),
    );
    expect(host.querySelector('[data-testid="document-content"]')?.textContent).toBe(draftHtml);
    expect(host.textContent).toContain('Unsaved changes');
    expect(button('Save').disabled).toBe(false);
  });

  it('keeps the draft version for conflict checking after another member edits the page', async () => {
    draftHtml = '<p>Local draft</p>';
    await act(async () => button('Edit document').click());
    context = {
      ...context,
      data: {
        ...context.data,
        pages: [{ ...initialPage, content: '<p>Another member’s edit</p>', version: 2 }],
      },
    };
    await act(async () => render());
    vi.mocked(patch).mockRejectedValue(new Error('EDIT_CONFLICT'));
    await act(async () => button('Save').click());
    expect(patch).toHaveBeenCalledWith(
      '/pages/page-one',
      expect.objectContaining({ version: 1, content: draftHtml }),
    );
    expect(host.querySelector('[data-testid="document-content"]')?.textContent).toBe(draftHtml);
    expect(host.textContent).toContain('Unsaved changes');
  });
});
