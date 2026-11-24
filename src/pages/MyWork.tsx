import { useState, useId, useMemo, type FormEvent } from 'react';
import { useQuery } from '@tanstack/react-query';
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
  CheckCircle2,
  FolderKanban,
  Activity,
  AlertCircle,
  Search,
  Clock3,
  Wifi,
  WifiOff,
  Flag,
  CheckSquare,
  Circle,
  CalendarDays,
  Sparkles,
  Plus,
  Layers,
  Bug,
  GitBranch,
  FileText,
  X,
  Flame,
} from 'lucide-react';
import type { Issue } from '../../shared/types';
import { canTeamCreate, type OrganizationWork } from '../../shared/organization';
import { useGrace } from '../context';
import { api, patch, post } from '../lib/api';
import { Avatar, Badge, Button, Empty, formatDate, relativeTime } from '../components/ui';
import { CopyButton } from '../components/CopyButton';
import '../home.css';
import '../simplified.css';
import '../my-work.css';

type Entry = { source: 'issue'; item: Issue } | { source: 'team'; item: OrganizationWork };

const workLabel = (item: OrganizationWork) =>
  item.kind === 'brd' ? 'BRD' : item.kind === 'daily' ? 'Daily task' : 'Version';

const entryType = (entry: Entry) =>
  entry.source === 'team'
    ? entry.item.kind
    : entry.item.type === 'bug'
      ? 'bug'
      : entry.item.type === 'story'
        ? 'feature'
        : 'issue';

const chartDate = (date: string) =>
  new Date(`${date}T12:00:00Z`).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  });

export function useTeamWork(teamId?: string, mine = false) {
  const { data } = useGrace();
  const params = new URLSearchParams();
  if (teamId) params.set('team_id', teamId);
  if (mine) params.set('mine', 'true');
  return useQuery({
    queryKey: ['organization-work', data.workspace.id, teamId || 'all', mine],
    queryFn: () => api<OrganizationWork[]>(`/organization/work?${params}`),
  });
}

export function makeEntries(issues: Issue[], work: OrganizationWork[]): Entry[] {
  return [
    ...issues.map((item) => ({ source: 'issue' as const, item })),
    ...work.map((item) => ({ source: 'team' as const, item })),
  ];
}

export function OrganizationMyWork() {
  const { data, connection = 'connecting', openIssue, openWork, openCreate, refresh, run, toast } =
    useGrace();
  const work = useTeamWork(undefined, true);
  const today = new Date().toLocaleDateString('en-CA');
  const gradient = useId().replaceAll(':', '');

  // Filter & View State
  const [view, setView] = useState<'assigned' | 'created' | 'completed' | 'attention'>('assigned');
  const [type, setType] = useState('all');
  const [projectId, setProjectId] = useState('');
  const [priorityFilter, setPriorityFilter] = useState('all');
  const [groupBy, setGroupBy] = useState<'none' | 'project' | 'status' | 'date'>('none');
  const [search, setSearch] = useState('');
  const [days, setDays] = useState<'7' | '14' | '30'>('14');
  const [pending, setPending] = useState<Set<string>>(() => new Set());

  // Quick Add State
  const [quickTitle, setQuickTitle] = useState('');
  const [quickSaving, setQuickSaving] = useState(false);

  const ownTeam = data.organization?.teams.find((t) => t.id === data.user.team_id);

  const done = (entry: Entry) =>
    entry.source === 'issue'
      ? data.statuses.find((s) => s.id === entry.item.status_id)?.category === 'done'
      : entry.item.state === 'done';

  const complete = async (entry: Entry) => {
    setPending((previous) => new Set(previous).add(entry.item.id));
    try {
      if (entry.source === 'team') {
        await run(
          () => patch(`/organization/work/${entry.item.id}`, { ...entry.item, state: 'done' }),
          'Task completed.',
        );
        void work.refetch();
      } else {
        const status = data.statuses.find(
          (s) => s.project_id === entry.item.project_id && s.category === 'done',
        );
        if (status) {
          await run(
            () =>
              patch(`/issues/${entry.item.id}`, {
                status_id: status.id,
                version: entry.item.version,
              }),
            'Issue completed.',
          );
        }
      }
    } finally {
      setPending((previous) => {
        const next = new Set(previous);
        next.delete(entry.item.id);
        return next;
      });
    }
  };

  const handleQuickAdd = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const inputEl = e.currentTarget.querySelector<HTMLInputElement>('input');
    const title = (quickTitle || inputEl?.value || '').trim();
    if (!title || quickSaving) return;

    if (canTeamCreate(data.organization, 'daily')) {
      setQuickSaving(true);
      try {
        await run(
          () =>
            post('/organization/work', {
              team_id: data.user.team_id || data.organization?.teams[0]?.id || '',
              kind: 'daily',
              title,
              state: 'planned',
              owner_id: data.user.id,
              due_date: today,
            }),
          'Daily task added.',
        );
        setQuickTitle('');
        if (inputEl) inputEl.value = '';
        void work.refetch();
      } finally {
        setQuickSaving(false);
      }
    } else {
      openCreate({ summary: title, assignee_id: data.user.id });
      setQuickTitle('');
      if (inputEl) inputEl.value = '';
    }
  };

  // Base entries
  const allEntries = useMemo(
    () => makeEntries(data.issues, work.data || []),
    [data.issues, work.data],
  );

  const mine = useMemo(
    () =>
      allEntries.filter((e) =>
        e.source === 'issue'
          ? e.item.assignee_id === data.user.id
          : e.item.owner_id === data.user.id,
      ),
    [allEntries, data.user.id],
  );

  const mineOpen = useMemo(() => mine.filter((e) => !done(e)), [mine]);
  const mineCompleted = useMemo(() => mine.filter((e) => done(e)), [mine]);

  const createdByMe = useMemo(
    () =>
      allEntries.filter((e) =>
        e.source === 'issue'
          ? e.item.reporter_id === data.user.id
          : e.item.created_by === data.user.id,
      ),
    [allEntries, data.user.id],
  );

  const attentionItems = useMemo(
    () =>
      mineOpen.filter((e) => {
        const isOverdue = Boolean(e.item.due_date && e.item.due_date < today);
        const isDueToday = e.item.due_date === today;
        const isFlagged = e.source === 'issue' && Boolean(e.item.flagged);
        const isHigh =
          e.source === 'issue' && (e.item.priority === 'critical' || e.item.priority === 'high');
        return isOverdue || isDueToday || isFlagged || isHigh;
      }),
    [mineOpen, today],
  );

  const visibleAttentionItems = useMemo(() => {
    if (!search) return attentionItems;
    return attentionItems.filter((e) => {
      const text =
        e.source === 'issue'
          ? `${e.item.key} ${e.item.summary} ${e.item.description || ''}`
          : `${e.item.title} ${e.item.description || ''}`;
      return text.toLowerCase().includes(search.toLowerCase());
    });
  }, [attentionItems, search]);

  // Metrics
  const openIssues = mineOpen.filter((e) => e.source === 'issue');
  const openDaily = mineOpen.filter((e) => e.source === 'team' && e.item.kind === 'daily');
  const overdueItems = mineOpen.filter((e) => Boolean(e.item.due_date && e.item.due_date < today));
  const dueTodayItems = mineOpen.filter((e) => e.item.due_date === today);

  const totalAssigned = mine.length;
  const completedCount = mineCompleted.length;
  const completionPercent = totalAssigned ? Math.round((completedCount / totalAssigned) * 100) : 0;

  const completedPoints = useMemo(
    () =>
      mineCompleted.reduce(
        (sum, e) => (e.source === 'issue' ? sum + (e.item.story_points || 0) : sum),
        0,
      ),
    [mineCompleted],
  );

  const totalPoints = useMemo(
    () =>
      mine.reduce(
        (sum, e) => (e.source === 'issue' ? sum + (e.item.story_points || 0) : sum),
        0,
      ),
    [mine],
  );

  const activeProjectIds = useMemo(
    () =>
      new Set(
        mineOpen
          .map((e) => (e.source === 'issue' ? e.item.project_id : e.item.project_id))
          .filter(Boolean),
      ),
    [mineOpen],
  );

  // Delivery trend
  const trend = useMemo(() => {
    const windowDays = Number(days);
    const result: { date: string; created: number; completed: number }[] = [];
    const now = new Date();

    for (let i = windowDays - 1; i >= 0; i--) {
      const d = new Date(now);
      d.setDate(d.getDate() - i);
      const dateStr = d.toLocaleDateString('en-CA');
      result.push({ date: dateStr, created: 0, completed: 0 });
    }
    const map = new Map(result.map((r) => [r.date, r]));

    allEntries.forEach((e) => {
      const isMine =
        e.source === 'issue'
          ? e.item.assignee_id === data.user.id || e.item.reporter_id === data.user.id
          : e.item.owner_id === data.user.id || e.item.created_by === data.user.id;
      if (!isMine) return;

      const createdDay = e.item.created_at.slice(0, 10);
      if (map.has(createdDay)) {
        map.get(createdDay)!.created += 1;
      }
      if (done(e)) {
        const completedDay = e.item.updated_at.slice(0, 10);
        if (map.has(completedDay)) {
          map.get(completedDay)!.completed += 1;
        }
      }
    });

    return result;
  }, [days, allEntries, data.user.id]);

  // Work distribution
  const distribution = useMemo(() => {
    let completed = 0;
    let active = 0;
    let todo = 0;

    mine.forEach((e) => {
      if (done(e)) {
        completed++;
      } else if (
        (e.source === 'issue' &&
          data.statuses.find((s) => s.id === e.item.status_id)?.category === 'active') ||
        (e.source === 'team' && e.item.state === 'active')
      ) {
        active++;
      } else {
        todo++;
      }
    });

    const flagged = mine.filter((e) => e.source === 'issue' && e.item.flagged).length;
    return { completed, active, todo, flagged, total: mine.length };
  }, [mine, data.statuses]);

  // Filtered entries for main list
  const filteredEntries = useMemo(() => {
    return allEntries
      .filter((entry) => {
        // Tab filter
        if (view === 'assigned') {
          const isAssigned =
            entry.source === 'issue'
              ? entry.item.assignee_id === data.user.id
              : entry.item.owner_id === data.user.id;
          if (!isAssigned || done(entry)) return false;
        } else if (view === 'created') {
          const isCreated =
            entry.source === 'issue'
              ? entry.item.reporter_id === data.user.id
              : entry.item.created_by === data.user.id;
          if (!isCreated) return false;
        } else if (view === 'completed') {
          const isAssigned =
            entry.source === 'issue'
              ? entry.item.assignee_id === data.user.id
              : entry.item.owner_id === data.user.id;
          if (!isAssigned || !done(entry)) return false;
        } else if (view === 'attention') {
          const isAssigned =
            entry.source === 'issue'
              ? entry.item.assignee_id === data.user.id
              : entry.item.owner_id === data.user.id;
          if (!isAssigned || done(entry)) return false;
          const isOverdue = Boolean(entry.item.due_date && entry.item.due_date < today);
          const isDueToday = entry.item.due_date === today;
          const isFlagged = entry.source === 'issue' && Boolean(entry.item.flagged);
          const isHigh =
            entry.source === 'issue' &&
            (entry.item.priority === 'critical' || entry.item.priority === 'high');
          if (!isOverdue && !isDueToday && !isFlagged && !isHigh) return false;
        }

        // Type filter
        if (type !== 'all' && entryType(entry) !== type) {
          return false;
        }

        // Project filter
        if (projectId && entry.item.project_id !== projectId) {
          return false;
        }

        // Priority filter
        if (priorityFilter !== 'all') {
          if (entry.source !== 'issue') return false;
          if (priorityFilter === 'urgent_high') {
            if (!['critical', 'high'].includes(entry.item.priority)) return false;
          } else if (entry.item.priority !== priorityFilter) {
            return false;
          }
        }

        // Search text
        if (search) {
          const label =
            entry.source === 'issue'
              ? `${entry.item.key} ${entry.item.summary} ${entry.item.description || ''}`
              : `${entry.item.title} ${entry.item.description || ''}`;
          if (!label.toLowerCase().includes(search.toLowerCase())) {
            return false;
          }
        }

        return true;
      })
      .sort((a, b) => {
        const aDue = a.item.due_date || '9999';
        const bDue = b.item.due_date || '9999';
        return aDue.localeCompare(bDue) || b.item.updated_at.localeCompare(a.item.updated_at);
      });
  }, [allEntries, view, type, projectId, priorityFilter, search, data.user.id, today]);

  // Grouped entries if grouping is active
  const groupedSections = useMemo(() => {
    if (groupBy === 'none') {
      return [{ key: 'all', title: '', entries: filteredEntries }];
    }

    if (groupBy === 'project') {
      const map = new Map<string, { title: string; color?: string; entries: Entry[] }>();
      filteredEntries.forEach((e) => {
        const pId = e.item.project_id || 'unassigned';
        const proj = data.projects.find((p) => p.id === pId);
        const title = proj ? `${proj.name} (${proj.key})` : 'No project';
        if (!map.has(pId)) {
          map.set(pId, { title, color: proj?.color, entries: [] });
        }
        map.get(pId)!.entries.push(e);
      });
      return Array.from(map.entries()).map(([id, group]) => ({
        key: id,
        title: group.title,
        color: group.color,
        entries: group.entries,
      }));
    }

    if (groupBy === 'status') {
      const groups = [
        { key: 'active', title: 'In progress', entries: [] as Entry[] },
        { key: 'todo', title: 'To do', entries: [] as Entry[] },
        { key: 'done', title: 'Completed', entries: [] as Entry[] },
      ];
      filteredEntries.forEach((e) => {
        if (done(e)) {
          groups[2].entries.push(e);
        } else if (
          (e.source === 'issue' &&
            data.statuses.find((s) => s.id === e.item.status_id)?.category === 'active') ||
          (e.source === 'team' && e.item.state === 'active')
        ) {
          groups[0].entries.push(e);
        } else {
          groups[1].entries.push(e);
        }
      });
      return groups.filter((g) => g.entries.length > 0);
    }

    if (groupBy === 'date') {
      const groups = [
        { key: 'overdue', title: 'Overdue', entries: [] as Entry[] },
        { key: 'today', title: 'Due today', entries: [] as Entry[] },
        { key: 'upcoming', title: 'Due later', entries: [] as Entry[] },
        { key: 'none', title: 'No due date', entries: [] as Entry[] },
      ];
      filteredEntries.forEach((e) => {
        if (!e.item.due_date) {
          groups[3].entries.push(e);
        } else if (e.item.due_date < today) {
          groups[0].entries.push(e);
        } else if (e.item.due_date === today) {
          groups[1].entries.push(e);
        } else {
          groups[2].entries.push(e);
        }
      });
      return groups.filter((g) => g.entries.length > 0);
    }

    return [{ key: 'all', title: '', entries: filteredEntries }];
  }, [filteredEntries, groupBy, data.projects, data.statuses, today]);

  // Standup brief
  const standupBrief = useMemo(() => {
    const completedRecently = mineCompleted
      .filter((e) => e.item.updated_at.slice(0, 10) >= today)
      .slice(0, 4);

    const inProgress = mineOpen
      .filter((e) => {
        if (e.source === 'issue') {
          const s = data.statuses.find((st) => st.id === e.item.status_id);
          return s?.category === 'active' || e.item.due_date === today;
        }
        return e.item.state === 'active' || e.item.due_date === today;
      })
      .slice(0, 4);

    const blockers = mineOpen
      .filter((e) => {
        const isOverdue = Boolean(e.item.due_date && e.item.due_date < today);
        const isFlagged = e.source === 'issue' && Boolean(e.item.flagged);
        return isOverdue || isFlagged;
      })
      .slice(0, 4);

    const text = [
      `*Daily Standup - ${data.user.name}* (${today})`,
      '',
      '**Completed / Progress:**',
      completedRecently.length
        ? completedRecently
            .map(
              (e) =>
                `- ${e.source === 'issue' ? `${e.item.key}: ` : ''}${e.source === 'issue' ? e.item.summary : e.item.title}`,
            )
            .join('\n')
        : '- Completed assigned backlog work',
      '',
      '**Today\'s Focus:**',
      inProgress.length
        ? inProgress
            .map(
              (e) =>
                `- ${e.source === 'issue' ? `${e.item.key}: ` : ''}${e.source === 'issue' ? e.item.summary : e.item.title}`,
            )
            .join('\n')
        : '- Working on current tasks',
      '',
      '**Blockers / Attention:**',
      blockers.length
        ? blockers
            .map(
              (e) =>
                `- ${e.source === 'issue' ? `${e.item.key} (Attention): ` : ''}${e.source === 'issue' ? e.item.summary : e.item.title}`,
            )
            .join('\n')
        : '- No blockers',
    ].join('\n');

    return { completedRecently, inProgress, blockers, text };
  }, [mineCompleted, mineOpen, today, data.user.name, data.statuses]);

  // Project progress breakdown for side card
  const projectSummaries = useMemo(() => {
    return Array.from(activeProjectIds).map((pId) => {
      const proj = data.projects.find((p) => p.id === pId);
      const projWork = mine.filter((e) => e.item.project_id === pId);
      const doneCount = projWork.filter((e) => done(e)).length;
      const totalCount = projWork.length;
      const pct = totalCount ? Math.round((doneCount / totalCount) * 100) : 0;
      const overdue = projWork.filter(
        (e) => !done(e) && Boolean(e.item.due_date && e.item.due_date < today),
      ).length;
      return {
        id: pId,
        name: proj?.name || 'Project',
        key: proj?.key || 'PRJ',
        color: proj?.color || '#94a3b8',
        doneCount,
        totalCount,
        pct,
        overdue,
      };
    });
  }, [activeProjectIds, data.projects, mine, today]);

  // Recent user activity
  const recentActivity = useMemo(() => {
    return (data.activity || [])
      .filter((a) => a.actor_id === data.user.id)
      .slice(0, 6)
      .map((a) => {
        const issue = data.issues.find((i) => i.id === a.issue_id);
        const action =
          a.field === 'status_id'
            ? `changed status to ${data.statuses.find((s) => s.id === a.new_value)?.name || 'new status'}`
            : a.field === 'comment'
              ? 'added a comment'
              : `updated ${a.field}`;
        return {
          id: a.id,
          issueId: a.issue_id,
          key: a.issue_key || issue?.key || 'Issue',
          title: a.issue_summary || issue?.summary || 'Task',
          action,
          time: a.created_at,
        };
      });
  }, [data.activity, data.user.id, data.issues, data.statuses]);

  const refreshAll = async () => {
    await refresh();
    await work.refetch();
  };

  return (
    <div className="page mywork-page">
      {/* Header & Kicker */}
      <div className="page-heading">
        <div>
          <div className="home-kicker">
            <span className="home-workspace-dot" />
            {data.workspace.name}
            <span>/</span>
            {ownTeam?.name || 'Personal'}
            <span>/</span>
            My work
          </div>
          <h1>My work</h1>
          <p>Your personal priorities, active deadlines, and delivery track across projects and teams.</p>
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
            onClick={() => void refreshAll()}
            disabled={work.isFetching}
            aria-label="Refresh my work"
          >
            <RefreshCw size={15} className={work.isFetching ? 'home-spin' : ''} />
          </Button>
          {canTeamCreate(data.organization, 'daily') && data.user.role !== 'viewer' && (
            <Button variant="secondary" onClick={() => openWork?.('daily')}>
              <Plus size={15} />
              Add daily task
            </Button>
          )}
          <Button
            onClick={() => openCreate({ assignee_id: data.user.id })}
            disabled={data.user.role === 'viewer'}
          >
            <Plus size={15} />
            Create issue
          </Button>
        </div>
      </div>

      {/* 4 Stat Metric Panels */}
      <section className="home-metrics mywork-metrics" aria-label="Personal work metrics">
        <article className="panel home-metric">
          <div>
            <span>Open work</span>
            <span className="home-metric-icon green">
              <CheckCircle2 size={19} />
            </span>
          </div>
          <strong>{mineOpen.length}</strong>
          <p>
            {openIssues.length} issues · {openDaily.length} daily tasks
          </p>
        </article>

        <article className="panel home-metric">
          <div>
            <span>Due soon & overdue</span>
            <span className="home-metric-icon amber">
              <Clock3 size={19} />
            </span>
          </div>
          <strong>{dueTodayItems.length + overdueItems.length}</strong>
          <p>
            {overdueItems.length} overdue · {dueTodayItems.length} due today
          </p>
        </article>

        <article className="panel home-metric">
          <div>
            <span>Personal delivery</span>
            <span className="home-metric-icon blue">
              <Sparkles size={19} />
            </span>
          </div>
          <strong>{completionPercent}%</strong>
          <p>
            {completedCount} completed · {completedPoints} pts delivered
          </p>
        </article>

        <article className="panel home-metric">
          <div>
            <span>Active projects</span>
            <span className="home-metric-icon purple">
              <FolderKanban size={19} />
            </span>
          </div>
          <strong>{activeProjectIds.size}</strong>
          <p>
            {activeProjectIds.size === 1 ? '1 active project' : `${activeProjectIds.size} active projects`}
          </p>
        </article>
      </section>

      {/* Interactive Visual Charts Grid */}
      <div className="home-chart-grid">
        <section className="panel home-chart-panel" aria-label="Delivery velocity chart">
          <header>
            <div>
              <h2>My delivery velocity</h2>
              <p>Personal work created and completed over time</p>
            </div>
            <label className="home-period">
              Activity window
              <select
                aria-label="Velocity period"
                value={days}
                onChange={(e) => setDays(e.target.value as '7' | '14' | '30')}
              >
                <option value="7">Last 7 days</option>
                <option value="14">Last 14 days</option>
                <option value="30">Last 30 days</option>
              </select>
            </label>
          </header>
          <div
            className="home-trend-chart"
            role="img"
            aria-label={`Personal activity over the last ${days} days. ${trend.reduce((n, d) => n + d.created, 0)} created and ${trend.reduce((n, d) => n + d.completed, 0)} completed.`}
          >
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={trend} margin={{ top: 12, right: 10, left: -22, bottom: 4 }}>
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
              Created <strong>{trend.reduce((n, d) => n + d.created, 0)}</strong>
            </span>
            <span>
              <i style={{ background: '#448565' }} />
              Completed <strong>{trend.reduce((n, d) => n + d.completed, 0)}</strong>
            </span>
            <small>Includes issues and daily tasks you completed or created.</small>
          </footer>
        </section>

        <section className="panel home-chart-panel home-state-panel" aria-label="Work breakdown chart">
          <header>
            <div>
              <h2>Work breakdown</h2>
              <p>Current state of your assignments</p>
            </div>
            <Activity size={19} />
          </header>
          <div className="home-donut">
            <div
              className="home-donut-chart"
              role="img"
              aria-label={`${distribution.completed} completed, ${distribution.active} in progress, ${distribution.todo} to do`}
            >
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={
                      distribution.total
                        ? [
                            { name: 'Completed', value: distribution.completed },
                            { name: 'In progress', value: distribution.active },
                            { name: 'To do', value: distribution.todo },
                          ]
                        : [{ name: 'No work', value: 1 }]
                    }
                    dataKey="value"
                    innerRadius="71%"
                    outerRadius="94%"
                    startAngle={90}
                    endAngle={-270}
                    paddingAngle={distribution.total ? 3 : 0}
                    stroke="none"
                    isAnimationActive={false}
                  >
                    {(distribution.total ? ['#619477', '#bba9d0', '#dbe3d7'] : ['#e9ede6']).map(
                      (color) => (
                        <Cell key={color} fill={color} />
                      ),
                    )}
                  </Pie>
                  {distribution.total > 0 && <Tooltip />}
                </PieChart>
              </ResponsiveContainer>
              <div className="home-donut-label">
                <strong>{distribution.total}</strong>
                <span>Assigned items</span>
              </div>
            </div>
            <div className="home-state-legend">
              {[
                { label: 'Completed', value: distribution.completed, color: '#619477' },
                { label: 'In progress', value: distribution.active, color: '#bba9d0' },
                { label: 'To do', value: distribution.todo, color: '#dbe3d7' },
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
              {completedPoints} story points delivered
            </span>
            <span>
              <Flag size={14} />
              {distribution.flagged} flagged
            </span>
          </footer>
        </section>
      </div>

      {/* Quick Add Fast Entry Bar */}
      <form onSubmit={handleQuickAdd} className="mywork-quick-add" aria-label="Quick add task">
        <span className="mywork-quick-add-icon">
          <CheckSquare size={18} />
        </span>
        <input
          value={quickTitle}
          onChange={(e) => setQuickTitle(e.target.value)}
          placeholder="Quick add a personal task for yourself today… (Press Enter to save)"
          aria-label="Quick add a daily task"
          disabled={quickSaving}
        />
        {quickTitle && (
          <button
            type="button"
            className="icon-btn"
            onClick={() => setQuickTitle('')}
            aria-label="Clear quick task title"
          >
            <X size={15} />
          </button>
        )}
        <Button size="small" type="submit" disabled={!quickTitle.trim() || quickSaving}>
          {quickSaving ? 'Saving…' : 'Add task'}
        </Button>
      </form>

      {/* Toolbar & Filter Controls */}
      <div className="mywork-toolbar">
        <div className="mywork-tabs" role="tablist" aria-label="My work views">
          {[
            { id: 'assigned', label: 'Assigned to me', count: mineOpen.length },
            { id: 'created', label: 'Created by me', count: createdByMe.length },
            { id: 'completed', label: 'Completed', count: mineCompleted.length },
            { id: 'attention', label: 'Needs attention', count: attentionItems.length },
          ].map((tab) => (
            <button
              key={tab.id}
              role="tab"
              aria-selected={view === tab.id}
              className={`mywork-tab-button ${view === tab.id ? 'active' : ''}`}
              onClick={() => setView(tab.id as typeof view)}
            >
              {tab.label}
              <span className="mywork-tab-count">{tab.count}</span>
            </button>
          ))}
        </div>

        <div className="mywork-filter-row">
          <div className="search-field" style={{ flex: 1, minWidth: 220 }}>
            <Search size={16} />
            <input
              aria-label="Search work"
              placeholder="Filter by title, key or description…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            {search && (
              <button
                type="button"
                className="icon-btn"
                onClick={() => setSearch('')}
                aria-label="Clear search"
              >
                <X size={14} />
              </button>
            )}
          </div>

          <div className="mywork-filter-controls">
            <label className="mywork-filter-select">
              <span>Type</span>
              <select
                aria-label="Work type"
                value={type}
                onChange={(e) => setType(e.target.value)}
              >
                {[
                  ['all', 'All types'],
                  ['daily', 'Daily tasks'],
                  ['issue', 'Issues'],
                  ['bug', 'Bugs'],
                  ['feature', 'Features'],
                  ['brd', 'BRDs'],
                  ['version', 'Versions'],
                ].map(([id, name]) => (
                  <option key={id} value={id}>
                    {name}
                  </option>
                ))}
              </select>
            </label>

            <label className="mywork-filter-select">
              <span>Project</span>
              <select
                aria-label="Work project"
                value={projectId}
                onChange={(e) => setProjectId(e.target.value)}
              >
                <option value="">All projects</option>
                {data.projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>

            <label className="mywork-filter-select">
              <span>Priority</span>
              <select
                aria-label="Work priority"
                value={priorityFilter}
                onChange={(e) => setPriorityFilter(e.target.value)}
              >
                <option value="all">All priorities</option>
                <option value="urgent_high">Critical & High</option>
                <option value="medium">Medium</option>
                <option value="low">Low</option>
              </select>
            </label>

            <label className="mywork-filter-select">
              <span>Group</span>
              <select
                aria-label="Group by"
                value={groupBy}
                onChange={(e) => setGroupBy(e.target.value as typeof groupBy)}
              >
                <option value="none">No grouping</option>
                <option value="project">By project</option>
                <option value="status">By status</option>
                <option value="date">By due date</option>
              </select>
            </label>
          </div>
        </div>
      </div>

      {/* Two Column Detail Grid */}
      <div className="home-detail-grid mywork-detail-grid">
        <div className="home-main-column">
          {/* Needs Attention Spotlight Banner (when in open view and attention items exist) */}
          {(view === 'assigned' || view === 'attention') && visibleAttentionItems.length > 0 && (
            <section className="mywork-attention-box" aria-label="Urgent items needing attention">
              <header>
                <h3>
                  <Flame size={16} />
                  Needs attention ({visibleAttentionItems.length})
                </h3>
                <Badge tone="amber">Urgent or overdue</Badge>
              </header>
              <div className="mywork-attention-items">
                {visibleAttentionItems.slice(0, 4).map((entry) => {
                  const isIssue = entry.source === 'issue';
                  const title = isIssue ? entry.item.summary : entry.item.title;
                  const proj = isIssue
                    ? data.projects.find((p) => p.id === entry.item.project_id)
                    : null;
                  const isOverdue = Boolean(entry.item.due_date && entry.item.due_date < today);
                  return (
                    <article className="mywork-attention-row" key={`attention-${entry.item.id}`}>
                      <div className="mywork-attention-left">
                        <button
                          type="button"
                          className="focus-complete"
                          aria-label={`Complete ${isIssue ? entry.item.key : title}`}
                          disabled={pending.has(entry.item.id)}
                          onClick={() => void complete(entry)}
                        >
                          <Circle size={18} />
                        </button>
                        <strong>{title}</strong>
                        {proj && <Badge>{proj.name}</Badge>}
                      </div>
                      <div className="mywork-attention-meta">
                        <span className={`mywork-due-chip ${isOverdue ? 'overdue' : 'today'}`}>
                          <Clock3 size={12} />
                          {isOverdue
                            ? `Overdue (${formatDate(entry.item.due_date)})`
                            : 'Due today'}
                        </span>
                        <Button
                          size="small"
                          variant="secondary"
                          onClick={() =>
                            isIssue
                              ? openIssue(entry.item.id)
                              : openWork?.(entry.item.kind, entry.item.team_id, entry.item)
                          }
                        >
                          View
                        </Button>
                      </div>
                    </article>
                  );
                })}
              </div>
            </section>
          )}

          {/* Unified Main Work List */}
          <section className="panel focus-work-list" aria-label="Work items">
            <header className="focus-list-heading">
              <h2>
                Work items
                <Badge>{filteredEntries.length}</Badge>
              </h2>
              <span>
                {view === 'assigned'
                  ? 'Assigned to you'
                  : view === 'created'
                    ? 'Created by you'
                    : view === 'completed'
                      ? 'Completed work'
                      : 'High priority & urgent'}
              </span>
            </header>

            {work.error && (
              <div className="focus-query-error" role="alert">
                <AlertCircle size={16} />
                <span>Team items could not be loaded. {work.error.message}</span>
                <Button variant="secondary" onClick={() => void work.refetch()}>
                  Retry
                </Button>
              </div>
            )}

            {work.isPending && (
              <div className="focus-loading" role="status">
                <RefreshCw size={16} className="home-spin" />
                Loading your work…
              </div>
            )}

            <div className="focus-rows">
              {groupedSections.map((group) => (
                <div key={group.key} className={groupBy !== 'none' ? 'mywork-group' : ''}>
                  {groupBy !== 'none' && (
                    <div className="mywork-group-header">
                      <span>
                        {group.color && (
                          <span
                            className="mywork-group-dot"
                            style={{ background: group.color }}
                          />
                        )}
                        {group.title}
                      </span>
                      <Badge>{group.entries.length}</Badge>
                    </div>
                  )}

                  {group.entries.map((entry) => {
                    const value = entry.item;
                    const isIssue = entry.source === 'issue';
                    const title = isIssue ? entry.item.summary : entry.item.title;
                    const label = isIssue
                      ? entry.item.type === 'story'
                        ? 'Feature'
                        : entry.item.type === 'bug'
                          ? 'Bug'
                          : 'Issue'
                      : workLabel(entry.item);
                    const Icon = isIssue
                      ? entry.item.type === 'bug'
                        ? Bug
                        : Layers
                      : entry.item.kind === 'brd'
                        ? FileText
                        : entry.item.kind === 'version'
                          ? GitBranch
                          : CheckSquare;
                    const status = isIssue
                      ? data.statuses.find((s) => s.id === entry.item.status_id)?.name
                      : entry.item.state === 'active'
                        ? 'In progress'
                        : entry.item.state === 'done'
                          ? entry.item.kind === 'version'
                            ? 'Released'
                            : 'Done'
                          : entry.item.state[0].toUpperCase() + entry.item.state.slice(1);
                    const owner = data.members.find(
                      (m) => m.id === (isIssue ? entry.item.assignee_id : entry.item.owner_id),
                    );
                    const proj = isIssue
                      ? data.projects.find((p) => p.id === entry.item.project_id)
                      : null;

                    const canComplete =
                      data.user.role !== 'viewer' &&
                      !done(entry) &&
                      (isIssue
                        ? data.projects.find((p) => p.id === entry.item.project_id)?.can_write !==
                            false &&
                          data.statuses.some(
                            (s) => s.project_id === entry.item.project_id && s.category === 'done',
                          )
                        : entry.item.kind === 'daily' &&
                          (!entry.item.project_id ||
                            data.projects.find((p) => p.id === entry.item.project_id)
                              ?.can_write !== false) &&
                          canTeamCreate(data.organization, 'daily', entry.item.team_id) &&
                          (data.organization?.can_admin ||
                            ['manager', 'lead'].includes(data.user.team_role || '') ||
                            entry.item.owner_id === data.user.id ||
                            entry.item.created_by === data.user.id));

                    const isOverdue =
                      value.due_date && value.due_date < today && !done(entry);
                    const isDueToday = value.due_date === today && !done(entry);

                    return (
                      <article
                        className="focus-work-row"
                        key={`${entry.source}-${value.id}`}
                      >
                        {canComplete ? (
                          <button
                            type="button"
                            className="focus-complete"
                            aria-label={`Complete ${isIssue ? entry.item.key : title}`}
                            disabled={pending.has(value.id)}
                            onClick={() => void complete(entry)}
                          >
                            <Circle size={20} />
                          </button>
                        ) : (
                          <span className="focus-complete passive" aria-hidden="true">
                            {done(entry) ? <CheckCircle2 size={20} /> : <Icon size={19} />}
                          </span>
                        )}

                        <button
                          type="button"
                          className="focus-open-work"
                          aria-label={`Open ${isIssue ? entry.item.key : label}: ${title}`}
                          onClick={() =>
                            isIssue
                              ? openIssue(value.id)
                              : openWork?.(entry.item.kind, entry.item.team_id, entry.item)
                          }
                        >
                          <span className={`focus-type-icon ${entryType(entry)}`}>
                            <Icon size={17} />
                          </span>

                          <span className="focus-work-title">
                            <strong>{title}</strong>
                            <small>
                              {isIssue ? entry.item.key : label}
                              {!isIssue && entry.item.version_tag ? ` · ${entry.item.version_tag}` : ''}
                              {proj ? ` · ${proj.name}` : ''}
                            </small>
                          </span>

                          <span className="focus-work-meta">
                            {isIssue && entry.item.priority && (
                              <span
                                className={`mywork-priority-chip ${entry.item.priority}`}
                                title={`Priority: ${entry.item.priority}`}
                              >
                                {entry.item.priority}
                              </span>
                            )}

                            {isIssue && Boolean(entry.item.flagged) && (
                              <span
                                className="home-priority flagged"
                                title="Flagged issue"
                                aria-label="Flagged issue"
                              >
                                <Flag size={14} />
                              </span>
                            )}

                            <Badge
                              tone={
                                done(entry)
                                  ? 'green'
                                  : status === 'In progress'
                                    ? 'lavender'
                                    : 'neutral'
                              }
                            >
                              {status || 'To do'}
                            </Badge>

                            <span
                              className={`focus-due ${isOverdue ? 'overdue' : isDueToday ? 'today' : ''}`}
                            >
                              {value.due_date ? (
                                <>
                                  <CalendarDays size={13} />
                                  {isOverdue
                                    ? formatDate(value.due_date)
                                    : isDueToday
                                      ? 'Today'
                                      : formatDate(value.due_date)}
                                </>
                              ) : (
                                <span>—</span>
                              )}
                            </span>

                            <Avatar user={owner} size={29} />
                            <ArrowRight size={16} />
                          </span>
                        </button>
                      </article>
                    );
                  })}
                </div>
              ))}
            </div>

            {!filteredEntries.length && !work.isPending && !work.error && (
              <Empty
                title={search || type !== 'all' ? 'No matching work' : 'You’re all caught up!'}
                text={
                  search || type !== 'all'
                    ? 'Try adjusting your search terms or filters.'
                    : 'No work items pending in this view. Use the quick add input above to capture a new task.'
                }
              />
            )}
          </section>
        </div>

        {/* Side Column: Standup Brief, Projects, and Activity */}
        <aside className="home-side-column">
          {/* Card 1: Daily Standup Brief */}
          <section className="panel mywork-side-card" aria-label="Daily standup brief">
            <header>
              <div>
                <h2>Daily standup brief</h2>
                <p>Personal check-in summary for today</p>
              </div>
              <CalendarDays size={19} color="#799480" />
            </header>

            <div className="mywork-standup-sections">
              <div className="mywork-standup-block">
                <h4>
                  <CheckCircle2 size={14} color="#4e9778" />
                  Completed recently
                </h4>
                {standupBrief.completedRecently.length > 0 ? (
                  <ul>
                    {standupBrief.completedRecently.map((e) => (
                      <li key={`standup-comp-${e.item.id}`}>
                        {e.source === 'issue' ? `${e.item.key}: ` : ''}
                        {e.source === 'issue' ? e.item.summary : e.item.title}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="empty-hint">Completed tasks will appear here.</p>
                )}
              </div>

              <div className="mywork-standup-block">
                <h4>
                  <Clock3 size={14} color="#8ba4ca" />
                  Today's focus
                </h4>
                {standupBrief.inProgress.length > 0 ? (
                  <ul>
                    {standupBrief.inProgress.map((e) => (
                      <li key={`standup-prog-${e.item.id}`}>
                        {e.source === 'issue' ? `${e.item.key}: ` : ''}
                        {e.source === 'issue' ? e.item.summary : e.item.title}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="empty-hint">No active tasks scheduled for today.</p>
                )}
              </div>

              <div className="mywork-standup-block">
                <h4>
                  <AlertCircle size={14} color="#bb9567" />
                  Attention & Blockers
                </h4>
                {standupBrief.blockers.length > 0 ? (
                  <ul>
                    {standupBrief.blockers.map((e) => (
                      <li key={`standup-block-${e.item.id}`}>
                        {e.source === 'issue' ? `${e.item.key}: ` : ''}
                        {e.source === 'issue' ? e.item.summary : e.item.title}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="empty-hint">No blockers or overdue deadlines! 👍</p>
                )}
              </div>
            </div>

            <footer className="mywork-standup-footer">
              <small>Formatted for standup meetings and Slack</small>
              <CopyButton text={standupBrief.text} label="Copy standup brief">
                Copy brief
              </CopyButton>
            </footer>
          </section>

          {/* Card 2: My Projects & Progress */}
          <section className="panel mywork-side-card" aria-label="My projects">
            <header>
              <div>
                <h2>My projects</h2>
                <p>Your delivery progress per project</p>
              </div>
              <Link to="/projects">
                All projects <ArrowUpRight size={14} />
              </Link>
            </header>

            <div className="mywork-project-rows">
              {projectSummaries.map((p) => (
                <div className="mywork-project-item" key={p.id}>
                  <div className="mywork-project-item-top">
                    <Link to={`/projects/${p.id}/board`}>
                      <span
                        className="home-team-avatar"
                        style={{ background: p.color, width: 28, height: 28 }}
                      >
                        <FolderKanban size={15} />
                      </span>
                      <span>{p.name}</span>
                    </Link>
                    <small>
                      {p.doneCount}/{p.totalCount} ({p.pct}%)
                    </small>
                  </div>
                  <div className="home-progress-track">
                    <span style={{ width: `${p.pct}%` }} />
                  </div>
                  <div className="mywork-project-item-bottom">
                    <span>{p.totalCount - p.doneCount} open for you</span>
                    {p.overdue > 0 && (
                      <span className="home-overdue">{p.overdue} overdue</span>
                    )}
                  </div>
                </div>
              ))}

              {!projectSummaries.length && (
                <Empty
                  title="No project work"
                  text="When issues from projects are assigned to you, progress tracks will appear here."
                />
              )}
            </div>
          </section>

          {/* Card 3: Recent Personal Activity */}
          <section className="panel mywork-side-card" aria-label="Recent activity">
            <header>
              <div>
                <h2>My recent activity</h2>
                <p>Actions logged in the workspace</p>
              </div>
              <Activity size={18} color="#799480" />
            </header>

            <div className="mywork-activity-list">
              {recentActivity.map((act) => (
                <button
                  type="button"
                  key={act.id}
                  className="mywork-activity-row"
                  onClick={() => openIssue(act.issueId)}
                  aria-label={`View ${act.key}: ${act.action}`}
                >
                  <span className="mywork-activity-dot" />
                  <div className="mywork-activity-text">
                    <strong>{act.key}</strong> {act.action}
                    <div className="mywork-activity-time">{relativeTime(act.time)}</div>
                  </div>
                </button>
              ))}

              {!recentActivity.length && (
                <p className="mywork-standup-block empty-hint">
                  Your recent updates and issue comments will appear here.
                </p>
              )}
            </div>
          </section>
        </aside>
      </div>

      {/* Real-time sync footer */}
      <div className="home-updated">
        <span className="connection-dot" />
        Synced in real time across your devices
        <span>· Project permissions apply to all personal metrics.</span>
      </div>
    </div>
  );
}
