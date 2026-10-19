import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  AreaChart,
  Area,
  BarChart,
  Bar,
  CartesianGrid,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  Legend,
} from 'recharts';
import {
  Plus,
  FileText,
  ArrowUpRight,
  ChevronRight,
  Check,
  Download,
  Save,
  History,
  Search,
  Users,
  Clock3,
  Target,
  Flag,
  MessageSquare,
  CalendarDays,
  Copy,
  Sparkles,
  SlidersHorizontal,
  Play,
  Trash2,
  X,
  CircleCheck,
  ArrowRight,
  CircleDashed,
} from 'lucide-react';
import type { Issue, Page, SavedView } from '../../shared/types';
import { useGrace } from '../context';
import { CopyButton } from '../components/CopyButton';
import { api, post, patch, download, exportIssues } from '../lib/api';
import {
  Avatar,
  AvatarGroup,
  Badge,
  Button,
  Empty,
  IconButton,
  Modal,
  PriorityIcon,
  formatDate,
  relativeTime,
} from '../components/ui';
import { Editor } from '../components/Editor';
import { IssueTable } from './Workspace';
export { SettingsPage } from './Settings';

export function PagesPage() {
  const { data, run } = useGrace();
  const { pageId } = useParams();
  const navigate = useNavigate();
  const [creating, setCreating] = useState(false);
  const [search, setSearch] = useState('');
  const page = data.pages.find((p) => p.id === pageId) || (pageId ? null : data.pages[0]);
  return (
    <div className="page pages-page">
      <div className="page-heading">
        <div>
          <span className="eyebrow">KEEP THE CONTEXT CLOSE</span>
          <h1>Documents</h1>
          <p>The plans, decisions, and little details that bring work to life.</p>
        </div>
        <Button onClick={() => setCreating(true)} disabled={data.user.role === 'viewer'}>
          <Plus size={15} />
          New page
        </Button>
      </div>
      <div className="pages-layout">
        <aside className="pages-sidebar">
          <div className="search-field">
            <Search size={14} />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Find a page…"
              aria-label="Find a page"
            />
          </div>
          <span className="eyebrow">WORKSPACE PAGES</span>
          {data.pages
            .filter((p) => p.title.toLowerCase().includes(search.toLowerCase()))
            .map((p) => (
              <Link key={p.id} className={page?.id === p.id ? 'active' : ''} to={`/pages/${p.id}`}>
                <FileText size={15} />
                <span>{p.title}</span>
                <ChevronRight size={12} />
              </Link>
            ))}
          <button
            className="add-page"
            onClick={() => setCreating(true)}
            disabled={data.user.role === 'viewer'}
          >
            <Plus size={14} />
            Add a page
          </button>
        </aside>
        {page ? (
          <PageEditor key={page.id} page={page} />
        ) : (
          <Empty
            title="A blank page. So much possibility."
            text="Make room for a plan, a decision, or your next good idea."
            action={
              <Button onClick={() => setCreating(true)}>
                <Plus size={14} />
                Create a page
              </Button>
            }
          />
        )}
      </div>
      {creating && (
        <Modal title="Make space for an idea" onClose={() => setCreating(false)}>
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              const body = Object.fromEntries(new FormData(e.currentTarget));
              const result = await run(
                () =>
                  post<{ id: string }>('/pages', {
                    ...body,
                    project_id: body.project_id || null,
                  }),
                'Your new page is ready.',
              );
              if (result) {
                setCreating(false);
                navigate(`/pages/${result.id}`);
              }
            }}
          >
            <div className="modal-body">
              <label>
                Page title
                <input
                  name="title"
                  required
                  maxLength={255}
                  autoFocus
                  placeholder="Give your idea a name"
                />
              </label>
              <label>
                Project
                <select name="project_id">
                  <option value="">Workspace page</option>
                  {data.projects.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <div className="modal-footer">
              <Button type="submit">Create page</Button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}
function PageEditor({ page }: { page: Page }) {
  const { data, run, toast } = useGrace();
  const [title, setTitle] = useState(page.title);
  const [content, setContent] = useState(page.content);
  const [baseline, setBaseline] = useState(page);
  const [saving, setSaving] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [restored, setRestored] = useState(0);
  const dirty = title !== baseline.title || content !== baseline.content;
  const canEdit =
    data.user.role !== 'viewer' &&
    (!page.project_id || data.projects.find((p) => p.id === page.project_id)?.can_write !== false);
  useEffect(() => {
    // Refetches may update clean documents, but must not advance a draft's edit
    // version or overwrite local typing when another member saves the page.
    if (!dirty && page.version !== baseline.version) {
      setTitle(page.title);
      setContent(page.content);
      setBaseline(page);
    }
  }, [page, baseline.version, dirty]);
  const versions = useQuery({
    queryKey: ['page-versions', page.id],
    queryFn: () => api<(Page & { created_at: string })[]>(`/pages/${page.id}/versions`),
    enabled: historyOpen,
  });
  const save = async () => {
    setSaving(true);
    const submittedTitle = title;
    const submittedContent = content;
    const result = await run(
      () =>
        patch<{ ok: true; page: Page }>(`/pages/${page.id}`, {
          title,
          content,
          version: baseline.version,
        }),
      'Page saved.',
    );
    if (result?.page) {
      setBaseline(result.page);
      // Use the canonical saved HTML while preserving edits made during save.
      setTitle((current) => (current === submittedTitle ? result.page.title : current));
      setContent((current) => (current === submittedContent ? result.page.content : current));
    }
    setSaving(false);
  };
  useEffect(() => {
    const before = (e: BeforeUnloadEvent) => {
      if (dirty) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', before);
    return () => window.removeEventListener('beforeunload', before);
  }, [dirty]);
  return (
    <article className="page-document panel">
      <header className="document-toolbar">
        <span>
          <FileText size={14} />
          {data.projects.find((p) => p.id === page.project_id)?.name || 'Workspace'}
          <ChevronRight size={12} />
          <span>Page</span>
        </span>
        <div>
          <small>{dirty ? 'Unsaved changes' : `Edited ${relativeTime(page.updated_at)}`}</small>
          <IconButton label="Page version history" onClick={() => setHistoryOpen(true)}>
            <History size={16} />
          </IconButton>
          <IconButton
            label="Download page as HTML"
            onClick={() =>
              download(
                `${title.replace(/[^a-z0-9]/gi, '-')}.html`,
                `<!doctype html><html><head><meta charset="utf-8"><title>${title.replace(/[<>&]/g, '')}</title></head><body>${content}</body></html>`,
                'text/html',
              )
            }
          >
            <Download size={16} />
          </IconButton>
          <Button busy={saving} disabled={!dirty || !canEdit || !title.trim()} onClick={save}>
            <Save size={14} />
            Save
          </Button>
        </div>
      </header>
      <div className="document-inner">
        <span className="document-page-icon">✳</span>
        <input
          className="document-title"
          aria-label="Page title"
          value={title}
          maxLength={255}
          disabled={!canEdit}
          onChange={(e) => setTitle(e.target.value)}
        />
        <div className="document-byline">
          <Avatar user={data.members.find((m) => m.id === page.author_id)} size={22} />
          <span>{data.members.find((m) => m.id === page.author_id)?.name}</span>
          <i />
          Version {page.version}
        </div>
        <Editor
          key={`${page.id}-${restored}`}
          content={content}
          onChange={setContent}
          editable={canEdit}
        />
      </div>
      {historyOpen && (
        <Modal title="Every idea has a history" onClose={() => setHistoryOpen(false)}>
          <div className="modal-body version-list">
            {versions.isPending ? (
              <p>Loading earlier versions…</p>
            ) : versions.error ? (
              <p className="form-error">{versions.error.message}</p>
            ) : versions.data?.length ? (
              versions.data.map((v) => (
                <div key={v.id}>
                  <History size={18} />
                  <div>
                    <strong>
                      Version {v.version} · {v.title}
                    </strong>
                    <p>
                      {formatDate(v.created_at, {
                        month: 'short',
                        day: 'numeric',
                        hour: 'numeric',
                        minute: '2-digit',
                      })}
                    </p>
                  </div>
                  <Button
                    variant="secondary"
                    disabled={!canEdit}
                    onClick={() => {
                      setTitle(v.title);
                      setContent(v.content);
                      setRestored((n) => n + 1);
                      setHistoryOpen(false);
                      toast('Earlier version loaded. Save to keep these changes.');
                    }}
                  >
                    Restore draft
                  </Button>
                </div>
              ))
            ) : (
              <Empty
                title="This is where it begins"
                text="Previous versions appear after your first edit."
              />
            )}
          </div>
        </Modal>
      )}
    </article>
  );
}

export function ReportsPage() {
  const { data } = useGrace();
  const [params] = useSearchParams();
  const [projectId, setProjectId] = useState(params.get('project') || 'all');
  const [days, setDays] = useState(14);
  const aggregate = useQuery({
    queryKey: ['report-summary', data.workspace.id, projectId, days],
    queryFn: () =>
      api<{
        summary: { total: number; completed: number; flagged: number };
        by_status: { status_id: string; count: number }[];
        by_assignee: { assignee_id: string; count: number; completed: number }[];
        time: { minutes: number };
        period: { completed: number; points: number };
        created: { date: string; count: number }[];
        completed: { date: string; count: number }[];
      }>(`/reports/summary?days=${days}${projectId === 'all' ? '' : `&project_id=${projectId}`}`),
  });
  const issues = data.issues.filter((i) => projectId === 'all' || i.project_id === projectId);
  const issueIds = new Set(issues.map((i) => i.id));
  const history = data.activity.filter((a) => issueIds.has(a.issue_id));
  const done = issues.filter(
    (i) => data.statuses.find((s) => s.id === i.status_id)?.category === 'done',
  );
  const since = Date.now() - days * 86400000;
  const recentlyDone = done.filter((i) =>
    history.some(
      (h) =>
        h.issue_id === i.id &&
        h.field === 'status_id' &&
        data.statuses.find((s) => s.id === h.new_value)?.category === 'done' &&
        Date.parse(h.created_at) >= since,
    ),
  );
  const flow = Array.from({ length: days }, (_, n) => {
    const d = new Date();
    d.setDate(d.getDate() - days + n + 1);
    const date = d.toISOString().slice(0, 10);
    return {
      date: formatDate(date, { month: 'short', day: 'numeric' }),
      created: aggregate.data
        ? aggregate.data.created.find((d) => d.date === date)?.count || 0
        : issues.filter((i) => i.created_at.slice(0, 10) === date).length,
      completed: aggregate.data
        ? aggregate.data.completed.find((d) => d.date === date)?.count || 0
        : history.filter(
            (h) =>
              h.field === 'status_id' &&
              data.statuses.find((s) => s.id === h.new_value)?.category === 'done' &&
              h.created_at.slice(0, 10) === date,
          ).length,
    };
  });
  const velocity = data.sprints
    .filter(
      (s) =>
        s.state === 'closed' &&
        (projectId === 'all' || s.project_id === projectId) &&
        Date.parse(s.end_date) >= since,
    )
    .map((s) => ({
      name: `${data.projects.find((p) => p.id === s.project_id)?.key} · ${s.name}`,
      committed: s.committed_points,
      completed: s.completed_points,
    }));
  const workload = data.members.map((m) => ({
    name: m.name.split(' ')[0],
    open: aggregate.data
      ? (aggregate.data.by_assignee.find((a) => a.assignee_id === m.id)?.count || 0) -
        (aggregate.data.by_assignee.find((a) => a.assignee_id === m.id)?.completed || 0)
      : issues.filter((i) => i.assignee_id === m.id && !done.some((d) => d.id === i.id)).length,
    done: aggregate.data
      ? aggregate.data.by_assignee.find((a) => a.assignee_id === m.id)?.completed || 0
      : done.filter((i) => i.assignee_id === m.id).length,
  }));
  const distribution = ['todo', 'active', 'done'].map((category, n) => ({
    name: ['To do', 'In progress', 'Done'][n],
    value: issues.filter(
      (i) => data.statuses.find((s) => s.id === i.status_id)?.category === category,
    ).length,
    color: ['#c2c5cc', '#b9a4d3', '#83ad94'][n],
  }));
  return (
    <div className="page reports-page">
      <div className="page-heading">
        <div>
          <span className="eyebrow">PROGRESS, WITH PERSPECTIVE</span>
          <h1>Reports</h1>
          <p>A clearer view of how your team is moving forward.</p>
        </div>
        <Button
          variant="secondary"
          onClick={() =>
            download(
              'grace-report.csv',
              [
                'Date,Created,Completed',
                ...flow.map((r) => `${r.date},${r.created},${r.completed}`),
              ].join('\r\n'),
              'text/csv',
            )
          }
        >
          <Download size={14} />
          Export report
        </Button>
      </div>
      <div className="report-filters">
        <select
          aria-label="Report project"
          value={projectId}
          onChange={(e) => setProjectId(e.target.value)}
        >
          <option value="all">All projects</option>
          {data.projects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
        <select
          aria-label="Report date range"
          value={days}
          onChange={(e) => setDays(Number(e.target.value))}
        >
          <option value={7}>Last 7 days</option>
          <option value={14}>Last 14 days</option>
          <option value={30}>Last 30 days</option>
          <option value={90}>Last 90 days</option>
        </select>
        <span>
          Charts reflect saved project activity.{' '}
          {aggregate.data
            ? `${(aggregate.data.time.minutes / 60).toFixed(1)} hours logged in this period.`
            : ''}
        </span>
      </div>
      {aggregate.error && (
        <p className="form-error" role="alert">
          Report totals could not be refreshed: {aggregate.error.message}
        </p>
      )}
      <div className="stat-grid">
        {[
          {
            label: 'Completed in this period',
            value: aggregate.data?.period.completed ?? recentlyDone.length,
            note: 'Issues moved to a done status',
            icon: CircleCheck,
          },
          {
            label: 'Points completed',
            value:
              aggregate.data?.period.points ?? recentlyDone.reduce((s, i) => s + i.story_points, 0),
            note: 'From work completed in this period',
            icon: Target,
          },
          {
            label: 'Open issues',
            value: aggregate.data
              ? aggregate.data.summary.total - aggregate.data.summary.completed
              : issues.length - done.length,
            note: 'Current work still to move forward',
            icon: CircleDashed,
          },
          {
            label: 'Flagged issues',
            value: aggregate.data?.summary.flagged ?? issues.filter((i) => i.flagged).length,
            note: 'Current blockers worth a closer look',
            icon: Flag,
          },
        ].map((s) => (
          <article className="stat-card" key={s.label}>
            <div>
              <span>{s.label}</span>
              <s.icon size={16} />
            </div>
            <strong>{s.value}</strong>
            <small>{s.note}</small>
          </article>
        ))}
      </div>
      <div className="report-grid">
        <section className="panel report-chart">
          <div className="panel-heading">
            <div>
              <h2>Created & completed</h2>
              <p>Daily flow through the workspace.</p>
            </div>
            <Badge>{days} days</Badge>
          </div>
          <ResponsiveContainer width="100%" height={250}>
            <AreaChart data={flow} margin={{ top: 15, right: 25, left: -15, bottom: 10 }}>
              <CartesianGrid vertical={false} stroke="#edf0ec" />
              <XAxis
                dataKey="date"
                tick={{ fontSize: 12 }}
                axisLine={false}
                tickLine={false}
                minTickGap={35}
              />
              <YAxis
                allowDecimals={false}
                tick={{ fontSize: 12 }}
                axisLine={false}
                tickLine={false}
              />
              <Tooltip contentStyle={{ borderRadius: 10, fontSize: 13 }} />
              <Legend iconType="circle" wrapperStyle={{ fontSize: 12 }} />
              <Area
                type="monotone"
                dataKey="created"
                name="Created"
                stroke="#aa93c6"
                fill="#f0eaf7"
              />
              <Area
                type="monotone"
                dataKey="completed"
                name="Completed"
                stroke="#6e9e82"
                fill="#e7f0e9"
              />
            </AreaChart>
          </ResponsiveContainer>
        </section>
        <section className="panel report-chart">
          <div className="panel-heading">
            <div>
              <h2>Sprint velocity</h2>
              <p>Committed and delivered story points.</p>
            </div>
          </div>
          {velocity.length ? (
            <ResponsiveContainer width="100%" height={250}>
              <BarChart data={velocity} margin={{ top: 15, right: 20, left: -15, bottom: 10 }}>
                <CartesianGrid vertical={false} stroke="#edf0ec" />
                <XAxis dataKey="name" tick={{ fontSize: 12 }} axisLine={false} tickLine={false} />
                <YAxis
                  allowDecimals={false}
                  tick={{ fontSize: 12 }}
                  axisLine={false}
                  tickLine={false}
                />
                <Tooltip contentStyle={{ borderRadius: 10, fontSize: 13 }} />
                <Legend iconType="circle" wrapperStyle={{ fontSize: 12 }} />
                <Bar dataKey="committed" name="Committed" fill="#d5c7e6" radius={[4, 4, 0, 0]} />
                <Bar dataKey="completed" name="Completed" fill="#87ad96" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <Empty
              title="A little more history to come"
              text="Completed sprints in this date range will appear here."
            />
          )}
        </section>
        <section className="panel report-chart">
          <div className="panel-heading">
            <div>
              <h2>Team workload</h2>
              <p>Current assignments, by person.</p>
            </div>
          </div>
          <ResponsiveContainer width="100%" height={250}>
            <BarChart data={workload} margin={{ top: 15, right: 20, left: -15, bottom: 10 }}>
              <CartesianGrid vertical={false} stroke="#edf0ec" />
              <XAxis dataKey="name" tick={{ fontSize: 12 }} axisLine={false} tickLine={false} />
              <YAxis
                allowDecimals={false}
                tick={{ fontSize: 12 }}
                axisLine={false}
                tickLine={false}
              />
              <Tooltip contentStyle={{ borderRadius: 10, fontSize: 13 }} />
              <Legend iconType="circle" wrapperStyle={{ fontSize: 12 }} />
              <Bar stackId="work" dataKey="done" name="Completed" fill="#a8c3af" />
              <Bar stackId="work" dataKey="open" name="Open" fill="#c3afda" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </section>
        <section className="panel report-chart">
          <div className="panel-heading">
            <div>
              <h2>Where work stands</h2>
              <p>Current issues by workflow category.</p>
            </div>
          </div>
          <ResponsiveContainer width="100%" height={250}>
            <PieChart>
              <Pie
                data={distribution.filter((d) => d.value)}
                dataKey="value"
                nameKey="name"
                innerRadius={63}
                outerRadius={87}
                paddingAngle={4}
              >
                {distribution
                  .filter((d) => d.value)
                  .map((d) => (
                    <Cell key={d.name} fill={d.color} />
                  ))}
              </Pie>
              <Tooltip contentStyle={{ borderRadius: 10, fontSize: 13 }} />
              <Legend iconType="circle" wrapperStyle={{ fontSize: 12 }} />
            </PieChart>
          </ResponsiveContainer>
        </section>
      </div>
    </div>
  );
}

export function TeamPage() {
  const { data, run } = useGrace();
  const [search, setSearch] = useState('');
  const admin = ['owner', 'admin'].includes(data.user.role);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteUrl, setInviteUrl] = useState('');
  return (
    <div className="page">
      <div className="page-heading">
        <div>
          <span className="eyebrow">GOOD WORK IS A TEAM SPORT</span>
          <h1>People</h1>
          <p>Different strengths. A shared direction.</p>
        </div>
        <div className="heading-actions">
          <Badge tone="green">
            <Users size={13} />
            {data.members.length} members
          </Badge>
          {admin && (
            <Button
              onClick={() => {
                setInviteUrl('');
                setInviteOpen(true);
              }}
            >
              <Plus size={14} />
              Invite member
            </Button>
          )}
        </div>
      </div>
      <div className="workspace-toolbar">
        <div className="tabs">
          <span className="directory-caption">Organization members</span>
        </div>
        <div className="search-field">
          <Search size={15} />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Find a teammate…"
            aria-label="Find a teammate"
          />
        </div>
      </div>
      <section className="panel team-table">
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Person</th>
                <th>Workspace role</th>
                <th>Open issues</th>
                <th>Completed issues</th>
                <th>Weekly capacity</th>
              </tr>
            </thead>
            <tbody>
              {data.members
                .filter((m) => `${m.name} ${m.email}`.toLowerCase().includes(search.toLowerCase()))
                .map((m) => {
                  const issues = data.issues.filter((i) => i.assignee_id === m.id);
                  const done = issues.filter(
                    (i) => data.statuses.find((s) => s.id === i.status_id)?.category === 'done',
                  ).length;
                  return (
                    <tr key={m.id}>
                      <td>
                        <div className="team-person">
                          <Avatar user={m} size={36} />
                          <div>
                            <strong>
                              {m.name}
                              {m.id === data.user.id && <small>you</small>}
                            </strong>
                            <span>{m.email}</span>
                          </div>
                        </div>
                      </td>
                      <td>
                        {m.role === 'owner' ? (
                          <Badge tone="green">Owner</Badge>
                        ) : (
                          <select
                            aria-label={`Role for ${m.name}`}
                            disabled={!admin}
                            value={m.role}
                            onChange={(e) =>
                              run(
                                () =>
                                  patch(`/members/${m.id}`, {
                                    role: e.target.value,
                                  }),
                                'Permissions updated.',
                              )
                            }
                          >
                            <option value="admin">Admin</option>
                            <option value="member">Member</option>
                            <option value="viewer">Viewer</option>
                          </select>
                        )}
                      </td>
                      <td>
                        <Badge>{issues.length - done}</Badge>
                      </td>
                      <td>{done}</td>
                      <td>
                        <div className="capacity-input">
                          <input
                            key={`${m.id}-${m.capacity}`}
                            aria-label={`Weekly capacity for ${m.name}`}
                            type="number"
                            min={0}
                            max={80}
                            defaultValue={m.capacity}
                            disabled={!admin && m.id !== data.user.id}
                            onBlur={(e) => {
                              if (Number(e.target.value) !== m.capacity)
                                run(
                                  () =>
                                    patch(`/members/${m.id}`, {
                                      capacity: Number(e.target.value),
                                    }),
                                  'Capacity updated.',
                                );
                            }}
                          />
                          <span>hours / week</span>
                        </div>
                      </td>
                    </tr>
                  );
                })}
            </tbody>
          </table>
        </div>
      </section>
      <div className="info-note">
        <Users size={17} />
        <p>
          Workspace roles apply on the server. Viewers can follow progress; members can create and
          update work; admins manage workspace settings and permissions.
        </p>
      </div>
      {inviteOpen && (
        <Modal title="Good work is better together" onClose={() => setInviteOpen(false)}>
          {inviteUrl ? (
            <div className="modal-body">
              <div className="invite-success">
                <Check size={22} />
                <h3>Your invitation is ready.</h3>
                <p>
                  Share this link with your teammate. It expires in 7 days and can only be accepted
                  by the invited email.
                </p>
              </div>
              <input
                className="invite-link"
                aria-label="Invitation link"
                readOnly
                value={inviteUrl}
                onFocus={(e) => e.target.select()}
              />
              <CopyButton text={inviteUrl} label="Copy invitation link" />
            </div>
          ) : (
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                const body = Object.fromEntries(new FormData(e.currentTarget));
                const result = await run(() => post<{ url: string }>('/invites', body));
                if (result) setInviteUrl(result.url);
              }}
            >
              <div className="modal-body">
                <label>
                  Team member email
                  <input name="email" type="email" required placeholder="teammate@company.com" />
                </label>
                <label>
                  Workspace role
                  <select name="role" defaultValue="member">
                    <option value="member">Member</option>
                    <option value="viewer">Viewer</option>
                    <option value="admin">Admin</option>
                  </select>
                </label>
                <p>
                  Share the invitation link with your teammate. Organization admins can also assign
                  an employee ID and team from Teams & roles.
                </p>
              </div>
              <div className="modal-footer">
                <Button type="submit">Create invitation link</Button>
              </div>
            </form>
          )}
        </Modal>
      )}
    </div>
  );
}

export function ManagerPage() {
  const { data: workspace, run, openIssue } = useGrace();
  const data = useMemo(() => {
    if (workspace.organization?.can_admin || !workspace.user.team_id) return workspace;
    const members = workspace.members.filter((m) => m.team_id === workspace.user.team_id);
    const ids = new Set(members.map((m) => m.id));
    return {
      ...workspace,
      members,
      issues: workspace.issues.filter((i) => ids.has(i.assignee_id || i.reporter_id)),
      standups: workspace.standups.filter((s) => ids.has(s.user_id)),
      risks: workspace.risks.filter((r) => ids.has(r.owner_id)),
    };
  }, [workspace]);
  const [tab, setTab] = useState('capacity');
  const [hoursPerPoint, setHoursPerPoint] = useState(4);
  const [standupOpen, setStandupOpen] = useState(false);
  const [riskOpen, setRiskOpen] = useState(false);
  const [days, setDays] = useState(7);
  const activeSprintIds = new Set(
    data.sprints.filter((s) => s.state === 'active').map((s) => s.id),
  );
  const activeIssues = data.issues.filter((i) => activeSprintIds.has(i.sprint_id || ''));
  const today = new Date().toISOString().slice(0, 10);
  const todayStandups = data.standups.filter((s) => s.created_at.slice(0, 10) === today);
  const stale = activeIssues.filter(
    (i) =>
      data.statuses.find((s) => s.id === i.status_id)?.category !== 'done' &&
      Date.now() - Date.parse(i.updated_at) > 3 * 86400000,
  );
  const digest = useMemo(() => {
    const since = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);
    const updated = data.issues.filter((i) => i.updated_at.slice(0, 10) >= since);
    const lines = (items: Issue[]) =>
      items.length
        ? items
            .map(
              (i) =>
                `- ${i.key}: ${i.summary}${i.assignee_id ? ` (${data.members.find((m) => m.id === i.assignee_id)?.name})` : ''}`,
            )
            .join('\n')
        : '- Nothing to report.';
    return `# ${data.workspace.name} · Weekly digest\n${formatDate(since)} – ${formatDate(today)}\n\n## Completed\n${lines(updated.filter((i) => data.statuses.find((s) => s.id === i.status_id)?.category === 'done'))}\n\n## In progress\n${lines(updated.filter((i) => data.statuses.find((s) => s.id === i.status_id)?.category === 'active'))}\n\n## Blocked work\n${lines(data.issues.filter((i) => i.flagged))}\n\n## Open risks\n${
      data.risks
        .filter((r) => r.state === 'open')
        .map((r) => `- [${r.severity}] ${r.title}`)
        .join('\n') || '- No open risks.'
    }\n`;
  }, [data, days, today]);
  const [digestText, setDigestText] = useState(digest);
  useEffect(() => setDigestText(digest), [digest]);
  return (
    <div className="page manager-page">
      <div className="page-heading">
        <div>
          <span className="eyebrow">LOOK AFTER THE WORK. AND THE PEOPLE.</span>
          <h1>Team planning</h1>
          <p>Stay close to your team, without getting in their way.</p>
        </div>
        <Badge tone="lavender">
          <Sparkles size={12} />
          Capacity & check-ins
        </Badge>
      </div>
      <div className="manager-summary">
        <div>
          <Users size={18} />
          <span>
            Team members<strong>{data.members.length}</strong>
          </span>
        </div>
        <div>
          <Target size={18} />
          <span>
            Active sprint scope
            <strong>
              {activeIssues.reduce((s, i) => s + i.story_points, 0)} <small>points</small>
            </strong>
          </span>
        </div>
        <div>
          <MessageSquare size={18} />
          <span>
            Today’s check-ins
            <strong>
              {new Set(todayStandups.map((s) => s.user_id)).size}
              <small> / {data.members.length}</small>
            </strong>
          </span>
        </div>
        <div>
          <Flag size={18} />
          <span>
            Open risks
            <strong>{data.risks.filter((r) => r.state === 'open').length}</strong>
          </span>
        </div>
      </div>
      <div className="tabs standalone">
        {[
          ['capacity', 'Capacity'],
          ['standups', 'Standups'],
          ['risks', 'Risks & blockers'],
          ['digest', 'Weekly digest'],
        ].map(([id, label]) => (
          <button className={tab === id ? 'active' : ''} key={id} onClick={() => setTab(id)}>
            {label}
          </button>
        ))}
      </div>
      {tab === 'capacity' ? (
        <>
          <div className="section-heading">
            <div>
              <h2>Make space before making plans.</h2>
              <p>Estimated load across active sprints, against two weeks of capacity.</p>
            </div>
            <label className="inline-field">
              Planning estimate
              <input
                type="number"
                min={1}
                max={16}
                value={hoursPerPoint}
                onChange={(e) =>
                  setHoursPerPoint(Math.max(1, Math.min(16, Number(e.target.value))))
                }
              />
              <span>hours / point</span>
            </label>
          </div>
          <section className="panel capacity-table">
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Team member</th>
                    <th>Active sprint points</th>
                    <th>Estimated work</th>
                    <th>Two-week capacity</th>
                    <th>Planned load</th>
                  </tr>
                </thead>
                <tbody>
                  {data.members.map((m) => {
                    const points = activeIssues
                      .filter(
                        (i) =>
                          i.assignee_id === m.id &&
                          data.statuses.find((s) => s.id === i.status_id)?.category !== 'done',
                      )
                      .reduce((s, i) => s + i.story_points, 0);
                    const estimated = points * hoursPerPoint;
                    const percent = m.capacity
                      ? Math.round((estimated / (m.capacity * 2)) * 100)
                      : estimated
                        ? 100
                        : 0;
                    return (
                      <tr key={m.id}>
                        <td>
                          <div className="team-person">
                            <Avatar user={m} size={32} />
                            <strong>{m.name}</strong>
                          </div>
                        </td>
                        <td>{points} pts</td>
                        <td>{estimated}h</td>
                        <td>{m.capacity * 2}h</td>
                        <td>
                          <div className={`capacity-bar ${percent > 100 ? 'over' : ''}`}>
                            <div>
                              <span style={{ width: `${Math.min(100, percent)}%` }} />
                            </div>
                            <strong>{percent}%</strong>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>
          <div className="info-note">
            <Clock3 size={17} />
            <p>
              This is a planning estimate using {hoursPerPoint} hours per story point and two weeks
              of capacity. Completed work is excluded. Set each person’s weekly availability on the{' '}
              <Link to="/team">Team page</Link>.
            </p>
          </div>
        </>
      ) : tab === 'standups' ? (
        <>
          <div className="section-heading">
            <div>
              <h2>A quick check-in. A clearer day.</h2>
              <p>
                {formatDate(today, {
                  weekday: 'long',
                  month: 'long',
                  day: 'numeric',
                })}
              </p>
            </div>
            <Button onClick={() => setStandupOpen(true)} disabled={data.user.role === 'viewer'}>
              <Plus size={15} />
              Add check-in
            </Button>
          </div>
          <div className="standup-grid">
            {data.members.map((m) => {
              const entry = todayStandups.find((s) => s.user_id === m.id);
              return (
                <article className="panel standup-card" key={m.id}>
                  <header>
                    <Avatar user={m} size={32} />
                    <strong>{m.name}</strong>
                    <Badge tone={entry ? 'green' : 'neutral'}>
                      {entry ? 'Checked in' : 'Not yet'}
                    </Badge>
                  </header>
                  {entry ? (
                    <>
                      <h4>YESTERDAY</h4>
                      <p>{entry.yesterday || '—'}</p>
                      <h4>TODAY</h4>
                      <p>{entry.today}</p>
                      <h4>BLOCKERS</h4>
                      <p className={entry.blockers ? 'blocker-text' : ''}>
                        {entry.blockers || 'A clear path ahead.'}
                      </p>
                    </>
                  ) : (
                    <p className="detail-hint">A little update can go a long way.</p>
                  )}
                </article>
              );
            })}
          </div>
          {stale.length > 0 && (
            <section className="panel stale-panel">
              <h3>
                <Clock3 size={16} />
                Worth a quick check
              </h3>
              <p>These active sprint issues haven’t been updated in more than 3 days.</p>
              {stale.map((i) => (
                <button key={i.id} onClick={() => openIssue(i.id)}>
                  <span>{i.key}</span>
                  {i.summary}
                  <ArrowUpRight size={13} />
                </button>
              ))}
            </section>
          )}
        </>
      ) : tab === 'risks' ? (
        <>
          <div className="section-heading">
            <div>
              <h2>Spot the bumps before they become blockers.</h2>
              <p>Make risks visible and give each one a way forward.</p>
            </div>
            <Button onClick={() => setRiskOpen(true)} disabled={data.user.role === 'viewer'}>
              <Plus size={15} />
              Add a risk
            </Button>
          </div>
          <section className="panel risk-list">
            {data.risks.length ? (
              data.risks.map((r) => (
                <article key={r.id}>
                  <span className={`risk-symbol ${r.severity}`}>
                    <Flag size={18} />
                  </span>
                  <div>
                    <h3>{r.title}</h3>
                    <p>
                      {data.projects.find((p) => p.id === r.project_id)?.name || 'Workspace'}
                      <span>·</span>
                      {data.members.find((m) => m.id === r.owner_id)?.name}
                    </p>
                  </div>
                  <Badge tone={['high', 'critical'].includes(r.severity) ? 'rose' : 'amber'}>
                    {r.severity}
                  </Badge>
                  <select
                    aria-label={`State of ${r.title}`}
                    disabled={data.user.role === 'viewer'}
                    value={r.state}
                    onChange={(e) =>
                      run(() => patch(`/risks/${r.id}`, { state: e.target.value }), 'Risk updated.')
                    }
                  >
                    <option value="open">Open</option>
                    <option value="mitigated">Mitigated</option>
                    <option value="closed">Closed</option>
                  </select>
                </article>
              ))
            ) : (
              <Empty
                title="A clear path ahead"
                text="Keep emerging risks here so the team can work through them together."
              />
            )}
          </section>
        </>
      ) : (
        <>
          <div className="section-heading">
            <div>
              <h2>The week, in a few thoughtful words.</h2>
              <p>Review, edit, and share a digest of your team’s work.</p>
            </div>
            <div className="heading-actions">
              <select
                className="compact-select"
                value={days}
                onChange={(e) => setDays(Number(e.target.value))}
              >
                <option value={7}>Last 7 days</option>
                <option value={14}>Last 14 days</option>
                <option value={30}>Last 30 days</option>
              </select>
              <CopyButton text={digestText} label="Copy digest" />
              <Button onClick={() => download('grace-weekly-digest.md', digestText)}>
                <Download size={14} />
                Download
              </Button>
            </div>
          </div>
          <textarea
            className="digest-editor"
            value={digestText}
            onChange={(e) => setDigestText(e.target.value)}
            aria-label="Weekly digest Markdown"
            spellCheck={false}
          />
        </>
      )}
      {standupOpen && (
        <Modal title="A little update from you" onClose={() => setStandupOpen(false)}>
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              const body = Object.fromEntries(new FormData(e.currentTarget));
              const result = await run(() => post('/standups', body), 'Check-in shared.');
              if (result) setStandupOpen(false);
            }}
          >
            <div className="modal-body">
              <label>
                What moved forward yesterday?
                <textarea name="yesterday" rows={2} maxLength={4000} />
              </label>
              <label>
                What’s your focus today?
                <textarea name="today" rows={3} required maxLength={4000} />
              </label>
              <label>
                Anything in the way?
                <textarea
                  name="blockers"
                  rows={2}
                  maxLength={4000}
                  placeholder="A clear path ahead? Leave this blank."
                />
              </label>
            </div>
            <div className="modal-footer">
              <Button type="submit">Share check-in</Button>
            </div>
          </form>
        </Modal>
      )}
      {riskOpen && (
        <Modal title="Make a risk visible" onClose={() => setRiskOpen(false)}>
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              const body = Object.fromEntries(new FormData(e.currentTarget));
              const result = await run(
                () =>
                  post('/risks', {
                    ...body,
                    project_id: body.project_id || null,
                  }),
                'Risk added.',
              );
              if (result) setRiskOpen(false);
            }}
          >
            <div className="modal-body">
              <label>
                What should the team know?
                <input name="title" required maxLength={255} placeholder="Describe the risk" />
              </label>
              <div className="form-row">
                <label>
                  Severity
                  <select name="severity">
                    <option value="low">Low</option>
                    <option value="medium">Medium</option>
                    <option value="high">High</option>
                    <option value="critical">Critical</option>
                  </select>
                </label>
                <label>
                  Project
                  <select name="project_id">
                    <option value="">Workspace</option>
                    {data.projects.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
            </div>
            <div className="modal-footer">
              <Button type="submit">Add risk</Button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}

export function ViewsPage() {
  const { data, run } = useGrace();
  const { viewId } = useParams();
  const navigate = useNavigate();
  const selected = data.views.find((v) => v.id === viewId);
  const routeKey = `${data.workspace.id}:${viewId || ''}`;
  const [queryState, setQueryState] = useState(() => ({
    routeKey,
    draft: selected?.query || '',
    applied: selected?.query || '',
    revision: 0,
  }));
  const [resultState, setResultState] = useState<{
    routeKey: string;
    query: string;
    rows: Issue[];
  }>({ routeKey, query: queryState.applied, rows: [] });
  const query = queryState.draft;
  const results =
    resultState.routeKey === routeKey && resultState.query === queryState.applied
      ? resultState.rows
      : [];
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [saveMode, setSaveMode] = useState<'new' | 'update' | null>(null);
  const [saving, setSaving] = useState(false);
  const [help, setHelp] = useState(false);
  const requestVersion = useRef(0);
  const currentRoute = useRef(routeKey);
  currentRoute.current = routeKey;
  const savedQuery = selected?.query || '';
  const canManage =
    data.user.role !== 'viewer' &&
    !!selected &&
    (selected.owner_id === data.user.id || ['owner', 'admin'].includes(data.user.role));

  // Route changes choose a new initial query. Background data refreshes preserve the editor draft.
  useEffect(() => {
    setQueryState((current) =>
      current.routeKey === routeKey
        ? current
        : { routeKey, draft: savedQuery, applied: savedQuery, revision: 0 },
    );
    setSaveMode(null);
    setError('');
  }, [routeKey]);

  // Re-run the last applied query when work changes, without applying unsaved editor text.
  useEffect(() => {
    if (queryState.routeKey !== routeKey || (viewId && !selected)) return;
    const controller = new AbortController();
    const version = ++requestVersion.current;
    const active = () =>
      !controller.signal.aborted &&
      version === requestVersion.current &&
      currentRoute.current === routeKey;
    setBusy(true);
    api<Issue[]>('/search/gql', {
      method: 'POST',
      body: JSON.stringify({ query: queryState.applied }),
      signal: controller.signal,
    })
      .then((rows) => {
        if (active()) {
          setResultState({ routeKey, query: queryState.applied, rows });
          setError('');
        }
      })
      .catch((e) => {
        if (active()) {
          setError(e.message);
          setResultState({ routeKey, query: queryState.applied, rows: [] });
        }
      })
      .finally(() => {
        if (active()) setBusy(false);
      });
    return () => controller.abort();
  }, [
    queryState.applied,
    queryState.routeKey,
    queryState.revision,
    routeKey,
    data.issues,
    !!selected,
  ]);
  const execute = (event: FormEvent) => {
    event.preventDefault();
    setError('');
    setQueryState((current) => ({
      ...current,
      applied: current.draft,
      revision: current.revision + 1,
    }));
  };
  if (viewId && !selected)
    return (
      <div className="page">
        <Empty
          title="This view isn’t available"
          text="It may have been removed or made private."
          action={
            <Link className="btn secondary" to="/views">
              Back to views
            </Link>
          }
        />
      </div>
    );
  return (
    <div className="page">
      <div className="page-heading">
        <div>
          <span className="eyebrow">A DIFFERENT LENS. THE SAME GOOD WORK.</span>
          <h1>{selected?.name || 'Saved views'}</h1>
          <p>Find your focus with Grace Query Language and saved views.</p>
        </div>
        <div className="heading-actions">
          <Button variant="secondary" onClick={() => exportIssues(results, 'csv')} disabled={busy}>
            <Download size={14} />
            Export
          </Button>
          {canManage && (
            <Button variant="secondary" onClick={() => setSaveMode('update')}>
              <Save size={14} />
              Update view
            </Button>
          )}
          <Button onClick={() => setSaveMode('new')} disabled={data.user.role === 'viewer'}>
            <Save size={14} />
            {selected ? 'Save as new' : 'Save view'}
          </Button>
        </div>
      </div>
      <div className="saved-view-bar">
        <Link to="/views" className={!viewId ? 'active' : ''}>
          <LayersIcon />
          All work
        </Link>
        {data.views.map((v) => (
          <Link key={v.id} to={`/views/${v.id}`} className={viewId === v.id ? 'active' : ''}>
            <SlidersHorizontal size={14} />
            {v.name}
            {v.sharing === 'private' && <small>Private</small>}
          </Link>
        ))}
      </div>
      <form className="query-builder" onSubmit={execute}>
        <span className="query-label">GQL</span>
        <input
          aria-label="Grace Query Language"
          placeholder="project = GRC AND priority in ('high', 'critical') ORDER BY priority DESC"
          value={query}
          onChange={(e) => setQueryState((current) => ({ ...current, draft: e.target.value }))}
          spellCheck={false}
          maxLength={4000}
        />
        <Button type="submit" busy={busy}>
          <Play size={13} />
          Run query
        </Button>
      </form>
      {error && (
        <div className="form-error" role="alert">
          {error}
        </div>
      )}
      <div className="query-help-bar">
        <span aria-live="polite">
          {busy ? 'Refreshing results…' : `${results.length} matching issues`}
          {query !== queryState.applied ? ' · Draft changes — run your query to apply' : ''}
        </span>
        <button onClick={() => setHelp(!help)}>
          {help ? 'Hide syntax guide' : 'A little help with GQL'}
          <ChevronRight size={13} />
        </button>
        {canManage && selected && (
          <button
            className="delete-view"
            onClick={async () => {
              const result = await run(
                () => api(`/views/${selected.id}`, { method: 'DELETE' }),
                'View removed.',
              );
              if (result) navigate('/views');
            }}
          >
            <Trash2 size={13} />
            Delete view
          </button>
        )}
      </div>
      {help && (
        <div className="query-guide panel">
          <h3>Find exactly what you need.</h3>
          <p>
            Combine fields using AND, OR, NOT, and parentheses. Supported fields: project, status,
            assignee, reporter, priority, type, label, sprint, points, due, key, summary, text,
            flagged.
          </p>
          <code>assignee = currentUser() AND status != 'Done'</code>
          <code>priority in ('critical', 'high') ORDER BY points DESC</code>
          <code>due &lt; now() AND sprint in (openSprints())</code>
          <p>
            Use =, !=, ~ (contains), in, not in, is empty, is not empty, &gt;, &lt;, &gt;=, &lt;=.
            Functions: currentUser(), openSprints(), now(), startOfWeek().
          </p>
        </div>
      )}
      <section className="panel">
        <IssueTable issues={results} />
      </section>
      {saveMode && (
        <Modal
          title={saveMode === 'update' ? 'Update this view' : 'Keep this perspective'}
          onClose={() => {
            if (!saving) setSaveMode(null);
          }}
        >
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              const values = Object.fromEntries(new FormData(e.currentTarget));
              const updating = saveMode === 'update' && selected;
              const savedRoute = routeKey;
              const draft = query;
              setSaving(true);
              const result = await run(
                () =>
                  updating
                    ? patch<SavedView>(`/views/${selected.id}`, { ...values, query: draft })
                    : post<SavedView>('/views', { ...values, query: draft }),
                updating ? 'View updated.' : 'View saved.',
              );
              setSaving(false);
              if (currentRoute.current !== savedRoute) return;
              if (result) {
                setSaveMode(null);
                if (updating)
                  setQueryState((current) => ({
                    ...current,
                    applied: draft,
                    revision: current.revision + 1,
                  }));
                else navigate(`/views/${result.id}`);
              }
            }}
          >
            <div className="modal-body">
              <label>
                View name
                <input
                  name="name"
                  required
                  maxLength={120}
                  autoFocus
                  placeholder="e.g. Launch priorities"
                  defaultValue={saveMode === 'update' ? selected?.name : ''}
                  disabled={saving}
                />
              </label>
              <label>
                Share with
                <select
                  name="sharing"
                  defaultValue={saveMode === 'update' ? selected?.sharing : 'private'}
                  disabled={saving}
                >
                  <option value="private">Just me</option>
                  <option value="workspace">Workspace</option>
                </select>
              </label>
              <div className="saved-query-preview">{query || 'All work'}</div>
            </div>
            <div className="modal-footer">
              <Button
                type="button"
                variant="secondary"
                onClick={() => setSaveMode(null)}
                disabled={saving}
              >
                Cancel
              </Button>
              <Button type="submit" busy={saving}>
                {saveMode === 'update' ? 'Update view' : 'Save view'}
              </Button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}
function LayersIcon() {
  return <SlidersHorizontal size={14} />;
}
