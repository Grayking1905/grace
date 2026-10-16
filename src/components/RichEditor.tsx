import { useEffect, useId, useRef, useState } from 'react';
import { useEditor, useEditorState, EditorContent } from '@tiptap/react';
import type { Editor as TiptapEditor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { Table, TableCell, TableHeader, TableRow } from '@tiptap/extension-table';
import TaskList from '@tiptap/extension-task-list';
import TaskItem from '@tiptap/extension-task-item';
import Placeholder from '@tiptap/extension-placeholder';
import {
  Bold,
  Italic,
  Underline,
  Strikethrough,
  List,
  ListOrdered,
  ListTodo,
  Heading2,
  Code2,
  Undo2,
  Redo2,
  Quote,
  Link,
  Unlink,
  Table2,
  Columns3,
  Rows3,
  Trash2,
  Pilcrow,
  Minus,
  X,
  type LucideIcon,
} from 'lucide-react';
import {
  filterEditorCommands,
  getSlashQuery,
  normalizeEditorLink,
  type EditorCommandId,
} from '../editor-commands';
import '../editor.css';

export interface RichEditorProps {
  content: string;
  onChange?: (html: string) => void;
  editable?: boolean;
  compact?: boolean;
  placeholder?: string;
  label?: string;
}

type SlashMenu = { query: string; from: number; to: number; top: number; left: number };

const commandIcons: Record<EditorCommandId, LucideIcon> = {
  paragraph: Pilcrow,
  heading: Heading2,
  bullet: List,
  numbered: ListOrdered,
  task: ListTodo,
  quote: Quote,
  code: Code2,
  table: Table2,
  divider: Minus,
};

function ToolbarButton({
  icon: Icon,
  label,
  active = false,
  disabled = false,
  onClick,
}: {
  icon: LucideIcon;
  label: string;
  active?: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      aria-pressed={active}
      disabled={disabled}
      className={active ? 'active' : ''}
      onMouseDown={(event) => event.preventDefault()}
      onClick={onClick}
    >
      <Icon size={17} />
    </button>
  );
}

export function RichEditor({
  content,
  onChange,
  editable = true,
  compact = false,
  placeholder = 'Write something useful, or type / for blocks…',
  label = 'Rich text editor',
}: RichEditorProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const onChangeRef = useRef(onChange);
  const lastEmitted = useRef<string | null>(null);
  const lastExternalContent = useRef(content);
  const keyHandler = useRef<(event: KeyboardEvent) => boolean>(() => false);
  const [slash, setSlash] = useState<SlashMenu | null>(null);
  const slashRef = useRef<SlashMenu | null>(null);
  const dismissedSlash = useRef<string | null>(null);
  const [commandIndex, setCommandIndex] = useState(0);
  const [linkOpen, setLinkOpen] = useState(false);
  const [linkUrl, setLinkUrl] = useState('');
  const [linkText, setLinkText] = useState('');
  const [linkError, setLinkError] = useState('');
  const linkSelection = useRef({ from: 0, to: 0, insertText: false });
  const instanceId = useId();
  const commandMenuId = `${instanceId}-blocks`;
  const linkInputId = `${instanceId}-link`;
  const activeCommand = slash ? filterEditorCommands(slash.query)[commandIndex] : undefined;
  onChangeRef.current = onChange;

  const closeSlash = () => {
    slashRef.current = null;
    setSlash(null);
    setCommandIndex(0);
  };

  const updateSlash = (current: TiptapEditor) => {
    if (current.isDestroyed || !current.schema) return;
    const { selection } = current.state;
    if (
      !current.isEditable ||
      !current.isFocused ||
      !selection.empty ||
      selection.$from.parent.type.name !== 'paragraph' ||
      current.isActive('table') ||
      current.isActive('codeBlock')
    ) {
      if (slashRef.current) closeSlash();
      return;
    }
    const text = selection.$from.parent.textBetween(
      0,
      selection.$from.parentOffset,
      '\n',
      '\ufffc',
    );
    const query = getSlashQuery(text);
    const signature = `${selection.from}:${text}`;
    if (query === null || dismissedSlash.current === signature) {
      if (query === null) dismissedSlash.current = null;
      if (slashRef.current) closeSlash();
      return;
    }
    const root = rootRef.current;
    if (!root) return;
    const cursor = current.view.coordsAtPos(selection.from);
    const bounds = root.getBoundingClientRect();
    const menuHeight = Math.min(336, filterEditorCommands(query).length * 54 + 56);
    const menu: SlashMenu = {
      query,
      from: selection.$from.start(),
      to: selection.from,
      top:
        window.innerHeight - cursor.bottom < menuHeight + 20
          ? Math.max(0, cursor.top - bounds.top - menuHeight - 5)
          : cursor.bottom - bounds.top + 5,
      left: Math.max(8, Math.min(cursor.left - bounds.left, bounds.width - 310)),
    };
    if (slashRef.current?.query !== query || slashRef.current?.from !== menu.from)
      setCommandIndex(0);
    slashRef.current = menu;
    setSlash(menu);
  };

  const editor = useEditor({
    // Create the editor after React commits. Suspense and StrictMode may discard
    // a render, so an editor created during rendering can already be destroyed.
    immediatelyRender: false,
    extensions: [
      StarterKit.configure({
        heading: { levels: [1, 2, 3] },
        link: {
          openOnClick: !editable,
          protocols: ['https', 'http', 'mailto'],
          isAllowedUri: (url) => normalizeEditorLink(url) !== null,
          HTMLAttributes: { target: '_blank', rel: 'noopener noreferrer nofollow' },
        },
      }),
      Table.configure({ resizable: editable, renderWrapper: true, cellMinWidth: 90 }),
      TableRow,
      TableHeader,
      TableCell,
      TaskList,
      TaskItem.configure({ nested: true }),
      Placeholder.configure({ placeholder }),
    ],
    content,
    editable,
    shouldRerenderOnTransaction: false,
    onUpdate: ({ editor: current }) => {
      const html = current.getHTML();
      lastEmitted.current = html;
      onChangeRef.current?.(html);
    },
    onTransaction: ({ editor: current }) => updateSlash(current),
    onBlur: () => closeSlash(),
    editorProps: {
      attributes: {
        class: 'rich-editor',
        'aria-label': label,
        role: editable ? 'textbox' : 'document',
        'aria-multiline': editable ? 'true' : 'false',
        'aria-readonly': String(!editable),
        'aria-autocomplete': editable ? 'list' : 'none',
        'aria-expanded': String(editable && !!slash),
        'aria-controls': editable && slash ? commandMenuId : '',
        'aria-activedescendant':
          editable && activeCommand ? `${commandMenuId}-${activeCommand.id}` : '',
      },
      handleKeyDown: (_view, event) => keyHandler.current(event),
    },
  });

  const state = useEditorState({
    editor,
    // A subscription snapshot can still contain the previous instance during a
    // remount. Read this render's editor; transactions still trigger updates.
    selector: () => {
      const current = editor;
      return current && !current.isDestroyed && current.schema
        ? {
            bold: current.isActive('bold'),
            italic: current.isActive('italic'),
            underline: current.isActive('underline'),
            strike: current.isActive('strike'),
            heading: current.isActive('heading'),
            bullet: current.isActive('bulletList'),
            numbered: current.isActive('orderedList'),
            task: current.isActive('taskList'),
            quote: current.isActive('blockquote'),
            code: current.isActive('codeBlock'),
            link: current.isActive('link'),
            table: current.isActive('table'),
            canUndo: current.can().undo(),
            canRedo: current.can().redo(),
            words: current.state.doc
              .textBetween(0, current.state.doc.content.size, ' ')
              .trim()
              .split(/\s+/)
              .filter(Boolean).length,
          }
        : null;
    },
  });

  useEffect(() => {
    if (!editor || editor.isDestroyed || !editor.schema || lastExternalContent.current === content)
      return;
    lastExternalContent.current = content;
    // Only an actual external content change can replace the document. Parent renders
    // and echoes of our own updates preserve the selection and the undo history.
    if (content !== lastEmitted.current && content !== editor.getHTML()) {
      editor.commands.setContent(content, { emitUpdate: false });
      closeSlash();
      setLinkOpen(false);
    }
  }, [content, editor]);

  useEffect(() => {
    if (!editor || editor.isDestroyed) return;
    editor.setEditable(editable, false);
    if (!editable) {
      closeSlash();
      setLinkOpen(false);
    }
  }, [editable, editor]);

  useEffect(() => {
    if (!slash) return;
    const selected = rootRef.current?.querySelector<HTMLElement>(
      `[data-command-index="${commandIndex}"]`,
    );
    selected?.scrollIntoView({ block: 'nearest' });
  }, [commandIndex, slash?.query]);

  if (!editor)
    return <div className="editor-loading" role="status" aria-label="Loading text editor" />;

  const openLink = () => {
    closeSlash();
    const { from, to, empty } = editor.state.selection;
    linkSelection.current = { from, to, insertText: empty && !editor.isActive('link') };
    setLinkUrl(editor.getAttributes('link').href || '');
    setLinkText('');
    setLinkError('');
    setLinkOpen(true);
  };

  const runCommand = (id: EditorCommandId) => {
    const selection = slashRef.current;
    if (!selection) return;
    closeSlash();
    const chain = editor.chain().focus().deleteRange({ from: selection.from, to: selection.to });
    switch (id) {
      case 'paragraph':
        chain.setParagraph().run();
        break;
      case 'heading':
        chain.setHeading({ level: 2 }).run();
        break;
      case 'bullet':
        chain.toggleBulletList().run();
        break;
      case 'numbered':
        chain.toggleOrderedList().run();
        break;
      case 'task':
        chain.toggleTaskList().run();
        break;
      case 'quote':
        chain.toggleBlockquote().run();
        break;
      case 'code':
        chain.toggleCodeBlock().run();
        break;
      case 'table':
        chain.insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run();
        break;
      case 'divider':
        chain.setHorizontalRule().run();
        break;
    }
  };

  const commands = slash ? filterEditorCommands(slash.query) : [];
  keyHandler.current = (event) => {
    if (!editable) return false;
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
      event.preventDefault();
      event.stopPropagation();
      openLink();
      return true;
    }
    if (!slashRef.current) return false;
    const options = filterEditorCommands(slashRef.current.query);
    if (event.key === 'Escape') {
      event.stopPropagation();
      dismissedSlash.current = `${editor.state.selection.from}:${editor.state.selection.$from.parent.textBetween(0, editor.state.selection.$from.parentOffset, '\n', '\ufffc')}`;
      closeSlash();
      return true;
    }
    if (['ArrowDown', 'ArrowUp'].includes(event.key) && options.length) {
      event.stopPropagation();
      setCommandIndex(
        (index) => (index + (event.key === 'ArrowDown' ? 1 : -1) + options.length) % options.length,
      );
      return true;
    }
    if (event.key === 'Enter' && options.length && !event.isComposing) {
      event.stopPropagation();
      runCommand(options[Math.min(commandIndex, options.length - 1)].id);
      return true;
    }
    return false;
  };

  const saveLink = () => {
    const url = normalizeEditorLink(linkUrl);
    if (!url) {
      setLinkError('Enter a valid web address or an email link, such as https://example.com.');
      return;
    }
    const { from, to, insertText } = linkSelection.current;
    const chain = editor.chain().focus().setTextSelection({ from, to });
    if (insertText) {
      chain
        .insertContent({
          type: 'text',
          text: linkText.trim() || url,
          marks: [{ type: 'link', attrs: { href: url } }],
        })
        .run();
    } else chain.extendMarkRange('link').setLink({ href: url }).run();
    setLinkOpen(false);
  };

  return (
    <div
      ref={rootRef}
      className={`editor ${compact ? 'compact' : ''} ${editable ? '' : 'readonly'}`}
    >
      {editable && (
        <>
          <div className="editor-toolbar" role="toolbar" aria-label="Text formatting">
            <div className="editor-tool-group">
              <ToolbarButton
                icon={Bold}
                label="Bold (Ctrl+B)"
                active={state?.bold}
                onClick={() => editor.chain().focus().toggleBold().run()}
              />
              <ToolbarButton
                icon={Italic}
                label="Italic (Ctrl+I)"
                active={state?.italic}
                onClick={() => editor.chain().focus().toggleItalic().run()}
              />
              <ToolbarButton
                icon={Underline}
                label="Underline (Ctrl+U)"
                active={state?.underline}
                onClick={() => editor.chain().focus().toggleUnderline().run()}
              />
              <ToolbarButton
                icon={Strikethrough}
                label="Strikethrough"
                active={state?.strike}
                onClick={() => editor.chain().focus().toggleStrike().run()}
              />
            </div>
            <div className="editor-tool-group">
              <ToolbarButton
                icon={Heading2}
                label="Heading"
                active={state?.heading}
                onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
              />
              <ToolbarButton
                icon={List}
                label="Bullet list"
                active={state?.bullet}
                onClick={() => editor.chain().focus().toggleBulletList().run()}
              />
              <ToolbarButton
                icon={ListOrdered}
                label="Numbered list"
                active={state?.numbered}
                onClick={() => editor.chain().focus().toggleOrderedList().run()}
              />
              <ToolbarButton
                icon={ListTodo}
                label="Checklist"
                active={state?.task}
                onClick={() => editor.chain().focus().toggleTaskList().run()}
              />
            </div>
            <div className="editor-tool-group">
              <ToolbarButton
                icon={Quote}
                label="Quote"
                active={state?.quote}
                onClick={() => editor.chain().focus().toggleBlockquote().run()}
              />
              <ToolbarButton
                icon={Code2}
                label="Code block"
                active={state?.code}
                onClick={() => editor.chain().focus().toggleCodeBlock().run()}
              />
              <ToolbarButton
                icon={Link}
                label="Add or edit link (Ctrl+K)"
                active={state?.link || linkOpen}
                onClick={openLink}
              />
              <ToolbarButton
                icon={Table2}
                label="Insert table"
                disabled={state?.table}
                onClick={() =>
                  editor
                    .chain()
                    .focus()
                    .insertTable({ rows: 3, cols: 3, withHeaderRow: true })
                    .run()
                }
              />
            </div>
            <div className="editor-tool-group editor-history-tools">
              <ToolbarButton
                icon={Undo2}
                label="Undo (Ctrl+Z)"
                disabled={!state?.canUndo}
                onClick={() => editor.chain().focus().undo().run()}
              />
              <ToolbarButton
                icon={Redo2}
                label="Redo (Ctrl+Shift+Z)"
                disabled={!state?.canRedo}
                onClick={() => editor.chain().focus().redo().run()}
              />
            </div>
          </div>
          {linkOpen && (
            <div
              className="editor-link-panel"
              role="group"
              aria-label="Link editor"
              onKeyDown={(event) => {
                event.stopPropagation();
                if (event.key === 'Enter') {
                  event.preventDefault();
                  saveLink();
                }
                if (event.key === 'Escape') {
                  setLinkOpen(false);
                  editor.commands.focus();
                }
              }}
            >
              <div className="editor-link-fields">
                <label htmlFor={linkInputId}>Web address or email link</label>
                <input
                  id={linkInputId}
                  autoFocus
                  type="text"
                  inputMode="url"
                  value={linkUrl}
                  placeholder="https://example.com"
                  aria-invalid={!!linkError}
                  aria-describedby={linkError ? `${linkInputId}-error` : undefined}
                  onChange={(event) => {
                    setLinkUrl(event.target.value);
                    setLinkError('');
                  }}
                />
                {linkSelection.current.insertText && (
                  <input
                    aria-label="Link text"
                    value={linkText}
                    placeholder="Link text (optional)"
                    onChange={(event) => setLinkText(event.target.value)}
                  />
                )}
                {linkError && (
                  <p id={`${linkInputId}-error`} className="editor-link-error" role="alert">
                    {linkError}
                  </p>
                )}
              </div>
              <button type="button" className="btn primary" onClick={saveLink}>
                Apply
              </button>
              {state?.link && (
                <button
                  type="button"
                  className="btn secondary"
                  aria-label="Remove link"
                  onClick={() => {
                    editor
                      .chain()
                      .focus()
                      .setTextSelection(linkSelection.current)
                      .extendMarkRange('link')
                      .unsetLink()
                      .run();
                    setLinkOpen(false);
                  }}
                >
                  <Unlink size={16} />
                </button>
              )}
              <button
                type="button"
                className="icon-btn"
                aria-label="Close link editor"
                onClick={() => {
                  setLinkOpen(false);
                  editor.commands.focus();
                }}
              >
                <X size={17} />
              </button>
            </div>
          )}
          {state?.table && (
            <div className="editor-table-tools" role="toolbar" aria-label="Table controls">
              <span>Table</span>
              <button
                type="button"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => editor.chain().focus().addRowAfter().run()}
              >
                <Rows3 size={15} /> Add row
              </button>
              <button
                type="button"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => editor.chain().focus().addColumnAfter().run()}
              >
                <Columns3 size={15} /> Add column
              </button>
              <button
                type="button"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => editor.chain().focus().deleteRow().run()}
              >
                Remove row
              </button>
              <button
                type="button"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => editor.chain().focus().deleteColumn().run()}
              >
                Remove column
              </button>
              <button
                type="button"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => editor.chain().focus().toggleHeaderRow().run()}
              >
                Header row
              </button>
              <button
                type="button"
                className="editor-remove-table"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => editor.chain().focus().deleteTable().run()}
              >
                <Trash2 size={15} /> Delete table
              </button>
            </div>
          )}
        </>
      )}
      <EditorContent editor={editor} />
      {editable && (
        <div className="editor-status">
          <span>
            Type <kbd>/</kbd> for blocks
          </span>
          <span>
            {state?.words || 0} {(state?.words || 0) === 1 ? 'word' : 'words'}
          </span>
        </div>
      )}
      {editable && slash && (
        <div
          id={commandMenuId}
          className="editor-command-menu"
          role="listbox"
          aria-label="Insert a block"
          style={{ top: slash.top, left: slash.left }}
        >
          <div className="editor-command-heading">
            Add a block <kbd>Esc</kbd>
          </div>
          {commands.length ? (
            commands.map((command, index) => {
              const Icon = commandIcons[command.id];
              return (
                <button
                  type="button"
                  key={command.id}
                  id={`${commandMenuId}-${command.id}`}
                  role="option"
                  aria-selected={index === commandIndex}
                  data-command-index={index}
                  className={index === commandIndex ? 'selected' : ''}
                  onMouseDown={(event) => event.preventDefault()}
                  onMouseEnter={() => setCommandIndex(index)}
                  onClick={() => runCommand(command.id)}
                >
                  <span className="editor-command-icon">
                    <Icon size={18} />
                  </span>
                  <span>
                    <strong>{command.label}</strong>
                    <small>{command.description}</small>
                  </span>
                </button>
              );
            })
          ) : (
            <p className="editor-command-empty">No matching blocks. Try “list” or “table”.</p>
          )}
        </div>
      )}
    </div>
  );
}
