// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { it, expect, vi, afterEach } from 'vitest';
import { io } from 'socket.io-client';
import { api, ApiError } from './api';
import { useWorkspaceRealtime } from './useWorkspaceRealtime';
vi.mock('socket.io-client', () => ({ io: vi.fn() }));
vi.mock('./api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./api')>()),
  api: vi.fn(),
}));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let host: HTMLDivElement, root: Root, client: QueryClient;
function makeSocket() {
  const listeners = new Map<string, (...args: unknown[]) => void>();
  const socket = {
    listeners,
    on: vi.fn((name: string, listener: (...args: unknown[]) => void) => {
      listeners.set(name, listener);
      return socket;
    }),
    connect: vi.fn(),
    disconnect: vi.fn(),
    removeAllListeners: vi.fn(() => listeners.clear()),
  };
  return socket;
}
type MockSocket = ReturnType<typeof makeSocket>;
let sockets: MockSocket[];
function Probe({ workspace = 'org' }: { workspace?: string }) {
  const state = useWorkspaceRealtime('user', workspace);
  return <span>{state}</span>;
}
async function render() {
  vi.useFakeTimers();
  sockets = [];
  vi.mocked(io).mockImplementation(() => {
    const socket = makeSocket();
    sockets.push(socket);
    return socket as never;
  });
  vi.mocked(api)
    .mockReset()
    .mockResolvedValue({ ok: true } as never);
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  client = new QueryClient();
  const invalidate = vi.spyOn(client, 'invalidateQueries').mockResolvedValue();
  const reset = vi.spyOn(client, 'resetQueries').mockResolvedValue();
  await act(async () =>
    root.render(
      <QueryClientProvider client={client}>
        <Probe />
      </QueryClientProvider>,
    ),
  );
  return { invalidate, reset };
}
afterEach(async () => {
  if (root) await act(async () => root.unmount());
  client?.clear();
  host?.remove();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.clearAllMocks();
});
it('marks the connection live, refreshes presence and debounces work invalidation', async () => {
  const { invalidate } = await render();
  expect(host.textContent).toBe('connecting');
  await act(async () => sockets[0].listeners.get('connect')!());
  expect(host.textContent).toBe('connected');
  invalidate.mockClear();
  await act(async () => sockets[0].listeners.get('presence.updated')!());
  expect(invalidate).toHaveBeenCalledWith({ queryKey: ['home-overview'] });
  invalidate.mockClear();
  await act(async () => {
    sockets[0].listeners.get('workspace.updated')!();
    sockets[0].listeners.get('workspace.updated')!();
    await vi.advanceTimersByTimeAsync(99);
  });
  expect(invalidate).not.toHaveBeenCalled();
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1);
  });
  expect(invalidate).toHaveBeenCalledOnce();
});
it('retries a temporary server interruption without clearing the workspace and reauthenticates before reconnecting', async () => {
  const { reset } = await render();
  vi.mocked(api).mockRejectedValueOnce(new ApiError('Server starting', 503, 'UNAVAILABLE'));
  await act(async () => {
    sockets[0].listeners.get('disconnect')!('io server disconnect');
    await vi.advanceTimersByTimeAsync(1200);
  });
  expect(host.textContent).toBe('offline');
  expect(reset).not.toHaveBeenCalled();
  expect(sockets[0].connect).not.toHaveBeenCalled();
  await act(async () => {
    await vi.advanceTimersByTimeAsync(2400);
  });
  expect(api).toHaveBeenCalledWith('/auth/me');
  expect(sockets[0].connect).toHaveBeenCalledOnce();
  expect(reset).not.toHaveBeenCalled();
});
it('returns to authentication after a revoked membership without reconnecting', async () => {
  const { reset } = await render();
  vi.mocked(api).mockRejectedValueOnce(new ApiError('Membership inactive', 403, 'FORBIDDEN'));
  await act(async () => {
    sockets[0].listeners.get('disconnect')!('io server disconnect');
    await vi.advanceTimersByTimeAsync(1200);
  });
  expect(reset).toHaveBeenCalledWith({ queryKey: ['bootstrap'] });
  expect(sockets[0].connect).not.toHaveBeenCalled();
});
it('validates refreshed credentials before retrying a rejected socket handshake', async () => {
  await render();
  await act(async () => {
    sockets[0].listeners.get('connect_error')!(new Error('Authentication required'));
    await vi.advanceTimersByTimeAsync(1200);
  });
  expect(api).toHaveBeenCalledWith('/auth/me');
  expect(sockets[0].connect).toHaveBeenCalledOnce();
});
it('cancels old reconnect attempts and listeners when switching organizations', async () => {
  await render();
  await act(async () => sockets[0].listeners.get('disconnect')!('io server disconnect'));
  await act(async () =>
    root.render(
      <QueryClientProvider client={client}>
        <Probe workspace="next-org" />
      </QueryClientProvider>,
    ),
  );
  expect(sockets).toHaveLength(2);
  expect(sockets[0].removeAllListeners).toHaveBeenCalledOnce();
  expect(sockets[0].disconnect).toHaveBeenCalledOnce();
  await act(async () => {
    await vi.advanceTimersByTimeAsync(5000);
  });
  expect(api).not.toHaveBeenCalled();
  expect(sockets[0].connect).not.toHaveBeenCalled();
});
