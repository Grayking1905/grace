// @vitest-environment jsdom
import React, { act, StrictMode, Suspense } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Editor as TiptapEditor } from '@tiptap/core';
import { RichEditor, type RichEditorProps } from './RichEditor';

let host: HTMLDivElement;
let root: Root;
let errors: Error[];
class Boundary extends React.Component<React.PropsWithChildren, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(error: Error) {
    errors.push(error);
  }
  render() {
    return this.state.failed ? <p>Editor crashed</p> : this.props.children;
  }
}

async function renderEditor(props: RichEditorProps, documentId = 'page-one') {
  await act(async () => {
    root.render(
      <StrictMode>
        <Boundary>
          <Suspense fallback={<p>Loading</p>}>
            <RichEditor key={documentId} {...props} />
          </Suspense>
        </Boundary>
      </StrictMode>,
    );
  });
  // Tiptap emits its managed create event after the committed DOM mount.
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 10));
  });
}
function liveEditor() {
  const element = host.querySelector('.tiptap') as (HTMLElement & { editor: TiptapEditor }) | null;
  expect(errors).toEqual([]);
  expect(element).not.toBeNull();
  expect(element!.editor.isDestroyed).toBe(false);
  return element!.editor;
}
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  errors = [];
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => {
    root.unmount();
  });
  host.remove();
  vi.restoreAllMocks();
});

describe('Rich editor React lifecycle', () => {
  it('opens and switches documents under StrictMode without reading a torn-down editor', async () => {
    for (const id of ['welcome', 'design', 'planning', 'welcome-again']) {
      await renderEditor({ content: `<h2>${id}</h2><p>Three useful words</p>` }, id);
      expect(liveEditor().getText()).toContain('Three useful words');
      expect(host.querySelector('[role="toolbar"]')).not.toBeNull();
      expect(host.textContent).toContain('4 words');
    }
    expect(errors).toEqual([]);
  });

  it('keeps drafts and undo history through parent updates, and accepts explicit external content', async () => {
    const onChange = vi.fn();
    const initial = '<p>Original context</p>';
    await renderEditor({ content: initial, onChange });
    const editor = liveEditor();
    await act(async () => {
      editor.commands.insertContentAt(editor.state.doc.content.size - 1, ' plus a draft');
    });
    expect(onChange).toHaveBeenCalled();
    const draft = editor.getHTML();
    await renderEditor({ content: initial, onChange, label: 'Page document' });
    expect(liveEditor()).toBe(editor);
    expect(editor.getHTML()).toBe(draft);
    expect(host.querySelector('[aria-label="Undo (Ctrl+Z)"]')?.hasAttribute('disabled')).toBe(
      false,
    );
    await renderEditor({ content: '<h2>Restored revision</h2>', onChange });
    expect(liveEditor().getText().trim()).toBe('Restored revision');
  });

  it('renders persisted tables and checklists in editable and read-only issue descriptions', async () => {
    const content =
      '<ul data-type="taskList"><li data-type="taskItem" data-checked="true"><p>Ready for review</p></li></ul><table><tbody><tr><th><p>Milestone</p></th></tr><tr><td><p>Release</p></td></tr></tbody></table>';
    await renderEditor({ content, editable: false }, 'issue-description');
    expect(liveEditor().getText()).toContain('Ready for review');
    expect(host.querySelector('table')).not.toBeNull();
    expect(host.querySelector<HTMLInputElement>('input[type="checkbox"]')?.checked).toBe(true);
    expect(host.querySelector('[role="document"]')).not.toBeNull();
    expect(host.querySelector('[role="toolbar"]')).toBeNull();
    await renderEditor({ content, editable: true }, 'issue-description');
    expect(host.querySelector('[role="textbox"]')).not.toBeNull();
    expect(liveEditor().isEditable).toBe(true);
    expect(errors).toEqual([]);
  });
});
