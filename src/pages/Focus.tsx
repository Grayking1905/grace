import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import {
  ArrowRight,
  Plus,
  Search,
  Users,
  CheckCircle2,
  Circle,
  FileText,
  CheckSquare,
  GitBranch,
  Layers,
  Bug,
  CalendarDays,
  Settings2,
} from 'lucide-react';
import type { Issue } from '../../shared/types';
import { canTeamCreate, type OrganizationWork } from '../../shared/organization';
import { useGrace } from '../context';
import { api, patch } from '../lib/api';
import { Avatar, AvatarGroup, Badge, Button, Empty, formatDate } from '../components/ui';
type Entry = { source: 'issue'; item: Issue } | { source: 'team'; item: OrganizationWork };
const workLabel = (item: OrganizationWork) =>
  item.kind === 'brd' ? 'BRD' : item.kind === 'daily' ? 'Daily task' : 'Version';
const entryType = (entry: Entry) =>
  entry.source === 'team'
    ? entry.item.kind
    : entry.item.type === 'bug'
      ? 'bug'
      : entry.item.type === 'story'
        ? 'feature'
        : 'issue';
export function useTeamWork(teamId?: string, mine = false) {
  const { data } = useGrace();
  const params = new URLSearchParams();
  if (teamId) params.set('team_id', teamId);
  if (mine) params.set('mine', 'true');
  return useQuery({
    queryKey: ['organization-work', data.workspace.id, teamId || 'all', mine],
    queryFn: () => api<OrganizationWork[]>(`/organization/work?${params}`),
  });
}
function makeEntries(issues: Issue[], work: OrganizationWork[]): Entry[] {
  return [
    ...issues.map((item) => ({ source: 'issue' as const, item })),
    ...work.map((item) => ({ source: 'team' as const, item })),
  ];
}
export function FocusWorkList({
  issues,
  work,
  personal = false,
  loading = false,
  error = null,
  retry = () => {},
  title = 'Work',
  showTypeFilter = true,
}: {
  issues: Issue[];
  work: OrganizationWork[];
  personal?: boolean;
  loading?: boolean;
  error?: Error | null;
  retry?: () => void;
  title?: string;
  showTypeFilter?: boolean;
}) {
  const { data, openIssue, openWork, run } = useGrace();
  const [search, setSearch] = useState('');
  const [type, setType] = useState('all');
  const [view, setView] = useState('open');
  const [pending, setPending] = useState<Set<string>>(() => new Set());
  const done = (entry: Entry) =>
    entry.source === 'issue'
      ? data.statuses.find((s) => s.id === entry.item.status_id)?.category === 'done'
      : entry.item.state === 'done';
  const entries = makeEntries(issues, work)
    .filter((entry) => {
      const value = entry.item;
      const created = entry.source === 'issue' ? entry.item.reporter_id : entry.item.created_by;
      const assigned = entry.source === 'issue' ? entry.item.assignee_id : entry.item.owner_id;
      if (personal && (view === 'created' ? created !== data.user.id : assigned !== data.user.id))
        return false;
      if (view === 'completed' ? !done(entry) : done(entry)) return false;
      const label =
        entry.source === 'issue' ? `${entry.item.key} ${entry.item.summary}` : entry.item.title;
      return (
        (type === 'all' || entryType(entry) === type) &&
        label.toLowerCase().includes(search.toLowerCase())
      );
    })
    .sort(
      (a, b) =>
        (a.item.due_date || '9999').localeCompare(b.item.due_date || '9999') ||
        b.item.updated_at.localeCompare(a.item.updated_at),
    );
  const complete = async (entry: Entry) => {
    setPending((previous) => new Set(previous).add(entry.item.id));
    try {
      if (entry.source === 'team')
        await run(
          () => patch(`/organization/work/${entry.item.id}`, { ...entry.item, state: 'done' }),
          'Task completed.',
        );
      else {
        const status = data.statuses.find(
          (s) => s.project_id === entry.item.project_id && s.category === 'done',
        );
        if (status)
          await run(
            () =>
              patch(`/issues/${entry.item.id}`, {
                status_id: status.id,
                version: entry.item.version,
              }),
            'Issue completed.',
          );
      }
    } finally {
      setPending((previous) => {
        const next = new Set(previous);
        next.delete(entry.item.id);
        return next;
      });
    }
  };
  const today = new Date().toLocaleDateString('en-CA');
  return (
    <section className="panel focus-work-list" aria-label={title}>
      <header className="focus-list-heading">
        <h2>
          {title}
          <Badge>{entries.length}</Badge>
        </h2>
        <span>{personal ? 'Assigned and created work' : 'Team priorities and deliverables'}</span>
      </header>
      <div className="focus-list-filters">
        <div className="search-field">
          <Search size={16} />
          <input
            aria-label="Search work"
            placeholder="Search by title or issue key…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        {showTypeFilter && (
          <label className="focus-filter">
            <span>Type</span>
            <select aria-label="Work type" value={type} onChange={(e) => setType(e.target.value)}>
              {[
                ['all', 'All types'],
                ['daily', 'Daily tasks'],
                ['issue', 'Issues'],
                ['bug', 'Bugs'],
                ['feature', 'Features'],
                ['brd', 'BRDs'],
                ['version', 'Versions'],
              ].map(([id, name]) => (
                <option key={id} value={id}>
                  {name}
                </option>
              ))}
            </select>
          </label>
        )}
        <label className="focus-filter">
          <span>View</span>
          <select aria-label="Work view" value={view} onChange={(e) => setView(e.target.value)}>
            <option value="open">{personal ? 'Assigned to me' : 'Open work'}</option>
            {personal && <option value="created">Created by me</option>}
            <option value="completed">Completed</option>
          </select>
        </label>
      </div>
      {error && (
        <div className="focus-query-error" role="alert">
          Team items could not be loaded. {error.message}
          <Button variant="secondary" onClick={retry}>
            Retry
          </Button>
        </div>
      )}
      {loading && (
        <div className="focus-loading" role="status">
          Loading team items…
        </div>
      )}
      <div className="focus-rows">
        {entries.map((entry) => {
          const value = entry.item;
          const isIssue = entry.source === 'issue';
          const title = isIssue ? entry.item.summary : entry.item.title;
          const label = isIssue
            ? entry.item.type === 'story'
              ? 'Feature'
              : entry.item.type === 'bug'
                ? 'Bug'
                : 'Issue'
            : workLabel(entry.item);
          const Icon = isIssue
            ? entry.item.type === 'bug'
              ? Bug
              : Layers
            : entry.item.kind === 'brd'
              ? FileText
              : entry.item.kind === 'version'
                ? GitBranch
                : CheckSquare;
          const status = isIssue
            ? data.statuses.find((s) => s.id === entry.item.status_id)?.name
            : entry.item.state === 'active'
              ? 'In progress'
              : entry.item.state === 'done'
                ? entry.item.kind === 'version'
                  ? 'Released'
                  : 'Done'
                : entry.item.state[0].toUpperCase() + entry.item.state.slice(1);
          const owner = data.members.find(
            (m) => m.id === (isIssue ? entry.item.assignee_id : entry.item.owner_id),
          );
          const canComplete =
            data.user.role !== 'viewer' &&
            !done(entry) &&
            (isIssue
              ? data.projects.find((p) => p.id === entry.item.project_id)?.can_write !== false &&
                data.statuses.some(
                  (s) => s.project_id === entry.item.project_id && s.category === 'done',
                )
              : entry.item.kind === 'daily' &&
                (!entry.item.project_id ||
                  data.projects.find((p) => p.id === entry.item.project_id)?.can_write !== false) &&
                canTeamCreate(data.organization, 'daily', entry.item.team_id) &&
                (data.organization?.can_admin ||
                  ['manager', 'lead'].includes(data.user.team_role || '') ||
                  entry.item.owner_id === data.user.id ||
                  entry.item.created_by === data.user.id));
          return (
            <article className="focus-work-row" key={`${entry.source}-${value.id}`}>
              {canComplete ? (
                <button
                  className="focus-complete"
                  aria-label={`Complete ${isIssue ? entry.item.key : title}`}
                  disabled={pending.has(value.id)}
                  onClick={() => void complete(entry)}
                >
                  <Circle size={20} />
                </button>
              ) : (
                <span className="focus-complete passive" aria-hidden="true">
                  {done(entry) ? <CheckCircle2 size={20} /> : <Icon size={19} />}
                </span>
              )}
              <button
                className="focus-open-work"
                aria-label={`Open ${isIssue ? entry.item.key : label}: ${title}`}
                onClick={() =>
                  isIssue
                    ? openIssue(value.id)
                    : openWork?.(entry.item.kind, entry.item.team_id, entry.item)
                }
              >
                <span className={`focus-type-icon ${entryType(entry)}`}>
                  <Icon size={17} />
                </span>
                <span className="focus-work-title">
                  <strong>{title}</strong>
                  <small>
                    {isIssue ? entry.item.key : label}
                    {!isIssue && entry.item.version_tag ? ` · ${entry.item.version_tag}` : ''}
                    {isIssue && data.projects.find((p) => p.id === entry.item.project_id)
                      ? ` · ${data.projects.find((p) => p.id === entry.item.project_id)?.name}`
                      : ''}
                  </small>
                </span>
                <span className="focus-work-meta">
                  <Badge
                    tone={done(entry) ? 'green' : status === 'In progress' ? 'lavender' : 'neutral'}
                  >
                    {status || 'To do'}
                  </Badge>
                  <span
                    className={`focus-due ${value.due_date && value.due_date < today && !done(entry) ? 'overdue' : ''}`}
                  >
                    {value.due_date ? (
                      <>
                        <CalendarDays size={13} />
                        {formatDate(value.due_date)}
                      </>
                    ) : (
                      <span>—</span>
                    )}
                  </span>
                  <Avatar user={owner} size={29} />
                  <ArrowRight size={16} />
                </span>
              </button>
            </article>
          );
        })}
      </div>
      {!entries.length && !loading && !error && (
        <Empty
          title={search || type !== 'all' ? 'No matching work' : 'You’re up to date'}
          text={
            search || type !== 'all'
              ? 'Try a different search or type.'
              : 'New assignments will appear here. Use Create to add work.'
          }
        />
      )}
    </section>
  );
}
export function OrganizationMyWork() {
  const { data, openWork } = useGrace();
  const work = useTeamWork(undefined, true);
  const today = new Date().toLocaleDateString('en-CA');
  const mine = makeEntries(
    data.issues.filter((i) => i.assignee_id === data.user.id),
    work.data?.filter((w) => w.owner_id === data.user.id) || [],
  ).filter((e) =>
    e.source === 'issue'
      ? data.statuses.find((s) => s.id === e.item.status_id)?.category !== 'done'
      : e.item.state !== 'done',
  );
  return (
    <div className="page focus-page">
      <div className="page-heading">
        <div>
          <h1>My work</h1>
          <p>Your tasks and project work, together in one place.</p>
        </div>
        {canTeamCreate(data.organization, 'daily') && data.user.role !== 'viewer' && (
          <Button variant="secondary" onClick={() => openWork?.('daily')}>
            <Plus size={16} />
            Add daily task
          </Button>
        )}
      </div>
      <div className="focus-summary">
        <div>
          <span className="summary-dot green" />
          <strong>{mine.length}</strong>
          <span>Open</span>
        </div>
        <div>
          <span className="summary-dot blue" />
          <strong>{mine.filter((e) => e.item.due_date === today).length}</strong>
          <span>Due today</span>
        </div>
        <div>
          <span className="summary-dot amber" />
          <strong>{mine.filter((e) => e.item.due_date && e.item.due_date < today).length}</strong>
          <span>Overdue</span>
        </div>
      </div>
      <FocusWorkList
        issues={data.issues}
        work={work.data || []}
        personal
        loading={work.isPending}
        error={work.error}
        retry={() => work.refetch()}
        title="Your work"
      />
    </div>
  );
}
export function TeamsDirectory() {
  const { data } = useGrace();
  const [search, setSearch] = useState('');
  const teams = data.organization?.teams || [];
  return (
    <div className="page focus-page">
      <div className="page-heading">
        <div>
          <h1>Teams</h1>
          <p>Choose a team to see its people and work.</p>
        </div>
        {data.organization?.can_admin && (
          <Link className="btn secondary" to="/organization">
            <Settings2 size={16} />
            Manage teams
          </Link>
        )}
      </div>
      <div className="search-field focus-team-search">
        <Search size={16} />
        <input
          aria-label="Find a team"
          placeholder="Find a team…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>
      <div className="focus-teams-grid">
        {teams
          .filter((t) => t.name.toLowerCase().includes(search.toLowerCase()))
          .map((t) => {
            const members = data.members.filter(
              (m) => m.team_id === t.id && m.active !== false && m.active !== 0,
            );
            return (
              <Link className="focus-team-card" to={`/teams/${t.id}`} key={t.id}>
                <span className="team-symbol" style={{ background: t.color }}>
                  <Users size={21} />
                </span>
                <div>
                  <h2>{t.name}</h2>
                  <p>{t.description}</p>
                  <small>
                    {members.length} {members.length === 1 ? 'person' : 'people'}
                  </small>
                </div>
                <ArrowRight size={18} />
              </Link>
            );
          })}
      </div>
      {!teams.filter((t) => t.name.toLowerCase().includes(search.toLowerCase())).length && (
        <Empty title="No teams found" text="Try another team name." />
      )}
    </div>
  );
}
