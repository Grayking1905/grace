import { useState, type FormEvent } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import {
  ArrowUpRight,
  LayoutDashboard,
  Plus,
  Search,
  Settings2,
  ShieldCheck,
  Users,
} from 'lucide-react';
import type { User } from '../../shared/types';
import {
  dashboardSections,
  defaultTeamPermissions,
  teamCapabilities,
  teamRoleLabels,
  type DashboardSection,
  type EmployeeProfile,
  type OrganizationTeam,
  type TeamPermissions,
} from '../../shared/organization';
import { useGrace } from '../context';
import { api, patch, post } from '../lib/api';
import { Avatar, Badge, Button, Empty, Modal } from '../components/ui';
import '../organization.css';

const sectionNames: Record<DashboardSection, string> = {
  issues: 'Issues',
  bugs: 'Bugs',
  features: 'Features',
  brds: 'BRDs',
  daily: 'Daily tasks',
  versions: 'Versions',
};
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
export { OrganizationMyWork } from './Focus';
export { OrganizationHome } from './Home';
export { TeamDashboard } from './TeamDashboard';

type Employee = EmployeeProfile & Pick<User, 'name' | 'email' | 'color' | 'role' | 'active'>;
export function OrganizationAdministration() {
  const { data } = useGrace();
  const admin = !!data.organization?.can_admin;
  const mayManage = admin || !!data.organization?.can_manage_team;
  const [tab, setTab] = useState('dashboards');
  const [editing, setEditing] = useState<OrganizationTeam | null | undefined>(undefined);
  const [employee, setEmployee] = useState<Employee | null>(null);
  const [search, setSearch] = useState('');
  const employees = useQuery({
    queryKey: ['organization-employees', data.workspace.id],
    queryFn: () => api<Employee[]>('/organization/employees'),
    enabled: mayManage,
  });
  if (!mayManage)
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
          <h1>{admin ? 'Teams & roles' : 'Manage my team'}</h1>
          <p>
            {admin
              ? 'Manage your teams, employee assignments and access.'
              : 'Manage your team dashboard and member roles.'}
          </p>
        </div>
        {admin && (
          <Button onClick={() => setEditing(null)}>
            <Plus size={16} />
            Create team dashboard
          </Button>
        )}
      </div>
      <div className="organization-admin-note">
        <ShieldCheck size={19} />
        <p>
          {admin
            ? 'Admins assign teams and Team Managers. Team Managers oversee their own team’s work and member roles.'
            : 'You can manage this team’s work, layout and member roles. Organization admins manage employee IDs, team transfers and manager access.'}
        </p>
      </div>
      <div className="organization-tabs" role="tablist" aria-label="Organization administration">
        {[
          ['dashboards', 'Team dashboards'],
          ['employees', 'Employee assignments'],
          ...(admin ? [['invite', 'Invite an employee']] : []),
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
          {data.organization!.teams.map((t) => (
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
                    <Badge>{teamRoleLabels[e.team_role]}</Badge>
                    <Button
                      variant="secondary"
                      onClick={() => setEmployee(e)}
                      disabled={
                        e.active === false ||
                        e.active === 0 ||
                        (!admin &&
                          (e.user_id === data.user.id ||
                            e.team_role === 'manager' ||
                            ['owner', 'admin'].includes(e.role)))
                      }
                      title={
                        !admin && (e.team_role === 'manager' || ['owner', 'admin'].includes(e.role))
                          ? 'Organization admins manage this role'
                          : undefined
                      }
                    >
                      Edit assignment
                    </Button>
                  </div>
                ))}
            </div>
          )}
          <p className="organization-footnote">
            {admin ? (
              <>
                Organization roles and account deactivation are available in{' '}
                <Link to="/administration">Administration</Link>.
              </>
            ) : (
              'Ask an organization admin to invite employees, transfer teams or assign another Team Manager.'
            )}
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
  const { run, data } = useGrace();
  const admin = !!data.organization?.can_admin;
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
    const body = { ...values, sections, ...(admin ? { permissions } : {}), version: team?.version };
    const saved = await run(
      () =>
        team
          ? patch(`/organization/teams/${team.id}${admin ? '' : '/layout'}`, body)
          : post('/organization/teams', body),
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
          {admin && (
            <details className="form-disclosure">
              <summary>Advanced role permissions</summary>
              <fieldset>
                <legend>Role privileges</legend>
                <p>
                  These privileges control editing. Project access and organization roles also
                  apply.
                </p>
                <div className="team-permission-grid">
                  <span>Can create and edit</span>
                  <strong>Manager</strong>
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
                <small>
                  Owners and organization admins retain access to every team and component.
                </small>
              </fieldset>
            </details>
          )}
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
      {(['manager', 'lead', 'member', 'viewer'] as const).map((role) => (
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
  const admin = !!data.organization?.can_admin;
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setBusy(true);
    const values = Object.fromEntries(new FormData(e.currentTarget));
    const saved = await run(
      () =>
        api(`/organization/employees/${employee.user_id}`, {
          method: 'PUT',
          body: JSON.stringify({
            ...values,
            employee_id: admin ? values.employee_id : employee.employee_id,
            team_id: admin ? values.team_id : employee.team_id,
            version: employee.version,
          }),
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
          <p>
            {admin
              ? 'Assign a team and the right level of access.'
              : 'Change this employee’s role within your team.'}
          </p>
          <label>
            Employee ID
            <input
              name="employee_id"
              required
              minLength={2}
              maxLength={40}
              pattern="[A-Za-z0-9][A-Za-z0-9_-]{1,39}"
              defaultValue={employee.employee_id}
              readOnly={!admin}
            />
          </label>
          <label>
            Team dashboard
            <select name="team_id" defaultValue={employee.team_id} disabled={!admin}>
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
              {admin && <option value="manager">Team Manager</option>}
              <option value="lead">Team lead</option>
              <option value="member">Member</option>
              <option value="viewer">Viewer</option>
            </select>
          </label>
          <small>
            {admin
              ? 'Team Managers manage work and member roles in their own team. Reassign open team items before transferring an employee.'
              : 'You can assign Team Lead, Member or Viewer. Only organization admins assign Team Managers.'}
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
            <select name="team_role" defaultValue="member">
              <option value="manager">Team Manager</option>
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
