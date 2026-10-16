export const EDITOR_COMMANDS = [
  {
    id: 'paragraph',
    label: 'Text',
    description: 'A regular paragraph',
    keywords: 'paragraph text plain',
  },
  {
    id: 'heading',
    label: 'Heading',
    description: 'Give the next section a title',
    keywords: 'heading title h2',
  },
  {
    id: 'bullet',
    label: 'Bullet list',
    description: 'Keep related ideas together',
    keywords: 'bullet list unordered',
  },
  {
    id: 'numbered',
    label: 'Numbered list',
    description: 'Write a sequence of steps',
    keywords: 'numbered ordered list steps',
  },
  {
    id: 'task',
    label: 'Checklist',
    description: 'Track small, actionable tasks',
    keywords: 'task checklist todo check',
  },
  {
    id: 'quote',
    label: 'Quote',
    description: 'Highlight a useful reference',
    keywords: 'quote blockquote reference',
  },
  {
    id: 'code',
    label: 'Code block',
    description: 'A space for a code example',
    keywords: 'code snippet block',
  },
  {
    id: 'table',
    label: 'Table',
    description: 'Organize information in a 3 × 3 table',
    keywords: 'table grid rows columns',
  },
  {
    id: 'divider',
    label: 'Divider',
    description: 'Add a quiet break between sections',
    keywords: 'divider horizontal rule separator',
  },
] as const;

export type EditorCommandId = (typeof EDITOR_COMMANDS)[number]['id'];

/** Commands only start at the beginning of a block, never inside a URL or sentence. */
export function getSlashQuery(textBeforeCursor: string): string | null {
  const match = /^\/([a-zA-Z0-9 -]{0,32})$/.exec(textBeforeCursor);
  return match ? match[1].trimStart().toLowerCase() : null;
}

export function filterEditorCommands(query: string) {
  const search = query.trim().toLowerCase();
  return EDITOR_COMMANDS.filter((command) =>
    `${command.label} ${command.keywords}`.toLowerCase().includes(search),
  );
}

/** Accept web and email destinations; never persist executable or credential-bearing URLs. */
export function normalizeEditorLink(input: string): string | null {
  const value = input.trim();
  if (!value || /[\u0000-\u0020\u007f<>"\\]/.test(value)) return null;
  const destination = /^[a-z][a-z0-9+.-]*:/i.test(value) ? value : `https://${value}`;
  try {
    const url = new URL(destination);
    if (url.protocol === 'mailto:') {
      return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(url.pathname) ? url.href : null;
    }
    if (
      !['https:', 'http:'].includes(url.protocol) ||
      !url.hostname ||
      url.username ||
      url.password
    )
      return null;
    // A bare word is more likely accidental text than a destination.
    if (!/^[a-z][a-z0-9+.-]*:/i.test(value) && !url.hostname.includes('.')) return null;
    return url.href;
  } catch {
    return null;
  }
}
