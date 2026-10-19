import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Plus, Settings2, Users, ArrowRight } from 'lucide-react';
import { useGrace } from '../context';
import { canTeamCreate, teamRoleLabels } from '../../shared/organization';
import { Avatar, Badge, Button, Empty } from '../components/ui';
import { FocusWorkList, useTeamWork } from './Focus';
export function TeamDashboard() {
  const { teamId } = useParams();
  const navigate = useNavigate();
  const { data, openWork } = useGrace();
  const work = useTeamWork(teamId);
  const [section, setSection] = useState('overview');
  const team = data.organization?.teams.find((t) => t.id === teamId);
  if (!team)
    return (
      <div className="page focus-page">
        <Empty
          title="Team not available"
          text="Your administrator assigns your team access."
          action={
            <Link className="btn secondary" to="/">
              Go home
            </Link>
          }
        />
      </div>
    );
  const people = data.members.filter(
    (m) => m.team_id === team.id && m.active !== false && m.active !== 0,
  );
  const ids = new Set(people.map((m) => m.id));
  const issues = data.issues.filter(
    (i) =>
      ids.has(i.assignee_id || i.reporter_id) &&
      team.sections.includes(
        i.type === 'bug' ? 'bugs' : i.type === 'story' ? 'features' : 'issues',
      ),
  );
  const items = (work.data || []).filter((w) =>
    team.sections.includes(w.kind === 'brd' ? 'brds' : w.kind === 'daily' ? 'daily' : 'versions'),
  );
  const openIssues = issues.filter(
    (i) => data.statuses.find((s) => s.id === i.status_id)?.category !== 'done',
  );
  const openItems = items.filter((w) => w.state !== 'done');
  const tabs = [
    ['overview', 'Overview'],
    ...(team.sections.some((s) => ['issues', 'bugs', 'features'].includes(s))
      ? [['work', 'Project work']]
      : []),
    ...(team.sections.includes('daily') ? [['daily', 'Daily tasks']] : []),
    ...(team.sections.includes('brds') ? [['brd', 'BRDs']] : []),
    ...(team.sections.includes('versions') ? [['version', 'Versions']] : []),
  ];
  const selected = tabs.some(([id]) => id === section) ? section : 'overview';
  const manager =
    data.organization?.can_admin ||
    (data.organization?.can_manage_team && data.user.team_id === team.id);
  const today = new Date().toLocaleDateString('en-CA');
  const addKind = selected === 'brd' ? 'brd' : selected === 'version' ? 'version' : 'daily';
  const capability = addKind === 'brd' ? 'brds' : addKind === 'version' ? 'versions' : 'daily';
  const title = tabs.find(([id]) => id === selected)?.[1] || 'Team work';
  const teamList = (
    <FocusWorkList
      showTypeFilter={selected === 'overview' || selected === 'work'}
      key={`${team.id}-${selected}`}
      issues={selected === 'overview' || selected === 'work' ? issues : []}
      work={
        selected === 'overview'
          ? items
          : selected === 'work'
            ? []
            : items.filter((w) => w.kind === selected)
      }
      loading={work.isPending}
      error={work.error}
      retry={() => work.refetch()}
      title={selected === 'overview' ? 'Team work' : title}
    />
  );
  return (
    <div className="page focus-page team-focus-page">
      <div className="page-heading">
        <div>
          <h1>
            <span className="team-title-dot" style={{ background: team.color }} />
            {team.name}
          </h1>
          <p>{team.description}</p>
        </div>
        <div className="page-heading-actions">
          {data.organization?.can_admin && (
            <label className="focus-filter">
              <span>Team</span>
              <select
                aria-label="Choose team dashboard"
                value={team.id}
                onChange={(e) => navigate(`/teams/${e.target.value}`)}
              >
                {data.organization.teams.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
            </label>
          )}
          {manager && (
            <Link to="/organization" className="btn secondary">
              <Settings2 size={15} />
              Manage team
            </Link>
          )}
        </div>
      </div>
      <div className="focus-summary">
        <div>
          <span className="summary-dot green" />
          <strong>{openIssues.length}</strong>
          <span>Open project items</span>
        </div>
        <div>
          <span className="summary-dot blue" />
          <strong>{openItems.length}</strong>
          <span>Team tasks & documents</span>
        </div>
        <div>
          <span className="summary-dot amber" />
          <strong>
            {[...openIssues, ...openItems].filter((i) => i.due_date && i.due_date < today).length}
          </strong>
          <span>Overdue</span>
        </div>
      </div>
      <div className="focus-team-toolbar">
        <div className="organization-tabs" role="tablist" aria-label="Team sections">
          {tabs.map(([id, label]) => (
            <button
              key={id}
              role="tab"
              aria-selected={selected === id}
              className={selected === id ? 'active' : ''}
              onClick={() => setSection(id)}
            >
              {label}
            </button>
          ))}
        </div>
        {selected !== 'work' &&
          data.user.role !== 'viewer' &&
          canTeamCreate(data.organization, capability, team.id) && (
            <Button variant="secondary" onClick={() => openWork?.(addKind, team.id)}>
              <Plus size={15} />
              {addKind === 'brd'
                ? 'Add BRD'
                : addKind === 'version'
                  ? 'Add version'
                  : 'Add daily task'}
            </Button>
          )}
      </div>
      <div role="tabpanel" aria-label={title}>
        {selected === 'overview' ? (
          <div className="focus-team-layout">
            {teamList}
            <aside className="panel focus-team-people">
              <header>
                <h2>People</h2>
                <Badge>{people.length}</Badge>
              </header>
              {people.length ? (
                people.map((person) => (
                  <div className="team-person" key={person.id}>
                    <Avatar user={person} size={33} />
                    <span>
                      <strong>{person.name}</strong>
                      <small>{teamRoleLabels[person.team_role || 'member']}</small>
                    </span>
                  </div>
                ))
              ) : (
                <p>No employees are assigned to this team yet.</p>
              )}
              {manager && (
                <Link className="text-link" to="/organization">
                  Manage team roles <ArrowRight size={14} />
                </Link>
              )}
              <div className="team-role-guide">
                <Users size={18} />
                <p>
                  {manager
                    ? 'Team Managers oversee work and member roles. Organization admins manage team assignments and access.'
                    : 'Your Team Manager can help with assignments and team work.'}
                </p>
              </div>
            </aside>
          </div>
        ) : (
          teamList
        )}
      </div>
    </div>
  );
}
