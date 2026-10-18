import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, ChevronsUpDown, Plus, Settings2 } from 'lucide-react';
import type { WorkspaceMembership } from '../../shared/administration';
import { useGrace } from '../context';
import { api, post } from '../lib/api';
import { Button, Modal } from './ui';
import '../administration.css';

export function WorkspaceSwitcher() {
  const { data, toast } = useGrace();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [create, setCreate] = useState(false);
  const [busy, setBusy] = useState(false);
  const [search, setSearch] = useState('');
  const wrap = useRef<HTMLDivElement>(null);
  const workspaces = useQuery({
    queryKey: ['workspaces', data.user.id, data.workspace.id],
    queryFn: () => api<WorkspaceMembership[]>('/workspaces'),
    enabled: open,
  });
  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent) => {
      if (!wrap.current?.contains(e.target as Node)) setOpen(false);
    };
    const escape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', close);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('pointerdown', close);
      document.removeEventListener('keydown', escape);
    };
  }, [open]);
  const enter = async (path: string, body?: unknown) => {
    setBusy(true);
    try {
      await post(path, body);
      await queryClient.cancelQueries();
      queryClient.clear();
      // A fresh shell also reconnects the socket to the new workspace and clears issue URLs.
      window.location.assign('/');
    } catch (error) {
      toast((error as Error).message, true);
      setBusy(false);
    }
  };
  const createWorkspace = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    void enter('/workspaces', { name: form.get('name') });
  };
  return (
    <div className="workspace-switch-wrap" ref={wrap}>
      <button
        className="workspace-switch administration-workspace-switch"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        aria-controls="workspace-options"
        disabled={busy}
      >
        <span className="workspace-symbol">
          {data.workspace.name[0]?.toUpperCase()}
          <span>✦</span>
        </span>
        <span>
          <strong>{data.workspace.name}</strong>
          <small>Organization · {data.user.role}</small>
        </span>
        <ChevronsUpDown size={16} />
      </button>
      {open && (
        <div className="workspace-popover administration-workspace-menu" id="workspace-options">
          <strong>Your organizations</strong>
          <label className="administration-search-label">
            Find a workspace
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search workspaces…"
              autoFocus
            />
          </label>
          <div className="administration-workspace-options">
            {workspaces.isPending ? (
              <p>Loading workspaces…</p>
            ) : workspaces.isError ? (
              <div className="administration-error" role="alert">
                {workspaces.error.message}
                <Button variant="ghost" onClick={() => void workspaces.refetch()}>
                  Try again
                </Button>
              </div>
            ) : (
              <>
                {workspaces.data
                  ?.filter((w) => w.name.toLowerCase().includes(search.toLowerCase()))
                  .map((workspace) => (
                    <button
                      className={`administration-workspace-option ${workspace.current ? 'active' : ''}`}
                      key={workspace.id}
                      disabled={busy || workspace.current}
                      onClick={() => void enter(`/workspaces/${workspace.id}/switch`)}
                    >
                      <span className="administration-workspace-initial">
                        {workspace.name[0]?.toUpperCase()}
                      </span>
                      <span>
                        <strong>{workspace.name}</strong>
                        <small>{workspace.role}</small>
                      </span>
                      {workspace.current && <Check size={17} />}
                    </button>
                  ))}
                {!workspaces.data?.some((w) =>
                  w.name.toLowerCase().includes(search.toLowerCase()),
                ) && <p>No workspaces match your search.</p>}
              </>
            )}
          </div>
          <button
            className="administration-menu-action"
            onClick={() => {
              setOpen(false);
              setCreate(true);
            }}
          >
            <Plus size={17} />
            Create workspace
          </button>
          <Link
            className="administration-menu-action"
            to="/administration"
            onClick={() => setOpen(false)}
          >
            <Settings2 size={17} />
            Manage workspace
          </Link>
        </div>
      )}
      {create && (
        <Modal
          title="Create a workspace"
          onClose={() => {
            if (!busy) setCreate(false);
          }}
        >
          <form className="administration-form" onSubmit={createWorkspace}>
            <p>
              Give your next team a home. You’ll become its owner and switch into the new workspace.
            </p>
            <label>
              Workspace name
              <input
                name="name"
                required
                minLength={2}
                maxLength={120}
                placeholder="e.g. Product studio"
                disabled={busy}
              />
            </label>
            <div className="administration-actions">
              <Button
                variant="secondary"
                type="button"
                disabled={busy}
                onClick={() => setCreate(false)}
              >
                Cancel
              </Button>
              <Button type="submit" busy={busy}>
                Create workspace
              </Button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}
