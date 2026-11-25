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
import { api, post, put, del } from '../lib/api';
import { ChatWidget } from '../components/ChatWidget';
import type { TeamMemberContribution, TeamMemberProjectAllocation } from '../../shared/types';

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

  // Member project allocation state
  const [assignProjectsMember, setAssignProjectsMember] = useState<TeamMemberProjectAllocation | null>(null);
  const [assignMembersProject, setAssignMembersProject] = useState<{ id: string; name: string; key: string } | null>(null);
  const [selectedProjectIds, setSelectedProjectIds] = useState<string[]>([]);
  const [selectedMemberUserIds, setSelectedMemberUserIds] = useState<string[]>([]);

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

  // Query member project allocations
  const { data: memberProjectsData, refetch: refetchMemberProjects } = useQuery<{
    projects: Array<{ id: string; name: string; key: string; color: string; description: string }>;
    members: Array<TeamMemberProjectAllocation>;
  }>({
    queryKey: ['team-member-projects', team.id],
    queryFn: () => api(`/organization/teams/${team.id}/member-projects`),
    enabled: Boolean(canManageMembers),
  });

  // Assign member projects mutation
  const assignMemberProjectsMutation = useMutation({
    mutationFn: () =>
      put(`/organization/teams/${team.id}/members/${assignProjectsMember?.user_id}/projects`, {
        project_ids: selectedProjectIds,
      }),
    onSuccess: async () => {
      setAssignProjectsMember(null);
      await refetchMemberProjects();
      await refresh();
    },
  });

  // Assign project members mutation
  const assignProjectMembersMutation = useMutation({
    mutationFn: () =>
      put(`/organization/teams/${team.id}/projects/${assignMembersProject?.id}/members`, {
        user_ids: selectedMemberUserIds,
      }),
    onSuccess: async () => {
      setAssignMembersProject(null);
      await refetchMemberProjects();
      await refresh();
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
                people.map((person) => {
                  const alloc = memberProjectsData?.members?.find((m) => m.user_id === person.id);
                  const memberProjects = (alloc?.project_ids || [])
                    .map((pid) => (memberProjectsData?.projects || assignedProjects).find((p) => p.id === pid))
                    .filter(Boolean);

                  return (
                    <div className="team-person" key={person.id}>
                      <div className="focus-team-member-top">
                        <div className="focus-team-member-info">
                          <Avatar user={person} size={34} />
                          <div className="focus-team-member-meta">
                            <strong title={person.name}>{person.name}</strong>
                            <small>{teamRoleLabels[person.team_role || 'member']}</small>
                          </div>
                        </div>
                        {canManageMembers && person.id !== data.user.id && (
                          <div className="focus-team-member-controls">
                            <select
                              aria-label={`Team role for ${person.name}`}
                              value={person.team_role || 'member'}
                              onChange={(e) => updateRoleMutation.mutate({ userId: person.id, role: e.target.value })}
                            >
                              <option value="lead">Lead</option>
                              <option value="member">Member</option>
                              <option value="viewer">Viewer</option>
                            </select>
                            <button
                              type="button"
                              className="focus-team-remove-btn"
                              aria-label={`Remove ${person.name} from team`}
                              title="Remove from team"
                              onClick={() => removeMemberMutation.mutate(person.id)}
                            >
                              <UserMinus size={14} />
                            </button>
                          </div>
                        )}
                      </div>

                      {canManageMembers && (
                        <div className="focus-team-member-projects">
                          <div className="focus-team-project-pills">
                            <span className="focus-team-projects-label">Projects:</span>
                            {memberProjects.length === 0 ? (
                              <span className="focus-team-projects-empty">None allocated</span>
                            ) : (
                              memberProjects.map((p) => (
                                <span
                                  key={p!.id}
                                  className="focus-team-project-chip"
                                  style={{ background: p!.color || '#e2e8f0' }}
                                >
                                  {p!.key}
                                </span>
                              ))
                            )}
                          </div>

                          <button
                            type="button"
                            className="btn secondary focus-team-projects-btn"
                            title="Allocate to specific projects"
                            onClick={() => {
                              setAssignProjectsMember(
                                alloc || {
                                  user_id: person.id,
                                  name: person.name,
                                  email: person.email,
                                  color: person.color,
                                  team_role: person.team_role || 'member',
                                  project_ids: [],
                                },
                              );
                              setSelectedProjectIds(alloc?.project_ids || []);
                            }}
                          >
                            <FolderKanban size={12} />
                            Projects
                          </button>
                        </div>
                      )}
                    </div>
                  );
                })
              ) : (
                <p>No employees are assigned to this team yet.</p>
              )}
              {canManageMembers && (
                <button
                  type="button"
                  className="btn secondary focus-team-add-member-btn"
                  onClick={() => setAddMemberOpen(true)}
                >
                  <UserPlus size={14} />
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

                  const allocatedMembers = (memberProjectsData?.members || []).filter((m) =>
                    m.project_ids.includes(proj.id),
                  );

                  return (
                    <div key={proj.id} className="team-project-card" style={{ display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
                      <div>
                        <div className="team-project-card-header">
                          <Link to={`/projects/${proj.id}`} className="team-project-card-title">
                            <span className="team-project-badge-dot" style={{ background: proj.color }} />
                            {proj.name}
                          </Link>
                          <Badge tone="neutral">{proj.key}</Badge>
                        </div>
                        <p style={{ fontSize: 12, color: 'var(--text-muted, #64748b)', margin: '4px 0 8px 0', lineClamp: 2, overflow: 'hidden' }}>
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

                        {/* Allocated Team Members */}
                        {canManageMembers && (
                          <div style={{ marginTop: 10, paddingTop: 10, borderTop: '1px solid var(--line)' }}>
                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                              <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--muted)' }}>
                                Allocated Members ({allocatedMembers.length})
                              </span>
                              <button
                                type="button"
                                className="btn secondary focus-team-projects-btn"
                                onClick={(e) => {
                                  e.preventDefault();
                                  setAssignMembersProject({ id: proj.id, name: proj.name, key: proj.key });
                                  setSelectedMemberUserIds(allocatedMembers.map((m) => m.user_id));
                                }}
                              >
                                <Users size={12} />
                                Allocate
                              </button>
                            </div>
                            <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', alignItems: 'center' }}>
                              {allocatedMembers.length === 0 ? (
                                <span style={{ fontSize: 12, color: 'var(--muted)', fontStyle: 'italic' }}>
                                  No team members allocated yet
                                </span>
                              ) : (
                                allocatedMembers.map((m) => (
                                  <span
                                    key={m.user_id}
                                    title={`${m.name} (${m.email})`}
                                    style={{
                                      display: 'inline-flex',
                                      alignItems: 'center',
                                      gap: 5,
                                      fontSize: 12,
                                      padding: '2px 8px',
                                      borderRadius: 14,
                                      background: 'var(--sage)',
                                      color: 'var(--text)',
                                      fontWeight: 500,
                                    }}
                                  >
                                    <Avatar user={{ name: m.name, color: m.color }} size={16} />
                                    <span>{m.name.split(' ')[0]}</span>
                                  </span>
                                ))
                              )}
                            </div>
                          </div>
                        )}
                      </div>

                      {otherTeams.length > 0 && (
                        <div style={{ fontSize: 11, color: 'var(--text-muted, #64748b)', display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', marginTop: 8 }}>
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
                    </div>
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

      {/* Allocate Member to Projects Modal */}
      {assignProjectsMember && (
        <Modal
          title={`Allocate ${assignProjectsMember.name} to Projects`}
          onClose={() => setAssignProjectsMember(null)}
        >
          <div className="team-member-modal-form">
            <p style={{ fontSize: 13, color: 'var(--text-muted, #64748b)', margin: 0 }}>
              Select which projects this team member should be assigned to work on.
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 320, overflowY: 'auto', marginTop: 10 }}>
              {(memberProjectsData?.projects || assignedProjects).length === 0 ? (
                <p style={{ fontSize: 12, color: 'var(--text-muted, #64748b)' }}>No projects are assigned to this team yet.</p>
              ) : (
                (memberProjectsData?.projects || assignedProjects).map((p) => {
                  const checked = selectedProjectIds.includes(p.id);
                  return (
                    <label
                      key={p.id}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 10,
                        padding: '8px 10px',
                        borderRadius: 6,
                        border: '1px solid var(--border, #e2e8f0)',
                        background: checked ? 'var(--sage, #edf2e9)' : 'transparent',
                        cursor: 'pointer',
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={(e) => {
                          if (e.target.checked) {
                            setSelectedProjectIds((prev) => [...prev, p.id]);
                          } else {
                            setSelectedProjectIds((prev) => prev.filter((id) => id !== p.id));
                          }
                        }}
                      />
                      <span
                        style={{
                          width: 10,
                          height: 10,
                          borderRadius: '50%',
                          background: p.color || '#3b82f6',
                          flexShrink: 0,
                        }}
                      />
                      <span style={{ fontWeight: 600, flex: 1, fontSize: 13 }}>{p.name}</span>
                      <Badge tone="neutral">{p.key}</Badge>
                    </label>
                  );
                })
              )}
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
              <Button variant="secondary" onClick={() => setAssignProjectsMember(null)}>
                Cancel
              </Button>
              <Button
                busy={assignMemberProjectsMutation.isPending}
                onClick={() => assignMemberProjectsMutation.mutate()}
              >
                Save Allocations
              </Button>
            </div>
          </div>
        </Modal>
      )}

      {/* Allocate Team Members to Project Modal */}
      {assignMembersProject && (
        <Modal
          title={`Allocate Team Members: ${assignMembersProject.name}`}
          onClose={() => setAssignMembersProject(null)}
        >
          <div className="team-member-modal-form">
            <p style={{ fontSize: 13, color: 'var(--text-muted, #64748b)', margin: 0 }}>
              Select which members of {team.name} should be allocated to work on {assignMembersProject.name} ({assignMembersProject.key}).
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 320, overflowY: 'auto', marginTop: 10 }}>
              {people.length === 0 ? (
                <p style={{ fontSize: 12, color: 'var(--text-muted, #64748b)' }}>No members in this team.</p>
              ) : (
                people.map((person) => {
                  const checked = selectedMemberUserIds.includes(person.id);
                  return (
                    <label
                      key={person.id}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 10,
                        padding: '8px 10px',
                        borderRadius: 6,
                        border: '1px solid var(--border, #e2e8f0)',
                        background: checked ? 'var(--sage, #edf2e9)' : 'transparent',
                        cursor: 'pointer',
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={(e) => {
                          if (e.target.checked) {
                            setSelectedMemberUserIds((prev) => [...prev, person.id]);
                          } else {
                            setSelectedMemberUserIds((prev) => prev.filter((id) => id !== person.id));
                          }
                        }}
                      />
                      <Avatar user={person} size={26} />
                      <div style={{ flex: 1 }}>
                        <div style={{ fontWeight: 600, fontSize: 13 }}>{person.name}</div>
                        <small style={{ color: 'var(--text-muted, #64748b)' }}>{person.email}</small>
                      </div>
                      <Badge tone="neutral">{teamRoleLabels[person.team_role || 'member']}</Badge>
                    </label>
                  );
                })
              )}
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
              <Button variant="secondary" onClick={() => setAssignMembersProject(null)}>
                Cancel
              </Button>
              <Button
                busy={assignProjectMembersMutation.isPending}
                onClick={() => assignProjectMembersMutation.mutate()}
              >
                Save Allocations
              </Button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
