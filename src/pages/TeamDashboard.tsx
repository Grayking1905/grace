import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Plus,
  Settings2,
  Users,
  ArrowRight,
  FolderKanban,
  CheckCircle2,
  AlertCircle,
  MessageSquare,
  TrendingUp,
  UserPlus,
  UserMinus,
  Shield,
  Layers,
} from 'lucide-react';
import { useGrace } from '../context';
import { canTeamCreate, teamRoleLabels, type TeamRole } from '../../shared/organization';
import { Avatar, Badge, Button, Empty, Modal } from '../components/ui';
import { FocusWorkList, useTeamWork } from './Focus';
import { api, post, del } from '../lib/api';
import { ChatWidget } from '../components/ChatWidget';
import type { TeamMemberContribution } from '../../shared/types';

export function TeamDashboard() {
  const { teamId } = useParams();
  const navigate = useNavigate();
  const { data, openWork, openCreate, refresh } = useGrace();
  const qc = useQueryClient();
  const work = useTeamWork(teamId);
  const [section, setSection] = useState('overview');

  // Member management state
  const [addMemberOpen, setAddMemberOpen] = useState(false);
  const [selectedUserId, setSelectedUserId] = useState('');
  const [selectedRole, setSelectedRole] = useState<'lead' | 'member' | 'viewer'>('member');

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

  // Eligible members not in this team
  const availableMembers = data.members.filter(
    (m) => m.team_id !== team.id && m.active !== false && m.active !== 0,
  );

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

  // Query member contributions
  const { data: contributionsData } = useQuery<{
    members: TeamMemberContribution[];
    total_completed_issues: number;
    total_story_points: number;
  }>({
    queryKey: ['team-contributions', team.id],
    queryFn: () => api(`/organization/teams/${team.id}/contributions`),
    enabled: section === 'contributions' || section === 'overview',
  });

  // Projects assigned to this team
  const assignedProjects = data.projects.filter(
    (p) =>
      p.team_ids?.includes(team.id) ||
      issues.some((i) => i.project_id === p.id),
  );

  const canManageMembers =
    data.organization?.can_admin ||
    (['manager', 'lead'].includes(data.user.team_role || '') && data.user.team_id === team.id);

  const manager =
    data.organization?.can_admin ||
    (data.organization?.can_manage_team && data.user.team_id === team.id);

  // Add member mutation
  const addMemberMutation = useMutation({
    mutationFn: () =>
      post(`/organization/teams/${team.id}/members`, {
        user_id: selectedUserId,
        team_role: selectedRole,
      }),
    onSuccess: async () => {
      setAddMemberOpen(false);
      setSelectedUserId('');
      await refresh();
      qc.invalidateQueries({ queryKey: ['team-contributions', team.id] });
    },
  });

  // Remove member mutation
  const removeMemberMutation = useMutation({
    mutationFn: (userId: string) =>
      del(`/organization/teams/${team.id}/members/${userId}`),
    onSuccess: async () => {
      await refresh();
      qc.invalidateQueries({ queryKey: ['team-contributions', team.id] });
    },
  });

  // Update role mutation
  const updateRoleMutation = useMutation({
    mutationFn: ({ userId, role }: { userId: string; role: string }) =>
      post(`/organization/teams/${team.id}/members`, {
        user_id: userId,
        team_role: role,
      }),
    onSuccess: async () => {
      await refresh();
      qc.invalidateQueries({ queryKey: ['team-contributions', team.id] });
    },
  });

  const tabs = [
    ['overview', 'Overview'],
    ['projects', 'Assigned Projects'],
    ['contributions', 'Member Contributions'],
    ['chat', 'Team Chat'],
    ...(team.sections.some((s) => ['issues', 'bugs', 'features'].includes(s))
      ? [['work', 'Project work']]
      : []),
    ...(team.sections.includes('daily') ? [['daily', 'Daily tasks']] : []),
    ...(team.sections.includes('brds') ? [['brd', 'BRDs']] : []),
    ...(team.sections.includes('versions') ? [['version', 'Versions']] : []),
  ];

  const selected = tabs.some(([id]) => id === section) ? section : 'overview';
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
          {canManageMembers && (
            <Button variant="secondary" onClick={() => setAddMemberOpen(true)}>
              <UserPlus size={15} />
              Add Member
            </Button>
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
          <strong>{assignedProjects.length}</strong>
          <span>Assigned projects</span>
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
          selected !== 'projects' &&
          selected !== 'contributions' &&
          selected !== 'chat' &&
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
        {selected === 'overview' && (
          <div className="focus-team-layout">
            {teamList}
            <aside className="panel focus-team-people">
              <header>
                <h2>Team Members</h2>
                <Badge>{people.length}</Badge>
              </header>
              {people.length ? (
                people.map((person) => (
                  <div className="team-person" key={person.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '6px 0' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <Avatar user={person} size={32} />
                      <span>
                        <strong>{person.name}</strong>
                        <small style={{ display: 'block', color: 'var(--text-muted, #64748b)' }}>
                          {teamRoleLabels[person.team_role || 'member']}
                        </small>
                      </span>
                    </div>
                    {canManageMembers && person.id !== data.user.id && (
                      <div style={{ display: 'flex', gap: 4 }}>
                        <select
                          style={{ fontSize: 11, padding: '2px 4px', borderRadius: 4, border: '1px solid var(--border, #e2e8f0)' }}
                          value={person.team_role || 'member'}
                          onChange={(e) => updateRoleMutation.mutate({ userId: person.id, role: e.target.value })}
                        >
                          <option value="lead">Lead</option>
                          <option value="member">Member</option>
                          <option value="viewer">Viewer</option>
                        </select>
                        <button
                          title="Remove from team"
                          style={{ background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer', padding: 2 }}
                          onClick={() => removeMemberMutation.mutate(person.id)}
                        >
                          <UserMinus size={13} />
                        </button>
                      </div>
                    )}
                  </div>
                ))
              ) : (
                <p>No employees are assigned to this team yet.</p>
              )}
              {canManageMembers && (
                <button
                  className="btn secondary"
                  style={{ width: '100%', marginTop: 8, fontSize: 12 }}
                  onClick={() => setAddMemberOpen(true)}
                >
                  <UserPlus size={13} />
                  Add Member to Team
                </button>
              )}
            </aside>
          </div>
        )}

        {/* Assigned Projects & Progress Tab */}
        {selected === 'projects' && (
          <div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
              <h2 style={{ fontSize: 16, fontWeight: 700 }}>
                Projects Assigned to {team.name} ({assignedProjects.length})
              </h2>
            </div>
            {assignedProjects.length === 0 ? (
              <Empty
                title="No projects assigned"
                text="An administrator can assign projects to this team from Project Settings."
              />
            ) : (
              <div className="team-projects-grid">
                {assignedProjects.map((proj) => {
                  const projIssues = issues.filter((i) => i.project_id === proj.id);
                  const doneCount = projIssues.filter(
                    (i) => data.statuses.find((s) => s.id === i.status_id)?.category === 'done',
                  ).length;
                  const pct = projIssues.length > 0 ? Math.round((doneCount / projIssues.length) * 100) : 0;
                  const otherTeams = (proj.team_ids || [])
                    .filter((tid) => tid !== team.id)
                    .map((tid) => data.organization?.teams.find((t) => t.id === tid))
                    .filter(Boolean);

                  return (
                    <Link key={proj.id} to={`/projects/${proj.id}`} className="team-project-card">
                      <div className="team-project-card-header">
                        <span className="team-project-card-title">
                          <span className="team-project-badge-dot" style={{ background: proj.color }} />
                          {proj.name}
                        </span>
                        <Badge tone="neutral">{proj.key}</Badge>
                      </div>
                      <p style={{ fontSize: 12, color: 'var(--text-muted, #64748b)', margin: 0, lineClamp: 2, overflow: 'hidden' }}>
                        {proj.description || 'No description provided.'}
                      </p>
                      <div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, marginBottom: 4 }}>
                          <span>Team Progress</span>
                          <strong>{pct}% ({doneCount}/{projIssues.length})</strong>
                        </div>
                        <div className="team-progress-track">
                          <div className={`team-progress-fill ${pct === 100 ? 'green' : ''}`} style={{ width: `${pct}%` }} />
                        </div>
                      </div>
                      {otherTeams.length > 0 && (
                        <div style={{ fontSize: 11, color: 'var(--text-muted, #64748b)', display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                          <span>Shared with:</span>
                          {otherTeams.map((ot) => (
                            <span
                              key={ot!.id}
                              style={{
                                background: ot!.color + '22',
                                color: '#1e293b',
                                padding: '1px 6px',
                                borderRadius: 4,
                                fontWeight: 600,
                              }}
                            >
                              {ot!.name}
                            </span>
                          ))}
                        </div>
                      )}
                    </Link>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* Member Contributions Tab */}
        {selected === 'contributions' && (
          <div className="team-contributions-section">
            <header className="team-contributions-header">
              <div className="team-contributions-title">
                <TrendingUp size={16} />
                <span>Member Delivery & Contribution Summary</span>
              </div>
              <div style={{ fontSize: 12, color: 'var(--text-muted, #64748b)' }}>
                Total Delivered: <strong>{contributionsData?.total_completed_issues || 0} issues</strong> · <strong>{contributionsData?.total_story_points || 0} story pts</strong>
              </div>
            </header>
            <table className="team-contributions-table">
              <thead>
                <tr>
                  <th>Member</th>
                  <th>Role</th>
                  <th>Assigned Tasks</th>
                  <th>Completed Tasks</th>
                  <th>Story Points</th>
                  <th>BRDs / Daily</th>
                  <th>Completion Rate</th>
                </tr>
              </thead>
              <tbody>
                {contributionsData?.members.map((m) => (
                  <tr key={m.user_id}>
                    <td>
                      <div className="team-member-cell">
                        <Avatar user={{ name: m.name, color: m.color }} size={28} />
                        <div>
                          <strong>{m.name}</strong>
                          <div style={{ fontSize: 11, color: 'var(--text-muted, #64748b)' }}>{m.email}</div>
                        </div>
                      </div>
                    </td>
                    <td>
                      <Badge tone="neutral">{teamRoleLabels[m.team_role as TeamRole] || m.team_role}</Badge>
                    </td>
                    <td>{m.assigned_issues}</td>
                    <td>
                      <strong style={{ color: '#16a34a' }}>{m.completed_issues}</strong>
                    </td>
                    <td>
                      <strong>{m.story_points} pts</strong>
                    </td>
                    <td>{m.brds_count} BRDs · {m.daily_tasks_count} Daily</td>
                    <td>
                      <div className="team-progress-bar-wrap">
                        <div className="team-progress-track">
                          <div
                            className={`team-progress-fill ${m.completion_rate >= 80 ? 'green' : ''}`}
                            style={{ width: `${m.completion_rate}%` }}
                          />
                        </div>
                        <span style={{ fontSize: 11, fontWeight: 700 }}>{m.completion_rate}%</span>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Team Chat Tab */}
        {selected === 'chat' && (
          <div style={{ marginTop: 12 }}>
            <ChatWidget teamId={team.id} title={`#${team.name.toLowerCase().replace(/[^a-z0-9_-]/g, '-')}-team`} />
          </div>
        )}

        {/* Other sections */}
        {selected !== 'overview' &&
          selected !== 'projects' &&
          selected !== 'contributions' &&
          selected !== 'chat' &&
          teamList}
      </div>

      {/* Add Member Modal */}
      {addMemberOpen && (
        <Modal title="Add Member to Team" onClose={() => setAddMemberOpen(false)}>
          <div className="team-member-modal-form">
            <div className="team-member-modal-field">
              <label>Select Workspace Member</label>
              <select
                value={selectedUserId}
                onChange={(e) => setSelectedUserId(e.target.value)}
              >
                <option value="">Choose a member…</option>
                {availableMembers.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name} ({m.email})
                  </option>
                ))}
              </select>
            </div>

            <div className="team-member-modal-field">
              <label>Team Role</label>
              <select
                value={selectedRole}
                onChange={(e) => setSelectedRole(e.target.value as 'lead' | 'member' | 'viewer')}
              >
                <option value="member">Member</option>
                <option value="lead">Team Lead</option>
                <option value="viewer">Viewer</option>
              </select>
            </div>

            <Button
              disabled={!selectedUserId || addMemberMutation.isPending}
              onClick={() => addMemberMutation.mutate()}
            >
              Add Member
            </Button>
          </div>
        </Modal>
      )}
    </div>
  );
}
