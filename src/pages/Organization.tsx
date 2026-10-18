import { useState, type FormEvent, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, Navigate, useParams } from 'react-router-dom';
import {
  ArrowUpRight,
  Bug,
  CalendarDays,
  CheckSquare,
  ChevronRight,
  FileText,
  GitBranch,
  LayoutDashboard,
  Plus,
  Search,
  Settings2,
  ShieldCheck,
  Sparkles,
  Users,
} from 'lucide-react';
import type { Issue, User } from '../../shared/types';
import {
  canTeamCreate,
  dashboardSections,
  defaultTeamPermissions,
  teamCapabilities,
  workKindLabels,
  type DashboardSection,
  type EmployeeProfile,
  type OrganizationTeam,
  type OrganizationWork,
  type OrganizationWorkKind,
  type TeamPermissions,
} from '../../shared/organization';
import { useGrace } from '../context';
import { api, patch, post } from '../lib/api';
import {
  Avatar,
  AvatarGroup,
  Badge,
  Button,
  Empty,
  Modal,
  PriorityIcon,
  StatusPill,
  TypeIcon,
  formatDate,
} from '../components/ui';
import { IssueTable } from './Workspace';
import '../organization.css';

const sectionNames: Record<DashboardSection, string> = {
  issues: 'Issues',
  bugs: 'Bugs',
  features: 'Features',
  brds: 'BRDs',
  daily: 'Daily tasks',
  versions: 'Versions',
};
const kindSection: Record<OrganizationWorkKind, DashboardSection> = {
  brd: 'brds',
  daily: 'daily',
  version: 'versions',
};
const kindIcons = { brd: FileText, daily: CheckSquare, version: GitBranch };
const stateLabel = (item: OrganizationWork) =>
  item.state === 'active'
    ? 'In progress'
    : item.state === 'done'
      ? item.kind === 'version'
        ? 'Released'
        : 'Done'
      : item.state[0].toUpperCase() + item.state.slice(1);
function useOrganizationWork(teamId?: string, mine = false) {
  const { data } = useGrace();
  const query = new URLSearchParams();
  if (teamId) query.set('team_id', teamId);
  if (mine) query.set('mine', 'true');
  return useQuery({
    queryKey: ['organization-work', data.workspace.id, teamId || 'all', mine],
    queryFn: () => api<OrganizationWork[]>(`/organization/work?${query}`),
  });
}
function QueryState({ error, retry }: { error: Error | null; retry: () => void }) {
  return error ? (
    <div className="panel organization-error" role="alert">
      <p>{error.message}</p>
      <Button variant="secondary" onClick={retry}>
        Try again
      </Button>
    </div>
  ) : (
    <div className="skeleton organization-skeleton" aria-label="Loading team work" />
  );
}
function Metric({
  label,
  value,
  icon,
  tone = 'sage',
}: {
  label: string;
  value: number | string;
  icon: ReactNode;
  tone?: string;
}) {
  return (
    <div className={`organization-metric ${tone}`}>
      <span>{icon}</span>
      <div>
        <strong>{value}</strong>
        <small>{label}</small>
      </div>
    </div>
  );
}
export function OrganizationHome() {
  const { data, openCreateMenu } = useGrace();
  const organization = data.organization;
  const work = useOrganizationWork();
  if (organization && !organization.can_admin)
    return <Navigate to={`/teams/${organization.employee.team_id}`} replace />;
  const teams = organization?.teams || [];
  const activeMembers = data.members.filter((m) => m.active !== false && m.active !== 0);
  const openIssues = data.issues.filter(
    (i) => data.statuses.find((s) => s.id === i.status_id)?.category !== 'done',
  );
  return (
    <div className="page organization-page">
      <div className="page-heading">
        <div>
          <span className="eyebrow">{data.workspace.name.toUpperCase()} / ORGANIZATION</span>
          <h1>Every team. One shared direction.</h1>
          <p>Your organization’s people, priorities and progress, brought together.</p>
        </div>
        <Button onClick={openCreateMenu}>
          <Plus size={17} />
          Create
        </Button>
      </div>
      <div className="organization-identity">
        <ShieldCheck size={17} />
        <span>Organization administrator</span>
        <span className="identity-divider" />
        <span>{data.user.employee_id}</span>
        <Link to="/organization">
          Manage teams & privileges <ArrowUpRight size={14} />
        </Link>
      </div>
      <div className="organization-metrics">
        <Metric label="Team dashboards" value={teams.length} icon={<LayoutDashboard size={22} />} />
        <Metric
          label="Active employees"
          value={activeMembers.length}
          icon={<Users size={22} />}
          tone="lavender"
        />
        <Metric
          label="Open project work"
          value={openIssues.length}
          icon={<CheckSquare size={22} />}
          tone="sand"
        />
        <Metric
          label="Business requirements"
          value={(work.data || []).filter((w) => w.kind === 'brd').length}
          icon={<FileText size={22} />}
          tone="blue"
        />
      </div>
      <div className="section-heading">
        <div>
          <h2>Your teams</h2>
          <p>Open any dashboard to see its work and priorities.</p>
        </div>
        <Link className="text-link" to="/organization">
          Configure dashboards <Settings2 size={15} />
        </Link>
      </div>
      <div className="organization-team-grid">
        {teams.map((team) => {
          const members = activeMembers.filter((m) => m.team_id === team.id);
          const ids = new Set(members.map((m) => m.id));
          const issues = openIssues.filter((i) => ids.has(i.assignee_id || i.reporter_id));
          const items = (work.data || []).filter(
            (w) => w.team_id === team.id && w.state !== 'done',
          );
          return (
            <Link className="organization-team-card" key={team.id} to={`/teams/${team.id}`}>
              <div className="team-card-heading">
                <span className="team-symbol" style={{ background: team.color }}>
                  <LayoutDashboard size={22} />
                </span>
                <ArrowUpRight size={18} />
              </div>
              <h2>{team.name}</h2>
              <p>{team.description}</p>
              <div className="team-card-counts">
                <span>
                  <strong>{issues.length}</strong> open issues
                </span>
                <span>
                  <strong>{items.length}</strong> team items
                </span>
              </div>
              <footer>
                <AvatarGroup users={members} />
                <span>
                  {members.length} {members.length === 1 ? 'employee' : 'employees'}
                  <ChevronRight size={14} />
                </span>
              </footer>
            </Link>
          );
        })}
      </div>
      <div className="organization-bottom-grid">
        <section className="panel organization-panel">
          <header>
            <div>
              <span className="eyebrow">NEEDS ATTENTION</span>
              <h2>Priority work</h2>
            </div>
            <Link to="/my-work">
              My work <ArrowUpRight size={15} />
            </Link>
          </header>
          <IssueTable
            issues={openIssues
              .filter((i) => i.flagged || i.priority === 'critical' || i.priority === 'high')
              .slice(0, 6)}
            compact
          />
        </section>
        <section className="panel organization-panel">
          <header>
            <div>
              <span className="eyebrow">ORGANIZATION ACCESS</span>
              <h2>Built around your people</h2>
            </div>
            <ShieldCheck size={21} />
          </header>
          <p>
            Assign employee IDs, create team dashboards and decide what each team role can change.
          </p>
          <div className="organization-code">
            <small>Organization code for employee sign-in</small>
            <code>{data.workspace.slug}</code>
          </div>
          <Link className="btn secondary" to="/organization">
            Manage organization <ArrowUpRight size={15} />
          </Link>
        </section>
      </div>
    </div>
  );
}
export function TeamDashboard() {
  const { teamId } = useParams();
  const { data, openCreate, openWork } = useGrace();
  const team = data.organization?.teams.find((t) => t.id === teamId);
  const work = useOrganizationWork(teamId);
  const [section, setSection] = useState<DashboardSection | 'overview'>('overview');
  if (!team)
    return (
      <div className="page">
        <Empty
          title="This dashboard is not available"
          text="Your administrator assigns dashboard access through your employee profile."
          action={
            <Link className="btn secondary" to="/">
              Open my dashboard
            </Link>
          }
        />
      </div>
    );
  const members = data.members.filter(
    (m) => m.team_id === team.id && m.active !== false && m.active !== 0,
  );
  const memberIds = new Set(members.map((m) => m.id));
  const issues = data.issues.filter((i) => memberIds.has(i.assignee_id || i.reporter_id));
  const activeIssues = issues.filter(
    (i) => data.statuses.find((s) => s.id === i.status_id)?.category !== 'done',
  );
  const workItems = work.data || [];
  const selected = team.sections.includes(section as DashboardSection) ? section : 'overview';
  const issueItems =
    selected === 'bugs'
      ? issues.filter((i) => i.type === 'bug')
      : selected === 'features'
        ? issues.filter((i) => i.type === 'story')
        : issues.filter((i) => !['bug', 'story'].includes(i.type));
  const isWorkSection = ['brds', 'daily', 'versions'].includes(selected);
  const kinds = selected === 'brds' ? 'brd' : selected === 'versions' ? 'version' : 'daily';
  const overdue = activeIssues.filter(
    (i) => i.due_date && i.due_date < new Date().toLocaleDateString('en-CA'),
  ).length;
  return (
    <div className="page organization-page">
      <div className="page-heading">
        <div>
          <span className="eyebrow">TEAM DASHBOARD / {data.workspace.name.toUpperCase()}</span>
          <h1>
            <span className="team-title-dot" style={{ background: team.color }} />
            {team.name}
          </h1>
          <p>{team.description}</p>
        </div>
        <div className="page-heading-actions">
          {data.organization?.can_admin && (
            <Link className="btn secondary" to="/organization">
              <Settings2 size={16} />
              Configure
            </Link>
          )}
          <Button
            onClick={() =>
              isWorkSection
                ? openWork?.(kinds, team.id)
                : openCreate({
                    type: selected === 'bugs' ? 'bug' : selected === 'features' ? 'story' : 'task',
                    assignee_id: members.some((m) => m.id === data.user.id)
                      ? data.user.id
                      : members[0]?.id,
                  })
            }
            disabled={
              data.user.role === 'viewer' ||
              !canTeamCreate(
                data.organization,
                isWorkSection ? (selected as 'brds' | 'daily' | 'versions') : 'work',
                team.id,
              )
            }
          >
            <Plus size={16} />
            {isWorkSection ? `Create ${workKindLabels[kinds]}` : 'Create work'}
          </Button>
        </div>
      </div>
      <div
        className="team-dashboard-banner"
        style={{ '--team-color': team.color } as React.CSSProperties}
      >
        <div>
          <span className="team-symbol" style={{ background: team.color }}>
            <LayoutDashboard size={25} />
          </span>
          <div>
            <strong>A clear place for {team.name.toLowerCase()} work.</strong>
            <p>
              {team.sections.length} dashboard sections · {members.length} employees ·{' '}
              {data.organization?.can_admin
                ? 'Administrator access'
                : `${data.user.team_role || 'member'} access`}
            </p>
          </div>
        </div>
        <AvatarGroup users={members} size={34} />
      </div>
      <div className="organization-metrics">
        <Metric label="Open issues" value={activeIssues.length} icon={<LayersIcon />} />
        <Metric
          label="Open bugs"
          value={activeIssues.filter((i) => i.type === 'bug').length}
          icon={<Bug size={22} />}
          tone="rose"
        />
        <Metric
          label="Team deliverables"
          value={workItems.filter((w) => w.state !== 'done').length}
          icon={<FileText size={22} />}
          tone="lavender"
        />
        <Metric
          label="Overdue issues"
          value={overdue}
          icon={<CalendarDays size={22} />}
          tone="sand"
        />
      </div>
      <div className="organization-tabs" role="tablist" aria-label="Team dashboard sections">
        {(['overview', ...team.sections] as const).map((s) => (
          <button
            key={s}
            role="tab"
            aria-selected={selected === s}
            className={selected === s ? 'active' : ''}
            onClick={() => setSection(s)}
          >
            {s === 'overview' ? 'Overview' : sectionNames[s]}
          </button>
        ))}
      </div>
      <div
        role="tabpanel"
        aria-label={selected === 'overview' ? 'Team overview' : sectionNames[selected]}
      >
        {selected === 'overview' ? (
          <div className="team-overview-grid">
            <div>
              <section className="panel organization-panel">
                <header>
                  <div>
                    <span className="eyebrow">KEEP WORK MOVING</span>
                    <h2>Team priorities</h2>
                  </div>
                  <Badge>{activeIssues.length} open</Badge>
                </header>
                <IssueTable issues={activeIssues.slice(0, 8)} compact />
              </section>
              {team.sections.includes('daily') && (
                <WorkSection
                  title="Daily tasks"
                  kind="daily"
                  teamId={team.id}
                  items={workItems
                    .filter((w) => w.kind === 'daily' && w.state !== 'done')
                    .slice(0, 4)}
                  loading={work.isPending}
                  error={work.error}
                  retry={() => work.refetch()}
                />
              )}
            </div>
            <div className="team-overview-aside">
              <section className="panel organization-panel">
                <header>
                  <h2>Team members</h2>
                  <Badge>{members.length}</Badge>
                </header>
                {members.length ? (
                  members.map((m) => (
                    <div className="team-person" key={m.id}>
                      <Avatar user={m} size={34} />
                      <span>
                        <strong>{m.name}</strong>
                        <small>{m.employee_id}</small>
                      </span>
                      <Badge>{m.team_role}</Badge>
                    </div>
                  ))
                ) : (
                  <p>Assign employees from Organization settings to build this team.</p>
                )}
              </section>
              {team.sections.includes('brds') && (
                <WorkSection
                  title="Business requirements"
                  kind="brd"
                  teamId={team.id}
                  items={workItems.filter((w) => w.kind === 'brd').slice(0, 3)}
                  loading={work.isPending}
                  error={work.error}
                  retry={() => work.refetch()}
                />
              )}
            </div>
          </div>
        ) : isWorkSection ? (
          <WorkSection
            title={sectionNames[selected as DashboardSection]}
            kind={kinds}
            teamId={team.id}
            items={workItems.filter((w) => w.kind === kinds)}
            loading={work.isPending}
            error={work.error}
            retry={() => work.refetch()}
          />
        ) : (
          <section className="panel">
            <IssueTable issues={issueItems} />
          </section>
        )}
      </div>
    </div>
  );
}
function LayersIcon() {
  return <CheckSquare size={22} />;
}
function WorkCard({ item }: { item: OrganizationWork }) {
  const { data, openWork } = useGrace();
  const Icon = kindIcons[item.kind];
  const owner = data.members.find((m) => m.id === item.owner_id);
  const overdue =
    item.due_date &&
    item.due_date < new Date().toLocaleDateString('en-CA') &&
    item.state !== 'done';
  return (
    <button
      className={`organization-work-card ${item.kind}`}
      onClick={() => openWork?.(item.kind, item.team_id, item)}
      aria-label={`Open ${workKindLabels[item.kind]}: ${item.title}`}
    >
      <div className="work-card-top">
        <span>
          <Icon size={16} />
          {workKindLabels[item.kind]}
          {item.version_tag && ` · ${item.version_tag}`}
        </span>
        <Badge
          tone={item.state === 'done' ? 'green' : item.state === 'active' ? 'purple' : 'neutral'}
        >
          {stateLabel(item)}
        </Badge>
      </div>
      <strong>{item.title}</strong>
      <p>
        {item.content
          .replace(/<[^>]*>/g, ' ')
          .replace(/&nbsp;/g, ' ')
          .trim()
          .slice(0, 110) || 'Open to add details and keep the team aligned.'}
      </p>
      <footer>
        <span className={overdue ? 'overdue' : ''}>
          <CalendarDays size={14} />
          {item.due_date ? formatDate(item.due_date) : 'No due date'}
        </span>
        <span>
          {item.issue_ids.length > 0 && `${item.issue_ids.length} linked`}
          <Avatar user={owner} size={27} />
        </span>
      </footer>
    </button>
  );
}
function WorkSection({
  title,
  kind,
  teamId,
  items,
  loading = false,
  error = null,
  retry = () => {},
}: {
  title: string;
  kind: OrganizationWorkKind;
  teamId?: string;
  items: OrganizationWork[];
  loading?: boolean;
  error?: Error | null;
  retry?: () => void;
}) {
  const { data, openWork } = useGrace();
  const capability = kind === 'brd' ? 'brds' : kind === 'version' ? 'versions' : 'daily';
  return (
    <section className="work-section">
      <div className="section-heading">
        <h2>
          {title} <Badge>{items.length}</Badge>
        </h2>
        <Button
          variant="ghost"
          onClick={() => openWork?.(kind, teamId)}
          disabled={
            data.user.role === 'viewer' || !canTeamCreate(data.organization, capability, teamId)
          }
        >
          <Plus size={15} />
          Add {workKindLabels[kind]}
        </Button>
      </div>
      {loading || error ? (
        <QueryState error={error} retry={retry} />
      ) : items.length ? (
        <div className="organization-work-grid">
          {items.map((item) => (
            <WorkCard key={item.id} item={item} />
          ))}
        </div>
      ) : (
        <div className="work-section-empty">
          <span>
            {kind === 'brd'
              ? 'Business requirements will appear here.'
              : kind === 'daily'
                ? 'A little room for today’s next step.'
                : 'Plan a version and link its deliverables here.'}
          </span>
        </div>
      )}
    </section>
  );
}
function PersonalIssueCard({ issue }: { issue: Issue }) {
  const { data, openIssue } = useGrace();
  return (
    <button
      className="organization-work-card personal-issue-card"
      onClick={() => openIssue(issue.id)}
      aria-label={`Open ${issue.key}: ${issue.summary}`}
    >
      <div className="work-card-top">
        <span>
          <TypeIcon type={issue.type} />
          {issue.key}
        </span>
        <StatusPill status={data.statuses.find((s) => s.id === issue.status_id)} />
      </div>
      <strong>{issue.summary}</strong>
      <p>{data.projects.find((p) => p.id === issue.project_id)?.name}</p>
      <footer>
        <PriorityIcon priority={issue.priority} withLabel />
        <span>
          {issue.due_date && formatDate(issue.due_date)}
          <Avatar user={data.members.find((m) => m.id === issue.assignee_id)} size={27} />
        </span>
      </footer>
    </button>
  );
}
export function OrganizationMyWork() {
  const { data, openCreateMenu } = useGrace();
  const work = useOrganizationWork(undefined, true);
  const [section, setSection] = useState<DashboardSection | 'all'>('all');
  const [scope, setScope] = useState('assigned');
  const [search, setSearch] = useState('');
  const matches = (title: string) => title.toLowerCase().includes(search.toLowerCase());
  const issues = data.issues.filter(
    (i) =>
      (scope === 'created' ? i.reporter_id === data.user.id : i.assignee_id === data.user.id) &&
      (scope === 'completed'
        ? data.statuses.find((s) => s.id === i.status_id)?.category === 'done'
        : data.statuses.find((s) => s.id === i.status_id)?.category !== 'done') &&
      matches(`${i.key} ${i.summary}`),
  );
  const items = (work.data || []).filter(
    (w) =>
      (scope === 'created' ? w.created_by === data.user.id : w.owner_id === data.user.id) &&
      (scope === 'completed' ? w.state === 'done' : w.state !== 'done') &&
      matches(w.title),
  );
  const grouped: Record<'issues' | 'bugs' | 'features', Issue[]> = {
    issues: issues.filter((i) => !['bug', 'story'].includes(i.type)),
    bugs: issues.filter((i) => i.type === 'bug'),
    features: issues.filter((i) => i.type === 'story'),
  };
  const counts = (s: DashboardSection) =>
    s === 'issues' || s === 'bugs' || s === 'features'
      ? grouped[s].length
      : items.filter((w) => kindSection[w.kind] === s).length;
  const sections: DashboardSection[] = ['daily', 'issues', 'bugs', 'features', 'brds', 'versions'];
  return (
    <div className="page organization-page my-work-page">
      <div className="page-heading">
        <div>
          <span className="eyebrow">YOUR SPACE TO MOVE THINGS FORWARD</span>
          <h1>My work</h1>
          <p>Today’s tasks, tomorrow’s ideas, and everything you’re responsible for.</p>
        </div>
        <Button disabled={data.user.role === 'viewer'} onClick={openCreateMenu}>
          <Plus size={17} />
          Create
        </Button>
      </div>
      <div className="organization-identity">
        <Avatar user={data.user} size={27} />
        <strong>{data.user.name}</strong>
        <span>{data.user.employee_id}</span>
        <Badge>
          {data.organization?.teams.find((t) => t.id === data.user.team_id)?.name || 'Organization'}
        </Badge>
      </div>
      <div className="organization-metrics">
        <Metric label="Daily tasks" value={counts('daily')} icon={<CheckSquare size={22} />} />
        <Metric
          label="Issues & bugs"
          value={counts('issues') + counts('bugs')}
          icon={<Bug size={22} />}
          tone="sand"
        />
        <Metric
          label="Business requirements"
          value={counts('brds')}
          icon={<FileText size={22} />}
          tone="lavender"
        />
        <Metric
          label="Features & versions"
          value={counts('features') + counts('versions')}
          icon={<GitBranch size={22} />}
          tone="blue"
        />
      </div>
      <div className="workspace-toolbar personal-work-toolbar">
        <div className="tabs">
          {[
            ['assigned', 'Assigned to me'],
            ['created', 'Created by me'],
            ['completed', 'Completed'],
          ].map(([id, label]) => (
            <button key={id} className={scope === id ? 'active' : ''} onClick={() => setScope(id)}>
              {label}
            </button>
          ))}
        </div>
        <div className="search-field">
          <Search size={16} />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Filter all your work…"
            aria-label="Filter all your work"
          />
        </div>
      </div>
      <div className="organization-tabs" role="tablist" aria-label="My work types">
        {(['all', ...sections] as const).map((s) => (
          <button
            role="tab"
            aria-selected={section === s}
            key={s}
            className={section === s ? 'active' : ''}
            onClick={() => setSection(s)}
          >
            {s === 'all' ? 'All work' : sectionNames[s]}
            <Badge>{s === 'all' ? issues.length + items.length : counts(s)}</Badge>
          </button>
        ))}
      </div>
      <div
        className="personal-work-sections"
        role="tabpanel"
        aria-label={section === 'all' ? 'All work' : sectionNames[section]}
      >
        {sections
          .filter((s) => section === 'all' || section === s)
          .map((s) =>
            s === 'issues' || s === 'bugs' || s === 'features' ? (
              <section className="work-section" key={s}>
                <div className="section-heading">
                  <h2>
                    {sectionNames[s]} <Badge>{grouped[s].length}</Badge>
                  </h2>
                </div>
                {grouped[s].length ? (
                  <div className="organization-work-grid">
                    {grouped[s].map((i) => (
                      <PersonalIssueCard key={i.id} issue={i} />
                    ))}
                  </div>
                ) : (
                  <div className="work-section-empty">
                    No {sectionNames[s].toLowerCase()} in this view.
                  </div>
                )}
              </section>
            ) : (
              <WorkSection
                key={s}
                title={sectionNames[s]}
                kind={s === 'brds' ? 'brd' : s === 'daily' ? 'daily' : 'version'}
                items={items.filter((w) => kindSection[w.kind] === s)}
                loading={work.isPending}
                error={work.error}
                retry={() => work.refetch()}
              />
            ),
          )}
      </div>
    </div>
  );
}

type Employee = EmployeeProfile & Pick<User, 'name' | 'email' | 'color' | 'role' | 'active'>;
export function OrganizationAdministration() {
  const { data } = useGrace();
  const [tab, setTab] = useState('dashboards');
  const [editing, setEditing] = useState<OrganizationTeam | null | undefined>(undefined);
  const [employee, setEmployee] = useState<Employee | null>(null);
  const [search, setSearch] = useState('');
  const employees = useQuery({
    queryKey: ['organization-employees', data.workspace.id],
    queryFn: () => api<Employee[]>('/organization/employees'),
    enabled: !!data.organization?.can_admin,
  });
  if (!data.organization?.can_admin)
    return (
      <div className="page">
        <Empty
          title="Organization administration"
          text="An organization administrator manages employee assignments, team dashboards and privileges."
        />
      </div>
    );
  return (
    <div className="page organization-page">
      <div className="page-heading">
        <div>
          <span className="eyebrow">ORGANIZATION / ADMINISTRATION</span>
          <h1>People in the right places.</h1>
          <p>Create team dashboards, assign employees and define how each role works.</p>
        </div>
        <Button onClick={() => setEditing(null)}>
          <Plus size={16} />
          Create team dashboard
        </Button>
      </div>
      <div className="organization-admin-note">
        <ShieldCheck size={19} />
        <p>
          Organization owners and admins can access every dashboard. Team leads can manage their
          team’s work; member privileges are configured per dashboard. Viewers have read-only
          access.
        </p>
      </div>
      <div className="organization-tabs" role="tablist" aria-label="Organization administration">
        {[
          ['dashboards', 'Team dashboards'],
          ['employees', 'Employee assignments'],
          ['invite', 'Invite an employee'],
        ].map(([id, label]) => (
          <button
            key={id}
            role="tab"
            aria-selected={tab === id}
            className={tab === id ? 'active' : ''}
            onClick={() => setTab(id)}
          >
            {label}
          </button>
        ))}
      </div>
      {tab === 'dashboards' ? (
        <div className="organization-team-grid admin-team-grid">
          {data.organization.teams.map((t) => (
            <section className="panel admin-team-card" key={t.id}>
              <header>
                <span className="team-symbol" style={{ background: t.color }}>
                  <LayoutDashboard size={21} />
                </span>
                <Badge>{data.members.filter((m) => m.team_id === t.id).length} employees</Badge>
              </header>
              <h2>{t.name}</h2>
              <p>{t.description}</p>
              <div className="team-section-tags">
                {t.sections.map((s) => (
                  <Badge key={s}>{sectionNames[s]}</Badge>
                ))}
              </div>
              <footer>
                <Link to={`/teams/${t.id}`}>
                  Open dashboard <ArrowUpRight size={14} />
                </Link>
                <Button variant="secondary" onClick={() => setEditing(t)}>
                  <Settings2 size={15} />
                  Configure
                </Button>
              </footer>
            </section>
          ))}
        </div>
      ) : tab === 'employees' ? (
        <section className="panel organization-panel">
          <header>
            <h2>Employee directory</h2>
            <div className="search-field">
              <Search size={16} />
              <input
                placeholder="Name, ID or email…"
                aria-label="Find employee"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
          </header>
          {employees.isPending || employees.error ? (
            <QueryState error={employees.error} retry={() => employees.refetch()} />
          ) : (
            <div className="employee-directory">
              {employees.data
                ?.filter((e) =>
                  `${e.name} ${e.employee_id} ${e.email}`
                    .toLowerCase()
                    .includes(search.toLowerCase()),
                )
                .map((e) => (
                  <div className="employee-row" key={e.user_id}>
                    <Avatar user={e} size={36} />
                    <div>
                      <strong>{e.name}</strong>
                      <small>{e.email}</small>
                    </div>
                    <code>{e.employee_id}</code>
                    <span>{data.organization?.teams.find((t) => t.id === e.team_id)?.name}</span>
                    <Badge>{e.team_role}</Badge>
                    <Button
                      variant="secondary"
                      onClick={() => setEmployee(e)}
                      disabled={e.active === false || e.active === 0}
                    >
                      Edit assignment
                    </Button>
                  </div>
                ))}
            </div>
          )}
          <p className="organization-footnote">
            Organization roles and account deactivation are available in{' '}
            <Link to="/administration">Administration</Link>.
          </p>
        </section>
      ) : (
        <EmployeeInvitation />
      )}
      {editing !== undefined && (
        <TeamConfiguration team={editing} onClose={() => setEditing(undefined)} />
      )}
      {employee && <EmployeeAssignment employee={employee} onClose={() => setEmployee(null)} />}
    </div>
  );
}
function TeamConfiguration({
  team,
  onClose,
}: {
  team: OrganizationTeam | null;
  onClose: () => void;
}) {
  const { run } = useGrace();
  const [sections, setSections] = useState<DashboardSection[]>(
    team?.sections || [...dashboardSections],
  );
  const [permissions, setPermissions] = useState<TeamPermissions>(
    team?.permissions || defaultTeamPermissions,
  );
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setBusy(true);
    const values = Object.fromEntries(new FormData(e.currentTarget));
    const body = { ...values, sections, permissions, version: team?.version };
    const saved = await run(
      () =>
        team ? patch(`/organization/teams/${team.id}`, body) : post('/organization/teams', body),
      'Team dashboard saved.',
    );
    setBusy(false);
    if (saved) onClose();
  };
  return (
    <Modal title={team ? `Configure ${team.name}` : 'Create team dashboard'} onClose={onClose} wide>
      <form onSubmit={submit}>
        <div className="modal-body team-config-form">
          <div className="form-row">
            <label>
              Team name
              <input
                name="name"
                defaultValue={team?.name}
                required
                minLength={2}
                maxLength={100}
                placeholder="e.g. Customer success"
              />
            </label>
            <label>
              Team color
              <input type="color" name="color" defaultValue={team?.color || '#dce8da'} />
            </label>
          </div>
          <label>
            Description
            <textarea
              name="description"
              maxLength={2000}
              defaultValue={team?.description}
              placeholder="What does this team focus on?"
            />
          </label>
          <fieldset>
            <legend>Dashboard sections</legend>
            <p>Choose the sections this team sees on its dashboard.</p>
            <div className="team-section-options">
              {dashboardSections.map((s) => (
                <label key={s}>
                  <input
                    type="checkbox"
                    checked={sections.includes(s)}
                    onChange={(e) =>
                      setSections((v) => (e.target.checked ? [...v, s] : v.filter((x) => x !== s)))
                    }
                  />
                  {sectionNames[s]}
                </label>
              ))}
            </div>
          </fieldset>
          <fieldset>
            <legend>Role privileges</legend>
            <p>
              These privileges control editing. Project access and organization roles also apply.
            </p>
            <div className="team-permission-grid">
              <span>Can create and edit</span>
              <strong>Lead</strong>
              <strong>Member</strong>
              <strong>Viewer</strong>
              {teamCapabilities.map((cap) => (
                <PermissionRow
                  key={cap}
                  capability={cap}
                  permissions={permissions}
                  change={setPermissions}
                />
              ))}
            </div>
            <small>Owners and organization admins retain access to every team and component.</small>
          </fieldset>
        </div>
        <div className="modal-footer">
          <span className="spacer" />
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" busy={busy} disabled={!sections.length}>
            Save dashboard
          </Button>
        </div>
      </form>
    </Modal>
  );
}
function PermissionRow({
  capability,
  permissions,
  change,
}: {
  capability: (typeof teamCapabilities)[number];
  permissions: TeamPermissions;
  change: (p: TeamPermissions) => void;
}) {
  const label = {
    work: 'Issues, bugs & features',
    brds: 'Business requirements',
    daily: 'Daily tasks',
    versions: 'Versions & releases',
  }[capability];
  return (
    <>
      <span>{label}</span>
      {(['lead', 'member', 'viewer'] as const).map((role) => (
        <label key={role}>
          <input
            aria-label={`${role} can edit ${label}`}
            type="checkbox"
            disabled={role === 'viewer'}
            checked={permissions[role].includes(capability)}
            onChange={(e) =>
              change({
                ...permissions,
                [role]: e.target.checked
                  ? [...permissions[role], capability]
                  : permissions[role].filter((c) => c !== capability),
              })
            }
          />
        </label>
      ))}
    </>
  );
}
function EmployeeAssignment({ employee, onClose }: { employee: Employee; onClose: () => void }) {
  const { data, run } = useGrace();
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setBusy(true);
    const values = Object.fromEntries(new FormData(e.currentTarget));
    const saved = await run(
      () =>
        api(`/organization/employees/${employee.user_id}`, {
          method: 'PUT',
          body: JSON.stringify({ ...values, version: employee.version }),
        }),
      'Employee assignment saved.',
    );
    setBusy(false);
    if (saved) onClose();
  };
  return (
    <Modal title={`Assign ${employee.name}`} onClose={onClose}>
      <form onSubmit={submit}>
        <div className="modal-body">
          <p>The employee ID and organization code connect this account to its team dashboard.</p>
          <label>
            Employee ID
            <input
              name="employee_id"
              required
              minLength={2}
              maxLength={40}
              pattern="[A-Za-z0-9][A-Za-z0-9_-]{1,39}"
              defaultValue={employee.employee_id}
            />
          </label>
          <label>
            Team dashboard
            <select name="team_id" defaultValue={employee.team_id}>
              {data.organization?.teams.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Team role
            <select name="team_role" defaultValue={employee.team_role}>
              <option value="lead">Team lead</option>
              <option value="member">Member</option>
              <option value="viewer">Viewer</option>
            </select>
          </label>
          <small>
            Reassign open team items before transferring an employee. Organization roles are managed
            separately in Administration.
          </small>
        </div>
        <div className="modal-footer">
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" busy={busy}>
            Save assignment
          </Button>
        </div>
      </form>
    </Modal>
  );
}
function EmployeeInvitation() {
  const { data, run } = useGrace();
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setBusy(true);
    const values = Object.fromEntries(new FormData(e.currentTarget));
    const saved = await run(
      () => post<{ url: string }>('/invites', values),
      'Employee invitation created.',
    );
    setBusy(false);
    if (saved) setUrl(saved.url);
  };
  return (
    <section className="panel organization-panel employee-invitation">
      <header>
        <div>
          <h2>Invite an employee</h2>
          <p>Reserve an employee ID and dashboard assignment before they register.</p>
        </div>
        <Users size={23} />
      </header>
      <form onSubmit={submit}>
        <div className="form-row">
          <label>
            Email address
            <input name="email" type="email" required placeholder="colleague@company.com" />
          </label>
          <label>
            Employee ID
            <input
              name="employee_id"
              required
              minLength={2}
              maxLength={40}
              pattern="[A-Za-z0-9][A-Za-z0-9_-]{1,39}"
              placeholder="e.g. ENG-1042"
            />
          </label>
        </div>
        <div className="form-row three">
          <label>
            Team dashboard
            <select name="team_id" required>
              {data.organization?.teams.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Team role
            <select name="team_role">
              <option value="member">Member</option>
              <option value="lead">Team lead</option>
              <option value="viewer">Viewer</option>
            </select>
          </label>
          <label>
            Organization role
            <select name="role">
              <option value="member">Member</option>
              <option value="viewer">Viewer</option>
              <option value="admin">Admin · all teams</option>
            </select>
          </label>
        </div>
        <Button type="submit" busy={busy}>
          <Plus size={16} />
          Create invitation
        </Button>
      </form>
      {url && (
        <div className="invitation-result" role="status">
          <strong>Invitation ready</strong>
          <p>
            Share this link with the employee. It is bound to their email and expires in 7 days.
          </p>
          <input
            aria-label="Employee invitation link"
            value={url}
            readOnly
            onFocus={(e) => e.target.select()}
          />
        </div>
      )}
      <div className="organization-code">
        <small>Organization code for employee sign-in</small>
        <code>{data.workspace.slug}</code>
      </div>
    </section>
  );
}
