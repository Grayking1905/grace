// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { it, expect, vi } from 'vitest';
import { AppErrorBoundary } from './AppErrorBoundary';
function BrokenPage({ message }: { message: string }): React.ReactNode {
  throw new Error(message);
}
it.each([
  [
    'Failed to fetch dynamically imported module: /assets/Pages-old-build.js',
    'Grace has been updated.',
  ],
  ['An unexpected render failure', 'Let’s get you back on track.'],
])('recovers a page failure with the appropriate reload guidance: %s', async (message, title) => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
  try {
    await act(async () =>
      root.render(
        <AppErrorBoundary>
          <BrokenPage message={message} />
        </AppErrorBoundary>,
      ),
    );
    expect(host.querySelector('h1')?.textContent).toBe(title);
    expect(host.querySelector('button')?.textContent).toBe('Reload Grace');
  } finally {
    await act(async () => root.unmount());
    host.remove();
    errors.mockRestore();
  }
});
