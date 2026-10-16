export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public code: string,
  ) {
    super(message);
  }
}
let refreshPromise: Promise<Response> | null = null;
export async function api<T = { ok: boolean }>(
  path: string,
  options: RequestInit = {},
  retry = true,
): Promise<T> {
  const headers = new Headers(options.headers);
  if (!(options.body instanceof FormData)) headers.set('Content-Type', 'application/json');
  headers.set('X-Grace-CSRF', '1');
  let response: Response;
  try {
    response = await fetch(`/api/v1${path}`, {
      ...options,
      headers,
      credentials: 'same-origin',
      cache: 'no-store',
    });
  } catch {
    throw new ApiError('Unable to reach Grace. Check your connection and try again.', 0, 'OFFLINE');
  }
  if (response.status === 401 && retry && !path.startsWith('/auth/')) {
    if (!refreshPromise)
      refreshPromise = fetch('/api/v1/auth/refresh', {
        method: 'POST',
        headers: { 'X-Grace-CSRF': '1' },
        credentials: 'same-origin',
      }).finally(() => {
        refreshPromise = null;
      });
    if ((await refreshPromise).ok) return api<T>(path, options, false);
  }
  const payload = await response
    .json()
    .catch(() => ({ message: 'The server returned an unexpected response.' }));
  if (!response.ok)
    throw new ApiError(
      payload.message || 'Something went wrong.',
      response.status,
      payload.code || 'REQUEST_FAILED',
    );
  return payload as T;
}
export const post = <T = { ok: boolean }>(path: string, body: unknown = {}) =>
  api<T>(path, { method: 'POST', body: JSON.stringify(body) });
export const patch = <T = { ok: boolean }>(path: string, body: unknown) =>
  api<T>(path, { method: 'PATCH', body: JSON.stringify(body) });
export function download(name: string, content: string, type = 'text/plain') {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export function exportIssues(issues: import('../../shared/types').Issue[], format: 'csv' | 'json') {
  if (format === 'json')
    return download('grace-issues.json', JSON.stringify(issues, null, 2), 'application/json');
  const fields = [
    'key',
    'summary',
    'type',
    'priority',
    'story_points',
    'due_date',
    'assignee_id',
  ] as const;
  const escape = (v: unknown) => {
    let text = String(v ?? '');
    if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
    return `"${text.replace(/"/g, '""')}"`;
  };
  download(
    'grace-issues.csv',
    [fields.join(','), ...issues.map((i) => fields.map((f) => escape(i[f])).join(','))].join(
      '\r\n',
    ),
    'text/csv;charset=utf-8',
  );
}
