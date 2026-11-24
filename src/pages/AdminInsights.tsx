import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  BarChart3,
  Users,
  TrendingUp,
  ShieldCheck,
  Activity,
  Eye,
  Download,
  RefreshCw,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  Info,
} from 'lucide-react';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  LineChart,
  Line,
  PieChart,
  Pie,
  Cell,
  Legend,
} from 'recharts';
import { api } from '../lib/api';
import { Badge, Button, Empty, formatDate } from '../components/ui';
import { useGrace } from '../context';

type InsightsSummary = {
  total_users: number;
  active_users_30d: number;
  active_users_7d: number;
  total_projects: number;
  active_projects: number;
  total_issues: number;
  issues_this_month: number;
  two_step_enabled: number;
  two_step_pending: number;
};

type AppUsageStat = {
  name: string;
  active_users: number;
  total_actions: number;
  adoption_pct: number;
};

type DailyActivity = {
  date: string;
  issues_created: number;
  issues_resolved: number;
  logins: number;
};

type UserAccessStat = {
  id: string;
  name: string;
  email: string;
  role: string;
  last_active: string | null;
  two_step: boolean;
  projects_count: number;
  issues_count: number;
  status: 'active' | 'idle' | 'inactive';
};

const COLORS = ['#0070f3', '#7c3aed', '#059669', '#d97706', '#dc2626', '#0891b2'];

function StatCard({
  icon: Icon,
  label,
  value,
  sub,
  tone,
}: {
  icon: React.ElementType;
  label: string;
  value: string | number;
  sub?: string;
  tone?: 'green' | 'amber' | 'red' | 'blue';
}) {
  const toneClass = tone ? `insights-stat-${tone}` : '';
  return (
    <div className={`insights-stat-card ${toneClass}`}>
      <span className="insights-stat-icon">
        <Icon size={22} />
      </span>
      <div>
        <strong className="insights-stat-value">{value}</strong>
        <span className="insights-stat-label">{label}</span>
        {sub && <small className="insights-stat-sub">{sub}</small>}
      </div>
    </div>
  );
}

export function AdminInsightsPage() {
  const { data } = useGrace();
  const [tab, setTab] = useState<'overview' | 'apps' | 'users' | 'security'>('overview');

  const summary = useQuery({
    queryKey: ['insights-summary', data.workspace.id],
    queryFn: () => api<InsightsSummary>('/insights/summary'),
  });
  const appUsage = useQuery({
    queryKey: ['insights-apps', data.workspace.id],
    queryFn: () => api<AppUsageStat[]>('/insights/apps'),
    enabled: tab === 'apps',
  });
  const activity = useQuery({
    queryKey: ['insights-activity', data.workspace.id],
    queryFn: () => api<DailyActivity[]>('/insights/activity'),
  });
  const users = useQuery({
    queryKey: ['insights-users', data.workspace.id],
    queryFn: () => api<UserAccessStat[]>('/insights/users'),
    enabled: tab === 'users' || tab === 'security',
  });

  const s = summary.data;
  const twoStepRate = s
    ? Math.round((s.two_step_enabled / Math.max(s.total_users, 1)) * 100)
    : 0;
  const adoptionRate = s
    ? Math.round((s.active_users_30d / Math.max(s.total_users, 1)) * 100)
    : 0;

  const securityScore =
    twoStepRate >= 80 ? 'high' : twoStepRate >= 50 ? 'medium' : 'low';

  const pieData = s
    ? [
        { name: 'Active (30d)', value: s.active_users_30d },
        { name: 'Idle', value: Math.max(0, s.total_users - s.active_users_30d) },
      ]
    : [];

  return (
    <div className="page insights-page">
      <div className="page-heading">
        <div>
          <span className="eyebrow">ADMIN INSIGHTS</span>
          <h1>Monitor app usage & plan for growth.</h1>
          <p>
            Track adoption, understand who needs access, and evaluate your organization's security
            posture based on real usage data.
          </p>
        </div>
        <div className="insights-heading-actions">
          <Button
            variant="secondary"
            onClick={() => {
              void summary.refetch();
              void activity.refetch();
            }}
          >
            <RefreshCw size={15} />
            Refresh
          </Button>
          <Button variant="secondary">
            <Download size={15} />
            Export CSV
          </Button>
        </div>
      </div>

      {/* Summary stats */}
      <div className="insights-stats-grid">
        <StatCard
          icon={Users}
          label="Total members"
          value={s?.total_users ?? '—'}
          sub={`${s?.active_users_7d ?? 0} active this week`}
          tone="blue"
        />
        <StatCard
          icon={TrendingUp}
          label="30-day adoption"
          value={`${adoptionRate}%`}
          sub={`${s?.active_users_30d ?? 0} of ${s?.total_users ?? 0} members`}
          tone={adoptionRate >= 70 ? 'green' : adoptionRate >= 40 ? 'amber' : 'red'}
        />
        <StatCard
          icon={Activity}
          label="Issues this month"
          value={s?.issues_this_month ?? '—'}
          sub={`${s?.total_issues ?? 0} total`}
        />
        <StatCard
          icon={ShieldCheck}
          label="2-step verification"
          value={`${twoStepRate}%`}
          sub={`${s?.two_step_enabled ?? 0} of ${s?.total_users ?? 0} members`}
          tone={securityScore === 'high' ? 'green' : securityScore === 'medium' ? 'amber' : 'red'}
        />
        <StatCard
          icon={BarChart3}
          label="Active projects"
          value={s?.active_projects ?? '—'}
          sub={`${s?.total_projects ?? 0} total`}
        />
        <StatCard
          icon={Eye}
          label="Security posture"
          value={securityScore === 'high' ? 'Strong' : securityScore === 'medium' ? 'Moderate' : 'At risk'}
          tone={securityScore === 'high' ? 'green' : securityScore === 'medium' ? 'amber' : 'red'}
        />
      </div>

      {/* Tabs */}
      <div className="insights-tabs">
        {(['overview', 'apps', 'users', 'security'] as const).map((t) => (
          <button key={t} className={tab === t ? 'active' : ''} onClick={() => setTab(t)}>
            {t === 'overview' && <BarChart3 size={15} />}
            {t === 'apps' && <Activity size={15} />}
            {t === 'users' && <Users size={15} />}
            {t === 'security' && <ShieldCheck size={15} />}
            {t.charAt(0).toUpperCase() + t.slice(1)}
          </button>
        ))}
      </div>

      {tab === 'overview' && (
        <div className="insights-content">
          <div className="insights-charts-row">
            <div className="panel insights-chart-panel">
              <h3>Issue activity — last 14 days</h3>
              {activity.isPending ? (
                <div className="skeleton insights-chart-skeleton" />
              ) : activity.data?.length ? (
                <ResponsiveContainer width="100%" height={220}>
                  <LineChart data={activity.data}>
                    <XAxis
                      dataKey="date"
                      tick={{ fontSize: 11 }}
                      tickFormatter={(d: string) =>
                        new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
                      }
                    />
                    <YAxis tick={{ fontSize: 11 }} />
                    <Tooltip />
                    <Legend />
                    <Line
                      type="monotone"
                      dataKey="issues_created"
                      name="Created"
                      stroke="#0070f3"
                      strokeWidth={2}
                      dot={false}
                    />
                    <Line
                      type="monotone"
                      dataKey="issues_resolved"
                      name="Resolved"
                      stroke="#059669"
                      strokeWidth={2}
                      dot={false}
                    />
                    <Line
                      type="monotone"
                      dataKey="logins"
                      name="Logins"
                      stroke="#7c3aed"
                      strokeWidth={2}
                      dot={false}
                    />
                  </LineChart>
                </ResponsiveContainer>
              ) : (
                <Empty title="No activity data" text="Usage data will appear as your team works." />
              )}
            </div>
            <div className="panel insights-chart-panel insights-pie-panel">
              <h3>Member activity distribution</h3>
              {s ? (
                <>
                  <ResponsiveContainer width="100%" height={180}>
                    <PieChart>
                      <Pie
                        data={pieData}
                        cx="50%"
                        cy="50%"
                        innerRadius={50}
                        outerRadius={80}
                        paddingAngle={3}
                        dataKey="value"
                      >
                        {pieData.map((_, i) => (
                          <Cell key={i} fill={COLORS[i % COLORS.length]} />
                        ))}
                      </Pie>
                      <Tooltip />
                      <Legend />
                    </PieChart>
                  </ResponsiveContainer>
                  <div className="insights-pie-stats">
                    <span>
                      <strong>{s.active_users_30d}</strong> active (30d)
                    </span>
                    <span>
                      <strong>{Math.max(0, s.total_users - s.active_users_30d)}</strong> idle
                    </span>
                  </div>
                </>
              ) : (
                <div className="skeleton insights-chart-skeleton" />
              )}
            </div>
          </div>

          <div className="panel insights-recommendations">
            <h3>
              <Info size={16} /> Recommendations
            </h3>
            <ul>
              {twoStepRate < 80 && (
                <li className="insights-rec-warn">
                  <AlertTriangle size={15} />
                  <span>
                    Only <strong>{twoStepRate}%</strong> of members use two-step verification.
                    Require 2SV for all admins and owners to improve security posture.
                  </span>
                </li>
              )}
              {twoStepRate >= 80 && (
                <li className="insights-rec-ok">
                  <CheckCircle2 size={15} />
                  <span>
                    Two-step verification adoption is strong at <strong>{twoStepRate}%</strong>.
                    Keep enforcing it for new members.
                  </span>
                </li>
              )}
              {adoptionRate < 60 && s && (
                <li className="insights-rec-warn">
                  <AlertTriangle size={15} />
                  <span>
                    <strong>{s.total_users - s.active_users_30d}</strong> members haven't been
                    active in 30 days. Consider reviewing their access to manage licensing.
                  </span>
                </li>
              )}
              {s && s.active_projects < s.total_projects * 0.5 && (
                <li className="insights-rec-info">
                  <Info size={15} />
                  <span>
                    More than half of your projects are inactive. Archive stale projects to keep
                    your workspace organized.
                  </span>
                </li>
              )}
            </ul>
          </div>
        </div>
      )}

      {tab === 'apps' && (
        <div className="insights-content">
          <div className="panel insights-panel-full">
            <div className="insights-panel-heading">
              <div>
                <h3>Atlassian app adoption</h3>
                <p>Track which features and apps your team uses most.</p>
              </div>
            </div>
            {appUsage.isPending ? (
              <div className="skeleton insights-chart-skeleton" />
            ) : appUsage.data?.length ? (
              <>
                <ResponsiveContainer width="100%" height={260}>
                  <BarChart data={appUsage.data} layout="vertical">
                    <XAxis type="number" tick={{ fontSize: 11 }} domain={[0, 100]} unit="%" />
                    <YAxis type="category" dataKey="name" tick={{ fontSize: 12 }} width={120} />
                    <Tooltip formatter={(v) => [`${v}%`, 'Adoption']} />
                    <Bar dataKey="adoption_pct" name="Adoption" fill="#0070f3" radius={[0, 4, 4, 0]} />
                  </BarChart>
                </ResponsiveContainer>
                <div className="insights-app-table">
                  <table>
                    <thead>
                      <tr>
                        <th>App / Feature</th>
                        <th>Active users</th>
                        <th>Total actions</th>
                        <th>Adoption</th>
                        <th>Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {appUsage.data.map((app) => (
                        <tr key={app.name}>
                          <td>
                            <strong>{app.name}</strong>
                          </td>
                          <td>{app.active_users}</td>
                          <td>{app.total_actions.toLocaleString()}</td>
                          <td>
                            <div className="insights-adoption-bar">
                              <div
                                className="insights-adoption-fill"
                                style={{ width: `${app.adoption_pct}%` }}
                              />
                              <span>{app.adoption_pct}%</span>
                            </div>
                          </td>
                          <td>
                            <Badge
                              tone={
                                app.adoption_pct >= 70
                                  ? 'green'
                                  : app.adoption_pct >= 40
                                    ? undefined
                                    : undefined
                              }
                            >
                              {app.adoption_pct >= 70
                                ? 'High'
                                : app.adoption_pct >= 40
                                  ? 'Medium'
                                  : 'Low'}
                            </Badge>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            ) : (
              <Empty title="No app usage data" text="Data will appear as your team uses features." />
            )}
          </div>
        </div>
      )}

      {tab === 'users' && (
        <div className="insights-content">
          <div className="panel insights-panel-full">
            <div className="insights-panel-heading">
              <div>
                <h3>Member access & usage</h3>
                <p>Make data-driven decisions about who needs access to apps.</p>
              </div>
            </div>
            {users.isPending ? (
              <div className="skeleton insights-chart-skeleton" />
            ) : users.data?.length ? (
              <div className="insights-user-table">
                <table>
                  <thead>
                    <tr>
                      <th>Member</th>
                      <th>Role</th>
                      <th>Last active</th>
                      <th>Projects</th>
                      <th>Issues</th>
                      <th>2SV</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {users.data.map((user) => (
                      <tr key={user.id}>
                        <td>
                          <div className="insights-user-cell">
                            <strong>{user.name}</strong>
                            <small>{user.email}</small>
                          </div>
                        </td>
                        <td>
                          <Badge>{user.role}</Badge>
                        </td>
                        <td>
                          {user.last_active ? (
                            <span title={user.last_active}>
                              {formatDate(user.last_active)}
                            </span>
                          ) : (
                            <span className="insights-muted">Never</span>
                          )}
                        </td>
                        <td>{user.projects_count}</td>
                        <td>{user.issues_count}</td>
                        <td>
                          {user.two_step ? (
                            <CheckCircle2 size={16} className="insights-ok" />
                          ) : (
                            <XCircle size={16} className="insights-warn" />
                          )}
                        </td>
                        <td>
                          <Badge
                            tone={
                              user.status === 'active'
                                ? 'green'
                                : undefined
                            }
                          >
                            {user.status}
                          </Badge>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <Empty title="No user data" text="Member activity will appear here." />
            )}
          </div>
        </div>
      )}

      {tab === 'security' && (
        <div className="insights-content">
          <div className="insights-security-score-card panel">
            <div
              className={`insights-security-badge insights-security-${securityScore}`}
            >
              <ShieldCheck size={36} />
              <div>
                <strong>
                  {securityScore === 'high'
                    ? 'Strong Security'
                    : securityScore === 'medium'
                      ? 'Moderate Risk'
                      : 'Security At Risk'}
                </strong>
                <span>
                  {securityScore === 'high'
                    ? 'Your organization has good security practices in place.'
                    : securityScore === 'medium'
                      ? 'Some members are not using two-step verification.'
                      : 'Many members lack two-step verification. Take action now.'}
                </span>
              </div>
            </div>
            <div className="insights-security-metrics">
              <div>
                <span>Two-step verification rate</span>
                <div className="insights-progress-bar">
                  <div
                    className={`insights-progress-fill insights-progress-${securityScore}`}
                    style={{ width: `${twoStepRate}%` }}
                  />
                </div>
                <strong>{twoStepRate}%</strong>
              </div>
              <div>
                <span>Members with 2SV enabled</span>
                <strong>{s?.two_step_enabled ?? '—'}</strong>
              </div>
              <div>
                <span>Members without 2SV</span>
                <strong className={twoStepRate < 80 ? 'insights-warn-text' : ''}>
                  {s ? s.total_users - s.two_step_enabled : '—'}
                </strong>
              </div>
            </div>
          </div>

          <div className="panel insights-panel-full">
            <div className="insights-panel-heading">
              <div>
                <h3>Member two-step verification status</h3>
                <p>Evaluate the security of your organization member by member.</p>
              </div>
            </div>
            {users.isPending ? (
              <div className="skeleton insights-chart-skeleton" />
            ) : users.data?.length ? (
              <div className="insights-user-table">
                <table>
                  <thead>
                    <tr>
                      <th>Member</th>
                      <th>Role</th>
                      <th>2-step verification</th>
                      <th>Last active</th>
                      <th>Risk level</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[...users.data]
                      .sort((a, b) => (a.two_step === b.two_step ? 0 : a.two_step ? 1 : -1))
                      .map((user) => (
                        <tr key={user.id}>
                          <td>
                            <div className="insights-user-cell">
                              <strong>{user.name}</strong>
                              <small>{user.email}</small>
                            </div>
                          </td>
                          <td>
                            <Badge>{user.role}</Badge>
                          </td>
                          <td>
                            {user.two_step ? (
                              <span className="insights-status-ok">
                                <CheckCircle2 size={15} /> Enabled
                              </span>
                            ) : (
                              <span className="insights-status-warn">
                                <XCircle size={15} /> Not enabled
                              </span>
                            )}
                          </td>
                          <td>
                            {user.last_active ? formatDate(user.last_active) : '—'}
                          </td>
                          <td>
                            <Badge
                              tone={
                                !user.two_step && ['owner', 'admin'].includes(user.role)
                                  ? undefined
                                  : user.two_step
                                    ? 'green'
                                    : undefined
                              }
                            >
                              {!user.two_step && ['owner', 'admin'].includes(user.role)
                                ? 'High'
                                : !user.two_step
                                  ? 'Medium'
                                  : 'Low'}
                            </Badge>
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <Empty title="No user data" text="Member security data will appear here." />
            )}
          </div>
        </div>
      )}
    </div>
  );
}
