import { useMemo, useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  LineChart,
  Line,
  ResponsiveContainer,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
} from 'recharts';
import {
  Plus,
  Layers,
  ArrowLeft,
  ArrowUpRight,
  Archive,
  RotateCcw,
  Pencil,
  CalendarDays,
  CircleDashed,
  CircleCheck,
  Check,
  Target,
  Search,
  X,
  Flag,
  Play,
  Download,
  Users,
  Minus,
  ArrowRight,
} from 'lucide-react';
import type { Issue, Project, Sprint } from '../../shared/types';
import type {
  ModuleDetail,
  ModuleInput,
  ModulePatch,
  ModuleState,
  ProjectModule,
  SprintAnalytics,
} from '../../shared/planning';
import { useGrace } from '../context';
import { api, patch, post, download } from '../lib/api';
import {
  Avatar,
  Badge,
  Button,
  Empty,
  IconButton,
  Modal,
  TypeIcon,
  formatDate,
} from '../components/ui';
import { IssueTable } from './Workspace';
import { CreateSprint, CompleteSprint } from '../components/SprintDialogs';
import '../planning.css';
import { ModuleRelationships, CycleRetrospectives } from './Portfolio';

const stateNames: Record<ModuleState, string> = {
  planned: 'Planned',
  in_progress: 'In progress',
  paused: 'Paused',
  completed: 'Completed',
  cancelled: 'Cancelled',
};
const stateTone = (state: ModuleState) =>
  state === 'completed'
    ? 'green'
    : state === 'paused'
      ? 'amber'
      : state === 'in_progress'
        ? 'lavender'
        : 'neutral';

export function ProjectModules({ project }: { project: Project }) {
  const { data, run } = useGrace();
  const [params, setParams] = useSearchParams();
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('all');
  const [showArchived, setShowArchived] = useState(false);
  const [create, setCreate] = useState(false);
  const modules = useQuery({
    queryKey: ['modules', data.workspace.id, project.id, showArchived],
    queryFn: () =>
      api<ProjectModule[]>(`/modules?project_id=${project.id}&include_archived=${showArchived}`),
  });
  const selected = params.get('module');
  const choose = (id: string | null) =>
    setParams((p) => {
      if (id) p.set('module', id);
      else p.delete('module');
      return p;
    });
  const list = (modules.data || []).filter(
    (m) =>
      m.name.toLowerCase().includes(search.toLowerCase()) &&
      (filter === 'all' || m.state === filter),
  );
  return (
    <section className="planning-view">
      <div className="planning-intro">
        <div>
          <span className="eyebrow">BUILD WITH A SHARED PURPOSE</span>
          <h2>{selected ? 'A closer look at the work.' : 'Big ideas, in manageable pieces.'}</h2>
          <p>Group related issues into features and milestones, across any sprint.</p>
        </div>
        <Button
          disabled={data.user.role === 'viewer' || project.can_write === false}
          onClick={() => setCreate(true)}
        >
          <Plus size={16} />
          New module
        </Button>
      </div>
      {selected ? (
        <ModuleFocus moduleId={selected} project={project} onBack={() => choose(null)} />
      ) : (
        <>
          <div className="planning-toolbar">
            <div className="search-field">
              <Search size={16} />
              <input
                aria-label="Find a module"
                placeholder="Find a module…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
            <select
              aria-label="Module state"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
            >
              <option value="all">All states</option>
              {Object.entries(stateNames).map(([value, name]) => (
                <option key={value} value={value}>
                  {name}
                </option>
              ))}
            </select>
            <label className="planning-toggle">
              <input
                type="checkbox"
                checked={showArchived}
                onChange={(e) => setShowArchived(e.target.checked)}
              />
              Include archived
            </label>
            <span className="planning-result-count">{list.length} modules</span>
          </div>
          {modules.isPending ? (
            <PlanningLoading />
          ) : modules.error ? (
            <PlanningError error={modules.error} retry={() => modules.refetch()} />
          ) : list.length ? (
            <div className="module-grid">
              {list.map((module) => (
                <article
                  className={`module-card ${module.archived_at ? 'archived' : ''}`}
                  key={module.id}
                >
                  <div className="module-card-head">
                    <span className="module-symbol">
                      <Layers size={20} />
                    </span>
                    <Badge tone={stateTone(module.state)}>{stateNames[module.state]}</Badge>
                    {module.archived_at && <Badge>Archived</Badge>}
                  </div>
                  <button className="module-open" onClick={() => choose(module.id)}>
                    <h3>{module.name}</h3>
                    <ArrowUpRight size={17} />
                  </button>
                  <p className="module-description">
                    {module.description || 'A shared focus for the next piece of your project.'}
                  </p>
                  <div className="module-progress-copy">
                    <span>
                      {module.completed_issues} / {module.total_issues} issues completed
                    </span>
                    <strong>{module.progress}%</strong>
                  </div>
                  <div className="progress-track">
                    <span style={{ width: `${module.progress}%` }} />
                  </div>
                  <footer>
                    <div>
                      <Avatar user={data.members.find((m) => m.id === module.lead_id)} size={27} />
                      <span>
                        {data.members.find((m) => m.id === module.lead_id)?.name.split(' ')[0] ||
                          'No lead'}
                      </span>
                    </div>
                    <span>
                      <CalendarDays size={13} />
                      {module.end_date ? formatDate(module.end_date) : 'No target date'}
                    </span>
                  </footer>
                </article>
              ))}
            </div>
          ) : (
            <Empty
              title={
                search || filter !== 'all'
                  ? 'No modules match this view'
                  : 'Give a great idea a clear shape'
              }
              text="Create a module, bring related issues together, and follow their progress toward a shared goal."
              action={
                <Button
                  onClick={() => setCreate(true)}
                  disabled={data.user.role === 'viewer' || project.can_write === false}
                >
                  <Plus size={16} />
                  Create a module
                </Button>
              }
            />
          )}
        </>
      )}
      {create && (
        <ModuleForm
          project={project}
          onClose={() => setCreate(false)}
          onSaved={(module) => {
            setCreate(false);
            choose(module.id);
          }}
        />
      )}
    </section>
  );
}

function ModuleFocus({
  moduleId,
  project,
  onBack,
}: {
  moduleId: string;
  project: Project;
  onBack: () => void;
}) {
  const { data, run } = useGrace();
  const query = useQuery({
    queryKey: ['module', data.workspace.id, moduleId],
    queryFn: () => api<ModuleDetail>(`/modules/${moduleId}`),
  });
  const [edit, setEdit] = useState(false);
  const [picker, setPicker] = useState(false);
  const [archive, setArchive] = useState(false);
  const [busy, setBusy] = useState(false);
  if (query.isPending) return <PlanningLoading />;
  if (query.error || !query.data)
    return (
      <PlanningError
        error={query.error || new Error('Module unavailable.')}
        retry={() => query.refetch()}
      />
    );
  const { module, issues } = query.data;
  const canArchive =
    project.can_write !== false &&
    (['owner', 'admin'].includes(data.user.role) || project.lead_id === data.user.id);
  const writable =
    data.user.role !== 'viewer' && project.can_write !== false && !module.archived_at;
  const update = async (changes: Omit<ModulePatch, 'version'>) => {
    setBusy(true);
    const result = await run(
      () => patch<ProjectModule>(`/modules/${module.id}`, { ...changes, version: module.version }),
      'Module updated.',
    );
    setBusy(false);
    return result;
  };
  return (
    <div className="module-focus">
      <button className="planning-back" onClick={onBack}>
        <ArrowLeft size={15} />
        All modules
      </button>
      <div className="module-focus-header">
        <span className="module-symbol large">
          <Layers size={25} />
        </span>
        <div>
          <div className="planning-title-line">
            <h2>{module.name}</h2>
            <Badge tone={stateTone(module.state)}>{stateNames[module.state]}</Badge>
            {module.archived_at && <Badge>Archived</Badge>}
          </div>
          <p>{module.description || 'Keep this module’s work connected to a clear outcome.'}</p>
        </div>
        <div className="planning-header-actions">
          <Button variant="secondary" disabled={!writable} onClick={() => setEdit(true)}>
            <Pencil size={14} />
            Edit
          </Button>
          {canArchive && (
            <Button
              variant="secondary"
              disabled={busy}
              onClick={() => (module.archived_at ? update({ archived: false }) : setArchive(true))}
            >
              {module.archived_at ? <RotateCcw size={14} /> : <Archive size={14} />}{' '}
              {module.archived_at ? 'Restore' : 'Archive'}
            </Button>
          )}
        </div>
      </div>
      <div className="module-focus-layout">
        <div>
          <div className="planning-metrics">
            <Metric
              icon={CircleCheck}
              title="Completed"
              value={`${module.completed_issues}/${module.total_issues}`}
              note="Issues in a done state"
            />
            <Metric
              icon={Target}
              title="Points delivered"
              value={`${module.completed_points}/${module.total_points}`}
              note="From linked work items"
            />
            <Metric
              icon={CircleDashed}
              title="Progress"
              value={`${module.progress}%`}
              note="Based on completed issues"
            />
          </div>
          <section className="panel">
            <div className="panel-heading">
              <div>
                <h2>Work in this module</h2>
                <p>Issues stay in their project and can belong to more than one module.</p>
              </div>
              <Button variant="secondary" onClick={() => setPicker(true)} disabled={!writable}>
                <Plus size={15} />
                Add issues
              </Button>
            </div>
            <IssueTable issues={issues} />
          </section>
        </div>
        <aside className="module-properties panel">
          <h3>Module details</h3>
          <label>
            State
            <select
              aria-label="Module status"
              disabled={!writable || busy}
              value={module.state}
              onChange={(e) => update({ state: e.target.value as ModuleState })}
            >
              {Object.entries(stateNames).map(([value, name]) => (
                <option key={value} value={value}>
                  {name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Lead
            <div className="module-person">
              <Avatar user={data.members.find((m) => m.id === module.lead_id)} size={29} />
              <span>
                {data.members.find((m) => m.id === module.lead_id)?.name || 'No lead assigned'}
              </span>
            </div>
          </label>
          <label>
            Start date
            <strong>{module.start_date ? formatDate(module.start_date) : 'Not scheduled'}</strong>
          </label>
          <label>
            Target date
            <strong>{module.end_date ? formatDate(module.end_date) : 'No target date'}</strong>
          </label>
          <div className="progress-track">
            <span style={{ width: `${module.progress}%` }} />
          </div>
          <p>All linked work must be done before a module can be marked completed.</p>
        </aside>
      </div>
      <ModuleRelationships moduleId={module.id} project={project} />
      {edit && (
        <ModuleForm
          project={project}
          module={module}
          onClose={() => setEdit(false)}
          onSaved={() => setEdit(false)}
        />
      )}
      {picker && (
        <IssuePicker
          project={project}
          selectedIds={module.issue_ids}
          title={`Work in ${module.name}`}
          onClose={() => setPicker(false)}
          onSave={async (ids) => {
            const result = await update({ issue_ids: ids });
            if (result) setPicker(false);
          }}
        />
      )}
      {archive && (
        <Modal title="Archive this module?" onClose={() => setArchive(false)}>
          <div className="modal-body">
            <p>
              The module will leave the active view. Its issues stay in their project, and you can
              restore the module at any time.
            </p>
          </div>
          <div className="modal-footer">
            <Button variant="secondary" onClick={() => setArchive(false)}>
              Keep active
            </Button>
            <Button
              busy={busy}
              onClick={async () => {
                const result = await update({ archived: true });
                if (result) {
                  setArchive(false);
                  onBack();
                }
              }}
            >
              <Archive size={14} />
              Archive module
            </Button>
          </div>
        </Modal>
      )}
    </div>
  );
}

function ModuleForm({
  project,
  module,
  onClose,
  onSaved,
}: {
  project: Project;
  module?: ProjectModule;
  onClose: () => void;
  onSaved: (module: ProjectModule) => void;
}) {
  const { data, run } = useGrace();
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const values = Object.fromEntries(new FormData(e.currentTarget));
    const body: ModuleInput = {
      project_id: project.id,
      name: String(values.name),
      description: String(values.description),
      state: values.state as ModuleState,
      lead_id: values.lead_id ? String(values.lead_id) : null,
      start_date: String(values.start_date || ''),
      end_date: String(values.end_date || ''),
    };
    setBusy(true);
    const result = await run(
      () =>
        module
          ? patch<ProjectModule>(`/modules/${module.id}`, {
              ...body,
              project_id: undefined,
              version: module.version,
            })
          : post<ProjectModule>('/modules', body),
      module ? 'Module saved.' : 'Your module is ready.',
    );
    setBusy(false);
    if (result) onSaved(result);
  };
  return (
    <Modal
      title={module ? 'Edit module' : 'A clear purpose for the next piece of work'}
      onClose={onClose}
    >
      <form onSubmit={submit}>
        <div className="modal-body">
          <label>
            Module name
            <input
              name="name"
              required
              maxLength={120}
              autoFocus
              defaultValue={module?.name || ''}
              placeholder="e.g. Customer onboarding"
            />
          </label>
          <label>
            Description
            <textarea
              name="description"
              rows={3}
              maxLength={5000}
              defaultValue={module?.description || ''}
              placeholder="What outcome brings this work together?"
            />
          </label>
          <div className="form-row">
            <label>
              State
              <select name="state" defaultValue={module?.state || 'planned'}>
                {Object.entries(stateNames).map(([value, name]) => (
                  <option key={value} value={value}>
                    {name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Module lead
              <select name="lead_id" defaultValue={module?.lead_id || ''}>
                <option value="">No lead</option>
                {data.members.map((m) => (
                  <option value={m.id} key={m.id}>
                    {m.name}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="form-row">
            <label>
              Start date
              <input name="start_date" type="date" defaultValue={module?.start_date || ''} />
            </label>
            <label>
              Target date
              <input name="end_date" type="date" defaultValue={module?.end_date || ''} />
            </label>
          </div>
        </div>
        <div className="modal-footer">
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" busy={busy}>
            {module ? 'Save module' : 'Create module'}
            <ArrowUpRight size={14} />
          </Button>
        </div>
      </form>
    </Modal>
  );
}

export function IssuePicker({
  project,
  selectedIds,
  title,
  onClose,
  onSave,
  eligible,
  maxChanges,
}: {
  project: Project;
  selectedIds: string[];
  title: string;
  onClose: () => void;
  onSave: (ids: string[]) => Promise<void>;
  eligible?: (issue: Issue) => boolean;
  maxChanges?: number;
}) {
  const { data } = useGrace();
  const [selected, setSelected] = useState(new Set(selectedIds));
  const [search, setSearch] = useState('');
  const [busy, setBusy] = useState(false);
  const issues = data.issues.filter(
    (i) =>
      i.project_id === project.id &&
      (!eligible || eligible(i)) &&
      `${i.key} ${i.summary}`.toLowerCase().includes(search.toLowerCase()),
  );
  const changedCount = (ids: Set<string>) =>
    [...new Set([...selectedIds, ...ids])].filter((id) => ids.has(id) !== selectedIds.includes(id))
      .length;
  const allMatchingSelected = issues.length > 0 && issues.every((i) => selected.has(i.id));
  const matchingNext = new Set(selected);
  for (const i of issues) allMatchingSelected ? matchingNext.delete(i.id) : matchingNext.add(i.id);
  return (
    <Modal title={title} onClose={onClose} wide>
      <div className="modal-body">
        <div className="search-field issue-picker-search">
          <Search size={16} />
          <input
            autoFocus
            aria-label="Find issues to add"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by title or issue key…"
          />
        </div>
        {maxChanges && (
          <p className="planning-muted">
            Change up to {maxChanges} issues at a time. Work in completed cycles stays in its
            recorded scope.
          </p>
        )}
        <div className="issue-picker">
          <label className="issue-picker-all">
            <input
              type="checkbox"
              checked={allMatchingSelected}
              disabled={!!maxChanges && changedCount(matchingNext) > maxChanges}
              onChange={(e) =>
                setSelected((previous) => {
                  const next = new Set(previous);
                  for (const issue of issues)
                    e.target.checked ? next.add(issue.id) : next.delete(issue.id);
                  return next;
                })
              }
            />
            Select matching issues<span>{selected.size} selected</span>
          </label>
          {issues.map((i) => (
            <label className="issue-picker-row" key={i.id}>
              <input
                type="checkbox"
                checked={selected.has(i.id)}
                disabled={
                  !!maxChanges &&
                  changedCount(
                    new Set(
                      [...selected]
                        .filter((id) => id !== i.id)
                        .concat(selected.has(i.id) ? [] : [i.id]),
                    ),
                  ) > maxChanges
                }
                onChange={(e) =>
                  setSelected((previous) => {
                    const next = new Set(previous);
                    e.target.checked ? next.add(i.id) : next.delete(i.id);
                    return next;
                  })
                }
              />
              <TypeIcon type={i.type} />
              <small>{i.key}</small>
              <span>{i.summary}</span>
              <Badge>{data.statuses.find((s) => s.id === i.status_id)?.name}</Badge>
            </label>
          ))}
          {!issues.length && (
            <p className="planning-muted">No matching issues. Try a different title or key.</p>
          )}
        </div>
      </div>
      <div className="modal-footer">
        <span>{selected.size} issues selected</span>
        <Button variant="secondary" onClick={onClose}>
          Cancel
        </Button>
        <Button
          busy={busy}
          onClick={async () => {
            setBusy(true);
            try {
              await onSave([...selected]);
            } finally {
              setBusy(false);
            }
          }}
        >
          Save selection
          <Check size={14} />
        </Button>
      </div>
    </Modal>
  );
}

export function ProjectCycles({ project }: { project: Project }) {
  const { data, run } = useGrace();
  const [params, setParams] = useSearchParams();
  const [filter, setFilter] = useState<'all' | 'active' | 'future' | 'closed'>('all');
  const [create, setCreate] = useState(false);
  const [complete, setComplete] = useState<Sprint | null>(null);
  const sprints = data.sprints
    .filter((s) => s.project_id === project.id)
    .sort((a, b) => b.start_date.localeCompare(a.start_date));
  const selected = params.get('cycle');
  const choose = (id: string | null) =>
    setParams((p) => {
      id ? p.set('cycle', id) : p.delete('cycle');
      return p;
    });
  return (
    <section className="planning-view">
      <div className="planning-intro">
        <div>
          <span className="eyebrow">A SUSTAINABLE RHYTHM FOR GOOD WORK</span>
          <h2>Plan a cycle. Move forward together.</h2>
          <p>Keep the sprint goal, scope, and progress in one clear place.</p>
        </div>
        <Button
          onClick={() => setCreate(true)}
          disabled={data.user.role === 'viewer' || project.can_write === false}
        >
          <Plus size={16} />
          New cycle
        </Button>
      </div>
      {selected ? (
        <CycleFocus
          sprintId={selected}
          project={project}
          onBack={() => choose(null)}
          onComplete={setComplete}
        />
      ) : (
        <>
          <div className="tabs standalone">
            {[
              ['all', 'All cycles'],
              ['active', 'Active'],
              ['future', 'Planned'],
              ['closed', 'Completed'],
            ].map(([id, label]) => (
              <button
                key={id}
                className={filter === id ? 'active' : ''}
                onClick={() => setFilter(id as typeof filter)}
              >
                {label}
                <Badge>{sprints.filter((s) => id === 'all' || s.state === id).length}</Badge>
              </button>
            ))}
          </div>
          <div className="cycle-list">
            {sprints
              .filter((s) => filter === 'all' || s.state === filter)
              .map((s) => {
                const issues = data.issues.filter((i) => i.sprint_id === s.id);
                const done = issues.filter(
                  (i) => data.statuses.find((st) => st.id === i.status_id)?.category === 'done',
                );
                const progress = issues.length
                  ? Math.round((done.length / issues.length) * 100)
                  : 0;
                return (
                  <article className="cycle-card panel" key={s.id}>
                    <span className={`cycle-icon ${s.state}`}>
                      <CircleDashed size={24} />
                    </span>
                    <div className="cycle-card-info">
                      <div>
                        <button onClick={() => choose(s.id)}>
                          <h3>{s.name}</h3>
                          <ArrowUpRight size={16} />
                        </button>
                        <Badge
                          tone={
                            s.state === 'active'
                              ? 'green'
                              : s.state === 'closed'
                                ? 'lavender'
                                : 'neutral'
                          }
                        >
                          {s.state === 'active'
                            ? 'Active'
                            : s.state === 'closed'
                              ? 'Completed'
                              : 'Planned'}
                        </Badge>
                      </div>
                      <p>{s.goal || 'A fresh opportunity to move the right work forward.'}</p>
                      <span>
                        <CalendarDays size={13} />
                        {formatDate(s.start_date)} – {formatDate(s.end_date)}
                        <i /> {issues.length} issues
                      </span>
                    </div>
                    <div className="cycle-progress">
                      <span>
                        {s.state === 'closed'
                          ? `${s.completed_points} points delivered`
                          : `${progress}% complete`}
                      </span>
                      <div className="progress-track">
                        <span style={{ width: `${s.state === 'closed' ? 100 : progress}%` }} />
                      </div>
                    </div>
                    <Button variant="secondary" onClick={() => choose(s.id)}>
                      View cycle
                      <ArrowRight size={14} />
                    </Button>
                  </article>
                );
              })}
            {!sprints.filter((s) => filter === 'all' || s.state === filter).length && (
              <Empty
                title="A little room for your next rhythm"
                text="Create a cycle, plan your scope, and start when the team is ready."
                action={
                  <Button
                    onClick={() => setCreate(true)}
                    disabled={data.user.role === 'viewer' || project.can_write === false}
                  >
                    <Plus size={15} />
                    Create a cycle
                  </Button>
                }
              />
            )}
          </div>
        </>
      )}
      {create && <CreateSprint project={project} onClose={() => setCreate(false)} />}{' '}
      {complete && <CompleteSprint sprint={complete} onClose={() => setComplete(null)} />}
    </section>
  );
}

function CycleFocus({
  sprintId,
  project,
  onBack,
  onComplete,
}: {
  sprintId: string;
  project: Project;
  onBack: () => void;
  onComplete: (sprint: Sprint) => void;
}) {
  const { data, run, openIssue } = useGrace();
  const query = useQuery({
    queryKey: ['sprint-analytics', data.workspace.id, sprintId],
    queryFn: () => api<SprintAnalytics>(`/sprints/${sprintId}/analytics`),
  });
  const [picker, setPicker] = useState(false);
  const [scopeTab, setScopeTab] = useState(false);
  if (query.isPending) return <PlanningLoading />;
  if (query.error || !query.data)
    return (
      <PlanningError
        error={query.error || new Error('Cycle unavailable.')}
        retry={() => query.refetch()}
      />
    );
  const analytics = query.data;
  const { sprint, summary } = analytics;
  const issues = data.issues.filter((i) => i.sprint_id === sprint.id);
  const canWrite = data.user.role !== 'viewer' && project.can_write !== false;
  const saveScope = async (ids: string[]) => {
    const additions = data.issues.filter((i) => ids.includes(i.id) && i.sprint_id !== sprint.id);
    const removals = issues.filter((i) => !ids.includes(i.id));
    const result = await run(async () => {
      // One atomic request per scope change; mixed add/remove is handled by the dedicated endpoint.
      return post(`/sprints/${sprint.id}/scope`, {
        items: [
          ...additions.map((i) => ({ id: i.id, version: i.version, sprint_id: sprint.id })),
          ...removals.map((i) => ({ id: i.id, version: i.version, sprint_id: null })),
        ],
      });
    }, 'Cycle scope updated.');
    if (result) setPicker(false);
  };
  return (
    <div>
      <button className="planning-back" onClick={onBack}>
        <ArrowLeft size={15} />
        All cycles
      </button>
      <div className="cycle-focus-heading">
        <div>
          <div className="planning-title-line">
            <h2>{sprint.name}</h2>
            <Badge tone={sprint.state === 'active' ? 'green' : 'neutral'}>
              {sprint.state === 'active'
                ? 'Active'
                : sprint.state === 'closed'
                  ? 'Completed'
                  : 'Planned'}
            </Badge>
          </div>
          <p>
            <Target size={15} />
            {sprint.goal || 'Give this cycle a shared goal.'}
          </p>
          <span className="planning-muted">
            <CalendarDays size={14} />
            {formatDate(sprint.start_date)} – {formatDate(sprint.end_date)}
          </span>
        </div>
        <div className="planning-header-actions">
          {sprint.state === 'future' && (
            <Button
              onClick={() =>
                run(() => post(`/sprints/${sprint.id}/start`), 'Your cycle is underway.')
              }
              disabled={!canWrite}
            >
              <Play size={14} />
              Start cycle
            </Button>
          )}
          {sprint.state === 'active' && (
            <Button onClick={() => onComplete(sprint)} disabled={!canWrite}>
              <Check size={14} />
              Complete cycle
            </Button>
          )}
          <Button
            variant="secondary"
            onClick={() =>
              download(
                `${sprint.name.replace(/[^a-z0-9]/gi, '-')}-burndown.csv`,
                [
                  'Date,Remaining points,Scope points,Completed points,Ideal points',
                  ...analytics.burndown.map(
                    (d) =>
                      `${d.date},${d.remaining_points ?? ''},${d.scope_points ?? ''},${d.completed_points ?? ''},${d.ideal_points}`,
                  ),
                ].join('\r\n'),
                'text/csv',
              )
            }
          >
            <Download size={14} />
            Export
          </Button>
        </div>
      </div>
      <div className="planning-metrics four">
        <Metric
          icon={CircleCheck}
          title="Completed work"
          value={`${summary.completed_issues}/${summary.total_issues}`}
          note={`${summary.completion_percent}% of ${analytics.summary_basis === 'completion_snapshot' ? 'final' : 'current'} scope`}
        />
        <Metric
          icon={Target}
          title="Delivered points"
          value={String(summary.completed_points)}
          note={`${summary.total_points} points in scope`}
        />
        <Metric
          icon={CircleDashed}
          title="Remaining points"
          value={String(summary.remaining_points)}
          note="Open work in this cycle"
        />
        <Metric
          icon={Flag}
          title="Scope change"
          value={`+${summary.added_points} / −${summary.removed_points}`}
          note="Points added / removed"
        />
      </div>
      <section className="panel burndown-panel">
        <div className="panel-heading">
          <div>
            <h2>Sprint burndown</h2>
            <p>Remaining scope, measured against a steady pace.</p>
          </div>
          <Badge>{sprint.state === 'closed' ? 'Final' : 'Live progress'}</Badge>
        </div>
        <div className="burndown-chart">
          <ResponsiveContainer width="100%" height={285}>
            <LineChart
              data={analytics.burndown}
              margin={{ top: 10, right: 25, left: 0, bottom: 5 }}
            >
              <CartesianGrid stroke="#e8ede4" vertical={false} />
              <XAxis
                dataKey="date"
                tickFormatter={(d) => formatDate(d, { month: 'short', day: 'numeric' })}
                tick={{ fontSize: 12, fill: '#6b7961' }}
                axisLine={false}
                tickLine={false}
                minTickGap={40}
              />
              <YAxis
                allowDecimals={false}
                tick={{ fontSize: 12, fill: '#6b7961' }}
                axisLine={false}
                tickLine={false}
              />
              <Tooltip
                labelFormatter={(d) => formatDate(String(d))}
                contentStyle={{ fontSize: 13, borderRadius: 8, border: '1px solid #e0e7da' }}
              />
              <Legend iconType="circle" wrapperStyle={{ fontSize: 12 }} />
              <Line
                dataKey="ideal_points"
                name="Ideal pace"
                stroke="#c8c1d2"
                strokeDasharray="5 5"
                dot={false}
              />
              <Line
                type="stepAfter"
                dataKey="remaining_points"
                name="Remaining points"
                stroke="#527b60"
                strokeWidth={2.5}
                dot={{ r: 3 }}
                connectNulls={false}
              />
              <Line
                type="stepAfter"
                dataKey="scope_points"
                name="Total scope"
                stroke="#a28bbd"
                strokeWidth={1.5}
                dot={false}
                connectNulls={false}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
        <p className="tracking-note">{analytics.history_note}</p>
      </section>
      <div className="planning-work-toolbar">
        <div className="tabs">
          <button className={!scopeTab ? 'active' : ''} onClick={() => setScopeTab(false)}>
            Work items<Badge>{issues.length}</Badge>
          </button>
          <button className={scopeTab ? 'active' : ''} onClick={() => setScopeTab(true)}>
            Scope history<Badge>{analytics.scope_events.length}</Badge>
          </button>
        </div>
        {sprint.state !== 'closed' && (
          <Button variant="secondary" onClick={() => setPicker(true)} disabled={!canWrite}>
            <Plus size={14} />
            Manage scope
          </Button>
        )}
      </div>
      {scopeTab ? (
        <section className="panel scope-history">
          {analytics.scope_events.length ? (
            analytics.scope_events.map((event) => (
              <button key={event.id} onClick={() => openIssue(event.issue_id)}>
                <span className={`scope-event-icon ${event.type}`}>
                  {event.type === 'removed' ? (
                    <Minus size={15} />
                  ) : event.type === 'added' ? (
                    <Plus size={15} />
                  ) : (
                    <Pencil size={14} />
                  )}
                </span>
                <div>
                  <strong>
                    {event.issue_key} <span>{event.summary}</span>
                  </strong>
                  <p>
                    {event.type === 'added'
                      ? 'Added to this cycle'
                      : event.type === 'removed'
                        ? 'Moved out of this cycle'
                        : 'Estimate updated'}{' '}
                    ·{' '}
                    {formatDate(event.created_at, {
                      month: 'short',
                      day: 'numeric',
                      hour: 'numeric',
                      minute: '2-digit',
                    })}
                  </p>
                </div>
                <Badge tone={event.points_delta >= 0 ? 'green' : 'amber'}>
                  {event.points_delta > 0 ? '+' : ''}
                  {event.points_delta} pts
                </Badge>
              </button>
            ))
          ) : (
            <Empty
              title="A steady scope so far"
              text="Work added, removed, or re-estimated during tracking will appear here."
            />
          )}
        </section>
      ) : (
        <section className="panel">
          <IssueTable issues={issues} />
        </section>
      )}
      {picker && (
        <IssuePicker
          project={project}
          selectedIds={issues.map((i) => i.id)}
          title={`Plan the scope of ${sprint.name}`}
          eligible={(i) =>
            i.sprint_id === sprint.id ||
            !data.sprints.some((s) => s.id === i.sprint_id && s.state === 'closed')
          }
          maxChanges={100}
          onClose={() => setPicker(false)}
          onSave={saveScope}
        />
      )}
      <CycleRetrospectives
        sprintId={sprint.id}
        closed={sprint.state === 'closed'}
        canWrite={canWrite}
      />
    </div>
  );
}
function Metric({
  icon: Icon,
  title,
  value,
  note,
}: {
  icon: typeof Target;
  title: string;
  value: string;
  note: string;
}) {
  return (
    <article className="planning-metric">
      <span>
        {title}
        <Icon size={17} />
      </span>
      <strong>{value}</strong>
      <p>{note}</p>
    </article>
  );
}
function PlanningLoading() {
  return (
    <div className="planning-loading">
      <div className="skeleton" />
      <div className="skeleton" />
      <div className="skeleton" />
    </div>
  );
}
function PlanningError({ error, retry }: { error: Error; retry: () => void }) {
  return (
    <div className="panel">
      <Empty
        title="We couldn’t load this view"
        text={error.message}
        action={
          <Button variant="secondary" onClick={retry}>
            Try again
          </Button>
        }
      />
    </div>
  );
}
