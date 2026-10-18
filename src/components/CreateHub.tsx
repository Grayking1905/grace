import { useState, type FormEvent } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useLocation } from 'react-router-dom';
import {
  Bug,
  CheckSquare,
  FileText,
  GitBranch,
  Layers,
  Plus,
  Sparkles,
  Trash2,
  ArrowUpRight,
} from 'lucide-react';
import {
  canTeamCreate,
  workKindLabels,
  workStates,
  type OrganizationWork,
  type OrganizationWorkKind,
} from '../../shared/organization';
import { useGrace } from '../context';
import { api, post, patch } from '../lib/api';
import { Badge, Button, Modal } from './ui';
import { Editor } from './Editor';

export function CreateHub({ onClose }: { onClose: () => void }) {
  const { data, openCreate, openWork, openProjectCreate } = useGrace();
  const location = useLocation();
  const projectId = /^\/projects\/([^/]+)/.exec(location.pathname)?.[1];
  const project = data.projects.find((p) => p.id === projectId);
  const teamId = /^\/teams\/([^/]+)/.exec(location.pathname)?.[1];
  const assignee = teamId
    ? data.user.team_id === teamId
      ? data.user.id
      : data.members.find((m) => m.team_id === teamId && m.active !== false && m.active !== 0)?.id
    : location.pathname === '/my-work'
      ? data.user.id
      : undefined;
  const defaults = {
    ...(projectId ? { project_id: projectId } : {}),
    ...(assignee ? { assignee_id: assignee } : {}),
  };
  const choices = [
    {
      name: 'Issue',
      text: 'Plan a task or track a piece of work.',
      icon: Layers,
      capability: 'work' as const,
      action: () => openCreate({ ...defaults, type: project?.default_type || 'task' }),
    },
    {
      name: 'Bug',
      text: 'Document a problem and its steps to reproduce.',
      icon: Bug,
      capability: 'work' as const,
      action: () =>
        openCreate({
          ...defaults,
          type: 'bug',
          creation_kind: 'Bug',
          description:
            '<h2>What happened?</h2><p></p><h2>Steps to reproduce</h2><ol><li><p></p></li></ol><h2>Expected behavior</h2><p></p>',
        }),
    },
    {
      name: 'New feature',
      text: 'Describe the outcome and acceptance criteria.',
      icon: Sparkles,
      capability: 'work' as const,
      action: () =>
        openCreate({
          ...defaults,
          type: 'story',
          labels: 'Feature',
          creation_kind: 'New feature',
          description:
            '<h2>Outcome</h2><p></p><h2>Acceptance criteria</h2><ul><li><p></p></li></ul>',
        }),
    },
    {
      name: 'BRD',
      text: 'Align business goals, scope and requirements.',
      icon: FileText,
      capability: 'brds' as const,
      action: () => openWork?.('brd', teamId),
    },
    {
      name: 'Daily task',
      text: 'Set an owner, a due date and a clear next step.',
      icon: CheckSquare,
      capability: 'daily' as const,
      action: () => openWork?.('daily', teamId),
    },
    {
      name: 'Version',
      text: 'Group deliverables and write release notes.',
      icon: GitBranch,
      capability: 'versions' as const,
      action: () => openWork?.('version', teamId),
    },
  ];
  return (
    <Modal title="Create" onClose={onClose} wide>
      <div className="modal-body create-hub">
        <p>Give the next piece of work a place to start.</p>
        <div className="create-choice-grid">
          {choices.map((choice) => (
            <button
              key={choice.name}
              disabled={
                data.user.role === 'viewer' ||
                !canTeamCreate(data.organization, choice.capability, teamId) ||
                (choice.capability === 'work' && project?.can_write === false) ||
                (choice.name === 'Bug' && project?.issue_types?.includes('bug') === false) ||
                (choice.name === 'New feature' && project?.issue_types?.includes('story') === false)
              }
              onClick={() => {
                onClose();
                choice.action();
              }}
            >
              <span className="create-choice-icon">
                <choice.icon size={23} />
              </span>
              <strong>{choice.name}</strong>
              <span>{choice.text}</span>
              <ArrowUpRight size={16} />
            </button>
          ))}
        </div>
        <button
          className="create-project-link"
          onClick={() => {
            onClose();
            openProjectCreate();
          }}
          disabled={
            data.user.role === 'viewer' ||
            (!data.organization?.can_admin && data.user.team_role === 'viewer')
          }
        >
          <Plus size={16} /> Create a project
        </button>
        <small>Available actions follow your organization and team privileges.</small>
      </div>
    </Modal>
  );
}
const initialContent: Record<OrganizationWorkKind, string> = {
  brd: '<h2>Business objective</h2><p></p><h2>Scope</h2><p></p><h2>Requirements</h2><ul><li><p></p></li></ul><h2>Acceptance criteria</h2><ul><li><p></p></li></ul><h2>Risks and dependencies</h2><p></p>',
  daily: '<p></p>',
  version:
    '<h2>Highlights</h2><p></p><h2>Changes</h2><ul><li><p></p></li></ul><h2>Release checklist</h2><p></p>',
};
export function OrganizationWorkDialog({
  kind,
  teamId,
  item,
  onClose,
}: {
  kind: OrganizationWorkKind;
  teamId?: string;
  item?: OrganizationWork;
  onClose: () => void;
}) {
  const { data, run, openIssue } = useGrace();
  const [selectedTeam, setSelectedTeam] = useState(
    item?.team_id || teamId || data.organization?.employee.team_id || '',
  );
  const [projectId, setProjectId] = useState(item?.project_id || '');
  const [content, setContent] = useState(item?.content || initialContent[kind]);
  const [linked, setLinked] = useState<string[]>(item?.issue_ids || []);
  const [busy, setBusy] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [linkSearch, setLinkSearch] = useState('');
  const [conflict, setConflict] = useState(false);
  const team = data.organization?.teams.find((t) => t.id === selectedTeam);
  const capability = kind === 'brd' ? 'brds' : kind === 'daily' ? 'daily' : 'versions';
  const writable =
    data.user.role !== 'viewer' &&
    canTeamCreate(data.organization, capability, selectedTeam) &&
    (!item ||
      data.organization?.can_admin ||
      data.user.team_role === 'lead' ||
      item.owner_id === data.user.id ||
      item.created_by === data.user.id);
  const current = useQuery({
    queryKey: ['organization-work-item', item?.id],
    queryFn: () => api<OrganizationWork>(`/organization/work/${item!.id}`),
    enabled: !!item,
  });
  const changed = !!item && !!current.data && current.data.version !== item.version;
  const owners = data.members.filter(
    (m) =>
      m.active !== false &&
      m.active !== 0 &&
      (m.team_id === selectedTeam || ['owner', 'admin'].includes(m.role)),
  );
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBusy(true);
    const values = Object.fromEntries(new FormData(event.currentTarget));
    const body = {
      ...values,
      kind,
      team_id: selectedTeam,
      project_id: projectId || null,
      content,
      issue_ids: linked,
      version: item?.version,
    };
    const saved = await run(
      () =>
        item
          ? patch<OrganizationWork>(`/organization/work/${item.id}`, body)
          : post<OrganizationWork>('/organization/work', body),
      `${workKindLabels[kind]} saved.`,
    );
    setBusy(false);
    if (saved) onClose();
    else setConflict(true);
  };
  return (
    <Modal
      title={`${item ? (writable ? 'Edit' : 'View') : 'Create'} ${workKindLabels[kind]}`}
      onClose={onClose}
      wide
    >
      <form onSubmit={submit}>
        <div className="modal-body organization-work-form">
          <div className="organization-form-intro">
            <Badge>{team?.name || 'Your team'}</Badge>
            <span>
              {kind === 'brd'
                ? 'From business intent to a shared plan.'
                : kind === 'daily'
                  ? 'A clear next step for today.'
                  : 'A release with a shared definition of done.'}
            </span>
          </div>
          {(changed || conflict) && (
            <div className="form-error" role="alert">
              {changed
                ? 'A newer version is available. Close and reopen this item before saving. Your current draft is kept here.'
                : 'The item could not be saved. Check the notification for details; your draft is still here.'}
            </div>
          )}
          <fieldset disabled={!writable || busy}>
            <label>
              Title
              <input
                name="title"
                required
                minLength={2}
                maxLength={200}
                defaultValue={item?.title}
                placeholder={
                  kind === 'brd'
                    ? 'e.g. Customer onboarding requirements'
                    : kind === 'daily'
                      ? 'What will you move forward today?'
                      : 'e.g. Autumn platform release'
                }
              />
            </label>
            <div className="form-row">
              <label>
                Team
                <select
                  value={selectedTeam}
                  disabled={!!item}
                  onChange={(e) => setSelectedTeam(e.target.value)}
                >
                  {data.organization?.teams.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Project
                <select
                  value={projectId}
                  onChange={(e) => {
                    setProjectId(e.target.value);
                    setLinked([]);
                  }}
                  disabled={!!item && item.issue_ids.length > 0}
                >
                  <option value="">Organization work · no project</option>
                  {data.projects.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <div className="form-row three">
              <label>
                Owner
                <select
                  key={selectedTeam}
                  name="owner_id"
                  defaultValue={
                    item?.owner_id ||
                    (owners.some((m) => m.id === data.user.id) ? data.user.id : owners[0]?.id)
                  }
                  required
                >
                  <option value="" disabled>
                    Choose an owner
                  </option>
                  {owners.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Status
                <select
                  name="state"
                  defaultValue={item?.state || (kind === 'daily' ? 'planned' : 'draft')}
                >
                  {workStates.map((s) => (
                    <option key={s} value={s}>
                      {s === 'active'
                        ? 'In progress'
                        : s === 'done' && kind === 'version'
                          ? 'Released'
                          : s[0].toUpperCase() + s.slice(1)}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                {kind === 'version' ? 'Release date' : 'Due date'}
                <input type="date" name="due_date" defaultValue={item?.due_date} />
              </label>
            </div>
            {kind === 'version' && (
              <label>
                Version tag
                <input
                  name="version_tag"
                  required
                  maxLength={60}
                  defaultValue={item?.version_tag}
                  placeholder="e.g. v1.2.0"
                />
              </label>
            )}
          </fieldset>
          <div className="work-description-label">
            {kind === 'brd'
              ? 'Business requirements'
              : kind === 'version'
                ? 'Release notes'
                : 'Details'}
          </div>
          <Editor content={content} onChange={setContent} editable={writable && !busy} />
          <section className="work-linked-issues">
            <h3>
              Linked work <Badge>{linked.length}</Badge>
            </h3>
            {item?.has_hidden_links && (
              <p className="organization-footnote">
                Some linked work is restricted by project access. Those links are preserved when you
                save.
              </p>
            )}
            {linked.map((id) => {
              const issue = data.issues.find((i) => i.id === id);
              return (
                <div key={id}>
                  <button type="button" onClick={() => openIssue(id)}>
                    {issue?.key || 'Issue'} · {issue?.summary || 'Open linked work'}
                  </button>
                  {writable && (
                    <button
                      type="button"
                      aria-label={`Unlink ${issue?.key || 'issue'}`}
                      onClick={() => setLinked((v) => v.filter((i) => i !== id))}
                    >
                      Remove
                    </button>
                  )}
                </div>
              );
            })}
            {writable && (
              <>
                <input
                  aria-label="Find issues to link"
                  placeholder="Find issues to link…"
                  value={linkSearch}
                  onChange={(e) => setLinkSearch(e.target.value)}
                />
                {linkSearch && (
                  <div className="work-link-results">
                    {data.issues
                      .filter(
                        (i) =>
                          (!projectId || i.project_id === projectId) &&
                          !linked.includes(i.id) &&
                          `${i.key} ${i.summary}`.toLowerCase().includes(linkSearch.toLowerCase()),
                      )
                      .slice(0, 8)
                      .map((i) => (
                        <button
                          type="button"
                          key={i.id}
                          onClick={() => {
                            setLinked((v) => [...v, i.id]);
                            setLinkSearch('');
                          }}
                        >
                          {i.key} · {i.summary}
                          <Plus size={14} />
                        </button>
                      ))}
                  </div>
                )}
              </>
            )}
          </section>
        </div>
        <div className="modal-footer">
          {item && writable && (
            <Button type="button" variant="danger" onClick={() => setDeleting((v) => !v)}>
              <Trash2 size={15} />
              {deleting ? 'Keep item' : 'Delete'}
            </Button>
          )}
          {deleting && item && (
            <Button
              type="button"
              variant="danger"
              busy={busy}
              onClick={async () => {
                setBusy(true);
                const result = await run(
                  () =>
                    api(`/organization/work/${item.id}?version=${item.version}`, {
                      method: 'DELETE',
                    }),
                  'Work item deleted.',
                );
                setBusy(false);
                if (result) onClose();
              }}
            >
              Confirm deletion
            </Button>
          )}
          <span className="spacer" />
          <Button type="button" variant="secondary" onClick={onClose}>
            {writable ? 'Cancel' : 'Close'}
          </Button>
          {writable && (
            <Button type="submit" busy={busy} disabled={changed}>
              {' '}
              {item ? 'Save changes' : `Create ${workKindLabels[kind]}`}
            </Button>
          )}
        </div>
      </form>
    </Modal>
  );
}
