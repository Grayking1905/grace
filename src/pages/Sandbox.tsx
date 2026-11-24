import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  FlaskConical,
  Plus,
  Trash2,
  RefreshCw,
  Copy,
  CheckCircle2,
  Clock,
  AlertTriangle,
  ArrowUpRight,
  Shield,
  Zap,
  Eye,
} from 'lucide-react';
import { api, post } from '../lib/api';
import { Avatar, Badge, Button, Empty, Modal, formatDate } from '../components/ui';
import { useGrace } from '../context';

type SandboxEnvironment = {
  id: string;
  name: string;
  description: string;
  status: 'active' | 'creating' | 'syncing' | 'error' | 'deleted';
  production_snapshot: string;
  last_synced: string | null;
  created_by_id: string;
  created_by_name: string;
  created_by_color: string;
  workspace_count: number;
  project_count: number;
  issue_count: number;
  created_at: string;
  updated_at: string;
};

type SandboxApp = {
  id: string;
  sandbox_id: string;
  name: string;
  version: string;
  installed_at: string;
  status: 'installed' | 'pending' | 'failed';
};

const STATUS_COLORS: Record<SandboxEnvironment['status'], string> = {
  active: 'green',
  creating: '',
  syncing: '',
  error: '',
  deleted: '',
};

const STATUS_LABELS: Record<SandboxEnvironment['status'], string> = {
  active: 'Active',
  creating: 'Creating…',
  syncing: 'Syncing…',
  error: 'Error',
  deleted: 'Deleted',
};

function StatusBadge({ status }: { status: SandboxEnvironment['status'] }) {
  return (
    <Badge tone={STATUS_COLORS[status] as 'green' | undefined}>
      {status === 'creating' || status === 'syncing' ? (
        <RefreshCw size={12} className="spinning" />
      ) : status === 'active' ? (
        <CheckCircle2 size={12} />
      ) : status === 'error' ? (
        <AlertTriangle size={12} />
      ) : null}
      {STATUS_LABELS[status]}
    </Badge>
  );
}

export function SandboxPage() {
  const { data, run, toast } = useGrace();
  const queryClient = useQueryClient();
  const [createOpen, setCreateOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState<SandboxEnvironment | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<SandboxEnvironment | null>(null);

  const sandboxes = useQuery({
    queryKey: ['sandboxes', data.workspace.id],
    queryFn: () => api<SandboxEnvironment[]>('/sandboxes'),
    refetchInterval: (query) => {
      const data = query.state.data;
      if (data?.some((s) => s.status === 'creating' || s.status === 'syncing')) return 3000;
      return false;
    },
  });

  const selectedApps = useQuery({
    queryKey: ['sandbox-apps', selected?.id],
    queryFn: () => api<SandboxApp[]>(`/sandboxes/${selected!.id}/apps`),
    enabled: !!selected,
  });

  const createSandbox = async (name: string, description: string) => {
    setBusy(true);
    try {
      await post('/sandboxes', { name, description });
      await queryClient.invalidateQueries({ queryKey: ['sandboxes'] });
      toast('Sandbox environment is being created. This may take a moment.', false);
      setCreateOpen(false);
    } catch (e) {
      toast((e as Error).message, true);
    } finally {
      setBusy(false);
    }
  };

  const syncSandbox = async (id: string) => {
    await run(() => post(`/sandboxes/${id}/sync`), 'Sandbox sync started.');
  };

  const deleteSandbox = async (id: string) => {
    const result = await run(
      () => api(`/sandboxes/${id}`, { method: 'DELETE' }),
      'Sandbox environment deleted.',
    );
    if (result !== undefined) {
      setDeleteConfirm(null);
      if (selected?.id === id) setSelected(null);
    }
  };

  const admin = ['owner', 'admin'].includes(data.user.role);

  return (
    <div className="page sandbox-page">
      <div className="page-heading">
        <div>
          <span className="eyebrow">SANDBOX</span>
          <h1>Safely test apps and control updates.</h1>
          <p>
            Test and experiment without affecting production. Create isolated environments, install
            apps, make changes, and delete sandboxes confidently.
          </p>
        </div>
        {admin && (
          <Button onClick={() => setCreateOpen(true)}>
            <Plus size={16} />
            Create sandbox
          </Button>
        )}
      </div>

      {/* Benefits strip */}
      <div className="sandbox-benefits">
        <div className="sandbox-benefit">
          <Shield size={20} />
          <span>
            <strong>Zero production risk</strong>
            <small>Changes never reach production until you promote them.</small>
          </span>
        </div>
        <div className="sandbox-benefit">
          <Zap size={20} />
          <span>
            <strong>Instant environments</strong>
            <small>Spin up and tear down sandboxes in seconds.</small>
          </span>
        </div>
        <div className="sandbox-benefit">
          <RefreshCw size={20} />
          <span>
            <strong>Always fresh data</strong>
            <small>Sync from production any time to stay up to date.</small>
          </span>
        </div>
        <div className="sandbox-benefit">
          <Eye size={20} />
          <span>
            <strong>Control app updates</strong>
            <small>Test new app versions before rolling out to your team.</small>
          </span>
        </div>
      </div>

      <div className="sandbox-layout">
        {/* Sandbox list */}
        <div className="sandbox-list-panel">
          <div className="sandbox-list-heading">
            <h2>Environments</h2>
            <span className="sandbox-count">
              {sandboxes.data?.filter((s) => s.status !== 'deleted').length ?? 0} active
            </span>
          </div>

          {sandboxes.isPending ? (
            <div className="sandbox-list-loading">
              <div className="skeleton" style={{ height: 80 }} />
              <div className="skeleton" style={{ height: 80 }} />
            </div>
          ) : sandboxes.data?.filter((s) => s.status !== 'deleted').length ? (
            <div className="sandbox-list">
              {sandboxes.data
                .filter((s) => s.status !== 'deleted')
                .map((sandbox) => (
                  <button
                    key={sandbox.id}
                    className={`sandbox-card ${selected?.id === sandbox.id ? 'selected' : ''}`}
                    onClick={() => setSelected(sandbox)}
                  >
                    <div className="sandbox-card-top">
                      <span className="sandbox-icon">
                        <FlaskConical size={18} />
                      </span>
                      <div className="sandbox-card-info">
                        <strong>{sandbox.name}</strong>
                        <span>{sandbox.description || 'No description'}</span>
                      </div>
                      <StatusBadge status={sandbox.status} />
                    </div>
                    <div className="sandbox-card-meta">
                      <span>
                        <Clock size={12} />
                        {sandbox.last_synced
                          ? `Synced ${formatDate(sandbox.last_synced)}`
                          : 'Never synced'}
                      </span>
                      <span>{sandbox.project_count} projects · {sandbox.issue_count} issues</span>
                    </div>
                  </button>
                ))}
            </div>
          ) : (
            <Empty
              title="No sandbox environments"
              text={
                admin
                  ? 'Create a sandbox to safely test apps and configurations without impacting production.'
                  : 'No sandbox environments have been created. Contact an admin to set one up.'
              }
            />
          )}
        </div>

        {/* Sandbox detail */}
        {selected ? (
          <div className="sandbox-detail panel">
            <div className="sandbox-detail-heading">
              <div>
                <div className="sandbox-detail-title-row">
                  <FlaskConical size={22} />
                  <h2>{selected.name}</h2>
                  <StatusBadge status={selected.status} />
                </div>
                <p>{selected.description || 'No description provided.'}</p>
              </div>
              <div className="sandbox-detail-actions">
                {admin && selected.status === 'active' && (
                  <>
                    <Button
                      variant="secondary"
                      onClick={() => void syncSandbox(selected.id)}
                    >
                      <RefreshCw size={15} />
                      Sync from production
                    </Button>
                    <Button
                      variant="danger"
                      onClick={() => setDeleteConfirm(selected)}
                    >
                      <Trash2 size={15} />
                      Delete
                    </Button>
                  </>
                )}
              </div>
            </div>

            <div className="sandbox-info-grid">
              <div className="sandbox-info-cell">
                <span>Created by</span>
                <strong>
                  <Avatar
                    user={{
                      name: selected.created_by_name,
                      color: selected.created_by_color,
                    }}
                    size={20}
                  />{' '}
                  {selected.created_by_name}
                </strong>
              </div>
              <div className="sandbox-info-cell">
                <span>Created</span>
                <strong>{formatDate(selected.created_at)}</strong>
              </div>
              <div className="sandbox-info-cell">
                <span>Last synced</span>
                <strong>
                  {selected.last_synced ? formatDate(selected.last_synced) : 'Never'}
                </strong>
              </div>
              <div className="sandbox-info-cell">
                <span>Projects</span>
                <strong>{selected.project_count}</strong>
              </div>
              <div className="sandbox-info-cell">
                <span>Issues</span>
                <strong>{selected.issue_count}</strong>
              </div>
              <div className="sandbox-info-cell">
                <span>Production snapshot</span>
                <strong className="sandbox-snapshot-id">
                  <Copy size={12} />
                  {selected.production_snapshot}
                </strong>
              </div>
            </div>

            {/* Apps in sandbox */}
            <div className="sandbox-apps-section">
              <div className="sandbox-apps-heading">
                <h3>Apps & integrations in this sandbox</h3>
                <p>
                  Test app versions before rolling them out to production. Install updates here
                  first.
                </p>
              </div>
              {selectedApps.isPending ? (
                <div className="skeleton" style={{ height: 60 }} />
              ) : selectedApps.data?.length ? (
                <div className="sandbox-app-list">
                  {selectedApps.data.map((app) => (
                    <div key={app.id} className="sandbox-app-row">
                      <div className="sandbox-app-info">
                        <strong>{app.name}</strong>
                        <span>v{app.version}</span>
                      </div>
                      <span>Installed {formatDate(app.installed_at)}</span>
                      <Badge
                        tone={app.status === 'installed' ? 'green' : undefined}
                      >
                        {app.status}
                      </Badge>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="sandbox-no-apps">
                  <FlaskConical size={28} />
                  <span>No apps installed in this sandbox yet.</span>
                  <small>
                    Install app updates here to test them before they affect your production
                    workspace.
                  </small>
                </div>
              )}
            </div>

            {/* Warning notice */}
            <div className="sandbox-notice">
              <AlertTriangle size={16} />
              <span>
                Changes made in this sandbox environment are <strong>isolated</strong> from your
                production workspace. Data and configuration changes here will not impact live
                users until you explicitly promote them.
              </span>
            </div>
          </div>
        ) : (
          <div className="sandbox-detail sandbox-detail-empty panel">
            <FlaskConical size={40} />
            <h3>Select an environment</h3>
            <p>Choose a sandbox from the list to view its details and manage apps.</p>
          </div>
        )}
      </div>

      {/* Create sandbox modal */}
      {createOpen && (
        <Modal title="Create a sandbox environment" onClose={() => !busy && setCreateOpen(false)}>
          <form
            className="administration-form"
            onSubmit={(e) => {
              e.preventDefault();
              const form = new FormData(e.currentTarget);
              void createSandbox(
                String(form.get('name') ?? ''),
                String(form.get('description') ?? ''),
              );
            }}
          >
            <p>
              A sandbox is an isolated copy of your production workspace. Create, change, and delete
              it without impacting your live team data.
            </p>
            <label>
              Sandbox name
              <input
                name="name"
                required
                minLength={2}
                maxLength={80}
                placeholder="e.g. App testing — Q4"
                disabled={busy}
              />
            </label>
            <label>
              Description <small>· optional</small>
              <textarea
                name="description"
                maxLength={500}
                rows={2}
                placeholder="What will you use this sandbox for?"
                disabled={busy}
              />
            </label>
            <div className="sandbox-create-notice">
              <Shield size={15} />
              <span>
                Your production data will be <strong>copied</strong>, not moved. Production users
                will never see sandbox changes.
              </span>
            </div>
            <div className="administration-actions">
              <Button
                variant="secondary"
                type="button"
                disabled={busy}
                onClick={() => setCreateOpen(false)}
              >
                Cancel
              </Button>
              <Button busy={busy}>
                <FlaskConical size={15} />
                Create sandbox
              </Button>
            </div>
          </form>
        </Modal>
      )}

      {/* Delete confirmation */}
      {deleteConfirm && (
        <Modal
          title={`Delete "${deleteConfirm.name}"?`}
          onClose={() => setDeleteConfirm(null)}
        >
          <div className="administration-form">
            <div className="sandbox-delete-warning">
              <AlertTriangle size={20} />
              <div>
                <strong>This action cannot be undone.</strong>
                <p>
                  Deleting this sandbox environment will permanently remove all its isolated data,
                  configurations, and app installations. Your production workspace is not affected.
                </p>
              </div>
            </div>
            <div className="administration-actions">
              <Button variant="secondary" onClick={() => setDeleteConfirm(null)}>
                Cancel
              </Button>
              <Button
                variant="danger"
                onClick={() => void deleteSandbox(deleteConfirm.id)}
              >
                <Trash2 size={15} />
                Delete sandbox
              </Button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

export function SandboxesManagement() {
  return <SandboxPage />;
}
