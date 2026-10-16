import { describe, expect, it } from 'vitest';
import { filterEditorCommands, getSlashQuery, normalizeEditorLink } from '../src/editor-commands';

describe('rich editor commands', () => {
  it('offers slash commands only at the start of the current block', () => {
    expect(getSlashQuery('/')).toBe('');
    expect(getSlashQuery('/Check')).toBe('check');
    expect(getSlashQuery('/code block')).toBe('code block');
    expect(getSlashQuery('Plan /check')).toBeNull();
    expect(getSlashQuery('https://example.com')).toBeNull();
    expect(getSlashQuery('/check\nmore text')).toBeNull();
    expect(getSlashQuery(`/${'a'.repeat(33)}`)).toBeNull();
  });

  it('filters both command labels and useful synonyms', () => {
    expect(filterEditorCommands('todo').map((command) => command.id)).toEqual(['task']);
    expect(filterEditorCommands(' LIST ').map((command) => command.id)).toEqual([
      'bullet',
      'numbered',
      'task',
    ]);
    expect(filterEditorCommands('unknown')).toEqual([]);
  });
});

describe('rich editor links', () => {
  it('normalizes web and email destinations', () => {
    expect(normalizeEditorLink('example.com/docs?q=grace')).toBe(
      'https://example.com/docs?q=grace',
    );
    expect(normalizeEditorLink(' https://example.com ')).toBe('https://example.com/');
    expect(normalizeEditorLink('http://localhost:5178')).toBe('http://localhost:5178/');
    expect(normalizeEditorLink('mailto:team@example.com')).toBe('mailto:team@example.com');
  });

  it('rejects executable, malformed, and credential-bearing links', () => {
    for (const value of [
      'javascript:alert(1)',
      'data:text/html,test',
      'file:///etc/passwd',
      'https://user:password@example.com',
      'https://example.com/\nscript',
      'mailto:not-an-email',
      'hello',
      '',
      'https://example.com/<script>',
    ])
      expect(normalizeEditorLink(value)).toBeNull();
  });
});
