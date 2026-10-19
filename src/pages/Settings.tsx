import { useState, type FormEvent } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import {
  Settings,
  Users,
  Database,
  ShieldCheck,
  Upload,
  Download,
  FileJson,
  Check,
  ArrowUpRight,
  FileSpreadsheet,
  History,
  CheckCircle2,
} from 'lucide-react';
import { useGrace } from '../context';
import { api, post, patch, exportIssues } from '../lib/api';
import { Avatar, Badge, Button, Empty, formatDate } from '../components/ui';
type Preview = {
  rows: {
    row: number;
    sourceKey: string;
    summary: string;
    status: string;
    warning: string;
    error: string;
  }[];
  imported: number;
};
export function SettingsPage() {
  const { data, run } = useGrace();
  const [tab, setTab] = useState('general');
  const admin = ['owner', 'admin'].includes(data.user.role);
  const [projectId, setProjectId] = useState(data.projects[0]?.id || '');
  const [file, setFile] = useState<{
    name: string;
    content: string;
    format: 'csv' | 'json';
  } | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [busy, setBusy] = useState(false);
  const [fileError, setFileError] = useState('');
  const audit = useQuery({
    queryKey: ['audit'],
    queryFn: () =>
      api<
        {
          id: string;
          actor_id: string;
          action: string;
          target_id: string;
          detail: string;
          created_at: string;
        }[]
      >('/audit'),
    enabled: tab === 'audit' && admin,
  });
  const doImport = async (confirm = false) => {
    if (!file) return;
    setBusy(true);
    const result = await run(
      () =>
        post<Preview>('/import/jira', {
          project_id: projectId,
          content: file.content,
          format: file.format,
          confirm,
        }),
      confirm ? 'Your imported work is ready.' : undefined,
    );
    if (result) {
      if (confirm) {
        setPreview(null);
        setFile(null);
      } else setPreview(result);
    }
    setBusy(false);
  };
  return (
    <div className="page settings-page">
      <div className="page-heading">
        <div>
          <h1>Settings</h1>
          <p>Your profile, team access, and workspace preferences.</p>
        </div>
      </div>
      <nav className="settings-shortcuts" aria-label="Settings areas">
        {(admin || data.organization?.can_manage_team) && (
          <Link to="/organization">
            <Users size={21} />
            <span>
              <strong>{admin ? 'Teams & roles' : 'Manage my team'}</strong>
              <small>People, dashboards and team permissions</small>
            </span>
            <ArrowUpRight size={16} />
          </Link>
        )}
        <Link to="/security">
          <ShieldCheck size={21} />
          <span>
            <strong>Security & notifications</strong>
            <small>Email verification, sessions and alerts</small>
          </span>
          <ArrowUpRight size={16} />
        </Link>
        {admin && (
          <Link to="/administration">
            <History size={21} />
            <span>
              <strong>Administration</strong>
              <small>Invitations, accounts and recovery</small>
            </span>
            <ArrowUpRight size={16} />
          </Link>
        )}
      </nav>
      <div className="settings-layout">
        <aside>
          {[
            { id: 'general', label: 'General', icon: Settings },
            { id: 'workflow', label: 'Workflows', icon: CheckCircle2 },
            { id: 'data', label: 'Import & export', icon: Database },
            { id: 'audit', label: 'Audit log', icon: ShieldCheck },
          ]
            .filter((t) => admin || t.id !== 'audit')
            .map((t) => (
              <button
                key={t.id}
                className={tab === t.id ? 'active' : ''}
                onClick={() => setTab(t.id)}
              >
                <t.icon size={16} />
                {t.label}
              </button>
            ))}
        </aside>
        <div className="settings-content">
          {tab === 'general' ? (
            <>
              <section className="panel settings-card">
                <h2>Workspace details</h2>
                <p>The home for your team’s work.</p>
                <form
                  onSubmit={async (e) => {
                    e.preventDefault();
                    const name = new FormData(e.currentTarget).get('name');
                    await run(() => patch('/workspace', { name }), 'Workspace updated.');
                  }}
                >
                  <label>
                    Workspace name
                    <input
                      key={data.workspace.name}
                      name="name"
                      defaultValue={data.workspace.name}
                      required
                      minLength={2}
                      maxLength={120}
                      disabled={!admin}
                    />
                  </label>
                  <label>
                    Workspace URL
                    <div className="readonly-field">grace / {data.workspace.slug}</div>
                  </label>
                  <Button type="submit" disabled={!admin}>
                    Save changes
                  </Button>
                </form>
              </section>
              <section className="panel settings-card">
                <h2>Your profile</h2>
                <p>A familiar face in a shared workspace.</p>
                <form
                  onSubmit={async (e) => {
                    e.preventDefault();
                    const name = new FormData(e.currentTarget).get('name');
                    await run(
                      () => patch(`/members/${data.user.id}`, { name }),
                      'Profile updated.',
                    );
                  }}
                >
                  <div className="profile-setting">
                    <Avatar user={data.user} size={48} />
                    <div>
                      <strong>{data.user.name}</strong>
                      <small>{data.user.email}</small>
                    </div>
                    <Badge tone="green">{data.user.role}</Badge>
                  </div>
                  <label>
                    Name
                    <input
                      key={data.user.name}
                      name="name"
                      defaultValue={data.user.name}
                      required
                      minLength={2}
                      maxLength={120}
                    />
                  </label>
                  <Button variant="secondary" type="submit">
                    Update profile
                  </Button>
                </form>
              </section>
              <section className="panel settings-card database-card">
                <Database size={25} />
                <div>
                  <h3>Persistent SQL storage</h3>
                  <p>
                    {data.database === 'mysql'
                      ? 'Connected to your MySQL database.'
                      : 'Using a local SQLite database for development. MySQL support is configured through the server environment.'}
                  </p>
                  <Badge tone="green">{data.database === 'mysql' ? 'MySQL' : 'Local SQLite'}</Badge>
                </div>
              </section>
            </>
          ) : tab === 'workflow' ? (
            <section className="panel settings-card">
              <h2>Simple, with room to grow.</h2>
              <p>
                Columns belong to a project. All configured statuses allow transitions in this
                initial workflow.
              </p>
              <label>
                Project
                <select value={projectId} onChange={(e) => setProjectId(e.target.value)}>
                  {data.projects.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </label>
              <div className="workflow-settings">
                {data.statuses
                  .filter((s) => s.project_id === projectId)
                  .map((s) => (
                    <form
                      key={`${s.id}-${s.name}-${s.wip_limit}`}
                      onSubmit={async (e) => {
                        e.preventDefault();
                        const v = Object.fromEntries(new FormData(e.currentTarget));
                        await run(
                          () =>
                            patch(`/statuses/${s.id}`, {
                              name: v.name,
                              wip_limit: Number(v.wip_limit),
                            }),
                          'Workflow updated.',
                        );
                      }}
                    >
                      <span className="workflow-dot" style={{ background: s.color }} />
                      <label>
                        Name
                        <input
                          name="name"
                          required
                          defaultValue={s.name}
                          maxLength={80}
                          disabled={!admin}
                        />
                      </label>
                      <label>
                        WIP limit
                        <input
                          name="wip_limit"
                          type="number"
                          min={0}
                          max={100}
                          defaultValue={s.wip_limit}
                          disabled={!admin}
                        />
                      </label>
                      <Badge>{s.category}</Badge>
                      <Button type="submit" variant="secondary" disabled={!admin}>
                        Save
                      </Button>
                    </form>
                  ))}
              </div>
              <div className="info-note">
                <CheckCircle2 size={17} />
                <p>
                  A limit of 0 allows unlimited work. Add columns from your board. A visual
                  transition designer is planned for the next milestone.
                </p>
              </div>
            </section>
          ) : tab === 'data' ? (
            <>
              <section className="panel settings-card">
                <div className="settings-icon">
                  <Upload size={23} />
                </div>
                <h2>Bring your work along.</h2>
                <p>
                  Import a Jira CSV or JSON export. Preview summaries, statuses, types, priorities,
                  and story points before creating any issues. Original keys are preserved in each
                  description.
                </p>
                <label>
                  Destination project
                  <select
                    value={projectId}
                    onChange={(e) => {
                      setProjectId(e.target.value);
                      setPreview(null);
                    }}
                  >
                    {data.projects.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name} · {p.key}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="file-drop">
                  <Upload size={25} />
                  <strong>{file?.name || 'Choose your Jira export'}</strong>
                  <span>CSV or JSON · Up to 1,000 issues · 2.5 MB</span>
                  <input
                    type="file"
                    accept=".csv,.json"
                    disabled={!admin || !projectId}
                    onChange={async (e) => {
                      const selected = e.target.files?.[0];
                      if (!selected) return;
                      setPreview(null);
                      setFileError('');
                      if (selected.size > 2500000) {
                        setFileError('Choose a file smaller than 2.5 MB.');
                        return;
                      }
                      setFile({
                        name: selected.name,
                        content: await selected.text(),
                        format: selected.name.toLowerCase().endsWith('.json') ? 'json' : 'csv',
                      });
                    }}
                  />
                </label>
                {fileError && <div className="form-error">{fileError}</div>}
                <div className="import-actions">
                  <Button
                    variant="secondary"
                    onClick={() => doImport(false)}
                    busy={busy}
                    disabled={!file || !admin || !projectId}
                  >
                    <FileSpreadsheet size={15} />
                    Preview import
                  </Button>
                  {preview && (
                    <Button
                      onClick={() => doImport(true)}
                      busy={busy}
                      disabled={preview.rows.some((r) => r.error)}
                    >
                      <Check size={15} />
                      Import {preview.rows.length} issues
                    </Button>
                  )}
                </div>
                {preview && (
                  <>
                    <div className="import-preview-heading">
                      <h3>Here’s what’s coming with you.</h3>
                      <Badge>{preview.rows.length} issues</Badge>
                    </div>
                    <div className="table-wrap import-preview">
                      <table>
                        <thead>
                          <tr>
                            <th>Source key</th>
                            <th>Summary</th>
                            <th>Status</th>
                            <th>Notes</th>
                          </tr>
                        </thead>
                        <tbody>
                          {preview.rows.map((r) => (
                            <tr key={r.row}>
                              <td>{r.sourceKey || `Row ${r.row}`}</td>
                              <td>{r.summary || '—'}</td>
                              <td>{r.status}</td>
                              <td className={r.error ? 'form-error' : ''}>
                                {r.error || r.warning || 'Ready'}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    <p className="view-footnote">
                      Import creates new issues with Grace project keys. Re-importing the same file
                      creates duplicates.
                    </p>
                  </>
                )}
              </section>
              <section className="panel settings-card">
                <h2>Your work goes where you go.</h2>
                <p>Export visible workspace issues for reporting or migration.</p>
                <div className="heading-actions">
                  <Button variant="secondary" onClick={() => exportIssues(data.issues, 'csv')}>
                    <Download size={14} />
                    Export CSV
                  </Button>
                  <Button variant="secondary" onClick={() => exportIssues(data.issues, 'json')}>
                    <FileJson size={14} />
                    Export JSON
                  </Button>
                </div>
              </section>
            </>
          ) : (
            <section className="panel settings-card">
              <h2>A clear record of changes.</h2>
              <p>Administrative actions, recorded with the person and time.</p>
              {!admin ? (
                <Empty
                  title="For workspace administrators"
                  text="Ask an admin if you need details about a workspace change."
                />
              ) : audit.isPending ? (
                <p>Loading the audit log…</p>
              ) : audit.error ? (
                <p className="form-error">{audit.error.message}</p>
              ) : audit.data?.length ? (
                <div className="audit-list">
                  {audit.data.map((a) => (
                    <article key={a.id}>
                      <History size={16} />
                      <div>
                        <strong>{a.action.replace(/\./g, ' ')}</strong>
                        <p>
                          {data.members.find((m) => m.id === a.actor_id)?.name ||
                            'Workspace member'}
                          {a.detail && ` · ${a.detail}`}
                        </p>
                        <small>
                          {formatDate(a.created_at, {
                            month: 'short',
                            day: 'numeric',
                            hour: 'numeric',
                            minute: '2-digit',
                          })}
                        </small>
                      </div>
                    </article>
                  ))}
                </div>
              ) : (
                <Empty
                  title="A fresh page in the log"
                  text="Project, sprint, import, and permission changes will appear here."
                />
              )}
            </section>
          )}
        </div>
      </div>
    </div>
  );
}
