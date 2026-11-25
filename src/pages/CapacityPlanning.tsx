import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api, put } from '../lib/api';
import { useGrace } from '../context';
import { Button } from '../components/ui';
import { Users, TrendingUp, TrendingDown, AlertTriangle, Download, ChevronDown } from 'lucide-react';
import type { Sprint } from '../../shared/types';
import type { SprintCapacity } from '../../shared/types';

interface CapacityResponse {
  sprint: Sprint & { total_capacity_hours?: number };
  capacity: SprintCapacity[];
}
interface TrendSprint {
  id: string;
  name: string;
  state: string;
  committed_points: number;
  completed_points: number;
  total_capacity_hours: number;
  total_assigned_points: number;
}
interface CapacityTrend {
  sprints: TrendSprint[];
}

function CapacityBar({ used, total, label }: { used: number; total: number; label?: string }) {
  const pct = total > 0 ? Math.min((used / total) * 100, 100) : 0;
  const over = total > 0 && used > total;
  const warn = pct >= 80 && !over;
  return (
    <div className="cap-bar-wrap">
      <div className="cap-bar-track">
        <div
          className={`cap-bar-fill ${over ? 'cap-bar-over' : warn ? 'cap-bar-warn' : 'cap-bar-ok'}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      {label && (
        <span className={`cap-bar-label ${over ? 'cap-bar-label-over' : ''}`}>{label}</span>
      )}
    </div>
  );
}

export function CapacityPlanningPage() {
  const { data: ctx } = useGrace();
  const qc = useQueryClient();
  const [selectedProjectId, setSelectedProjectId] = useState(ctx?.projects[0]?.id ?? '');
  const [selectedSprintId, setSelectedSprintId] = useState<string | null>(null);
  const [whatIf, setWhatIf] = useState<Record<string, { hours: number; focus: number }>>({});
  const [showTrend, setShowTrend] = useState(false);

  const sprints = (ctx?.sprints ?? []).filter(
    (s) => s.project_id === selectedProjectId && s.state !== 'closed',
  );
  const activeSprint = selectedSprintId
    ? sprints.find((s) => s.id === selectedSprintId)
    : sprints.find((s) => s.state === 'active') ?? sprints[0];

  const { data, isLoading } = useQuery<CapacityResponse>({
    queryKey: ['sprint-capacity', activeSprint?.id],
    queryFn: () => api(`/sprints/${activeSprint!.id}/capacity`),
    enabled: !!activeSprint?.id,
  });

  const { data: trendData } = useQuery<CapacityTrend>({
    queryKey: ['project-capacity-trend', selectedProjectId],
    queryFn: () => api(`/projects/${selectedProjectId}/capacity`),
    enabled: !!selectedProjectId && showTrend,
  });

  const updateMutation = useMutation({
    mutationFn: ({ userId, body }: { userId: string; body: { available_hours?: number; focus_factor?: number } }) =>
      put(`/sprints/${activeSprint!.id}/capacity/${userId}`, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['sprint-capacity', activeSprint?.id] }),
  });

  const capacity = data?.capacity ?? [];
  const totalHours = capacity.reduce((sum, m) => {
    const wi = whatIf[m.user_id];
    return sum + (wi?.hours ?? m.available_hours) * (wi?.focus ?? m.focus_factor);
  }, 0);
  const totalPoints = capacity.reduce((sum, m) => sum + m.assigned_points, 0);
  const teamUtil = totalHours > 0 ? (totalPoints / (totalHours / 8)) * 100 : 0; // rough pts-per-day
  const isOverloaded = teamUtil > 100;
  const isUnderloaded = teamUtil < 50;

  function exportCsv() {
    const rows = [
      ['Member', 'Available Hours', 'Focus Factor', 'Effective Hours', 'Assigned Points', 'Utilization %'],
      ...capacity.map((m) => {
        const wi = whatIf[m.user_id];
        const h = wi?.hours ?? m.available_hours;
        const f = wi?.focus ?? m.focus_factor;
        const eff = Math.round(h * f);
        const util = eff > 0 ? Math.round((m.assigned_points / (eff / 8)) * 100) : 0;
        return [m.user_name, h, f, eff, m.assigned_points, util];
      }),
    ];
    const csv = rows.map((r) => r.join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `capacity-${activeSprint?.name ?? 'sprint'}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="capacity-page">
      {/* Header */}
      <div className="capacity-header">
        <div className="capacity-header-left">
          <Users size={22} />
          <div>
            <h1 className="capacity-title">Capacity Planning</h1>
            <p className="capacity-subtitle">Balance team bandwidth and sprint scope</p>
          </div>
        </div>
        <div className="capacity-header-actions">
          <Button onClick={exportCsv}>
            <Download size={15} />
            Export CSV
          </Button>
        </div>
      </div>

      {/* Controls */}
      <div className="capacity-controls">
        <div className="capacity-select-wrap">
          <label>Project</label>
          <select
            className="capacity-select"
            value={selectedProjectId}
            onChange={(e) => { setSelectedProjectId(e.target.value); setSelectedSprintId(null); }}
          >
            {(ctx?.projects ?? []).map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
        </div>
        <div className="capacity-select-wrap">
          <label>Sprint</label>
          <select
            className="capacity-select"
            value={activeSprint?.id ?? ''}
            onChange={(e) => setSelectedSprintId(e.target.value)}
          >
            {sprints.length === 0 && <option value="">No active sprints</option>}
            {sprints.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name} {s.state === 'active' ? '(active)' : ''}
              </option>
            ))}
          </select>
        </div>
        <button
          className={`capacity-trend-toggle ${showTrend ? 'active' : ''}`}
          onClick={() => setShowTrend((v) => !v)}
        >
          <TrendingUp size={15} />
          {showTrend ? 'Hide trend' : 'Show trend'}
        </button>
      </div>

      {/* Team summary */}
      {data && (
        <div className="capacity-team-summary">
          <div className={`capacity-summary-card ${isOverloaded ? 'over' : isUnderloaded ? 'under' : 'ok'}`}>
            <div className="capacity-summary-icon">
              {isOverloaded ? <AlertTriangle size={22} /> : isUnderloaded ? <TrendingDown size={22} /> : <TrendingUp size={22} />}
            </div>
            <div className="capacity-summary-info">
              <span className="capacity-summary-label">Team utilization</span>
              <span className="capacity-summary-value">{Math.round(teamUtil)}%</span>
              <span className="capacity-summary-status">
                {isOverloaded ? '⚠ Over-committed — reduce scope or add capacity' :
                 isUnderloaded ? '↓ Under-utilized — consider pulling more work' :
                 '✓ Well-balanced sprint plan'}
              </span>
            </div>
          </div>
          <div className="capacity-summary-stats">
            <div className="capacity-stat-item">
              <span className="capacity-stat-label">Total effective hours</span>
              <span className="capacity-stat-value">{Math.round(totalHours)}h</span>
            </div>
            <div className="capacity-stat-item">
              <span className="capacity-stat-label">Assigned story points</span>
              <span className="capacity-stat-value">{totalPoints} pts</span>
            </div>
            <div className="capacity-stat-item">
              <span className="capacity-stat-label">Sprint committed</span>
              <span className="capacity-stat-value">{data.sprint.committed_points} pts</span>
            </div>
            <div className="capacity-stat-item">
              <span className="capacity-stat-label">Members</span>
              <span className="capacity-stat-value">{capacity.length}</span>
            </div>
          </div>
        </div>
      )}

      {/* Member rows */}
      {isLoading && (
        <div className="capacity-loading">
          <Users size={32} />
          <p>Loading capacity data…</p>
        </div>
      )}

      {!isLoading && capacity.length === 0 && (
        <div className="capacity-empty">
          <Users size={48} />
          <h3>No members found</h3>
          <p>Add members to this project to manage their capacity.</p>
        </div>
      )}

      {capacity.length > 0 && (
        <div className="capacity-table">
          <div className="capacity-table-header">
            <span>Member</span>
            <span>Available hours</span>
            <span>Focus factor</span>
            <span>Effective hours</span>
            <span>Assigned pts</span>
            <span>Workload</span>
          </div>

          {capacity.map((member) => {
            const wi = whatIf[member.user_id];
            const hours = wi?.hours ?? member.available_hours;
            const focus = wi?.focus ?? member.focus_factor;
            const effectiveHours = Math.round(hours * focus);
            const util = effectiveHours > 0 ? (member.assigned_points / (effectiveHours / 8)) * 100 : 0;
            const isOver = util > 100;

            return (
              <div key={member.user_id} className="capacity-member-row">
                <div className="capacity-member-info">
                  <div
                    className="capacity-avatar"
                    style={{ background: member.user_color }}
                  >
                    {member.user_name.charAt(0).toUpperCase()}
                  </div>
                  <span className="capacity-member-name">{member.user_name}</span>
                </div>

                <div className="capacity-input-cell">
                  <input
                    type="number"
                    className="capacity-input"
                    min={0}
                    max={336}
                    value={hours}
                    onChange={(e) =>
                      setWhatIf((prev) => ({
                        ...prev,
                        [member.user_id]: { hours: Number(e.target.value), focus: focus },
                      }))
                    }
                    onBlur={() => {
                      updateMutation.mutate({ userId: member.user_id, body: { available_hours: hours } });
                    }}
                  />
                  <span className="capacity-input-unit">h</span>
                </div>

                <div className="capacity-input-cell">
                  <input
                    type="range"
                    className="capacity-slider"
                    min={0.1}
                    max={1}
                    step={0.05}
                    value={focus}
                    onChange={(e) =>
                      setWhatIf((prev) => ({
                        ...prev,
                        [member.user_id]: { hours: hours, focus: Number(e.target.value) },
                      }))
                    }
                    onMouseUp={() => {
                      updateMutation.mutate({ userId: member.user_id, body: { focus_factor: focus } });
                    }}
                  />
                  <span className="capacity-input-unit">{Math.round(focus * 100)}%</span>
                </div>

                <div className="capacity-effective-hours">
                  <span className={isOver ? 'cap-over' : ''}>{effectiveHours}h</span>
                </div>

                <div className="capacity-points-cell">
                  <span>{member.assigned_points} pts</span>
                </div>

                <div className="capacity-workload-cell">
                  <CapacityBar
                    used={member.assigned_points}
                    total={effectiveHours / 8} // convert to point-days
                    label={`${Math.round(util)}%`}
                  />
                </div>
              </div>
            );
          })}

          {/* Team total row */}
          <div className="capacity-team-total-row">
            <div className="capacity-member-info">
              <span className="capacity-team-label">Team total</span>
            </div>
            <div className="capacity-effective-hours">
              <strong>{Math.round(totalHours)}h</strong>
            </div>
            <div />
            <div />
            <div className="capacity-points-cell">
              <strong>{totalPoints} pts</strong>
            </div>
            <div className="capacity-workload-cell">
              <CapacityBar
                used={totalPoints}
                total={totalHours / 8}
                label={`${Math.round(teamUtil)}% team load`}
              />
            </div>
          </div>
        </div>
      )}

      {/* Trend chart */}
      {showTrend && trendData && (
        <div className="capacity-trend-section">
          <h3 className="capacity-trend-title">
            <TrendingUp size={18} />
            Sprint capacity trend (last 8 sprints)
          </h3>
          <div className="capacity-trend-chart">
            {trendData.sprints.map((s) => {
              const maxPts = Math.max(...trendData.sprints.map((x) => x.total_assigned_points), 1);
              const committedH = Math.max(...trendData.sprints.map((x) => x.total_capacity_hours), 1);
              const ptsH = (s.total_assigned_points / maxPts) * 100;
              const capH = (s.total_capacity_hours / committedH) * 100;
              return (
                <div key={s.id} className="capacity-trend-col">
                  <div className="capacity-trend-bars">
                    <div className="capacity-trend-bar capacity-trend-cap" style={{ height: `${capH}%` }} title={`${s.total_capacity_hours}h capacity`} />
                    <div className="capacity-trend-bar capacity-trend-pts" style={{ height: `${ptsH}%` }} title={`${s.total_assigned_points} pts`} />
                  </div>
                  <span className="capacity-trend-label">{s.name.slice(0, 10)}</span>
                  <span className="capacity-trend-state">{s.state}</span>
                </div>
              );
            })}
          </div>
          <div className="capacity-trend-legend">
            <span><span className="cap-legend-box cap-legend-cap" /> Capacity hours</span>
            <span><span className="cap-legend-box cap-legend-pts" /> Assigned points</span>
          </div>
        </div>
      )}

      {/* What-if banner */}
      {Object.keys(whatIf).length > 0 && (
        <div className="capacity-whatif-banner">
          <AlertTriangle size={16} />
          <span>What-if mode active — changes are saved on blur/release</span>
          <button onClick={() => setWhatIf({})}>Reset</button>
        </div>
      )}
    </div>
  );
}
