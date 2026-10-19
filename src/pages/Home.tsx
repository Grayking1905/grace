import { useState, useId } from 'react';
import { useQuery, useInfiniteQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import {
  AreaChart,
  Area,
  CartesianGrid,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
} from 'recharts';
import {
  ArrowRight,
  ArrowUpRight,
  RefreshCw,
  Users,
  CheckCircle2,
  FolderKanban,
  Activity,
  AlertCircle,
  Search,
  Settings2,
  LogIn,
  Clock3,
  Wifi,
  WifiOff,
  Flag,
  CheckSquare,
} from 'lucide-react';
import type { HomeOverview, HomeActivityPage, HomeProject, HomeEvent } from '../../shared/home';
import { teamRoleLabels } from '../../shared/organization';
import { useGrace } from '../context';
import { api } from '../lib/api';
import { Avatar, Badge, Button, Empty, Modal, relativeTime, formatDate } from '../components/ui';
import '../home.css';

const percent = (done: number, total: number) => (total ? Math.round((done / total) * 100) : 0);
const chartDate = (date: string) =>
  new Date(`${date}T12:00:00Z`).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  });
const actionText = (event: HomeEvent) => {
  const labels: Record<string, string> = {
    'auth.login': 'signed in',
    'auth.logout': 'signed out',
    'member.joined': 'joined the organization',
    'issue.created': 'created an issue',
    'bug.created': 'reported a bug',
    'feature.created': 'created a feature',
    'issue.status_id': 'changed the status of',
    'issue.assignee_id': 'reassigned',
    'issue.priority': 'changed the priority of',
    'issue.comment': 'commented on',
    'issue.summary': 'renamed',
    'issue.description': 'updated the description of',
    'issue.rank': 'reordered',
    'issue.deleted_at': 'changed the availability of',
    'issue.worklog': 'logged time on',
    'issue.attachment': 'added an attachment to',
    'issue.link': 'linked work to',
    'project.teams.assigned': 'updated team assignments for',
    'project.created': 'created a project',
    'project.updated': 'updated a project',
    'project.member.added': 'added a member to',
    'project.member.removed': 'removed a member from',
    'project.settings.updated': 'updated project settings for',
    'team.created': 'created a team',
    'team.updated': 'updated a team',
    'team.layout.updated': 'updated the dashboard for',
    'employee.assigned': 'updated the team role for',
    'brd.created': 'created a BRD',
    'brd.updated': 'updated a BRD',
    'daily.created': 'created a daily task',
    'daily.updated': 'updated a daily task',
    'version.created': 'created a version',
    'version.updated': 'updated a version',
    'page.created': 'created a document',
    'page.updated': 'updated a document',
    'comment.updated': 'edited a comment on',
    'comment.deleted': 'deleted a comment on',
    'standup.created': 'posted a check-in',
  };
  return (
    labels[event.action] ||
    `${event.action.split('.').at(-1)?.replaceAll('_', ' ')} ${event.entity_type === 'issue' ? 'work' : event.entity_type}`
  );
};
export function OrganizationHome() {
  const { data, connection = 'connecting', openIssue, refresh } = useGrace();
  const admin = !!data.organization?.can_admin;
  const [teamId, setTeamId] = useState('');
  const [projectId, setProjectId] = useState('');
  const [days, setDays] = useState('14');
  const [search, setSearch] = useState('');
  const [assignment, setAssignment] = useState<HomeProject | null>(null);
  const params = new URLSearchParams({ days });
  if (teamId && admin) params.set('team_id', teamId);
  if (projectId) params.set('project_id', projectId);
  const overview = useQuery({
    queryKey: ['home-overview', data.workspace.id, data.user.id, teamId, projectId, days],
    queryFn: () => api<HomeOverview>(`/organization/overview?${params}`),
    refetchInterval: 15000,
  });
  const home = overview.data;
  const ownTeam = data.organization?.teams.find((t) => t.id === data.user.team_id);
  const title = admin ? 'Organization overview' : `${ownTeam?.name || 'Your team'} overview`;
  const selectedTeam = admin ? teamId : data.user.team_id;
  const gradient = useId().replaceAll(':', '');
  const loading = (
    <div className="home-loading" role="status">
      <RefreshCw size={21} />
      Loading your overview…
    </div>
  );
  return (
    <div className="page home-page">
      <div className="page-heading">
        <div>
          <div className="home-kicker">
            <span className="home-workspace-dot" />
            {data.workspace.name}
            <span>/</span>
            {admin ? 'Organization' : 'My team'}
          </div>
          <h1>{title}</h1>
          <p>
            {admin
              ? 'A live picture of your teams, projects and progress.'
              : 'Your team’s projects, progress and recent activity, together.'}
          </p>
        </div>
        <div className="home-heading-actions">
          <span
            className={`home-live ${connection === 'connected' ? 'connected' : ''}`}
            role="status"
          >
            {connection === 'connected' ? <Wifi size={14} /> : <WifiOff size={14} />}{' '}
            {connection === 'connected'
              ? 'Live updates'
              : connection === 'connecting'
                ? 'Connecting…'
                : 'Auto-refresh · 15s'}
          </span>
          <Button
            variant="secondary"
            onClick={() => void refresh()}
            disabled={overview.isFetching}
            aria-label="Refresh overview"
          >
            <RefreshCw size={15} className={overview.isFetching ? 'home-spin' : ''} />
          </Button>
          <Link
            className="btn secondary"
            to={admin ? '/organization' : `/teams/${data.user.team_id}`}
          >
            <Settings2 size={15} />
            {admin ? 'Manage teams' : 'Open team'}
          </Link>
        </div>
      </div>
      <div className="home-filters">
        <div className="home-filter-controls">
          {admin && (
            <label>
              Team
              <select
                aria-label="Overview team"
                value={teamId}
                onChange={(e) => {
                  setTeamId(e.target.value);
                  setProjectId('');
                }}
              >
                <option value="">All teams</option>
                {data.organization?.teams.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
            </label>
          )}
          <label>
            Project
            <select
              aria-label="Overview project"
              value={projectId}
              onChange={(e) => setProjectId(e.target.value)}
            >
              <option value="">All projects</option>
              {(
                home?.available_projects ||
                (admin ? data.projects.filter((p) => !p.archived_at) : [])
              ).map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
        </div>
        <label className="home-period">
          Activity window
          <select
            aria-label="Overview period"
            value={days}
            onChange={(e) => setDays(e.target.value)}
          >
            <option value="7">Last 7 days</option>
            <option value="14">Last 14 days</option>
            <option value="30">Last 30 days</option>
          </select>
        </label>
      </div>
      {overview.error && (
        <div className="home-error" role="alert">
          <AlertCircle size={19} />
          <span>{overview.error.message}</span>
          <Button
            variant="secondary"
            onClick={() => {
              if (projectId) setProjectId('');
              else void overview.refetch();
            }}
          >
            {projectId ? 'Clear project filter' : 'Try again'}
          </Button>
        </div>
      )}
      {!home ? (
        overview.isPending ? (
          loading
        ) : null
      ) : (
        <>
          <section className="home-metrics" aria-label="Overview metrics">
            {[
              {
                label: 'Completed issues',
                value: `${percent(home.summary.completed, home.summary.total)}%`,
                detail: `${home.summary.completed} of ${home.summary.total} issues complete`,
                icon: CheckCircle2,
                tone: 'green',
              },
              {
                label: 'Active projects',
                value: home.summary.projects,
                detail: `Across ${home.teams.length} ${home.teams.length === 1 ? 'team' : 'teams'}`,
                icon: FolderKanban,
                tone: 'blue',
              },
              {
                label: 'Online now',
                value: home.summary.online,
                detail: `${home.summary.people} ${home.scope === 'team' ? 'active team' : 'organization'} ${home.summary.people === 1 ? 'member' : 'members'}`,
                icon: Users,
                tone: 'purple',
              },
              {
                label: 'Overdue work',
                value: home.summary.overdue + home.summary.team_work_overdue,
                detail: `${home.summary.overdue} issues · ${home.summary.team_work_overdue} team items`,
                icon: Clock3,
                tone: 'amber',
              },
            ].map((metric) => (
              <article className="panel home-metric" key={metric.label}>
                <div>
                  <span>{metric.label}</span>
                  <span className={`home-metric-icon ${metric.tone}`}>
                    <metric.icon size={19} />
                  </span>
                </div>
                <strong>{metric.value}</strong>
                <p>{metric.detail}</p>
              </article>
            ))}
          </section>
          <div className="home-chart-grid">
            <section className="panel home-chart-panel">
              <header>
                <div>
                  <h2>Delivery activity</h2>
                  <p>New issues and completed work over time</p>
                </div>
                <Badge>{home.days} days</Badge>
              </header>
              <div
                className="home-trend-chart"
                role="img"
                aria-label={`Issues created and completed over the last ${home.days} days. ${home.trend.reduce((n, d) => n + d.created, 0)} created and ${home.trend.reduce((n, d) => n + d.completed, 0)} completed.`}
              >
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart
                    data={home.trend}
                    margin={{ top: 12, right: 10, left: -22, bottom: 4 }}
                  >
                    <defs>
                      <linearGradient id={`${gradient}completed`} x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#4e9778" stopOpacity={0.22} />
                        <stop offset="100%" stopColor="#4e9778" stopOpacity={0.015} />
                      </linearGradient>
                      <linearGradient id={`${gradient}created`} x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#8ba4ca" stopOpacity={0.16} />
                        <stop offset="100%" stopColor="#8ba4ca" stopOpacity={0.01} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid stroke="#edf0eb" vertical={false} />
                    <XAxis
                      dataKey="date"
                      tickFormatter={chartDate}
                      tickLine={false}
                      axisLine={false}
                      minTickGap={38}
                      tick={{ fontSize: 12, fill: '#727c74' }}
                    />
                    <YAxis
                      allowDecimals={false}
                      tickLine={false}
                      axisLine={false}
                      tick={{ fontSize: 12, fill: '#727c74' }}
                    />
                    <Tooltip
                      labelFormatter={(value) => chartDate(String(value))}
                      contentStyle={{ border: '1px solid #e1e8df', borderRadius: 10, fontSize: 13 }}
                    />
                    <Area
                      name="Created"
                      type="monotone"
                      dataKey="created"
                      stroke="#8ba4ca"
                      strokeWidth={2.5}
                      fill={`url(#${gradient}created)`}
                      isAnimationActive={false}
                    />
                    <Area
                      name="Completed"
                      type="monotone"
                      dataKey="completed"
                      stroke="#448565"
                      strokeWidth={2.5}
                      fill={`url(#${gradient}completed)`}
                      isAnimationActive={false}
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
              <footer className="home-chart-legend">
                <span>
                  <i style={{ background: '#8ba4ca' }} />
                  Created <strong>{home.trend.reduce((n, d) => n + d.created, 0)}</strong>
                </span>
                <span>
                  <i style={{ background: '#448565' }} />
                  Completed <strong>{home.trend.reduce((n, d) => n + d.completed, 0)}</strong>
                </span>
                <small>Completed counts unique issues per day.</small>
              </footer>
            </section>
            <section className="panel home-chart-panel home-state-panel">
              <header>
                <div>
                  <h2>Work distribution</h2>
                  <p>Current project issue status</p>
                </div>
                <Activity size={19} />
              </header>
              <div className="home-donut">
                <div
                  className="home-donut-chart"
                  role="img"
                  aria-label={`${home.summary.completed} completed, ${home.summary.active} in progress, ${home.summary.todo} to do`}
                >
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={
                          home.summary.total
                            ? [
                                { name: 'Completed', value: home.summary.completed },
                                { name: 'In progress', value: home.summary.active },
                                { name: 'To do', value: home.summary.todo },
                              ]
                            : [{ name: 'No issues', value: 1 }]
                        }
                        dataKey="value"
                        innerRadius="71%"
                        outerRadius="94%"
                        startAngle={90}
                        endAngle={-270}
                        paddingAngle={home.summary.total ? 3 : 0}
                        stroke="none"
                        isAnimationActive={false}
                      >
                        {(home.summary.total ? ['#619477', '#bba9d0', '#dbe3d7'] : ['#e9ede6']).map(
                          (color) => (
                            <Cell key={color} fill={color} />
                          ),
                        )}
                      </Pie>
                      {home.summary.total > 0 && <Tooltip />}
                    </PieChart>
                  </ResponsiveContainer>
                  <div className="home-donut-label">
                    <strong>{home.summary.total}</strong>
                    <span>Total issues</span>
                  </div>
                </div>
                <div className="home-state-legend">
                  {[
                    { label: 'Completed', value: home.summary.completed, color: '#619477' },
                    { label: 'In progress', value: home.summary.active, color: '#bba9d0' },
                    { label: 'To do', value: home.summary.todo, color: '#dbe3d7' },
                  ].map((s) => (
                    <span key={s.label}>
                      <i style={{ background: s.color }} />
                      {s.label}
                      <strong>{s.value}</strong>
                    </span>
                  ))}
                </div>
              </div>
              <footer className="home-state-footer">
                <span>
                  <CheckSquare size={15} />
                  {home.summary.team_work_done}/{home.summary.team_work} team items complete
                </span>
                <span>
                  <Flag size={14} />
                  {home.summary.flagged} flagged
                </span>
              </footer>
            </section>
          </div>
          <div className="home-detail-grid">
            <div className="home-main-column">
              <section className="panel home-team-delivery">
                <header>
                  <div>
                    <h2>
                      {home.scope === 'organization' ? 'Team delivery' : 'Your team’s progress'}
                    </h2>
                    <p>Completed issues, active work and project coverage</p>
                  </div>
                  <Link to={admin ? '/teams' : `/teams/${data.user.team_id}`}>
                    View {admin ? 'teams' : 'team'} <ArrowUpRight size={15} />
                  </Link>
                </header>
                <div>
                  {home.teams.map((team) => (
                    <Link to={`/teams/${team.id}`} key={team.id} className="home-team-delivery-row">
                      <div className="home-team-name">
                        <span className="home-team-avatar" style={{ background: team.color }}>
                          <Users size={17} />
                        </span>
                        <span>
                          <strong>{team.name}</strong>
                          <small>
                            {team.people} {team.people === 1 ? 'person' : 'people'} ·{' '}
                            {team.projects} {team.projects === 1 ? 'project' : 'projects'}
                          </small>
                        </span>
                      </div>
                      <div className="home-team-progress">
                        <div>
                          <span>
                            {team.completed}/{team.total} complete
                          </span>
                          <strong>{percent(team.completed, team.total)}%</strong>
                        </div>
                        <div className="home-progress-track">
                          <span style={{ width: `${percent(team.completed, team.total)}%` }} />
                          <i style={{ width: `${percent(team.active, team.total)}%` }} />
                        </div>
                      </div>
                      <span className="home-team-open">
                        {team.total - team.completed} open<small>{team.online} online</small>
                      </span>
                      <ArrowRight size={15} />
                    </Link>
                  ))}
                </div>
              </section>
              <section className="panel home-project-panel">
                <header>
                  <div>
                    <h2>{admin ? 'Project overview' : 'Team & assigned projects'}</h2>
                    <p>
                      {home.scope === 'team'
                        ? 'Issue progress shown for this team.'
                        : 'Team ownership and current delivery progress.'}
                    </p>
                  </div>
                  <Link to="/projects">
                    All projects <ArrowUpRight size={15} />
                  </Link>
                </header>
                <div className="search-field home-project-search">
                  <Search size={16} />
                  <input
                    aria-label="Search overview projects"
                    placeholder="Find a project…"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                  />
                </div>
                <div>
                  {home.projects
                    .filter((p) =>
                      `${p.key} ${p.name}`.toLowerCase().includes(search.toLowerCase()),
                    )
                    .map((p) => (
                      <article key={p.id} className="home-project-row">
                        <div className="home-project-heading">
                          <Link to={`/projects/${p.id}/board`}>
                            <span className="home-project-symbol" style={{ background: p.color }}>
                              <FolderKanban size={18} />
                            </span>
                            <span>
                              <strong>{p.name}</strong>
                              <small>
                                {p.key} · {p.total} issues
                              </small>
                            </span>
                          </Link>
                          {admin && (
                            <button
                              className="home-assign-button"
                              aria-label={`Assign teams for ${p.name}`}
                              onClick={() => setAssignment(p)}
                            >
                              <Settings2 size={15} />
                              <span>Assign teams</span>
                            </button>
                          )}
                        </div>
                        <div className="home-project-teams">
                          {p.team_ids.length ? (
                            p.team_ids.map((id) => (
                              <Badge key={id}>
                                {data.organization?.teams.find((t) => t.id === id)?.name ||
                                  'Your team'}
                              </Badge>
                            ))
                          ) : (
                            <span className="home-unassigned">
                              {p.linked_team_ids.length
                                ? 'Linked through people or work'
                                : 'No team assigned'}
                            </span>
                          )}
                        </div>
                        <div className="home-project-progress">
                          <div className="home-progress-track">
                            <span style={{ width: `${percent(p.completed, p.total)}%` }} />
                          </div>
                          <strong>{percent(p.completed, p.total)}%</strong>
                        </div>
                        <footer>
                          <span>
                            {p.completed} complete · {p.active} in progress
                          </span>
                          <span className={p.overdue ? 'home-overdue' : ''}>
                            {p.overdue ? `${p.overdue} overdue` : 'No overdue issues'}
                          </span>
                        </footer>
                      </article>
                    ))}
                </div>
                {!home.projects.filter((p) =>
                  `${p.key} ${p.name}`.toLowerCase().includes(search.toLowerCase()),
                ).length && (
                  <Empty
                    title={search ? 'No matching projects' : 'No projects assigned yet'}
                    text={
                      search
                        ? 'Try another project name.'
                        : 'Projects appear when assigned to your team or its members, or linked through their work.'
                    }
                  />
                )}
              </section>
              <section className="panel home-attention">
                <header>
                  <div>
                    <h2>Needs attention</h2>
                    <p>Flagged, high-priority and overdue issues</p>
                  </div>
                  <Badge>{home.attention.length}</Badge>
                </header>
                {home.attention.map((issue) => (
                  <button key={issue.id} onClick={() => openIssue(issue.id)}>
                    <span className={`home-priority ${issue.flagged ? 'flagged' : ''}`}>
                      {issue.flagged ? <Flag size={16} /> : <AlertCircle size={16} />}
                    </span>
                    <span>
                      <strong>{issue.summary}</strong>
                      <small>
                        {issue.key} · {issue.priority} priority
                      </small>
                    </span>
                    <small
                      className={
                        issue.due_date && issue.due_date < new Date().toLocaleDateString('en-CA')
                          ? 'home-overdue'
                          : ''
                      }
                    >
                      {issue.due_date ? formatDate(issue.due_date) : 'No due date'}
                    </small>
                    <ArrowRight size={15} />
                  </button>
                ))}
                {!home.attention.length && (
                  <div className="home-clear">
                    <CheckCircle2 size={20} />
                    <span>No urgent issues in this overview.</span>
                  </div>
                )}
              </section>
            </div>
            <aside className="home-side-column">
              <HomeActivity
                teamId={selectedTeam}
                projectId={projectId}
                people={home.people}
                days={days}
              />
              <section className="panel home-people">
                <header>
                  <div>
                    <h2>{admin && !teamId ? 'Organization members' : 'Team members'}</h2>
                    <p>
                      {home.summary.online} online now · {home.summary.people}{' '}
                      {home.summary.people === 1 ? 'member' : 'members'}
                    </p>
                  </div>
                  <Users size={19} />
                </header>
                <div className="home-people-list">
                  {[...home.people]
                    .sort(
                      (a, b) => Number(b.online) - Number(a.online) || a.name.localeCompare(b.name),
                    )
                    .map((person) => (
                      <div className="home-person" key={person.id}>
                        <span className="home-presence-avatar">
                          <Avatar user={person} size={33} />
                          <i className={person.online ? 'online' : ''} />
                        </span>
                        <span>
                          <strong>{person.name}</strong>
                          <small>
                            {person.organization_role === 'owner'
                              ? 'Organization owner'
                              : person.organization_role === 'admin'
                                ? 'Organization admin'
                                : teamRoleLabels[person.team_role]}{' '}
                            · {person.open} open
                          </small>
                        </span>
                        <span
                          className={`home-person-state ${person.online ? 'online' : ''}`}
                          title={
                            person.last_login
                              ? `Last sign-in: ${new Date(person.last_login).toLocaleString()}`
                              : 'No recent sign-in recorded'
                          }
                        >
                          {person.online
                            ? 'Online'
                            : person.last_login
                              ? relativeTime(person.last_login)
                              : '—'}
                        </span>
                      </div>
                    ))}
                </div>
                <footer>Online means a connected Grace browser session.</footer>
              </section>
            </aside>
          </div>
          <div className="home-updated">
            <span className="connection-dot" />
            Updated{' '}
            {new Date(home.generated_at).toLocaleTimeString(undefined, {
              hour: '2-digit',
              minute: '2-digit',
            })}
            <span>Project permissions apply to all charts and activity.</span>
          </div>
        </>
      )}
      {assignment && <TeamAssignment project={assignment} onClose={() => setAssignment(null)} />}
    </div>
  );
}
function HomeActivity({
  teamId,
  projectId,
  people,
  days,
}: {
  teamId?: string;
  projectId: string;
  people: HomeOverview['people'];
  days: string;
}) {
  const { data, openIssue, openWork, connection } = useGrace();
  const [kind, setKind] = useState('all');
  const [actor, setActor] = useState('');
  const [opening, setOpening] = useState<string | null>(null);
  const { toast } = useGrace();
  const params = new URLSearchParams({ kind, limit: '15', days });
  if (teamId) params.set('team_id', teamId);
  if (projectId) params.set('project_id', projectId);
  if (actor && people.some((p) => p.id === actor)) params.set('actor_id', actor);
  const query = useInfiniteQuery({
    queryKey: [
      'home-activity',
      data.workspace.id,
      data.user.id,
      teamId,
      projectId,
      kind,
      actor,
      days,
    ],
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) =>
      api<HomeActivityPage>(
        `/organization/activity?${params}${pageParam ? `&cursor=${encodeURIComponent(pageParam)}` : ''}`,
      ),
    getNextPageParam: (last) => last.next_cursor,
    refetchInterval: 15000,
  });
  const entries = query.data?.pages.flatMap((p) => p.items) || [];
  const openRecord = async (event: HomeEvent) => {
    if (event.entity_type === 'issue') {
      openIssue(event.entity_id);
      return;
    }
    if (['daily', 'brd', 'version'].includes(event.entity_type)) {
      setOpening(event.id);
      try {
        const item = await api<import('../../shared/organization').OrganizationWork>(
          `/organization/work/${event.entity_id}`,
        );
        openWork?.(item.kind, item.team_id, item);
      } catch (error) {
        toast((error as Error).message, true);
      } finally {
        setOpening(null);
      }
    }
  };
  return (
    <section className="panel home-activity">
      <header>
        <div>
          <h2>Activity feed</h2>
          <p>
            {data.organization?.can_admin
              ? 'Sign-ins and changes as they happen'
              : 'Team and assigned-project activity'}
          </p>
        </div>
        <span
          className={`home-feed-indicator ${connection === 'connected' ? 'live' : ''}`}
          title={
            connection === 'connected' ? 'Connected to live updates' : 'Refreshes every 15 seconds'
          }
        >
          <i />
          {connection === 'connected' ? 'Live' : '15s'}
        </span>
      </header>
      <div className="home-feed-filters">
        <select aria-label="Activity type" value={kind} onChange={(e) => setKind(e.target.value)}>
          <option value="all">All activity</option>
          <option value="signins">Sign-ins & sign-outs</option>
          <option value="work">Work changes</option>
        </select>
        <select
          aria-label="Activity member"
          value={people.some((p) => p.id === actor) ? actor : ''}
          onChange={(e) => setActor(e.target.value)}
        >
          <option value="">All members</option>
          {people.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </div>
      <div
        className="home-feed-scroll"
        aria-label="Recent organization activity"
        aria-busy={query.isFetching}
      >
        {query.error && (
          <div className="home-feed-error" role="alert">
            <p>{query.error.message}</p>
            <Button variant="secondary" onClick={() => void query.refetch()}>
              Retry activity
            </Button>
          </div>
        )}
        {query.isPending && (
          <p className="home-feed-empty" role="status">
            Loading activity…
          </p>
        )}
        {entries.map((event) => {
          const signIn = ['auth.login', 'auth.logout', 'member.joined'].includes(event.action);
          const openable =
            ['issue', 'daily', 'brd', 'version'].includes(event.entity_type) &&
            !event.action.endsWith('.deleted') &&
            !event.action.endsWith('.deleted_at');
          const content = (
            <>
              <span className="home-feed-avatar">
                {signIn ? (
                  <span className="home-login-icon">
                    <LogIn size={17} />
                  </span>
                ) : (
                  <Avatar user={{ name: event.actor_name, color: event.actor_color }} size={31} />
                )}
              </span>
              <span className="home-feed-body">
                <span>
                  <strong>{event.actor_name}</strong> {actionText(event)}
                </span>
                {!signIn && <b>{event.title}</b>}
                <small>
                  <time
                    dateTime={event.created_at}
                    title={new Date(event.created_at).toLocaleString()}
                  >
                    {relativeTime(event.created_at)}
                  </time>
                  {event.project_id && data.projects.find((p) => p.id === event.project_id) && (
                    <span> · {data.projects.find((p) => p.id === event.project_id)?.key}</span>
                  )}
                </small>
              </span>
              {openable && <ArrowUpRight size={13} />}
            </>
          );
          return openable ? (
            <button
              className="home-feed-event"
              key={event.id}
              disabled={opening === event.id}
              onClick={() => void openRecord(event)}
            >
              {content}
            </button>
          ) : event.entity_type === 'project' &&
            data.projects.some((p) => p.id === event.entity_id) ? (
            <Link
              className="home-feed-event"
              key={event.id}
              to={`/projects/${event.entity_id}/board`}
            >
              {content}
            </Link>
          ) : event.entity_type === 'page' ? (
            <Link className="home-feed-event" key={event.id} to={`/pages/${event.entity_id}`}>
              {content}
            </Link>
          ) : (
            <div className="home-feed-event" key={event.id}>
              {content}
            </div>
          );
        })}
        {!entries.length && !query.isPending && !query.error && (
          <div className="home-feed-empty">
            <Activity size={23} />
            <strong>No activity in this view yet</strong>
            <p>Sign-ins and work changes will appear here. Try another filter.</p>
          </div>
        )}
      </div>
      {query.hasNextPage && (
        <button
          className="home-load-more"
          disabled={query.isFetchingNextPage}
          onClick={() => void query.fetchNextPage()}
        >
          {query.isFetchingNextPage ? 'Loading…' : 'Load earlier activity'}
        </button>
      )}
      <footer>Showing {entries.length} events · live updates with a 15-second fallback</footer>
    </section>
  );
}
function TeamAssignment({ project, onClose }: { project: HomeProject; onClose: () => void }) {
  const { data, run } = useGrace();
  const [selected, setSelected] = useState(project.team_ids);
  const [busy, setBusy] = useState(false);
  return (
    <Modal title={`Assign teams · ${project.name}`} onClose={onClose}>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          const result = await run(
            () =>
              api(`/projects/${project.id}/teams`, {
                method: 'PUT',
                body: JSON.stringify({ team_ids: selected, version: project.assignment_version }),
              }),
            'Project team assignments saved.',
          );
          setBusy(false);
          if (result) onClose();
        }}
      >
        <div className="modal-body">
          <p>
            Choose the teams responsible for this project. Project membership and private-project
            access are managed separately.
          </p>
          <fieldset className="home-assignment-options" disabled={busy}>
            <legend>Assigned teams</legend>
            {data.organization?.teams.map((team) => (
              <label key={team.id}>
                <input
                  type="checkbox"
                  checked={selected.includes(team.id)}
                  onChange={(e) =>
                    setSelected((previous) =>
                      e.target.checked
                        ? [...previous, team.id]
                        : previous.filter((id) => id !== team.id),
                    )
                  }
                />
                <span className="home-team-dot" style={{ background: team.color }} />
                {team.name}
              </label>
            ))}
          </fieldset>
          <small>
            You can leave the project unassigned. Existing issue and member assignments are
            preserved.
          </small>
        </div>
        <div className="modal-footer">
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" busy={busy}>
            Save team assignments
          </Button>
        </div>
      </form>
    </Modal>
  );
}
