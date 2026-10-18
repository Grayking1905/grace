import { useEffect, useState, useRef, type FormEvent } from 'react';
import { useVirtualizer, defaultRangeExtractor } from '@tanstack/react-virtual';
import { Link, NavLink, useParams, useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import {
  DndContext,
  DragOverlay,
  MouseSensor,
  TouchSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  useDroppable,
  useDndContext,
  closestCorners,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
  sortableKeyboardCoordinates,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import {
  ArrowUpRight,
  ArrowRight,
  Plus,
  LayoutGrid,
  List,
  CalendarRange,
  Layers,
  ListTodo,
  Search,
  SlidersHorizontal,
  Settings2,
  ChevronDown,
  MoreHorizontal,
  Flag,
  CalendarDays,
  GripVertical,
  Circle,
  Check,
  Play,
  CircleCheck,
  Target,
  ExternalLink,
  X,
  Download,
  Filter,
  Clock3,
  CircleDashed,
  Star,
} from 'lucide-react';
import type { Bootstrap, Issue, Project, Sprint, Status } from '../../shared/types';
import { useGrace } from '../context';
import { api, exportIssues, patch, post } from '../lib/api';
import {
  Avatar,
  AvatarGroup,
  Badge,
  Button,
  Empty,
  IconButton,
  Modal,
  PriorityIcon,
  StatusPill,
  TypeIcon,
  formatDate,
} from '../components/ui';
import { IssueTable, ProjectIcon } from './Workspace';
import { CreateSprint, CompleteSprint } from '../components/SprintDialogs';
import { ProjectModules, ProjectCycles } from './Planning';
import { ProjectAdministration } from './Administration';
import { BacklogRankControls } from '../components/IssueTools';

export function ProjectPage() {
  const { projectId, view = 'board' } = useParams();
  const { data, openCreate, openCreateMenu } = useGrace();
  const project = data.projects.find((p) => p.id === projectId);
  if (!project)
    return (
      <div className="page">
        <Empty
          title="This project isn’t available"
          text="It may be archived, or you may not have access."
          action={
            <Link className="btn secondary" to="/projects">
              Back to projects
            </Link>
          }
        />
      </div>
    );
  const issues = data.issues.filter((i) => i.project_id === project.id);
  const people = data.members.filter(
    (m) => issues.some((i) => i.assignee_id === m.id) || project.lead_id === m.id,
  );
  const tabs = [
    { id: 'overview', label: 'Overview', icon: Layers },
    { id: 'board', label: 'Board', icon: LayoutGrid },
    { id: 'list', label: 'List', icon: List },
    { id: 'backlog', label: 'Backlog', icon: ListTodo },
    { id: 'cycles', label: 'Cycles', icon: CircleDashed },
    { id: 'modules', label: 'Modules', icon: Layers },
    { id: 'roadmap', label: 'Roadmap', icon: CalendarRange },
    { id: 'settings', label: 'Settings', icon: Settings2 },
  ];
  return (
    <div className="page project-page">
      <div className="project-heading">
        <ProjectIcon project={project} size={48} />
        <div>
          <div className="project-title-row">
            <h1>{project.name}</h1>
            <Badge>{project.key}</Badge>
          </div>
          <p>{project.description}</p>
        </div>
        <div className="project-heading-actions">
          <AvatarGroup users={people} />
          <span className="vertical-divider" />
          <Button
            variant="secondary"
            onClick={() => navigator.clipboard.writeText(window.location.href).catch(() => {})}
          >
            <ExternalLink size={14} />
            <span>Copy link</span>
          </Button>
          <Button
            onClick={() =>
              openCreateMenu ? openCreateMenu() : openCreate({ project_id: project.id })
            }
            disabled={data.user.role === 'viewer'}
          >
            <Plus size={16} />
            Create
          </Button>
        </div>
      </div>
      <div className="project-tabs">
        <nav>
          {tabs.map((t) => (
            <NavLink
              key={t.id}
              to={`/projects/${project.id}/${t.id}`}
              className={({ isActive }) => (isActive ? 'active' : '')}
            >
              <t.icon size={15} />
              {t.label}
              {t.id === 'board' && <span>{issues.length}</span>}
            </NavLink>
          ))}
        </nav>
        <Link to={`/reports?project=${project.id}`} className="project-reports-link">
          Reports <ArrowUpRight size={14} />
        </Link>
      </div>
      {view === 'modules' ? (
        <ProjectModules project={project} />
      ) : view === 'cycles' ? (
        <ProjectCycles project={project} />
      ) : view === 'settings' ? (
        <ProjectAdministration projectId={project.id} />
      ) : view === 'board' ? (
        <Board project={project} />
      ) : view === 'list' ? (
        <IssueList project={project} />
      ) : view === 'backlog' ? (
        <Backlog project={project} />
      ) : view === 'roadmap' ? (
        <Roadmap project={project} />
      ) : (
        <ProjectOverview project={project} />
      )}
    </div>
  );
}

function Board({ project }: { project: Project }) {
  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      if (typeof performance.mark === 'function') {
        performance.mark('grace.board.rendered');
        performance.measure('grace.board.initial-render', {
          start: 0,
          end: 'grace.board.rendered',
        });
      }
    });
    return () => cancelAnimationFrame(frame);
  }, [project.id]);
  const { data, openCreate, toast, refresh, run } = useGrace();
  const client = useQueryClient();
  const [search, setSearch] = useState('');
  const [mine, setMine] = useState(false);
  const [filterOpen, setFilterOpen] = useState(false);
  const [displayOpen, setDisplayOpen] = useState(false);
  const [priority, setPriority] = useState('');
  const [type, setType] = useState('');
  const [assignee, setAssignee] = useState('');
  const [label, setLabel] = useState('');
  const [showPoints, setShowPoints] = useState(true);
  const [showDue, setShowDue] = useState(true);
  const [dragged, setDragged] = useState<Issue | null>(null);
  const [complete, setComplete] = useState(false);
  const [columnModal, setColumnModal] = useState(false);
  const [transitionBusy, setTransitionBusy] = useState(false);
  const sprints = data.sprints.filter((s) => s.project_id === project.id && s.state !== 'closed');
  const activeSprint = sprints.find((s) => s.state === 'active');
  const [sprintId, setSprintId] = useState(activeSprint?.id || 'all');
  const statuses = data.statuses
    .filter((s) => s.project_id === project.id)
    .sort((a, b) => a.position - b.position);
  const all = data.issues.filter((i) => i.project_id === project.id);
  const issues = all.filter(
    (i) =>
      (sprintId === 'all' || i.sprint_id === sprintId) &&
      (!mine || i.assignee_id === data.user.id) &&
      (!priority || i.priority === priority) &&
      (!type || i.type === type) &&
      (!assignee || i.assignee_id === assignee) &&
      (!label || i.labels.includes(label)) &&
      `${i.key} ${i.summary}`.toLowerCase().includes(search.toLowerCase()),
  );
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 180, tolerance: 6 } }),
    useSensor(KeyboardSensor, {
      keyboardCodes: { start: ['Space'], cancel: ['Escape'], end: ['Space'] },
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );
  const onDragStart = (event: DragStartEvent) =>
    setDragged(issues.find((i) => i.id === event.active.id) || null);
  const onDragEnd = async (event: DragEndEvent) => {
    setDragged(null);
    const { active, over } = event;
    if (!over || active.id === over.id || transitionBusy) return;
    const current = data.issues.find((i) => i.id === active.id);
    if (!current) return;
    const targetIssue = issues.find((i) => i.id === over.id);
    const statusId = targetIssue?.status_id || String(over.id);
    if (!statuses.some((s) => s.id === statusId)) return;
    const destination = issues
      .filter((i) => i.status_id === statusId && i.id !== current.id)
      .sort((a, b) => a.rank - b.rank);
    let index = targetIssue
      ? destination.findIndex((i) => i.id === targetIssue.id)
      : destination.length;
    if (targetIssue && current.status_id === statusId && current.rank < targetIssue.rank)
      index += 1;
    const before = destination[index - 1];
    const after = destination[index];
    const rank =
      before && after
        ? (before.rank + after.rank) / 2
        : before
          ? before.rank + 1000
          : after
            ? after.rank - 1000
            : 1000;
    setTransitionBusy(true);
    await client.cancelQueries({ queryKey: ['bootstrap'] });
    client.setQueryData<Bootstrap>(['bootstrap'], (old) =>
      old
        ? {
            ...old,
            issues: old.issues.map((i) =>
              i.id === current.id ? { ...i, status_id: statusId, rank } : i,
            ),
          }
        : old,
    );
    try {
      await patch(`/issues/${current.id}`, {
        status_id: statusId,
        rank,
        version: current.version,
      });
    } catch (e) {
      toast((e as Error).message, true);
    } finally {
      await refresh();
      setTransitionBusy(false);
    }
  };
  const filterCount = [priority, type, assignee, label].filter(Boolean).length;
  return (
    <div className="board-view">
      <div className="board-toolbar">
        <div className="board-toolbar-left">
          <div className="search-field board-search">
            <Search size={15} />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search issues…"
              aria-label="Search board issues"
            />
            <kbd>/</kbd>
          </div>
          <div className="popover-wrap">
            <Button
              variant="secondary"
              onClick={() => {
                setFilterOpen(!filterOpen);
                setDisplayOpen(false);
              }}
            >
              <SlidersHorizontal size={14} />
              Filter
              {filterCount > 0 && <Badge tone="green">{filterCount}</Badge>}
            </Button>
            {filterOpen && (
              <div className="filter-popover">
                <header>
                  <strong>Focus your board</strong>
                  <IconButton label="Close filters" onClick={() => setFilterOpen(false)}>
                    <X size={14} />
                  </IconButton>
                </header>
                <label>
                  Priority
                  <select value={priority} onChange={(e) => setPriority(e.target.value)}>
                    <option value="">All priorities</option>
                    {['critical', 'high', 'medium', 'low', 'lowest'].map((v) => (
                      <option key={v} value={v}>
                        {v}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Type
                  <select value={type} onChange={(e) => setType(e.target.value)}>
                    <option value="">All types</option>
                    {['task', 'story', 'bug', 'epic', 'subtask'].map((v) => (
                      <option key={v} value={v}>
                        {v}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Assignee
                  <select value={assignee} onChange={(e) => setAssignee(e.target.value)}>
                    <option value="">Everyone</option>
                    {data.members.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Label
                  <select value={label} onChange={(e) => setLabel(e.target.value)}>
                    <option value="">All labels</option>
                    {[...new Set(all.flatMap((i) => i.labels))].map((l) => (
                      <option key={l}>{l}</option>
                    ))}
                  </select>
                </label>
                <Button
                  variant="ghost"
                  onClick={() => {
                    setPriority('');
                    setType('');
                    setAssignee('');
                    setLabel('');
                  }}
                >
                  Clear filters
                </Button>
              </div>
            )}
          </div>
          <button
            className={`my-issues-filter ${mine ? 'selected' : ''}`}
            onClick={() => setMine(!mine)}
          >
            <Avatar user={data.user} size={22} />
            My issues
          </button>
          <span className="board-count">{issues.length} issues</span>
        </div>
        <div className="board-toolbar-right">
          <div className="popover-wrap">
            <Button
              variant="ghost"
              onClick={() => {
                setDisplayOpen(!displayOpen);
                setFilterOpen(false);
              }}
            >
              <Settings2 size={14} />
              Display
            </Button>
            {displayOpen && (
              <div className="display-popover">
                <strong>Card details</strong>
                <label>
                  <input
                    type="checkbox"
                    checked={showPoints}
                    onChange={(e) => setShowPoints(e.target.checked)}
                  />
                  Story points
                </label>
                <label>
                  <input
                    type="checkbox"
                    checked={showDue}
                    onChange={(e) => setShowDue(e.target.checked)}
                  />
                  Due dates
                </label>
                <small>Use the status field in an issue to move it with a keyboard.</small>
              </div>
            )}
          </div>
          <span className="vertical-divider" />
          <span className="live-label">
            <i />
            LIVE SYNC
          </span>
        </div>
      </div>
      <div className="sprint-strip">
        <div>
          <span className="sprint-symbol">
            <CircleDashed size={16} />
          </span>
          <select
            aria-label="Board sprint"
            className="sprint-select"
            value={sprintId}
            onChange={(e) => setSprintId(e.target.value)}
          >
            <option value="all">All issues</option>
            {sprints.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
                {s.state === 'active' ? ' · Active' : ''}
              </option>
            ))}
          </select>
          {sprintId !== 'all' && (
            <>
              <Badge tone="green">
                {sprints.find((s) => s.id === sprintId)?.state === 'active'
                  ? 'In progress'
                  : 'Planned'}
              </Badge>
              <span className="sprint-dates">
                <CalendarDays size={13} />
                {formatDate(sprints.find((s) => s.id === sprintId)?.start_date || '')} –{' '}
                {formatDate(sprints.find((s) => s.id === sprintId)?.end_date || '')}
              </span>
            </>
          )}
        </div>
        {activeSprint && sprintId === activeSprint.id ? (
          <Button
            variant="ghost"
            onClick={() => setComplete(true)}
            disabled={data.user.role === 'viewer'}
          >
            Complete sprint <ArrowRight size={13} />
          </Button>
        ) : (
          <Link to={`/projects/${project.id}/backlog`}>
            Plan your next sprint <ArrowRight size={13} />
          </Link>
        )}
      </div>
      <DndContext
        sensors={sensors}
        collisionDetection={closestCorners}
        onDragStart={onDragStart}
        onDragEnd={onDragEnd}
        onDragCancel={() => setDragged(null)}
      >
        <div className="kanban-board">
          {statuses.map((status) => (
            <BoardColumn
              key={status.id}
              status={status}
              issues={issues
                .filter((i) => i.status_id === status.id)
                .sort((a, b) => a.rank - b.rank)}
              onAdd={() =>
                openCreate({
                  project_id: project.id,
                  status_id: status.id,
                  sprint_id: sprintId === 'all' ? null : sprintId,
                })
              }
              showPoints={showPoints}
              showDue={showDue}
            />
          ))}
          {['owner', 'admin'].includes(data.user.role) && (
            <button className="add-column" onClick={() => setColumnModal(true)}>
              <Plus size={16} />
              Add column
            </button>
          )}
        </div>
        <DragOverlay>
          {dragged && (
            <div className="drag-preview">
              <IssueCard issue={dragged} showPoints={showPoints} showDue={showDue} overlay />
            </div>
          )}
        </DragOverlay>
      </DndContext>
      <div className="board-footnote">
        <span>
          <GripVertical size={13} />
          Drag to move. Open an issue to edit the details.
        </span>
        <span>
          {statuses.length} columns · {issues.reduce((s, i) => s + i.story_points, 0)} points
        </span>
      </div>
      {complete && activeSprint && (
        <CompleteSprint sprint={activeSprint} onClose={() => setComplete(false)} />
      )}
      {columnModal && (
        <Modal title="A new step in your workflow" onClose={() => setColumnModal(false)}>
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              const values = Object.fromEntries(new FormData(e.currentTarget));
              const result = await run(
                () => post('/statuses', { ...values, project_id: project.id }),
                'Column added.',
              );
              if (result) setColumnModal(false);
            }}
          >
            <div className="modal-body">
              <label>
                Column name
                <input
                  name="name"
                  required
                  maxLength={80}
                  placeholder="e.g. Quality assurance"
                  autoFocus
                />
              </label>
              <label>
                Category
                <select name="category">
                  <option value="todo">To do</option>
                  <option value="active">In progress</option>
                  <option value="done">Done</option>
                </select>
              </label>
            </div>
            <div className="modal-footer">
              <Button type="submit">Add column</Button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}
function BoardColumn({
  status,
  issues,
  onAdd,
  showPoints,
  showDue,
}: {
  status: Status;
  issues: Issue[];
  onAdd: () => void;
  showPoints: boolean;
  showDue: boolean;
}) {
  const { data, run } = useGrace();
  const { setNodeRef, isOver } = useDroppable({ id: status.id });
  const [settings, setSettings] = useState(false);
  const overLimit = status.wip_limit > 0 && issues.length > status.wip_limit;
  return (
    <section
      ref={setNodeRef}
      className={`board-column ${isOver ? 'drop-target' : ''} ${overLimit ? 'over-limit' : ''}`}
      aria-label={`${status.name}, ${issues.length} issues`}
    >
      <header className="column-heading">
        <span className="column-color" style={{ background: status.color }} />
        <h3>{status.name}</h3>
        <span className="column-count">
          {issues.length}
          {status.wip_limit > 0 && <small>/{status.wip_limit}</small>}
        </span>
        <div className="column-actions">
          <IconButton
            label={`Configure ${status.name}`}
            onClick={() => setSettings(true)}
            disabled={!['owner', 'admin'].includes(data.user.role)}
          >
            <MoreHorizontal size={17} />
          </IconButton>
          <IconButton
            label={`Add issue to ${status.name}`}
            onClick={onAdd}
            disabled={data.user.role === 'viewer'}
          >
            <Plus size={16} />
          </IconButton>
        </div>
      </header>
      {overLimit && <div className="wip-warning">Work in progress limit exceeded</div>}
      <SortableContext items={issues.map((i) => i.id)} strategy={verticalListSortingStrategy}>
        <VirtualBoardCards issues={issues} showPoints={showPoints} showDue={showDue} />
      </SortableContext>
      <button className="column-add-issue" onClick={onAdd} disabled={data.user.role === 'viewer'}>
        <Plus size={15} />
        Add issue
      </button>
      {settings && (
        <Modal title={`Configure ${status.name}`} onClose={() => setSettings(false)}>
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              const v = Object.fromEntries(new FormData(e.currentTarget));
              const result = await run(
                () =>
                  patch(`/statuses/${status.id}`, {
                    name: v.name,
                    wip_limit: Number(v.wip_limit),
                  }),
                'Workflow updated.',
              );
              if (result) setSettings(false);
            }}
          >
            <div className="modal-body">
              <label>
                Column name
                <input name="name" defaultValue={status.name} required maxLength={80} />
              </label>
              <label>
                Work in progress limit
                <input
                  name="wip_limit"
                  type="number"
                  min={0}
                  max={100}
                  defaultValue={status.wip_limit}
                />
                <small>Use 0 for no limit.</small>
              </label>
            </div>
            <div className="modal-footer">
              <Button type="submit">Save column</Button>
            </div>
          </form>
        </Modal>
      )}
    </section>
  );
}
function VirtualBoardCards({
  issues,
  showPoints,
  showDue,
}: {
  issues: Issue[];
  showPoints: boolean;
  showDue: boolean;
}) {
  const scroll = useRef<HTMLDivElement>(null);
  const { active } = useDndContext();
  const enabled = issues.length > 100;
  const activeIndex = issues.findIndex((i) => i.id === active?.id);
  const virtualizer = useVirtualizer<HTMLDivElement, HTMLDivElement>({
    count: issues.length,
    getScrollElement: () => scroll.current,
    estimateSize: () => 154,
    overscan: 5,
    enabled,
    initialRect: { width: 280, height: 600 },
    getItemKey: (index) => issues[index].id,
    rangeExtractor: (range) => {
      const indexes = defaultRangeExtractor(range);
      if (activeIndex >= 0 && !indexes.includes(activeIndex)) indexes.push(activeIndex);
      return indexes.sort((a, b) => a - b);
    },
  });
  return (
    <div
      ref={scroll}
      className="column-cards"
      style={enabled ? { height: 'min(640px,60vh)', overflowY: 'auto' } : undefined}
    >
      {enabled ? (
        <div
          style={{
            height: virtualizer.getTotalSize(),
            position: 'relative',
            width: '100%',
            flexShrink: 0,
          }}
        >
          {virtualizer.getVirtualItems().map((row) => (
            <div
              key={row.key}
              data-index={row.index}
              ref={virtualizer.measureElement}
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                right: 0,
                transform: `translateY(${row.start}px)`,
                paddingBottom: 10,
              }}
            >
              <IssueCard issue={issues[row.index]} showPoints={showPoints} showDue={showDue} />
            </div>
          ))}
        </div>
      ) : (
        issues.map((issue) => (
          <IssueCard key={issue.id} issue={issue} showPoints={showPoints} showDue={showDue} />
        ))
      )}
    </div>
  );
}
function IssueCard({
  issue,
  showPoints,
  showDue,
  overlay = false,
}: {
  issue: Issue;
  showPoints: boolean;
  showDue: boolean;
  overlay?: boolean;
}) {
  const { data, openIssue } = useGrace();
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: overlay ? `overlay-${issue.id}` : issue.id,
    disabled:
      overlay ||
      data.user.role === 'viewer' ||
      data.projects.find((p) => p.id === issue.project_id)?.can_write === false,
    data: { status_id: issue.status_id },
  });
  const suppressClick = useRef(false);
  useEffect(() => {
    if (isDragging) {
      suppressClick.current = true;
      return;
    }
    const timer = setTimeout(() => {
      suppressClick.current = false;
    }, 250);
    return () => clearTimeout(timer);
  }, [isDragging]);
  const style = { transform: CSS.Transform.toString(transform), transition };
  const due = issue.due_date;
  const isDone = data.statuses.find((s) => s.id === issue.status_id)?.category === 'done';
  const overdue = due && due < new Date().toISOString().slice(0, 10) && !isDone;
  return (
    <article
      {...attributes}
      {...listeners}
      role="button"
      tabIndex={overlay ? -1 : 0}
      aria-label={`${issue.key}: ${issue.summary}. Enter to open, Space to move.`}
      onClick={() => {
        if (!overlay && !suppressClick.current) openIssue(issue.id);
      }}
      onKeyDown={(event) => {
        if (event.key === 'Enter') {
          event.preventDefault();
          openIssue(issue.id);
        } else listeners?.onKeyDown?.(event);
      }}
      aria-hidden={overlay || undefined}
      ref={setNodeRef}
      style={style}
      className={`issue-card ${isDragging ? 'dragging' : ''} ${issue.flagged ? 'flagged' : ''} ${overlay ? 'overlay' : ''}`}
    >
      <div className="card-top">
        <span className="card-key">
          <TypeIcon type={issue.type} />
          {issue.key}
        </span>
        <div>
          {issue.flagged > 0 && <Flag size={13} color="#b67766" />}
          <span className="drag-handle" aria-hidden="true">
            <GripVertical size={15} />
          </span>
        </div>
      </div>
      <span className="card-summary">{issue.summary}</span>
      <div className="card-labels">
        {issue.labels.slice(0, 2).map((l, n) => (
          <span
            key={l}
            className={`tag ${['Design', 'Experience'].includes(l) ? 'lavender' : l === 'Bug' ? 'rose' : l === 'Foundation' ? 'sand' : 'sage'}`}
          >
            {l}
          </span>
        ))}
        {issue.carry_over > 0 && <span className="tag sand">Carry-over</span>}
      </div>
      {showDue && due && (
        <div className={`card-due ${overdue ? 'overdue' : ''}`}>
          <CalendarDays size={12} />
          {formatDate(due)}
          {overdue && <span>Overdue</span>}
        </div>
      )}
      <div className="card-bottom">
        <PriorityIcon priority={issue.priority} withLabel />
        {showPoints && <span className="points">{issue.story_points || '—'}</span>}
        <Avatar user={data.members.find((m) => m.id === issue.assignee_id)} size={24} />
      </div>
    </article>
  );
}
function IssueList({ project }: { project: Project }) {
  const { data } = useGrace();
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const issues = data.issues.filter(
    (i) =>
      i.project_id === project.id &&
      (!status || i.status_id === status) &&
      `${i.key} ${i.summary}`.toLowerCase().includes(search.toLowerCase()),
  );
  return (
    <>
      <div className="board-toolbar">
        <div className="search-field">
          <Search size={15} />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search issues…"
            aria-label="Search project issues"
          />
        </div>
        <select
          className="compact-select"
          value={status}
          onChange={(e) => setStatus(e.target.value)}
        >
          <option value="">All statuses</option>
          {data.statuses
            .filter((s) => s.project_id === project.id)
            .map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
        </select>
        <span className="spacer" />
        <Button variant="secondary" onClick={() => exportIssues(issues, 'csv')}>
          <Download size={14} />
          Export CSV
        </Button>
      </div>
      <section className="panel">
        <IssueTable issues={issues} />
      </section>
    </>
  );
}
function Backlog({ project }: { project: Project }) {
  const { data, openCreate, run, openIssue } = useGrace();
  const [createSprint, setCreateSprint] = useState(false);
  const [complete, setComplete] = useState<Sprint | null>(null);
  const sprints = data.sprints
    .filter((s) => s.project_id === project.id && s.state !== 'closed')
    .sort((a, b) => (a.state === 'active' ? -1 : b.state === 'active' ? 1 : 0));
  const issues = data.issues.filter((i) => i.project_id === project.id);
  const groups = [
    ...sprints.map((s) => ({ id: s.id, name: s.name, sprint: s })),
    { id: 'backlog', name: 'Backlog', sprint: null },
  ];
  return (
    <div className="backlog-view">
      <div className="section-heading">
        <div>
          <h2>Good plans leave room to grow.</h2>
          <p>Give the right work a place in your next sprint.</p>
        </div>
        <Button
          variant="secondary"
          onClick={() => setCreateSprint(true)}
          disabled={data.user.role === 'viewer'}
        >
          <Plus size={15} />
          Create sprint
        </Button>
      </div>
      {groups.map((group) => {
        const items = issues
          .filter((i) => (group.id === 'backlog' ? !i.sprint_id : i.sprint_id === group.id))
          .sort((a, b) => a.rank - b.rank || a.id.localeCompare(b.id));
        return (
          <section className="backlog-group panel" key={group.id}>
            <header>
              <ChevronDown size={16} />
              <h3>{group.name}</h3>
              <Badge>{items.length} issues</Badge>
              {group.sprint && (
                <>
                  <Badge tone={group.sprint.state === 'active' ? 'green' : 'neutral'}>
                    {group.sprint.state === 'active' ? 'Active' : 'Planned'}
                  </Badge>
                  <span className="sprint-dates">
                    {formatDate(group.sprint.start_date)} – {formatDate(group.sprint.end_date)}
                  </span>
                </>
              )}
              <span className="spacer" />
              <span className="points-summary">
                {items.reduce((s, i) => s + i.story_points, 0)} points
              </span>
              {group.sprint && (
                <Button
                  variant="secondary"
                  disabled={data.user.role === 'viewer'}
                  onClick={() =>
                    group.sprint!.state === 'active'
                      ? setComplete(group.sprint)
                      : run(() => post(`/sprints/${group.id}/start`), 'Your sprint is underway.')
                  }
                >
                  <Play size={12} />
                  {group.sprint.state === 'active' ? 'Complete sprint' : 'Start sprint'}
                </Button>
              )}
            </header>
            {group.sprint?.goal && (
              <p className="backlog-goal">
                <Target size={13} />
                {group.sprint.goal}
              </p>
            )}
            <div className="backlog-issues">
              {items.map((i) => (
                <div className="backlog-issue" key={i.id}>
                  <BacklogRankControls issue={i} items={items} />
                  <TypeIcon type={i.type} />
                  <button className="issue-key" onClick={() => openIssue(i.id)}>
                    {i.key}
                  </button>
                  <button className="backlog-summary" onClick={() => openIssue(i.id)}>
                    {i.summary}
                  </button>
                  {i.carry_over > 0 && <Badge tone="amber">Carry-over</Badge>}
                  <PriorityIcon priority={i.priority} />
                  <span className="points">{i.story_points || '—'}</span>
                  <Avatar user={data.members.find((m) => m.id === i.assignee_id)} size={24} />
                  <select
                    aria-label={`Sprint for ${i.key}`}
                    value={i.sprint_id || ''}
                    disabled={data.user.role === 'viewer'}
                    onChange={(e) =>
                      run(
                        () =>
                          patch(`/issues/${i.id}`, {
                            sprint_id: e.target.value || null,
                            version: i.version,
                          }),
                        'Sprint updated.',
                      )
                    }
                  >
                    <option value="">Backlog</option>
                    {sprints.map((s) => (
                      <option value={s.id} key={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                </div>
              ))}
            </div>
            {!items.length && (
              <p className="backlog-empty">
                A little room for your next great idea. Move an issue here or create one below.
              </p>
            )}
            <button
              className="panel-bottom-action"
              onClick={() =>
                openCreate({
                  project_id: project.id,
                  sprint_id: group.sprint?.id || null,
                })
              }
              disabled={data.user.role === 'viewer'}
            >
              <Plus size={14} />
              Create issue
            </button>
          </section>
        );
      })}
      {createSprint && (
        <CreateSprint project={project} onClose={() => setCreateSprint(false)} />
      )}{' '}
      {complete && <CompleteSprint sprint={complete} onClose={() => setComplete(null)} />}
    </div>
  );
}
function Roadmap({ project }: { project: Project }) {
  const { data, openIssue, openCreate } = useGrace();
  const [zoom, setZoom] = useState(30);
  const dated = data.issues.filter(
    (i) => i.project_id === project.id && i.start_date && i.due_date,
  );
  const all = data.issues.filter((i) => i.project_id === project.id);
  const start = new Date();
  start.setDate(start.getDate() - 7);
  const startTime = start.getTime();
  const ms = 86400000;
  const ticks = Array.from(
    { length: Math.ceil(zoom / 7) },
    (_, n) => new Date(startTime + n * 7 * ms),
  );
  return (
    <div className="roadmap-view">
      <div className="section-heading">
        <div>
          <h2>See the bigger picture.</h2>
          <p>Work with start and due dates finds its place on your timeline.</p>
        </div>
        <div className="heading-actions">
          <select
            className="compact-select"
            value={zoom}
            onChange={(e) => setZoom(Number(e.target.value))}
          >
            <option value={30}>Month</option>
            <option value={90}>Quarter</option>
          </select>
          <Button
            variant="secondary"
            onClick={() => openCreate({ project_id: project.id, type: 'epic' })}
            disabled={data.user.role === 'viewer'}
          >
            <Plus size={14} />
            Create epic
          </Button>
        </div>
      </div>
      {dated.length ? (
        <div className="timeline panel">
          <div className="timeline-header">
            <strong>Work item</strong>
            <div>
              {ticks.map((t) => (
                <span key={t.toISOString()}>{formatDate(t.toISOString())}</span>
              ))}
            </div>
          </div>
          {dated.map((i) => {
            const left = Math.max(0, ((Date.parse(i.start_date) - startTime) / ms / zoom) * 100);
            const right = Math.min(
              100,
              Math.max(0, ((Date.parse(i.due_date) - startTime) / ms / zoom) * 100),
            );
            const status = data.statuses.find((s) => s.id === i.status_id);
            return (
              <div className="timeline-row" key={i.id}>
                <button onClick={() => openIssue(i.id)}>
                  <TypeIcon type={i.type} />
                  <span>
                    <small>{i.key}</small>
                    {i.summary}
                  </span>
                </button>
                <div className="timeline-track">
                  {right > left && (
                    <button
                      title={`${i.summary}: ${formatDate(i.start_date)} – ${formatDate(i.due_date)}`}
                      onClick={() => openIssue(i.id)}
                      className={`timeline-bar ${status?.category === 'done' ? 'done' : ''}`}
                      style={{
                        left: `${left}%`,
                        width: `${Math.max(1, right - left)}%`,
                      }}
                    >
                      <span>{i.summary}</span>
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <Empty
          title="Give your plans a little perspective"
          text="Add a start date and due date to your issues to see them on the timeline."
        />
      )}
      <p className="view-footnote">
        {dated.length} scheduled issues · {all.length - dated.length} without dates. Open any issue
        to adjust its schedule.
      </p>
    </div>
  );
}
function ProjectOverview({ project }: { project: Project }) {
  const { data, openIssue } = useGrace();
  const issues = data.issues.filter((i) => i.project_id === project.id);
  const statuses = data.statuses.filter((s) => s.project_id === project.id);
  const done = issues.filter(
    (i) => statuses.find((s) => s.id === i.status_id)?.category === 'done',
  );
  const active = data.sprints.find((s) => s.project_id === project.id && s.state === 'active');
  const lead = data.members.find((m) => m.id === project.lead_id);
  return (
    <div className="project-overview">
      <div className="overview-summary">
        <div className="panel overview-about">
          <span className="eyebrow">THE BIG PICTURE</span>
          <h2>Good work, moving forward.</h2>
          <p>{project.description}</p>
          <div className="overview-meta">
            <span>
              Project lead <Avatar user={lead} size={25} />
              <strong>{lead?.name}</strong>
            </span>
            <span>
              Approach <Badge>{project.template}</Badge>
            </span>
          </div>
          {active && (
            <div className="overview-sprint">
              <Target size={21} />
              <div>
                <strong>{active.name}</strong>
                <p>{active.goal}</p>
              </div>
              <Link to={`/projects/${project.id}/board`}>
                <ArrowUpRight size={17} />
              </Link>
            </div>
          )}
        </div>
        <div className="panel overview-health">
          <span className="eyebrow">PROJECT PROGRESS</span>
          <strong>{issues.length ? Math.round((done.length / issues.length) * 100) : 0}%</strong>
          <div className="progress-track">
            <span
              style={{
                width: `${issues.length ? (done.length / issues.length) * 100 : 0}%`,
              }}
            />
          </div>
          <p>
            {done.length} of {issues.length} issues completed
          </p>
          {statuses.map((s) => (
            <div className="status-breakdown" key={s.id}>
              <span style={{ background: s.color }} />
              {s.name}
              <b>{issues.filter((i) => i.status_id === s.id).length}</b>
            </div>
          ))}
        </div>
      </div>
      <div className="section-heading">
        <h2>All project work</h2>
        <Link to={`/projects/${project.id}/board`}>
          Open board <ArrowRight size={14} />
        </Link>
      </div>
      <section className="panel">
        <IssueTable issues={issues} />
      </section>
    </div>
  );
}
