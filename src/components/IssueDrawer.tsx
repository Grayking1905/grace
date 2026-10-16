import { useRef, useState, type FormEvent } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Copy,
  Link2,
  Eye,
  Flag,
  Trash2,
  CopyPlus,
  Plus,
  Paperclip,
  MessageSquare,
  History,
  Clock3,
  Send,
  Check,
  Pencil,
  ArrowUpRight,
  FileText,
  Download,
  X,
  CircleCheck,
} from 'lucide-react';
import type { Issue, IssueDetail } from '../../shared/types';
import { useGrace } from '../context';
import { api, patch, post } from '../lib/api';
import {
  Avatar,
  Badge,
  Button,
  Empty,
  IconButton,
  Modal,
  PriorityIcon,
  TypeIcon,
  formatDate,
  relativeTime,
} from './ui';
import { Editor } from './Editor';
import { IssuePlanningTools } from './IssueTools';
export function IssueDrawer({ issueId, onClose }: { issueId: string; onClose: () => void }) {
  const { data, run, toast, openIssue, openCreate } = useGrace();
  const detail = useQuery({
    queryKey: ['issue', issueId],
    queryFn: () => api<IssueDetail>(`/issues/${issueId}`),
  });
  const [tab, setTab] = useState('comments');
  const [descriptionEdit, setDescriptionEdit] = useState(false);
  const [description, setDescription] = useState('');
  const [saving, setSaving] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState(false);
  const [worklogOpen, setWorklogOpen] = useState(false);
  const [linkOpen, setLinkOpen] = useState(false);
  const [commentEdit, setCommentEdit] = useState<string | null>(null);
  const [commentDelete, setCommentDelete] = useState<string | null>(null);
  const commentBody = useRef<HTMLTextAreaElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const current = detail.data?.issue;
  const write =
    data.user.role !== 'viewer' &&
    data.projects.find((p) => p.id === current?.project_id)?.can_write !== false;
  const update = async (changes: Record<string, unknown>) => {
    if (!current) return;
    setSaving(true);
    const result = await run(() =>
      patch<Issue>(`/issues/${current.id}`, {
        ...changes,
        version: current.version,
      }),
    );
    setSaving(false);
    return result;
  };
  if (detail.isPending)
    return (
      <Modal title="Opening your issue…" onClose={onClose} wide>
        <div className="drawer-loading">
          <div className="skeleton" />
          <div className="skeleton" />
          <div className="skeleton" />
        </div>
      </Modal>
    );
  if (!current || !detail.data)
    return (
      <Modal title="Issue unavailable" onClose={onClose}>
        <Empty
          title="We couldn’t open this issue"
          text={detail.error?.message}
          action={<Button onClick={() => detail.refetch()}>Try again</Button>}
        />
      </Modal>
    );
  const { comments, history, worklogs, attachments, links, watchers } = detail.data;
  const project = data.projects.find((p) => p.id === current.project_id)!;
  const statuses = data.statuses.filter((s) => s.project_id === current.project_id);
  const sprints = data.sprints.filter(
    (s) => s.project_id === current.project_id && s.state !== 'closed',
  );
  const children = data.issues.filter((i) => i.parent_id === current.id);
  const parent = data.issues.find((i) => i.id === current.parent_id);
  const watching = watchers.includes(data.user.id);
  const renderValue = (field: string, value: string) => {
    if (!value || value === 'null' || value === '""') return 'none';
    if (field === 'status_id') return data.statuses.find((s) => s.id === value)?.name || value;
    if (['assignee_id', 'reporter_id'].includes(field))
      return data.members.find((m) => m.id === value)?.name || value;
    if (field === 'sprint_id') return data.sprints.find((s) => s.id === value)?.name || value;
    if (field === 'description') return 'description';
    return value.replace(/<[^>]*>/g, '').slice(0, 120);
  };
  return (
    <Modal title={`${project.key} / ${current.key}`} onClose={onClose} wide>
      <div className="issue-drawer-body">
        <div className="drawer-action-bar">
          <div>
            <TypeIcon type={current.type} />
            <span>{current.type === 'subtask' ? 'Sub-task' : current.type}</span>
            <span className="save-state">
              {saving ? (
                'Saving…'
              ) : (
                <>
                  <Check size={12} />
                  Saved
                </>
              )}
            </span>
          </div>
          <div>
            <IconButton
              label={watching ? 'Stop watching' : 'Watch this issue'}
              onClick={() =>
                run(
                  () =>
                    post(`/issues/${current.id}/watch`, {
                      watching: !watching,
                    }),
                  watching ? 'You stopped watching this issue.' : 'You’re watching this issue.',
                )
              }
            >
              <Eye size={16} fill={watching ? '#d8e9de' : 'none'} />
            </IconButton>
            <IconButton
              label="Copy issue link"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(window.location.href);
                  toast('Issue link copied.');
                } catch {
                  toast('Could not access the clipboard.', true);
                }
              }}
            >
              <Link2 size={16} />
            </IconButton>
            <IconButton
              label="Clone issue"
              disabled={!write}
              onClick={async () => {
                const copy = await run(
                  () => post<Issue>(`/issues/${current.id}/clone`),
                  'Issue cloned.',
                );
                if (copy) {
                  onClose();
                  openIssue(copy.id);
                }
              }}
            >
              <CopyPlus size={16} />
            </IconButton>
            <IconButton
              label={current.flagged ? 'Remove blocked flag' : 'Mark as blocked'}
              disabled={!write}
              onClick={() => update({ flagged: current.flagged ? 0 : 1 })}
            >
              <Flag size={16} fill={current.flagged ? '#e4b5a8' : 'none'} />
            </IconButton>
            <IconButton
              label="Delete issue"
              disabled={!write}
              onClick={() => setDeleteConfirm(true)}
            >
              <Trash2 size={16} />
            </IconButton>
          </div>
        </div>
        <div className="drawer-layout">
          <div className="drawer-main">
            {parent && (
              <button className="parent-link" onClick={() => openIssue(parent.id)}>
                <TypeIcon type={parent.type} />
                {parent.key} <span>{parent.summary}</span>
              </button>
            )}
            <textarea
              className="issue-title-input"
              aria-label="Issue title"
              key={`${current.id}-${current.version}-title`}
              defaultValue={current.summary}
              rows={2}
              maxLength={255}
              disabled={!write}
              onBlur={(e) => {
                if (e.target.value.trim() && e.target.value !== current.summary)
                  update({ summary: e.target.value.trim() });
              }}
            />
            {current.flagged > 0 && (
              <div className="blocked-banner">
                <Flag size={15} />
                <span>This issue is blocked. A little help could move it forward.</span>
              </div>
            )}
            <section className="issue-description">
              <div className="detail-section-heading">
                <h3>Description</h3>
                {write && !descriptionEdit && (
                  <button
                    onClick={() => {
                      setDescription(current.description);
                      setDescriptionEdit(true);
                    }}
                  >
                    <Pencil size={13} />
                    Edit
                  </button>
                )}
              </div>
              {descriptionEdit ? (
                <>
                  <Editor
                    key={`${current.id}-edit`}
                    content={description}
                    onChange={setDescription}
                  />
                  <div className="editor-actions">
                    <Button variant="secondary" onClick={() => setDescriptionEdit(false)}>
                      Cancel
                    </Button>
                    <Button
                      busy={saving}
                      onClick={async () => {
                        const result = await update({ description });
                        if (result) setDescriptionEdit(false);
                      }}
                    >
                      Save description
                    </Button>
                  </div>
                </>
              ) : current.description ? (
                <Editor
                  key={`${current.id}-${current.version}`}
                  content={current.description}
                  editable={false}
                />
              ) : (
                <button
                  className="add-description"
                  disabled={!write}
                  onClick={() => {
                    setDescription('');
                    setDescriptionEdit(true);
                  }}
                >
                  Add a little context…
                </button>
              )}
            </section>
            <section className="issue-children">
              <div className="detail-section-heading">
                <h3>
                  {current.type === 'epic' ? 'Child issues' : 'Subtasks'}
                  {children.length > 0 && (
                    <Badge>
                      {
                        children.filter(
                          (i) =>
                            data.statuses.find((s) => s.id === i.status_id)?.category === 'done',
                        ).length
                      }
                      /{children.length}
                    </Badge>
                  )}
                </h3>
                {write && ['epic', 'story', 'task', 'bug'].includes(current.type) && (
                  <button
                    onClick={() =>
                      openCreate({
                        project_id: current.project_id,
                        parent_id: current.id,
                        type: current.type === 'epic' ? 'story' : 'subtask',
                      })
                    }
                  >
                    <Plus size={14} />
                    Add
                  </button>
                )}
              </div>
              {children.map((child) => (
                <button className="child-issue" key={child.id} onClick={() => openIssue(child.id)}>
                  <TypeIcon type={child.type} />
                  <span>{child.key}</span>
                  <strong>{child.summary}</strong>
                  <CircleCheck
                    size={14}
                    color={
                      data.statuses.find((s) => s.id === child.status_id)?.category === 'done'
                        ? '#599573'
                        : '#cbd0cb'
                    }
                  />
                </button>
              ))}
              {!children.length && (
                <span className="detail-hint">Break bigger work into smaller steps.</span>
              )}
            </section>
            <section>
              <div className="detail-section-heading">
                <h3>
                  Linked issues <Badge>{links.length}</Badge>
                </h3>
                {write && (
                  <button onClick={() => setLinkOpen(true)}>
                    <Link2 size={13} />
                    Link issue
                  </button>
                )}
              </div>
              {links.map((link) => (
                <button
                  className="linked-issue"
                  key={link.id}
                  onClick={() => openIssue(link.target_id)}
                >
                  <Link2 size={13} />
                  <span>{link.type}</span>
                  <strong>{link.key}</strong>
                  <span>{link.summary}</span>
                  <ArrowUpRight size={13} />
                </button>
              ))}
            </section>
            <section>
              <div className="detail-section-heading">
                <h3>
                  Attachments <Badge>{attachments.length}</Badge>
                </h3>
                {write && (
                  <button onClick={() => fileInput.current?.click()}>
                    <Plus size={13} />
                    Add file
                  </button>
                )}
              </div>
              <input
                type="file"
                hidden
                ref={fileInput}
                onChange={async (e) => {
                  const file = e.target.files?.[0];
                  if (!file) return;
                  if (file.size > 25 * 1024 * 1024) {
                    toast('Files must be 25 MB or smaller.', true);
                    return;
                  }
                  const form = new FormData();
                  form.append('file', file);
                  await run(
                    () =>
                      api(`/issues/${current.id}/attachments`, {
                        method: 'POST',
                        body: form,
                      }),
                    'File attached.',
                  );
                  e.target.value = '';
                }}
              />
              {attachments.length > 0 ? (
                <div className="attachment-list">
                  {attachments.map((a) => (
                    <a key={a.id} href={`/api/v1/attachments/${a.id}`} download>
                      <FileText size={20} />
                      <div>
                        <strong>{a.name}</strong>
                        <small>{(a.size / 1024).toFixed(1)} KB</small>
                      </div>
                      <Download size={14} />
                    </a>
                  ))}
                </div>
              ) : (
                <div
                  className="attachment-empty"
                  onClick={() => write && fileInput.current?.click()}
                >
                  <Paperclip size={16} />
                  <span>Keep helpful files close to the work.</span>
                  <small>Up to 25 MB per file</small>
                </div>
              )}
            </section>
            <section className="issue-activity">
              <div className="tabs">
                <button
                  className={tab === 'comments' ? 'active' : ''}
                  onClick={() => setTab('comments')}
                >
                  <MessageSquare size={14} />
                  Comments <Badge>{comments.length}</Badge>
                </button>
                <button
                  className={tab === 'history' ? 'active' : ''}
                  onClick={() => setTab('history')}
                >
                  <History size={14} />
                  History
                </button>
                <button
                  className={tab === 'worklogs' ? 'active' : ''}
                  onClick={() => setTab('worklogs')}
                >
                  <Clock3 size={14} />
                  Work log
                </button>
              </div>
              {tab === 'comments' ? (
                <div className="comment-list">
                  {comments.map((c) => {
                    const user = data.members.find((m) => m.id === c.author_id);
                    return (
                      <article className="comment" key={c.id}>
                        <Avatar user={user} size={29} />
                        <div>
                          <header>
                            <strong>{user?.name}</strong>
                            <small>
                              {relativeTime(c.created_at)}
                              {c.edited_at ? ' · edited' : ''}
                            </small>
                            {write &&
                              (c.author_id === data.user.id ||
                                ['owner', 'admin'].includes(data.user.role)) && (
                                <button
                                  onClick={() => setCommentEdit(c.id)}
                                  aria-label="Edit comment"
                                >
                                  <Pencil size={12} />
                                </button>
                              )}
                          </header>
                          {write &&
                            (c.author_id === data.user.id ||
                              ['owner', 'admin'].includes(data.user.role)) && (
                              <button
                                aria-label={`Delete comment by ${user?.name || 'member'}`}
                                onClick={() => setCommentDelete(c.id)}
                              >
                                <Trash2 size={13} />
                              </button>
                            )}
                          {commentEdit === c.id ? (
                            <form
                              onSubmit={async (e) => {
                                e.preventDefault();
                                const body = new FormData(e.currentTarget).get('body');
                                const result = await run(
                                  () => patch(`/issues/${current.id}/comments/${c.id}`, { body }),
                                  'Comment updated.',
                                );
                                if (result) setCommentEdit(null);
                              }}
                            >
                              <textarea
                                name="body"
                                defaultValue={c.body}
                                required
                                maxLength={20000}
                              />
                              <div className="editor-actions">
                                <Button
                                  variant="ghost"
                                  type="button"
                                  onClick={() => setCommentEdit(null)}
                                >
                                  Cancel
                                </Button>
                                <Button type="submit">Save</Button>
                              </div>
                            </form>
                          ) : (
                            <p>
                              {c.body.replace(
                                /@\[([^\]]+)\]\(([a-zA-Z0-9_-]+)\)/g,
                                (_match, _name, userId) =>
                                  `@${data.members.find((m) => m.id === userId)?.name || 'member'}`,
                              )}
                            </p>
                          )}
                        </div>
                      </article>
                    );
                  })}
                  {write && (
                    <form
                      className="comment-compose"
                      onSubmit={async (e) => {
                        e.preventDefault();
                        const form = e.currentTarget;
                        const body = new FormData(form).get('body');
                        const result = await run(
                          () => post(`/issues/${current.id}/comments`, { body }),
                          'Comment added.',
                        );
                        if (result) form.reset();
                      }}
                    >
                      <Avatar user={data.user} size={29} />
                      <div>
                        <textarea
                          name="body"
                          aria-label="Write a comment"
                          ref={commentBody}
                          required
                          maxLength={20000}
                          rows={3}
                          placeholder="Share an update or a little context…"
                        />
                        <select
                          aria-label="Mention a teammate"
                          value=""
                          onChange={(e) => {
                            const member = data.members.find((m) => m.id === e.target.value);
                            if (member && commentBody.current) {
                              const textarea = commentBody.current;
                              const token = `@[${member.name}](${member.id}) `;
                              const start = textarea.selectionStart;
                              textarea.value =
                                textarea.value.slice(0, start) +
                                token +
                                textarea.value.slice(textarea.selectionEnd);
                              textarea.focus();
                              textarea.setSelectionRange(
                                start + token.length,
                                start + token.length,
                              );
                            }
                          }}
                        >
                          <option value="" disabled>
                            @ Mention a teammate
                          </option>
                          {data.members
                            .filter((m) => m.active !== false && m.active !== 0)
                            .map((m) => (
                              <option key={m.id} value={m.id}>
                                {m.name}
                              </option>
                            ))}
                        </select>
                        <Button type="submit">
                          <Send size={13} />
                          Comment
                        </Button>
                      </div>
                    </form>
                  )}
                  {!comments.length && !write && <p className="detail-hint">No comments yet.</p>}
                </div>
              ) : tab === 'history' ? (
                <div className="issue-history">
                  {history.map((h) => (
                    <article key={h.id}>
                      <span className="history-dot" />
                      <div>
                        <p>
                          <strong>{data.members.find((m) => m.id === h.actor_id)?.name}</strong>{' '}
                          {h.field === 'created'
                            ? 'created this issue'
                            : h.field === 'comment'
                              ? 'added a comment'
                              : `updated ${h.field.replace(/_id$/, '').replace(/_/g, ' ')}`}
                        </p>
                        {!['created', 'comment'].includes(h.field) && (
                          <div>
                            <span>{renderValue(h.field, h.old_value)}</span>
                            <ArrowUpRight size={12} />
                            <strong>{renderValue(h.field, h.new_value)}</strong>
                          </div>
                        )}
                        <small>
                          {formatDate(h.created_at, {
                            month: 'short',
                            day: 'numeric',
                            hour: 'numeric',
                            minute: '2-digit',
                          })}
                        </small>
                      </div>
                    </article>
                  ))}
                </div>
              ) : (
                <div className="worklog-list">
                  <div className="worklog-total">
                    <Clock3 size={17} />
                    <strong>
                      {(worklogs.reduce((s, w) => s + w.minutes, 0) / 60).toFixed(1)}h logged
                    </strong>
                    {write && (
                      <Button variant="secondary" onClick={() => setWorklogOpen(true)}>
                        <Plus size={13} />
                        Log time
                      </Button>
                    )}
                  </div>
                  {worklogs.map((w) => (
                    <article key={w.id}>
                      <Avatar user={data.members.find((m) => m.id === w.user_id)} size={26} />
                      <div>
                        <strong>
                          {data.members.find((m) => m.id === w.user_id)?.name}
                          <span>{w.minutes} min</span>
                        </strong>
                        <p>{w.note || 'Time logged on this issue.'}</p>
                        <small>{relativeTime(w.created_at)}</small>
                      </div>
                    </article>
                  ))}
                </div>
              )}
            </section>
          </div>
          <aside className="issue-properties">
            <h3>Details</h3>
            <label>
              Status
              <select
                value={current.status_id}
                disabled={!write || saving}
                onChange={(e) => update({ status_id: e.target.value })}
              >
                {statuses.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Type
              <select
                value={current.type}
                disabled={!write || saving}
                onChange={(e) => update({ type: e.target.value })}
              >
                {['task', 'story', 'bug', 'epic', 'subtask'].map((t) => (
                  <option key={t} value={t}>
                    {t[0].toUpperCase() + t.slice(1)}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Priority
              <select
                value={current.priority}
                disabled={!write || saving}
                onChange={(e) => update({ priority: e.target.value })}
              >
                {['critical', 'high', 'medium', 'low', 'lowest'].map((p) => (
                  <option key={p} value={p}>
                    {p[0].toUpperCase() + p.slice(1)}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Assignee
              <select
                value={current.assignee_id || ''}
                disabled={!write || saving}
                onChange={(e) => update({ assignee_id: e.target.value || null })}
              >
                <option value="">Unassigned</option>
                {data.members.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Reporter
              <div className="property-person">
                <Avatar user={data.members.find((m) => m.id === current.reporter_id)} size={23} />
                {data.members.find((m) => m.id === current.reporter_id)?.name}
              </div>
            </label>
            <div className="property-divider" />
            <label>
              Sprint
              <select
                value={current.sprint_id || ''}
                disabled={!write || saving}
                onChange={(e) => update({ sprint_id: e.target.value || null })}
              >
                <option value="">Backlog</option>
                {sprints.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
                {current.sprint_id && !sprints.some((s) => s.id === current.sprint_id) && (
                  <option value={current.sprint_id}>
                    {data.sprints.find((s) => s.id === current.sprint_id)?.name} · Closed
                  </option>
                )}
              </select>
            </label>
            <label>
              Story points
              <input
                key={`${current.version}-points`}
                type="number"
                min={0}
                max={1000}
                defaultValue={current.story_points}
                disabled={!write || saving}
                onBlur={(e) => {
                  if (Number(e.target.value) !== current.story_points)
                    update({ story_points: Number(e.target.value) });
                }}
              />
            </label>
            <label>
              Start date
              <input
                type="date"
                value={current.start_date}
                disabled={!write || saving}
                onChange={(e) => update({ start_date: e.target.value })}
              />
            </label>
            <label>
              Due date
              <input
                type="date"
                value={current.due_date}
                disabled={!write || saving}
                onChange={(e) => update({ due_date: e.target.value })}
              />
            </label>
            <label>
              Labels
              <input
                key={`${current.version}-labels`}
                defaultValue={current.labels.join(', ')}
                disabled={!write || saving}
                placeholder="Add labels"
                onBlur={(e) => {
                  const labels = e.target.value
                    .split(',')
                    .map((l) => l.trim())
                    .filter(Boolean);
                  if (JSON.stringify(labels) !== JSON.stringify(current.labels)) update({ labels });
                }}
              />
            </label>
            <div className="property-divider" />
            <div className="issue-timestamps">
              <IssuePlanningTools issue={current} watchers={watchers} write={write} />
              <p>Created {formatDate(current.created_at)}</p>
              <p>Updated {relativeTime(current.updated_at)}</p>
              <span>
                {watchers.length} watcher{watchers.length !== 1 ? 's' : ''}
              </span>
            </div>
          </aside>
        </div>
      </div>
      {commentDelete && (
        <Modal title="Delete this comment?" onClose={() => setCommentDelete(null)}>
          <div className="modal-body">
            <p>This comment and its mention links will be removed.</p>
          </div>
          <div className="modal-footer">
            <Button variant="secondary" onClick={() => setCommentDelete(null)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              onClick={async () => {
                if (
                  await run(
                    () =>
                      api(`/issues/${current.id}/comments/${commentDelete}`, { method: 'DELETE' }),
                    'Comment deleted.',
                  )
                )
                  setCommentDelete(null);
              }}
            >
              Delete comment
            </Button>
          </div>
        </Modal>
      )}
      {deleteConfirm && (
        <Modal title={`Delete ${current.key}?`} onClose={() => setDeleteConfirm(false)}>
          <div className="modal-body">
            <p>
              This issue will be removed from your board. Workspace admins can restore it for 30
              days.
            </p>
          </div>
          <div className="modal-footer">
            <Button variant="secondary" onClick={() => setDeleteConfirm(false)}>
              Keep issue
            </Button>
            <Button
              variant="danger"
              onClick={async () => {
                const result = await run(() => api(`/issues/${current.id}`, { method: 'DELETE' }));
                if (result) {
                  onClose();
                  toast(
                    `${current.key} deleted.`,
                    false,
                    ['owner', 'admin'].includes(data.user.role)
                      ? {
                          label: 'Undo',
                          run: () => {
                            run(() => post(`/issues/${current.id}/restore`), 'Issue restored.');
                          },
                        }
                      : undefined,
                  );
                }
              }}
            >
              Delete issue
            </Button>
          </div>
        </Modal>
      )}
      {worklogOpen && (
        <Modal title="Make your time count" onClose={() => setWorklogOpen(false)}>
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              const v = Object.fromEntries(new FormData(e.currentTarget));
              const result = await run(
                () =>
                  post(`/issues/${current.id}/worklogs`, {
                    minutes: Number(v.minutes),
                    note: v.note,
                  }),
                'Time logged.',
              );
              if (result) setWorklogOpen(false);
            }}
          >
            <div className="modal-body">
              <label>
                Time spent (minutes)
                <input name="minutes" type="number" required min={1} max={1440} defaultValue={30} />
              </label>
              <label>
                A little context
                <textarea
                  name="note"
                  maxLength={2000}
                  rows={3}
                  placeholder="What did you work on?"
                />
              </label>
            </div>
            <div className="modal-footer">
              <Button type="submit">Log time</Button>
            </div>
          </form>
        </Modal>
      )}
      {linkOpen && (
        <Modal title="Connect the dots" onClose={() => setLinkOpen(false)}>
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              const body = Object.fromEntries(new FormData(e.currentTarget));
              const result = await run(
                () => post(`/issues/${current.id}/links`, body),
                'Issues linked.',
              );
              if (result) setLinkOpen(false);
            }}
          >
            <div className="modal-body">
              <label>
                Relationship
                <select name="type">
                  <option value="relates to">relates to</option>
                  <option value="blocks">blocks</option>
                  <option value="duplicates">duplicates</option>
                </select>
              </label>
              <label>
                Issue
                <select name="target_id" required>
                  {data.issues
                    .filter((i) => i.id !== current.id)
                    .map((i) => (
                      <option key={i.id} value={i.id}>
                        {i.key} · {i.summary}
                      </option>
                    ))}
                </select>
              </label>
            </div>
            <div className="modal-footer">
              <Button type="submit">Link issue</Button>
            </div>
          </form>
        </Modal>
      )}
    </Modal>
  );
}
