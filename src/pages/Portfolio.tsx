import { useState, type FormEvent } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Plus, Target, ArrowUpRight, Pencil, Users, GitBranch } from 'lucide-react';
import { Link } from 'react-router-dom';
import { api, patch, post } from '../lib/api';
import { useGrace } from '../context';
import { Avatar, Badge, Button, Empty, Modal, formatDate } from '../components/ui';
import type { ProjectModule } from '../../shared/planning';
import type { Project } from '../../shared/types';
interface Initiative {
  id: string;
  name: string;
  description: string;
  state: string;
  lead_id: string | null;
  target_date: string;
  module_ids: string[];
  version: number;
  created_by: string;
}
interface ModulePlan {
  version: number;
  members: string[];
  dependencies: { id: string; name: string; state: string; project_id: string }[];
  metrics: {
    total: number;
    completed: number;
    unassigned: number;
    flagged: number;
    overdue: number;
  };
  has_hidden_dependencies: boolean;
}
export function PortfolioPage() {
  const { data } = useGrace();
  const [edit, setEdit] = useState<Initiative | 'new' | null>(null);
  const initiatives = useQuery({
    queryKey: ['initiatives', data.workspace.id],
    queryFn: () => api<Initiative[]>('/initiatives'),
  });
  const modules = useQuery({
    queryKey: ['portfolio-modules', data.workspace.id],
    queryFn: () => api<ProjectModule[]>('/modules'),
  });
  return (
    <div className="page">
      <div className="page-heading">
        <div>
          <span className="eyebrow">CONNECT DAILY WORK TO A BIGGER PURPOSE</span>
          <h1>Portfolio & initiatives</h1>
          <p>Bring modules from several projects together around a shared outcome.</p>
        </div>
        <Button disabled={data.user.role === 'viewer'} onClick={() => setEdit('new')}>
          <Plus size={16} />
          New initiative
        </Button>
      </div>
      {initiatives.error ? (
        <p className="form-error">{initiatives.error.message}</p>
      ) : initiatives.isPending ? (
        <p>Loading initiatives…</p>
      ) : initiatives.data?.length ? (
        <div className="module-grid">
          {initiatives.data.map((initiative) => {
            const linked = modules.data?.filter((m) => initiative.module_ids.includes(m.id)) || [];
            const done = linked.filter((m) => m.state === 'completed').length;
            const progress = linked.length ? Math.round((done / linked.length) * 100) : 0;
            return (
              <article key={initiative.id} className="module-card">
                <div className="module-card-head">
                  <span className="module-symbol">
                    <Target size={22} />
                  </span>
                  <Badge tone={initiative.state === 'completed' ? 'green' : 'neutral'}>
                    {initiative.state}
                  </Badge>
                </div>
                <h3>{initiative.name}</h3>
                <p className="module-description">
                  {initiative.description || 'A shared direction for the next chapter.'}
                </p>
                <div className="module-progress-copy">
                  <span>
                    {done}/{linked.length} modules completed
                  </span>
                  <strong>{progress}%</strong>
                </div>
                <div className="progress-track">
                  <span style={{ width: `${progress}%`, background: '#7ca18a' }} />
                </div>
                <p className="planning-muted">
                  {new Set(linked.map((m) => m.project_id)).size} projects ·{' '}
                  {initiative.target_date
                    ? `Target ${formatDate(initiative.target_date)}`
                    : 'No target date'}
                </p>
                <div className="planning-header-actions">
                  {(initiative.created_by === data.user.id ||
                    ['owner', 'admin'].includes(data.user.role)) && (
                    <Button variant="secondary" onClick={() => setEdit(initiative)}>
                      <Pencil size={14} />
                      Edit plan
                    </Button>
                  )}
                  <Avatar user={data.members.find((m) => m.id === initiative.lead_id)} />
                </div>
                {linked.map((module) => (
                  <Link
                    className="planning-back"
                    style={{ margin: '15px 0 0' }}
                    key={module.id}
                    to={`/projects/${module.project_id}/modules?module=${module.id}`}
                  >
                    {module.name}
                    <ArrowUpRight size={14} />
                  </Link>
                ))}
              </article>
            );
          })}
        </div>
      ) : (
        <Empty
          title="Give related projects a shared direction"
          text="Create an initiative and connect the modules that contribute to it."
        />
      )}
      {edit && (
        <InitiativeForm
          initiative={edit === 'new' ? undefined : edit}
          modules={modules.data || []}
          onClose={() => setEdit(null)}
        />
      )}
    </div>
  );
}
function InitiativeForm({
  initiative,
  modules,
  onClose,
}: {
  initiative?: Initiative;
  modules: ProjectModule[];
  onClose: () => void;
}) {
  const { data, run } = useGrace();
  const [selected, setSelected] = useState(new Set(initiative?.module_ids || []));
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const values = Object.fromEntries(new FormData(e.currentTarget));
    const body = { ...values, lead_id: values.lead_id || null, module_ids: [...selected] };
    setBusy(true);
    const result = await run(
      () =>
        initiative
          ? patch(`/initiatives/${initiative.id}`, { ...body, version: initiative.version })
          : post('/initiatives', body),
      'Initiative saved.',
    );
    setBusy(false);
    if (result) onClose();
  };
  return (
    <Modal
      title={initiative ? 'Edit initiative' : 'A shared outcome across projects'}
      onClose={onClose}
      wide
    >
      <form onSubmit={submit}>
        <div className="modal-body">
          <label>
            Name
            <input name="name" required maxLength={160} defaultValue={initiative?.name} autoFocus />
          </label>
          <label>
            Outcome
            <textarea
              name="description"
              maxLength={10000}
              rows={3}
              defaultValue={initiative?.description}
            />
          </label>
          <div className="form-row three">
            <label>
              State
              <select name="state" defaultValue={initiative?.state || 'planned'}>
                {['planned', 'active', 'paused', 'completed'].map((state) => (
                  <option key={state}>{state}</option>
                ))}
              </select>
            </label>
            <label>
              Lead
              <select name="lead_id" defaultValue={initiative?.lead_id || ''}>
                <option value="">No lead</option>
                {data.members
                  .filter((m) => m.active !== false && m.active !== 0)
                  .map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name}
                    </option>
                  ))}
              </select>
            </label>
            <label>
              Target date
              <input name="target_date" type="date" defaultValue={initiative?.target_date || ''} />
            </label>
          </div>
          <label>Contributing modules</label>
          <div className="issue-picker">
            {modules
              .filter((m) => data.projects.find((p) => p.id === m.project_id)?.can_write !== false)
              .map((module) => (
                <label className="issue-picker-row" key={module.id}>
                  <input
                    type="checkbox"
                    checked={selected.has(module.id)}
                    onChange={(e) =>
                      setSelected((previous) => {
                        const next = new Set(previous);
                        e.target.checked ? next.add(module.id) : next.delete(module.id);
                        return next;
                      })
                    }
                  />
                  <span>{module.name}</span>
                  <Badge>{data.projects.find((p) => p.id === module.project_id)?.key}</Badge>
                </label>
              ))}
            {!modules.length && (
              <p className="planning-muted">Create a module in a project first.</p>
            )}
          </div>
        </div>
        <div className="modal-footer">
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" busy={busy}>
            Save initiative
          </Button>
        </div>
      </form>
    </Modal>
  );
}
export function ModuleRelationships({ moduleId, project }: { moduleId: string; project: Project }) {
  const { data, run } = useGrace();
  const [edit, setEdit] = useState(false);
  const plan = useQuery({
    queryKey: ['module-planning', data.workspace.id, moduleId],
    queryFn: () => api<ModulePlan>(`/modules/${moduleId}/planning`),
  });
  const modules = useQuery({
    queryKey: ['portfolio-modules', data.workspace.id],
    queryFn: () => api<ProjectModule[]>('/modules'),
    enabled: edit,
  });
  if (plan.error) return <p className="form-error">{plan.error.message}</p>;
  if (!plan.data) return <p className="planning-muted">Loading module plan…</p>;
  return (
    <section className="panel" style={{ padding: 20, marginTop: 20 }}>
      <div className="panel-heading" style={{ padding: 0, marginBottom: 18 }}>
        <div>
          <h2>People, dependencies & health</h2>
          <p>
            {plan.data.metrics.overdue || 0} overdue · {plan.data.metrics.flagged || 0} flagged ·{' '}
            {plan.data.metrics.unassigned || 0} unassigned
          </p>
        </div>
        <Button
          variant="secondary"
          disabled={
            project.can_write === false ||
            data.user.role === 'viewer' ||
            plan.data.has_hidden_dependencies
          }
          onClick={() => setEdit(true)}
        >
          <Pencil size={14} />
          Edit plan
        </Button>
      </div>
      <div className="planning-header-actions">
        <Users size={16} />
        {plan.data.members.length ? (
          plan.data.members.map((id) => (
            <Avatar key={id} user={data.members.find((m) => m.id === id)} />
          ))
        ) : (
          <span className="planning-muted">No members assigned</span>
        )}
      </div>
      <div style={{ marginTop: 15 }}>
        <p className="planning-muted">
          <GitBranch size={15} />
          Depends on
        </p>
        {plan.data.dependencies.length ? (
          plan.data.dependencies.map((dependency) => (
            <Link
              key={dependency.id}
              className="planning-back"
              style={{ margin: '12px 0' }}
              to={`/projects/${dependency.project_id}/modules?module=${dependency.id}`}
            >
              {dependency.name}
              <Badge tone={dependency.state === 'completed' ? 'green' : 'amber'}>
                {dependency.state}
              </Badge>
            </Link>
          ))
        ) : (
          <p className="planning-muted">No visible dependencies.</p>
        )}
        {plan.data.has_hidden_dependencies && (
          <p className="planning-muted">
            Some dependencies require additional project access. A workspace administrator can
            manage the complete plan.
          </p>
        )}
      </div>
      {edit && (
        <Modal title="Plan module ownership and dependencies" onClose={() => setEdit(false)} wide>
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              const form = new FormData(e.currentTarget);
              const result = await run(
                () =>
                  api(`/modules/${moduleId}/planning`, {
                    method: 'PUT',
                    body: JSON.stringify({
                      version: plan.data!.version,
                      members: form.getAll('members'),
                      depends_on: form.getAll('depends_on'),
                    }),
                  }),
                'Module plan saved.',
              );
              if (result) setEdit(false);
            }}
          >
            <div className="modal-body">
              <label>Members with project access</label>
              <div className="issue-picker">
                {data.members
                  .filter((m) => m.active !== false && m.active !== 0)
                  .map((member) => (
                    <label className="issue-picker-row" key={member.id}>
                      <input
                        type="checkbox"
                        name="members"
                        value={member.id}
                        defaultChecked={plan.data!.members.includes(member.id)}
                      />
                      <Avatar user={member} />
                      {member.name}
                    </label>
                  ))}
              </div>
              <label>Depends on these modules</label>
              <div className="issue-picker">
                {modules.data
                  ?.filter((m) => m.id !== moduleId)
                  .map((module) => (
                    <label className="issue-picker-row" key={module.id}>
                      <input
                        type="checkbox"
                        name="depends_on"
                        value={module.id}
                        defaultChecked={plan.data!.dependencies.some((d) => d.id === module.id)}
                      />
                      <span>{module.name}</span>
                      <Badge>{data.projects.find((p) => p.id === module.project_id)?.key}</Badge>
                    </label>
                  ))}
              </div>
              <p className="planning-muted">
                Circular dependencies are rejected. Dependencies describe sequencing; they do not
                automatically change issue status.
              </p>
            </div>
            <div className="modal-footer">
              <Button variant="secondary" type="button" onClick={() => setEdit(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={!modules.data}>
                Save module plan
              </Button>
            </div>
          </form>
        </Modal>
      )}
    </section>
  );
}
interface Retrospective {
  id: string;
  author_id: string;
  went_well: string;
  improve: string;
  actions: string;
  version: number;
}
export function CycleRetrospectives({
  sprintId,
  closed,
  canWrite,
}: {
  sprintId: string;
  closed: boolean;
  canWrite: boolean;
}) {
  const { data, run } = useGrace();
  const [edit, setEdit] = useState(false);
  const query = useQuery({
    queryKey: ['retrospectives', data.workspace.id, sprintId],
    queryFn: () => api<Retrospective[]>(`/sprints/${sprintId}/retrospectives`),
  });
  const mine = query.data?.find((r) => r.author_id === data.user.id);
  return (
    <section className="panel" style={{ padding: 22, marginTop: 22 }}>
      <div className="panel-heading" style={{ padding: 0 }}>
        <div>
          <h2>Cycle retrospective</h2>
          <p>Keep the lessons and next actions close to the cycle.</p>
        </div>
        <Button
          variant="secondary"
          disabled={!closed || !canWrite || !query.data}
          onClick={() => setEdit(true)}
        >
          {mine ? 'Edit my reflection' : 'Add my reflection'}
        </Button>
      </div>
      {!closed && <p className="planning-muted">Reflections open when this cycle is completed.</p>}
      {query.error && <p className="form-error">{query.error.message}</p>}
      {query.data?.map((reflection) => (
        <article
          key={reflection.id}
          style={{ padding: '20px 0', borderBottom: '1px solid var(--line)' }}
        >
          <div className="planning-header-actions">
            <Avatar user={data.members.find((m) => m.id === reflection.author_id)} />
            <strong>{data.members.find((m) => m.id === reflection.author_id)?.name}</strong>
          </div>
          {[
            ['Went well', reflection.went_well],
            ['Improve', reflection.improve],
            ['Next actions', reflection.actions],
          ].map(
            ([label, text]) =>
              text && (
                <div key={label}>
                  <h3 style={{ fontSize: 14 }}>{label}</h3>
                  <p style={{ fontSize: 14, whiteSpace: 'pre-wrap', lineHeight: 1.7 }}>{text}</p>
                </div>
              ),
          )}
        </article>
      ))}
      {closed && !query.data?.length && (
        <p className="planning-muted">No reflections shared yet.</p>
      )}
      {edit && (
        <Modal title="Reflect on this cycle" onClose={() => setEdit(false)}>
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              const form = Object.fromEntries(new FormData(e.currentTarget));
              if (
                await run(
                  () =>
                    api(`/sprints/${sprintId}/retrospectives`, {
                      method: 'PUT',
                      body: JSON.stringify({ ...form, version: mine?.version || 0 }),
                    }),
                  'Reflection saved.',
                )
              )
                setEdit(false);
            }}
          >
            <div className="modal-body">
              <label>
                What went well?
                <textarea
                  name="went_well"
                  defaultValue={mine?.went_well}
                  maxLength={10000}
                  rows={3}
                />
              </label>
              <label>
                What could improve?
                <textarea name="improve" defaultValue={mine?.improve} maxLength={10000} rows={3} />
              </label>
              <label>
                Next actions
                <textarea name="actions" defaultValue={mine?.actions} maxLength={10000} rows={3} />
              </label>
            </div>
            <div className="modal-footer">
              <Button type="button" variant="secondary" onClick={() => setEdit(false)}>
                Cancel
              </Button>
              <Button type="submit">Save reflection</Button>
            </div>
          </form>
        </Modal>
      )}
    </section>
  );
}
