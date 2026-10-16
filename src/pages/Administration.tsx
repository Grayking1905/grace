import { useState, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Archive,
  ArrowUpRight,
  Check,
  Copy,
  MailPlus,
  Monitor,
  Plus,
  RotateCcw,
  ShieldCheck,
  Trash2,
  Users,
  Building2,
} from 'lucide-react';
import type {
  ActiveSession,
  ArchivedProject,
  ProjectMemberRole,
  ProjectMemberships,
  TrashedIssue,
  WorkspaceInvite,
  WorkspaceMembership,
} from '../../shared/administration';
import { useGrace } from '../context';
import { api, patch, post } from '../lib/api';
import { Avatar, Badge, Button, Empty, Modal, formatDate } from '../components/ui';
import '../administration.css';

function QueryState({
  pending,
  error,
  retry,
  children,
}: {
  pending: boolean;
  error: Error | null;
  retry: () => void;
  children: ReactNode;
}) {
  if (pending)
    return (
      <div className="administration-loading" role="status">
        Loading workspace details…
      </div>
    );
  if (error)
    return (
      <div className="administration-error" role="alert">
        <p>{error.message}</p>
        <Button variant="secondary" onClick={retry}>
          Try again
        </Button>
      </div>
    );
  return <>{children}</>;
}
function Confirm({
  title,
  text,
  confirm,
  label,
  onClose,
}: {
  title: string;
  text: string;
  confirm: () => Promise<void>;
  label: string;
  onClose: () => void;
}) {
  const [busy, setBusy] = useState(false);
  return (
    <Modal
      title={title}
      onClose={() => {
        if (!busy) onClose();
      }}
    >
      <div className="administration-form">
        <p>{text}</p>
        <div className="administration-actions">
          <Button variant="secondary" disabled={busy} onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="danger"
            busy={busy}
            onClick={async () => {
              setBusy(true);
              try {
                await confirm();
              } finally {
                setBusy(false);
              }
            }}
          >
            {label}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

export function AdministrationPage() {
  const { data } = useGrace();
  const admin = ['owner', 'admin'].includes(data.user.role);
  const [tab, setTab] = useState('workspaces');
  const tabs = [
    { id: 'workspaces', label: 'Workspaces', icon: Building2 },
    ...(admin ? [{ id: 'invitations', label: 'Invitations', icon: MailPlus }] : []),
    { id: 'archives', label: 'Archived projects', icon: Archive },
    ...(admin ? [{ id: 'trash', label: 'Issue trash', icon: Trash2 }] : []),
    { id: 'sessions', label: 'Your sessions', icon: Monitor },
  ];
  return (
    <div className="page administration-page">
      <div className="page-heading">
        <div>
          <span className="eyebrow">WORKSPACE ADMINISTRATION</span>
          <h1>A clear home for your team.</h1>
          <p>Manage access, recover work, and keep your account secure.</p>
        </div>
        <Link className="btn secondary" to="/settings">
          Workspace settings
          <ArrowUpRight size={16} />
        </Link>
      </div>
      <div className="administration-layout">
        <nav aria-label="Administration sections">
          {tabs.map((item) => (
            <button
              key={item.id}
              className={tab === item.id ? 'active' : ''}
              onClick={() => setTab(item.id)}
            >
              <item.icon size={18} />
              {item.label}
            </button>
          ))}
        </nav>
        <section className="panel administration-panel">
          {tab === 'workspaces' ? (
            <Workspaces />
          ) : tab === 'invitations' && admin ? (
            <Invitations />
          ) : tab === 'archives' ? (
            <Archives />
          ) : tab === 'trash' && admin ? (
            <Trash />
          ) : (
            <Sessions />
          )}
        </section>
      </div>
    </div>
  );
}

function Workspaces() {
  const { data, toast } = useGrace();
  const queryClient = useQueryClient();
  const [create, setCreate] = useState(false);
  const [busy, setBusy] = useState(false);
  const workspaces = useQuery({
    queryKey: ['workspaces', data.user.id, data.workspace.id],
    queryFn: () => api<WorkspaceMembership[]>('/workspaces'),
  });
  const enter = async (path: string, body?: unknown) => {
    setBusy(true);
    try {
      await post(path, body);
      await queryClient.cancelQueries();
      queryClient.clear();
      window.location.assign('/');
    } catch (error) {
      toast((error as Error).message, true);
      setBusy(false);
    }
  };
  return (
    <>
      <div className="administration-section-heading">
        <div>
          <h2>Your workspaces</h2>
          <p>Separate teams and projects, with one account.</p>
        </div>
        <Button onClick={() => setCreate(true)}>
          <Plus size={16} />
          New workspace
        </Button>
      </div>
      <QueryState
        pending={workspaces.isPending}
        error={workspaces.error}
        retry={() => void workspaces.refetch()}
      >
        <div className="administration-records">
          {workspaces.data?.map((workspace) => (
            <div className="administration-record" key={workspace.id}>
              <span className="administration-record-icon">
                <Building2 size={21} />
              </span>
              <div className="administration-record-copy">
                <strong>{workspace.name}</strong>
                <span>
                  {workspace.slug} · {workspace.role}
                </span>
              </div>
              {workspace.current ? (
                <Badge tone="green">
                  <Check size={13} />
                  Current workspace
                </Badge>
              ) : (
                <Button
                  variant="secondary"
                  disabled={busy}
                  onClick={() => void enter(`/workspaces/${workspace.id}/switch`)}
                >
                  Switch workspace
                </Button>
              )}
            </div>
          ))}
        </div>
      </QueryState>
      {create && (
        <Modal
          title="Create a workspace"
          onClose={() => {
            if (!busy) setCreate(false);
          }}
        >
          <form
            className="administration-form"
            onSubmit={(e) => {
              e.preventDefault();
              void enter('/workspaces', { name: new FormData(e.currentTarget).get('name') });
            }}
          >
            <p>
              You’ll be the owner of the new workspace. Your existing workspaces stay available in
              the switcher.
            </p>
            <label>
              Workspace name
              <input
                name="name"
                required
                minLength={2}
                maxLength={120}
                disabled={busy}
                placeholder="e.g. Design team"
              />
            </label>
            <div className="administration-actions">
              <Button
                variant="secondary"
                type="button"
                disabled={busy}
                onClick={() => setCreate(false)}
              >
                Cancel
              </Button>
              <Button busy={busy}>Create and switch</Button>
            </div>
          </form>
        </Modal>
      )}
    </>
  );
}

function Invitations() {
  const { data, run, toast } = useGrace();
  const [invite, setInvite] = useState(false);
  const [link, setLink] = useState('');
  const [busy, setBusy] = useState(false);
  const [revoke, setRevoke] = useState<WorkspaceInvite | null>(null);
  const invites = useQuery({
    queryKey: ['invitations', data.workspace.id],
    queryFn: () => api<WorkspaceInvite[]>('/invites'),
  });
  return (
    <>
      <div className="administration-section-heading">
        <div>
          <h2>Workspace invitations</h2>
          <p>Invite people to {data.workspace.name}, and manage pending access.</p>
        </div>
        <Button
          onClick={() => {
            setInvite(true);
            setLink('');
          }}
        >
          <MailPlus size={16} />
          Invite member
        </Button>
      </div>
      <div className="administration-note">
        <ShieldCheck size={18} />
        <p>
          Invitations are bound to an email address and expire after seven days. Share the new link
          with its intended recipient.
        </p>
      </div>
      <QueryState
        pending={invites.isPending}
        error={invites.error}
        retry={() => void invites.refetch()}
      >
        {invites.data?.length ? (
          <div className="administration-records">
            {invites.data.map((item) => (
              <div className="administration-record" key={item.id}>
                <span className="administration-record-icon">
                  <MailPlus size={20} />
                </span>
                <div className="administration-record-copy">
                  <strong>{item.email}</strong>
                  <span>
                    {item.role} access ·{' '}
                    {item.state === 'accepted'
                      ? `Accepted ${formatDate(item.accepted_at!)}`
                      : `Expires ${formatDate(item.expires_at)}`}
                  </span>
                </div>
                <Badge
                  tone={
                    item.state === 'accepted'
                      ? 'green'
                      : item.state === 'expired'
                        ? 'neutral'
                        : 'yellow'
                  }
                >
                  {item.state}
                </Badge>
                {item.state !== 'accepted' && (
                  <Button variant="ghost" onClick={() => setRevoke(item)}>
                    Revoke
                  </Button>
                )}
              </div>
            ))}
          </div>
        ) : (
          <Empty
            title="Your next teammate starts here"
            text="Create an invitation to give someone access to the workspace."
          />
        )}
      </QueryState>
      {invite && (
        <Modal
          title={link ? 'Your invitation is ready' : 'Invite someone to Grace'}
          onClose={() => {
            if (!busy) setInvite(false);
          }}
        >
          {link ? (
            <div className="administration-form">
              <p>
                Copy this invitation link and share it with the invited person. The link is shown
                only when it is created.
              </p>
              <label>
                Invitation link
                <input value={link} readOnly onFocus={(e) => e.target.select()} />
              </label>
              <div className="administration-actions">
                <Button variant="secondary" onClick={() => setInvite(false)}>
                  Done
                </Button>
                <Button
                  onClick={async () => {
                    try {
                      await navigator.clipboard.writeText(link);
                      toast('Invitation link copied.');
                    } catch {
                      toast('Select the invitation link and copy it manually.', true);
                    }
                  }}
                >
                  <Copy size={16} />
                  Copy link
                </Button>
              </div>
            </div>
          ) : (
            <form
              className="administration-form"
              onSubmit={async (e) => {
                e.preventDefault();
                const form = new FormData(e.currentTarget);
                setBusy(true);
                const result = await run(
                  () =>
                    post<{ url: string }>('/invites', {
                      email: form.get('email'),
                      role: form.get('role'),
                    }),
                  'Invitation created.',
                );
                if (result) setLink(result.url);
                setBusy(false);
              }}
            >
              <label>
                Email address
                <input
                  name="email"
                  type="email"
                  required
                  maxLength={254}
                  placeholder="teammate@company.com"
                  disabled={busy}
                />
              </label>
              <label>
                Workspace role
                <select name="role" defaultValue="member" disabled={busy}>
                  <option value="member">Member — create and update work</option>
                  <option value="viewer">Viewer — browse work</option>
                  <option value="admin">Admin — manage workspace and access</option>
                </select>
              </label>
              <div className="administration-actions">
                <Button
                  variant="secondary"
                  type="button"
                  onClick={() => setInvite(false)}
                  disabled={busy}
                >
                  Cancel
                </Button>
                <Button busy={busy}>Create invitation</Button>
              </div>
            </form>
          )}
        </Modal>
      )}
      {revoke && (
        <Confirm
          title="Revoke invitation?"
          text={`${revoke.email} will no longer be able to join using this invitation. You can create a new invitation later.`}
          label="Revoke invitation"
          onClose={() => setRevoke(null)}
          confirm={async () => {
            if (
              await run(
                () => api(`/invites/${revoke.id}`, { method: 'DELETE' }),
                'Invitation revoked.',
              )
            )
              setRevoke(null);
          }}
        />
      )}
    </>
  );
}

function Archives() {
  const { data, run } = useGrace();
  const [busy, setBusy] = useState<string | null>(null);
  const archived = useQuery({
    queryKey: ['archived-projects', data.workspace.id],
    queryFn: () => api<ArchivedProject[]>('/administration/projects'),
  });
  return (
    <>
      <div className="administration-section-heading">
        <div>
          <h2>Archived projects</h2>
          <p>Restore a project to bring its issues, sprints, and documents back into view.</p>
        </div>
      </div>
      <QueryState
        pending={archived.isPending}
        error={archived.error}
        retry={() => void archived.refetch()}
      >
        {archived.data?.length ? (
          <div className="administration-records">
            {archived.data.map((project) => (
              <div className="administration-record" key={project.id}>
                <span className="administration-record-icon" style={{ background: project.color }}>
                  <Archive size={20} />
                </span>
                <div className="administration-record-copy">
                  <strong>
                    {project.name} <small>{project.key}</small>
                  </strong>
                  <span>Archived {formatDate(project.archived_at!)}</span>
                </div>
                {project.can_manage ? (
                  <Button
                    variant="secondary"
                    busy={busy === project.id}
                    disabled={busy !== null}
                    onClick={async () => {
                      setBusy(project.id);
                      await run(() => post(`/projects/${project.id}/restore`), 'Project restored.');
                      setBusy(null);
                    }}
                  >
                    <RotateCcw size={15} />
                    Restore project
                  </Button>
                ) : (
                  <Badge>Administrator access required</Badge>
                )}
              </div>
            ))}
          </div>
        ) : (
          <Empty
            title="No archived projects"
            text="Projects you archive will appear here. Their work stays safely stored."
          />
        )}
      </QueryState>
    </>
  );
}

function Trash() {
  const { data, run } = useGrace();
  const [busy, setBusy] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const trash = useQuery({
    queryKey: ['issue-trash', data.workspace.id],
    queryFn: () => api<TrashedIssue[]>('/administration/trash'),
  });
  const rows =
    trash.data?.filter((issue) =>
      `${issue.key} ${issue.summary} ${issue.project_name}`
        .toLowerCase()
        .includes(search.toLowerCase()),
    ) || [];
  return (
    <>
      <div className="administration-section-heading">
        <div>
          <h2>Issue trash</h2>
          <p>Workspace administrators can recover deleted issues for 30 days.</p>
        </div>
      </div>
      <label className="administration-search-label">
        Find deleted work
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by issue key, title, or project…"
        />
      </label>
      <QueryState pending={trash.isPending} error={trash.error} retry={() => void trash.refetch()}>
        {rows.length ? (
          <div className="administration-records">
            {rows.map((issue) => (
              <div className="administration-record" key={issue.id}>
                <span className="administration-record-icon">
                  <Trash2 size={19} />
                </span>
                <div className="administration-record-copy">
                  <small>
                    {issue.key} · {issue.project_name}
                  </small>
                  <strong>{issue.summary}</strong>
                  <span>
                    {issue.project_archived
                      ? 'Restore the archived project first'
                      : issue.recoverable
                        ? `Recover before ${formatDate(issue.recover_until)}`
                        : 'Recovery period has ended'}
                  </span>
                </div>
                <Button
                  variant="secondary"
                  disabled={!issue.recoverable || busy !== null}
                  busy={busy === issue.id}
                  onClick={async () => {
                    setBusy(issue.id);
                    await run(
                      () => post(`/administration/trash/${issue.id}/restore`),
                      'Issue recovered.',
                    );
                    setBusy(null);
                  }}
                >
                  <RotateCcw size={15} />
                  Recover
                </Button>
              </div>
            ))}
          </div>
        ) : (
          <Empty
            title={search ? 'No deleted issues match' : 'The trash is clear'}
            text={
              search
                ? 'Try a different issue key, title, or project.'
                : 'Deleted issues appear here with their recovery deadline.'
            }
          />
        )}
      </QueryState>
    </>
  );
}

function Sessions() {
  const { data, run, toast } = useGrace();
  const queryClient = useQueryClient();
  const [revoke, setRevoke] = useState<ActiveSession | 'others' | 'all' | null>(null);
  const sessions = useQuery({
    queryKey: ['account-sessions', data.user.id],
    queryFn: () => api<ActiveSession[]>('/sessions'),
  });
  return (
    <>
      <div className="administration-section-heading">
        <div>
          <h2>Your active sessions</h2>
          <p>Review your sign-ins across every workspace.</p>
        </div>
        <div className="administration-session-actions">
          <Button
            variant="secondary"
            disabled={!sessions.data?.some((session) => !session.current)}
            onClick={() => setRevoke('others')}
          >
            Sign out other sessions
          </Button>
          <Button variant="ghost" onClick={() => setRevoke('all')}>
            Sign out everywhere
          </Button>
        </div>
      </div>
      <div className="administration-note">
        <ShieldCheck size={18} />
        <p>
          Ending a session immediately revokes its access. Sign out everywhere also ends your
          current session.
        </p>
      </div>
      <QueryState
        pending={sessions.isPending}
        error={sessions.error}
        retry={() => void sessions.refetch()}
      >
        <div className="administration-records">
          {sessions.data?.map((session) => (
            <div className="administration-record" key={session.id}>
              <span className="administration-record-icon">
                <Monitor size={20} />
              </span>
              <div className="administration-record-copy">
                <strong>{session.workspace_name}</strong>
                <span>
                  Signed in {new Date(session.created_at).toLocaleString()} · Expires{' '}
                  {formatDate(session.expires_at)}
                </span>
              </div>
              {session.current ? (
                <Badge tone="green">Current session</Badge>
              ) : (
                <Button variant="ghost" onClick={() => setRevoke(session)}>
                  Sign out
                </Button>
              )}
            </div>
          ))}
        </div>
      </QueryState>
      {revoke && (
        <Confirm
          title={
            revoke === 'all'
              ? 'Sign out everywhere?'
              : revoke === 'others'
                ? 'Sign out all other sessions?'
                : 'End this session?'
          }
          text="Anyone using the affected session will need to sign in again to continue working."
          label="Sign out"
          onClose={() => setRevoke(null)}
          confirm={async () => {
            if (revoke === 'all') {
              try {
                await post('/sessions/revoke-all');
                await queryClient.cancelQueries();
                queryClient.clear();
                window.location.assign('/');
              } catch (error) {
                toast((error as Error).message, true);
              }
              return;
            }
            const result = await run(
              () =>
                revoke === 'others'
                  ? post('/sessions/revoke-others')
                  : api(`/sessions/${revoke.id}`, { method: 'DELETE' }),
              'Session access revoked.',
            );
            if (result) setRevoke(null);
          }}
        />
      )}
    </>
  );
}

export function ProjectAdministration({ projectId }: { projectId: string }) {
  const { data, run } = useGrace();
  const navigate = useNavigate();
  const project = data.projects.find((item) => item.id === projectId);
  const [invite, setInvite] = useState(false);
  const [busy, setBusy] = useState(false);
  const [remove, setRemove] = useState<{ id: string; name: string } | null>(null);
  const [archive, setArchive] = useState(false);
  const members = useQuery({
    queryKey: ['project-members', data.workspace.id, projectId],
    queryFn: () => api<ProjectMemberships>(`/projects/${projectId}/members`),
  });
  if (!project) return null;
  const canManage = members.data?.can_manage === true;
  const available = data.members.filter(
    (user) => !members.data?.members.some((member) => member.id === user.id),
  );
  return (
    <div className="administration-project-settings">
      <section className="panel administration-panel">
        <div className="administration-section-heading">
          <div>
            <h2>Project details</h2>
            <p>Keep the purpose, ownership, and access of this project clear.</p>
          </div>
          <Badge>{project.key}</Badge>
        </div>
        {!members.isPending && !canManage && (
          <div className="administration-note">
            <ShieldCheck size={18} />
            <p>A project lead or administrator can update these settings.</p>
          </div>
        )}
        <form
          key={`${project.id}-${project.name}-${project.visibility}-${project.lead_id}`}
          className="administration-form"
          onSubmit={async (e) => {
            e.preventDefault();
            const form = new FormData(e.currentTarget);
            setBusy(true);
            await run(
              () =>
                patch(`/projects/${projectId}/administration`, {
                  name: form.get('name'),
                  description: form.get('description'),
                  visibility: form.get('visibility'),
                  lead_id: form.get('lead_id'),
                }),
              'Project settings saved.',
            );
            setBusy(false);
          }}
        >
          <label>
            Project name
            <input
              name="name"
              defaultValue={project.name}
              minLength={2}
              maxLength={120}
              required
              disabled={!canManage || busy}
            />
          </label>
          <label>
            Description
            <textarea
              name="description"
              defaultValue={project.description}
              maxLength={2000}
              rows={3}
              disabled={!canManage || busy}
            />
          </label>
          <div className="administration-form-columns">
            <label>
              Visibility
              <select
                name="visibility"
                defaultValue={project.visibility}
                disabled={!canManage || busy}
              >
                <option value="workspace">Workspace — visible to everyone in this workspace</option>
                <option value="private">
                  Private — visible to project members and workspace admins
                </option>
              </select>
            </label>
            <label>
              Project lead
              <select name="lead_id" defaultValue={project.lead_id} disabled={!canManage || busy}>
                {data.members
                  .filter((member) => member.role !== 'viewer' || member.id === project.lead_id)
                  .map((member) => (
                    <option key={member.id} value={member.id} disabled={member.role === 'viewer'}>
                      {member.name}
                    </option>
                  ))}
              </select>
            </label>
          </div>
          <div>
            <Button disabled={!canManage} busy={busy}>
              Save project details
            </Button>
          </div>
        </form>
      </section>
      <section className="panel administration-panel">
        <div className="administration-section-heading">
          <div>
            <h2>Project members</h2>
            <p>
              {project.visibility === 'private'
                ? 'Only these people, the project lead, and workspace administrators can access this project.'
                : 'Workspace members can access this project. Add explicit roles to grant administration or restrict edits.'}
            </p>
          </div>
          <Button
            variant="secondary"
            disabled={!canManage || !available.length}
            onClick={() => setInvite(true)}
          >
            <Users size={16} />
            Add member
          </Button>
        </div>
        <QueryState
          pending={members.isPending}
          error={members.error}
          retry={() => void members.refetch()}
        >
          {members.data?.members.length ? (
            <div className="administration-records">
              {members.data.members.map((member) => (
                <div className="administration-record" key={member.id}>
                  <Avatar user={member} size={38} />
                  <div className="administration-record-copy">
                    <strong>
                      {member.name}{' '}
                      {member.id === project.lead_id && <Badge tone="green">Project lead</Badge>}
                    </strong>
                    <span>
                      {member.email}
                      {member.workspace_role === 'viewer'
                        ? ' · Workspace viewer'
                        : ['owner', 'admin'].includes(member.workspace_role)
                          ? ` · Workspace ${member.workspace_role}`
                          : ''}
                    </span>
                  </div>
                  <label className="administration-role-label">
                    <span className="sr-only">Project role for {member.name}</span>
                    <select
                      aria-label={`Project role for ${member.name}`}
                      value={member.role}
                      disabled={!canManage || busy || member.id === project.lead_id}
                      onChange={async (event) => {
                        const role = event.target.value as ProjectMemberRole;
                        setBusy(true);
                        await run(
                          () => patch(`/projects/${projectId}/members/${member.id}`, { role }),
                          'Project role updated.',
                        );
                        setBusy(false);
                      }}
                    >
                      <option value="admin">Project admin</option>
                      <option value="member">Member</option>
                      <option value="viewer">Viewer</option>
                    </select>
                  </label>
                  {canManage && member.id !== project.lead_id && (
                    <Button variant="ghost" disabled={busy} onClick={() => setRemove(member)}>
                      Remove
                    </Button>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <Empty
              title="No explicit project members"
              text="The project lead and workspace administrators retain access. Add a member to assign a project role."
            />
          )}
        </QueryState>
      </section>
      {canManage && (
        <section className="panel administration-panel administration-archive-panel">
          <div>
            <h2>Archive this project</h2>
            <p>
              Hide the project from active work. Its issues, documents, and history stay stored, and
              you can restore it later.
            </p>
          </div>
          <Button variant="secondary" onClick={() => setArchive(true)}>
            <Archive size={16} />
            Archive project
          </Button>
        </section>
      )}
      {invite && (
        <Modal
          title={`Add a member to ${project.name}`}
          onClose={() => {
            if (!busy) setInvite(false);
          }}
        >
          <form
            className="administration-form"
            onSubmit={async (e) => {
              e.preventDefault();
              const form = new FormData(e.currentTarget);
              setBusy(true);
              const result = await run(
                () =>
                  post(`/projects/${projectId}/members`, {
                    user_id: form.get('user_id'),
                    role: form.get('role'),
                  }),
                'Project member added.',
              );
              if (result) setInvite(false);
              setBusy(false);
            }}
          >
            <label>
              Workspace member
              <select name="user_id" required disabled={busy}>
                {available.map((member) => (
                  <option key={member.id} value={member.id}>
                    {member.name} · {member.email}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Project role
              <select name="role" defaultValue="member" disabled={busy}>
                <option value="member">Member — create and update work</option>
                <option value="viewer">Viewer — browse this project</option>
                <option value="admin">Project admin — manage settings and members</option>
              </select>
            </label>
            <p className="administration-form-help">
              Workspace owners and admins keep their administrative access. Workspace viewers remain
              unable to edit work.
            </p>
            <div className="administration-actions">
              <Button
                variant="secondary"
                type="button"
                disabled={busy}
                onClick={() => setInvite(false)}
              >
                Cancel
              </Button>
              <Button busy={busy}>Add to project</Button>
            </div>
          </form>
        </Modal>
      )}
      {remove && (
        <Confirm
          title="Remove project member?"
          text={`Remove ${remove.name} from this project? In a private project, this also removes access unless they are a workspace administrator or the lead.`}
          label="Remove member"
          onClose={() => setRemove(null)}
          confirm={async () => {
            if (
              await run(
                () => api(`/projects/${projectId}/members/${remove.id}`, { method: 'DELETE' }),
                'Project member removed.',
              )
            )
              setRemove(null);
          }}
        />
      )}
      {archive && (
        <Confirm
          title={`Archive ${project.name}?`}
          text="This project will leave your active workspace. You can bring it back from Administration → Archived projects."
          label="Archive project"
          onClose={() => setArchive(false)}
          confirm={async () => {
            if (await run(() => post(`/projects/${projectId}/archive`), 'Project archived.')) {
              setArchive(false);
              navigate('/administration');
            }
          }}
        />
      )}
    </div>
  );
}
