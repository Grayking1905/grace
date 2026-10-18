import { useEffect, useMemo, useState, useRef } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { Link } from 'react-router-dom';
import {
  AreaChart,
  Area,
  CartesianGrid,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';
import {
  ArrowUpRight,
  ArrowRight,
  Plus,
  Layers,
  Smartphone,
  Globe,
  CircleCheck,
  CircleDashed,
  CircleDot,
  Flag,
  MoreHorizontal,
  CalendarDays,
  ChevronRight,
  Search,
  CheckCheck,
  Inbox as InboxIcon,
  Star,
  ArrowDownWideNarrow,
  Clock3,
  Sparkles,
} from 'lucide-react';
import type { Issue, Project } from '../../shared/types';
import { BulkIssueActions } from '../components/BulkIssueActions';
import { useGrace } from '../context';
import { api, patch, post } from '../lib/api';
import {
  Avatar,
  AvatarGroup,
  Badge,
  Button,
  Empty,
  IconButton,
  PriorityIcon,
  StatusPill,
  TypeIcon,
  formatDate,
  relativeTime,
} from '../components/ui';

export function ProjectIcon({ project, size = 38 }: { project: Project; size?: number }) {
  const Icon =
    project.icon === 'smartphone' ? Smartphone : project.icon === 'globe' ? Globe : Layers;
  return (
    <span className="project-icon" style={{ background: project.color, width: size, height: size }}>
      <Icon size={size * 0.46} />
    </span>
  );
}
export function ProjectCard({ project }: { project: Project }) {
  const { data, run } = useGrace();
  const issues = data.issues.filter((i) => i.project_id === project.id);
  const done = issues.filter(
    (i) => data.statuses.find((s) => s.id === i.status_id)?.category === 'done',
  ).length;
  const flagged = issues.some((i) => i.flagged);
  const people = data.members.filter(
    (m) => m.id === project.lead_id || issues.some((i) => i.assignee_id === m.id),
  );
  return (
    <article className="project-card">
      <div className="project-card-top">
        <ProjectIcon project={project} />
        <Badge tone={flagged ? 'amber' : 'green'}>
          <span className="tiny-dot" />
          {flagged ? 'Needs attention' : 'On track'}
        </Badge>
        <IconButton
          label={project.favorite ? 'Remove favorite' : 'Favorite project'}
          onClick={() =>
            run(() =>
              patch(`/projects/${project.id}`, {
                favorite: project.favorite ? 0 : 1,
              }),
            )
          }
        >
          <Star
            size={15}
            fill={project.favorite ? '#c8a76a' : 'none'}
            color={project.favorite ? '#b7985a' : 'currentColor'}
          />
        </IconButton>
      </div>
      <Link to={`/projects/${project.id}/board`} className="project-title">
        {project.name}
        <ArrowUpRight size={16} />
      </Link>
      <p>{project.description}</p>
      <div className="project-progress-label">
        <span>Progress</span>
        <strong>{issues.length ? Math.round((done / issues.length) * 100) : 0}%</strong>
      </div>
      <div className="progress-track">
        <span
          style={{
            width: `${issues.length ? (done / issues.length) * 100 : 0}%`,
            background:
              project.icon === 'layers'
                ? '#ac95d0'
                : project.icon === 'smartphone'
                  ? '#7aa891'
                  : '#d0ad77',
          }}
        />
      </div>
      <div className="project-card-bottom">
        <AvatarGroup users={people} size={25} />
        <span>
          <CircleCheck size={13} />
          {done}/{issues.length} issues
        </span>
      </div>
    </article>
  );
}
export function Dashboard() {
  const { data, openCreate, openProjectCreate, openIssue } = useGrace();
  const [period, setPeriod] = useState(7);
  const done = data.issues.filter(
    (i) => data.statuses.find((s) => s.id === i.status_id)?.category === 'done',
  );
  const active = data.issues.filter(
    (i) => data.statuses.find((s) => s.id === i.status_id)?.category === 'active',
  );
  const risk = data.issues.filter((i) => i.flagged);
  const mine = data.issues
    .filter((i) => i.assignee_id === data.user.id && !done.some((d) => d.id === i.id))
    .sort((a, b) => Number(b.flagged) - Number(a.flagged))
    .slice(0, 4);
  const chart = useMemo(
    () =>
      Array.from({ length: period }, (_, n) => {
        const d = new Date();
        d.setDate(d.getDate() - period + n + 1);
        const date = d.toISOString().slice(0, 10);
        const created = data.issues.filter((i) => i.created_at.slice(0, 10) <= date).length;
        const completed = data.activity.filter(
          (h) =>
            h.field === 'status_id' &&
            data.statuses.find((s) => s.id === h.new_value)?.category === 'done' &&
            h.created_at.slice(0, 10) <= date,
        ).length;
        return {
          day: formatDate(date, { month: 'short', day: 'numeric' }),
          created,
          completed,
        };
      }),
    [data, period],
  );
  const stats = [
    {
      label: 'Total issues',
      value: data.issues.length,
      icon: Layers,
      tone: 'purple',
      note: `Across ${data.projects.length} active projects`,
    },
    {
      label: 'In progress',
      value: active.length,
      icon: CircleDot,
      tone: 'amber',
      note: 'Good things are taking shape',
    },
    {
      label: 'Completed',
      value: done.length,
      icon: CircleCheck,
      tone: 'green',
      note: `${data.issues.length ? Math.round((done.length / data.issues.length) * 100) : 0}% of all work wrapped up`,
    },
    {
      label: 'Needs attention',
      value: risk.length,
      icon: Flag,
      tone: 'rose',
      note: risk.length ? 'A little help goes a long way' : 'Nothing standing in your way',
    },
  ];
  const firstProject = data.projects[0];
  const sprint = data.sprints.find(
    (s) => s.state === 'active' && s.project_id === firstProject?.id,
  );
  const sprintIssues = data.issues.filter((i) => i.sprint_id === sprint?.id);
  const sprintDone = sprintIssues.filter((i) => done.some((d) => d.id === i.id)).length;
  return (
    <div className="page dashboard">
      <div className="page-heading">
        <div>
          <span className="eyebrow">YOUR WORKSPACE, AT A GLANCE</span>
          <h1>
            Good things ahead, {data.user.name.split(' ')[0]}
            <span className="greeting-sparkle">✳</span>
          </h1>
          <p>Here’s where things stand. Let’s make today count.</p>
        </div>
        <div className="heading-actions">
          <span className="date-label">
            <CalendarDays size={15} />
            {formatDate(new Date().toISOString(), {
              weekday: 'short',
              month: 'short',
              day: 'numeric',
            })}
          </span>
          <Button
            variant="secondary"
            onClick={openProjectCreate}
            disabled={data.user.role === 'viewer'}
          >
            <Plus size={15} />
            New project
          </Button>
        </div>
      </div>
      <section className="welcome-banner">
        <div>
          <span className="banner-kicker">
            <span />A LITTLE CLARITY. A LOT OF POSSIBILITY.
          </span>
          <h2>
            Big ideas move forward.
            <br />
            One thoughtful step at a time.
          </h2>
          <p>Your people, projects, and plans. In a good place.</p>
          <Button onClick={() => openCreate()} disabled={data.user.role === 'viewer'}>
            Let’s make progress <ArrowUpRight size={15} />
          </Button>
        </div>
        <div className="banner-art" aria-hidden="true">
          <div className="art-orbit orbit-one" />
          <div className="art-orbit orbit-two" />
          <div className="art-card art-card-one">
            <span className="art-checkbox">
              <CheckCheck size={14} />
            </span>
            <span>Make space for good work</span>
            <span className="art-mini-star">✦</span>
          </div>
          <div className="art-card art-card-two">
            <span className="art-chart">
              <i />
              <i />
              <i />
              <i />
              <i />
            </span>
            <div>
              <small>A LITTLE MORE EVERY DAY</small>
              <strong>Progress, together.</strong>
            </div>
            <span>↗</span>
          </div>
          <div className="art-flower">✳</div>
          <span className="art-tiny-dot" />
        </div>
      </section>
      <section className="stat-grid" aria-label="Workspace statistics">
        {stats.map((stat) => (
          <article className="stat-card" key={stat.label}>
            <div>
              <span>{stat.label}</span>
              <span className={`stat-icon ${stat.tone}`}>
                <stat.icon size={17} />
              </span>
            </div>
            <strong>{stat.value}</strong>
            <small>{stat.note}</small>
          </article>
        ))}
      </section>
      <section>
        <div className="section-heading">
          <div>
            <h2>
              Your projects <span className="count">{data.projects.length}</span>
            </h2>
            <p>Different moving parts. One shared direction.</p>
          </div>
          <Link to="/projects">
            View all projects <ArrowRight size={14} />
          </Link>
        </div>
        {data.projects.length ? (
          <div className="project-grid">
            {data.projects.slice(0, 3).map((p) => (
              <ProjectCard key={p.id} project={p} />
            ))}
          </div>
        ) : (
          <Empty
            title="Your next big thing starts here"
            text="Create a project and turn your ideas into a plan."
            action={
              <Button onClick={openProjectCreate}>
                <Plus size={15} />
                Create a project
              </Button>
            }
          />
        )}
      </section>
      <div className="dashboard-columns">
        <section className="panel focus-panel">
          <div className="panel-heading">
            <div>
              <h2>Your focus</h2>
              <p>A few things with your name on them.</p>
            </div>
            <Link to="/my-work">
              My work <ArrowUpRight size={14} />
            </Link>
          </div>
          {mine.length ? (
            <div className="focus-list">
              {mine.map((i) => (
                <button key={i.id} onClick={() => openIssue(i.id)}>
                  <span className="focus-check">
                    <CircleDashed size={18} />
                  </span>
                  <div>
                    <strong>{i.summary}</strong>
                    <span>
                      <TypeIcon type={i.type} />
                      {i.key}
                      <i /> {data.projects.find((p) => p.id === i.project_id)?.name}
                    </span>
                  </div>
                  {i.flagged ? (
                    <Badge tone="rose">Blocked</Badge>
                  ) : (
                    <PriorityIcon priority={i.priority} />
                  )}
                  <ChevronRight size={14} />
                </button>
              ))}
            </div>
          ) : (
            <Empty
              title="A clear head. A clear list."
              text="Your assigned work will appear here."
            />
          )}
          <button
            className="panel-bottom-action"
            onClick={() => openCreate({ assignee_id: data.user.id })}
            disabled={data.user.role === 'viewer'}
          >
            <Plus size={15} />
            Add something to your list
          </button>
        </section>
        <section className="panel activity-panel">
          <div className="panel-heading">
            <div>
              <h2>Around the workspace</h2>
              <p>Good work happens together.</p>
            </div>
            <span className="live-label">
              <i />
              LIVE
            </span>
          </div>
          <div className="activity-list">
            {data.activity.slice(0, 4).map((a) => {
              const u = data.members.find((m) => m.id === a.actor_id);
              const status = data.statuses.find((s) => s.id === a.new_value);
              return (
                <button onClick={() => openIssue(a.issue_id)} key={a.id}>
                  <Avatar user={u} size={29} />
                  <div>
                    <p>
                      <strong>{u?.name.split(' ')[0]}</strong>{' '}
                      {a.field === 'created'
                        ? 'created an issue'
                        : a.field === 'status_id'
                          ? `moved an issue to ${status?.name || 'a new status'}`
                          : 'updated an issue'}
                    </p>
                    <span>
                      <b>{a.issue_key}</b> {a.issue_summary}
                    </span>
                    <small>{relativeTime(a.created_at)}</small>
                  </div>
                </button>
              );
            })}
            {!data.activity.length && (
              <Empty title="A fresh beginning" text="Updates from your team will appear here." />
            )}
          </div>
        </section>
      </div>
      <div className="dashboard-columns chart-row">
        <section className="panel">
          <div className="panel-heading">
            <div>
              <h2>Momentum, made visible</h2>
              <p>A small step forward is still a step forward.</p>
            </div>
            <select
              className="compact-select"
              value={period}
              onChange={(e) => setPeriod(Number(e.target.value))}
            >
              <option value={7}>Last 7 days</option>
              <option value={14}>Last 14 days</option>
            </select>
          </div>
          <div className="chart-legend">
            <span>
              <i style={{ background: '#9c86c0' }} />
              Created
            </span>
            <span>
              <i style={{ background: '#6da589' }} />
              Completed
            </span>
            <Link to="/reports">
              Explore reports <ArrowUpRight size={13} />
            </Link>
          </div>
          <div className="dashboard-chart">
            <ResponsiveContainer width="100%" height={200}>
              <AreaChart data={chart} margin={{ top: 15, right: 25, left: -23, bottom: 0 }}>
                <defs>
                  <linearGradient id="createdFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#bba9d8" stopOpacity={0.22} />
                    <stop offset="100%" stopColor="#bba9d8" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid vertical={false} stroke="#edf0ec" strokeDasharray="3 4" />
                <XAxis
                  dataKey="day"
                  tick={{ fontSize: 12, fill: '#91968f' }}
                  axisLine={false}
                  tickLine={false}
                  minTickGap={25}
                />
                <YAxis
                  allowDecimals={false}
                  tick={{ fontSize: 12, fill: '#91968f' }}
                  axisLine={false}
                  tickLine={false}
                />
                <Tooltip
                  contentStyle={{
                    borderRadius: 10,
                    border: '1px solid #e5e9e3',
                    fontSize: 13,
                  }}
                />
                <Area
                  type="monotone"
                  dataKey="created"
                  name="Created"
                  stroke="#a18abf"
                  fill="url(#createdFill)"
                  strokeWidth={2}
                />
                <Area
                  type="monotone"
                  dataKey="completed"
                  name="Completed"
                  stroke="#72a68b"
                  fill="transparent"
                  strokeWidth={2}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </section>
        <section className="sprint-pulse">
          <div className="pulse-label">
            <Sparkles size={15} />
            SPRINT PULSE<span className="badge green">Active</span>
          </div>
          {sprint ? (
            <>
              <h2>{sprint.name}</h2>
              <p>{sprint.goal}</p>
              <div className="pulse-ring">
                <svg viewBox="0 0 120 120">
                  <circle cx="60" cy="60" r="48" fill="none" stroke="#e4e8dc" strokeWidth="7" />
                  <circle
                    cx="60"
                    cy="60"
                    r="48"
                    fill="none"
                    stroke="#719a7d"
                    strokeWidth="7"
                    strokeLinecap="round"
                    strokeDasharray={`${sprintIssues.length ? (sprintDone / sprintIssues.length) * 302 : 0} 302`}
                    transform="rotate(-90 60 60)"
                  />
                </svg>
                <div>
                  <strong>
                    {sprintIssues.length ? Math.round((sprintDone / sprintIssues.length) * 100) : 0}
                    %
                  </strong>
                  <span>complete</span>
                </div>
              </div>
              <div className="pulse-bottom">
                <span>
                  {sprintDone} of {sprintIssues.length} issues completed
                </span>
                <Link to={`/projects/${sprint.project_id}/board`}>
                  Open board <ArrowUpRight size={14} />
                </Link>
              </div>
            </>
          ) : (
            <Empty title="Find your next rhythm" text="Plan a sprint from your project backlog." />
          )}
        </section>
      </div>
    </div>
  );
}

export function IssueTable({ issues, compact = false }: { issues: Issue[]; compact?: boolean }) {
  const { data, openIssue, run } = useGrace();
  const [sort, setSort] = useState('rank');
  const [descending, setDescending] = useState(false);
  const [selection, setSelection] = useState<Map<string, Issue>>(new Map());
  useEffect(() => {
    setSelection((previous) => {
      const next = new Map([...previous].filter(([id]) => issues.some((i) => i.id === id)));
      return next.size === previous.size ? previous : next;
    });
  }, [issues]);
  const canEdit = (i: Issue) =>
    data.user.role !== 'viewer' &&
    data.projects.find((p) => p.id === i.project_id)?.can_write !== false;
  const selectable = !compact && issues.some(canEdit);
  const selected = [...selection.values()].filter((i) => issues.some((item) => item.id === i.id));
  const toggle = (item: Issue, checked: boolean) =>
    setSelection((previous) => {
      const next = new Map(previous);
      if (checked && next.size < 100) next.set(item.id, item);
      else next.delete(item.id);
      return next;
    });
  const sorted = [...issues].sort((a, b) => {
    const rank = { critical: 5, high: 4, medium: 3, low: 2, lowest: 1 };
    const result =
      sort === 'priority'
        ? rank[a.priority] - rank[b.priority]
        : sort === 'story_points'
          ? a.story_points - b.story_points
          : sort === 'rank'
            ? a.rank - b.rank
            : String(a[sort as keyof Issue] || '').localeCompare(
                String(b[sort as keyof Issue] || ''),
                undefined,
                { numeric: true },
              );
    return descending ? -result : result;
  });
  const header = (key: string, label: string) => (
    <button
      onClick={() => {
        if (sort === key) setDescending((v) => !v);
        else {
          setSort(key);
          setDescending(false);
        }
      }}
    >
      {label}
      {sort === key && (
        <ArrowDownWideNarrow size={12} style={{ transform: descending ? 'rotate(180deg)' : '' }} />
      )}
    </button>
  );
  const tableScroll = useRef<HTMLDivElement>(null);
  const windowRows = !compact && sorted.length > 100;
  const virtualizer = useVirtualizer<HTMLDivElement, HTMLTableRowElement>({
    count: sorted.length,
    getScrollElement: () => tableScroll.current,
    estimateSize: () => 52,
    overscan: 10,
    enabled: windowRows,
    initialRect: { width: 1000, height: 640 },
    getItemKey: (index) => sorted[index].id,
  });
  const visibleRows = windowRows
    ? virtualizer.getVirtualItems().map((row) => ({
        issue: sorted[row.index],
        index: row.index,
        start: row.start,
        end: row.end,
      }))
    : sorted.map((issue, index) => ({ issue, index, start: 0, end: 0 }));
  if (!issues.length)
    return (
      <Empty
        title="A little breathing room"
        text="No issues match this view. Try a different filter or create something new."
      />
    );
  return (
    <div
      ref={tableScroll}
      style={windowRows ? { maxHeight: 680, overflow: 'auto' } : undefined}
      className={`table-wrap ${compact ? 'compact' : ''}`}
    >
      {selectable && <BulkIssueActions issues={selected} onClear={() => setSelection(new Map())} />}
      <table className="issue-table" aria-rowcount={sorted.length + 1}>
        <thead>
          <tr>
            {selectable && (
              <th className="issue-selection">
                <input
                  type="checkbox"
                  aria-label="Select up to 100 issues in this view"
                  checked={
                    issues.filter(canEdit).length > 0 &&
                    issues
                      .filter(canEdit)
                      .slice(0, 100)
                      .every((i) => selection.has(i.id))
                  }
                  onChange={(e) =>
                    setSelection(
                      e.target.checked
                        ? new Map(
                            issues
                              .filter(canEdit)
                              .slice(0, 100)
                              .map((i) => [i.id, i]),
                          )
                        : new Map(),
                    )
                  }
                />
              </th>
            )}
            <th>{header('key', 'Issue')}</th>
            <th>{header('summary', 'Title')}</th>
            <th>Status</th>
            <th>{header('priority', 'Priority')}</th>
            <th>Assignee</th>
            {!compact && (
              <>
                <th>{header('story_points', 'Points')}</th>
                <th>{header('due_date', 'Due date')}</th>
              </>
            )}
          </tr>
        </thead>
        <tbody>
          {windowRows && (visibleRows[0]?.start || 0) > 0 && (
            <tr aria-hidden="true">
              <td
                colSpan={selectable ? 8 : 7}
                style={{ height: visibleRows[0].start, padding: 0, border: 0 }}
              />
            </tr>
          )}
          {visibleRows.map(({ issue: i, index }) => (
            <tr
              key={i.id}
              data-index={index}
              aria-rowindex={index + 2}
              ref={windowRows ? virtualizer.measureElement : undefined}
            >
              {selectable && (
                <td className="issue-selection">
                  <input
                    type="checkbox"
                    aria-label={`Select ${i.key}`}
                    checked={selection.has(i.id)}
                    disabled={!canEdit(i) || (!selection.has(i.id) && selected.length >= 100)}
                    onChange={(e) => toggle(i, e.target.checked)}
                  />
                </td>
              )}
              <td>
                <button className="issue-key" onClick={() => openIssue(i.id)}>
                  <TypeIcon type={i.type} />
                  {i.key}
                </button>
              </td>
              <td>
                <button className="issue-summary" onClick={() => openIssue(i.id)}>
                  {i.flagged > 0 && <Flag size={12} color="#b16a62" />}
                  {i.summary}
                  {i.carry_over > 0 && <span className="carry-label">Carry-over</span>}
                </button>
              </td>
              <td>
                <select
                  aria-label={`Status for ${i.key}`}
                  className="inline-status"
                  value={i.status_id}
                  disabled={!canEdit(i)}
                  onChange={(e) =>
                    run(() =>
                      patch(`/issues/${i.id}`, {
                        status_id: e.target.value,
                        version: i.version,
                      }),
                    )
                  }
                >
                  {data.statuses
                    .filter((s) => s.project_id === i.project_id)
                    .map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                </select>
              </td>
              <td>
                <PriorityIcon priority={i.priority} withLabel />
              </td>
              <td>
                <Avatar user={data.members.find((m) => m.id === i.assignee_id)} size={25} />
              </td>
              {!compact && (
                <>
                  <td>
                    <span className="points">{i.story_points || '—'}</span>
                  </td>
                  <td
                    className={
                      i.due_date &&
                      i.due_date < new Date().toISOString().slice(0, 10) &&
                      data.statuses.find((s) => s.id === i.status_id)?.category !== 'done'
                        ? 'overdue'
                        : ''
                    }
                  >
                    {i.due_date ? formatDate(i.due_date) : '—'}
                  </td>
                </>
              )}
            </tr>
          ))}
          {windowRows && (
            <tr aria-hidden="true">
              <td
                colSpan={selectable ? 8 : 7}
                style={{
                  height: Math.max(0, virtualizer.getTotalSize() - (visibleRows.at(-1)?.end || 0)),
                  padding: 0,
                  border: 0,
                }}
              />
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
export function MyWork() {
  const { data, openCreate } = useGrace();
  const [tab, setTab] = useState('assigned');
  const [search, setSearch] = useState('');
  const issues = data.issues.filter(
    (i) =>
      (tab === 'created' ? i.reporter_id === data.user.id : i.assignee_id === data.user.id) &&
      (tab === 'completed'
        ? data.statuses.find((s) => s.id === i.status_id)?.category === 'done'
        : data.statuses.find((s) => s.id === i.status_id)?.category !== 'done') &&
      `${i.key} ${i.summary}`.toLowerCase().includes(search.toLowerCase()),
  );
  return (
    <div className="page">
      <div className="page-heading">
        <div>
          <span className="eyebrow">A LITTLE FOCUS GOES A LONG WAY</span>
          <h1>My work</h1>
          <p>Your priorities, in one clear place.</p>
        </div>
        <Button
          onClick={() => openCreate({ assignee_id: data.user.id })}
          disabled={data.user.role === 'viewer'}
        >
          <Plus size={15} />
          Create issue
        </Button>
      </div>
      <div className="workspace-toolbar">
        <div className="tabs">
          {[
            ['assigned', 'Assigned to me'],
            ['created', 'Created by me'],
            ['completed', 'Completed'],
          ].map(([id, label]) => (
            <button key={id} className={tab === id ? 'active' : ''} onClick={() => setTab(id)}>
              {label}
            </button>
          ))}
        </div>
        <div className="search-field">
          <Search size={15} />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Filter your work…"
            aria-label="Filter your work"
          />
        </div>
      </div>
      <section className="panel">
        <IssueTable issues={issues} />
      </section>
    </div>
  );
}
export function Projects() {
  const { data, openProjectCreate } = useGrace();
  const [search, setSearch] = useState('');
  const [favorites, setFavorites] = useState(false);
  const projects = data.projects.filter(
    (p) => p.name.toLowerCase().includes(search.toLowerCase()) && (!favorites || p.favorite),
  );
  return (
    <div className="page">
      <div className="page-heading">
        <div>
          <span className="eyebrow">IDEAS, WITH A PLACE TO GROW</span>
          <h1>
            Projects <span className="heading-count">{data.projects.length}</span>
          </h1>
          <p>Bring the right people around the work that matters.</p>
        </div>
        <Button onClick={openProjectCreate} disabled={data.user.role === 'viewer'}>
          <Plus size={15} />
          New project
        </Button>
      </div>
      <div className="workspace-toolbar">
        <div className="tabs">
          <button className={!favorites ? 'active' : ''} onClick={() => setFavorites(false)}>
            All projects
          </button>
          <button className={favorites ? 'active' : ''} onClick={() => setFavorites(true)}>
            <Star size={14} />
            Favorites
          </button>
        </div>
        <div className="search-field">
          <Search size={15} />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Find a project…"
            aria-label="Find a project"
          />
        </div>
      </div>
      {projects.length ? (
        <div className="project-grid full-grid">
          {projects.map((p) => (
            <ProjectCard key={p.id} project={p} />
          ))}
        </div>
      ) : (
        <Empty
          title="Make space for your next big thing"
          text="A project brings the plan, people, and progress together."
          action={
            <Button onClick={openProjectCreate}>
              <Plus size={15} />
              Create a project
            </Button>
          }
        />
      )}
    </div>
  );
}
export function InboxPage() {
  const { data, run, openIssue } = useGrace();
  const [unreadOnly, setUnreadOnly] = useState(false);
  const items = data.notifications.filter((n) => !unreadOnly || !n.read_at);
  return (
    <div className="page narrow-page">
      <div className="page-heading">
        <div>
          <span className="eyebrow">STAY IN THE LOOP</span>
          <h1>Inbox</h1>
          <p>The updates that matter. Without the noise.</p>
        </div>
        <Button
          variant="secondary"
          onClick={() => run(() => post('/notifications/read'), 'All caught up.')}
        >
          <CheckCheck size={15} />
          Mark all read
        </Button>
      </div>
      <div className="tabs standalone">
        <button className={!unreadOnly ? 'active' : ''} onClick={() => setUnreadOnly(false)}>
          All updates <Badge>{data.notifications.length}</Badge>
        </button>
        <button className={unreadOnly ? 'active' : ''} onClick={() => setUnreadOnly(true)}>
          Unread <Badge>{data.notifications.filter((n) => !n.read_at).length}</Badge>
        </button>
      </div>
      <section className="panel inbox-list">
        {items.length ? (
          items.map((n) => (
            <button
              key={n.id}
              className={!n.read_at ? 'unread' : ''}
              onClick={() => {
                run(() => post('/notifications/read', { id: n.id }));
                if (n.issue_id) openIssue(n.issue_id);
              }}
            >
              <span className="inbox-symbol">
                <InboxIcon size={18} />
              </span>
              <div>
                <strong>{n.title}</strong>
                <p>{n.body}</p>
                <small>{relativeTime(n.created_at)}</small>
              </div>
              {!n.read_at && <span className="unread-dot" />}
              <ChevronRight size={15} />
            </button>
          ))
        ) : (
          <Empty
            title="You’re all caught up"
            text="Take a breath. We’ll keep the important updates here."
          />
        )}
      </section>
    </div>
  );
}
