import { useEffect, useLayoutEffect, useRef, useState, type FormEvent } from 'react';
import { createPortal } from 'react-dom';
import { Link } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, ChevronsUpDown, Plus, Search, Settings2, Building2 } from 'lucide-react';
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
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ top: 0, left: 0, width: 320, maxHeight: 480 });
  const workspaces = useQuery({
    queryKey: ['workspaces', data.user.id, data.workspace.id],
    queryFn: () => api<WorkspaceMembership[]>('/workspaces'),
    enabled: open,
  });
  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const rect = trigger.current?.getBoundingClientRect();
      if (!rect) return;
      const width = Math.min(320, window.innerWidth - 24);
      const top = Math.max(12, Math.min(rect.bottom + 8, window.innerHeight - 180));
      setPosition({
        top,
        left: Math.max(12, Math.min(rect.left, window.innerWidth - width - 12)),
        width,
        maxHeight: Math.max(0, window.innerHeight - top - 12),
      });
    };
    place();
    window.addEventListener('resize', place);
    document.addEventListener('scroll', place, true);
    document.addEventListener('transitionend', place, true);
    return () => {
      window.removeEventListener('resize', place);
      document.removeEventListener('scroll', place, true);
      document.removeEventListener('transitionend', place, true);
    };
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent) => {
      if (!wrap.current?.contains(e.target as Node) && !menu.current?.contains(e.target as Node))
        setOpen(false);
    };
    const escape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        setOpen(false);
        trigger.current?.focus();
      }
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
      // Keep the shell mounted until navigation. Reloading clears the old query cache and socket.
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
        ref={trigger}
        className="workspace-switch administration-workspace-switch"
        onClick={() => {
          if (!open) setSearch('');
          setOpen(!open);
        }}
        aria-label={`Switch organization, ${data.workspace.name}`}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls="workspace-options"
        disabled={busy}
      >
        <span className="workspace-symbol" aria-hidden="true">
          {data.workspace.name[0]?.toUpperCase()}
        </span>
        <span>
          <small className="workspace-switch-eyebrow">Organization</small>
          <strong title={data.workspace.name}>{data.workspace.name}</strong>
          <small className="workspace-switch-role" role={busy ? 'status' : undefined}>
            {busy ? 'Switching organization…' : data.user.role}
          </small>
        </span>
        <ChevronsUpDown size={16} />
      </button>
      {open &&
        createPortal(
          <div
            ref={menu}
            className="workspace-popover administration-workspace-menu workspace-switch-overlay"
            id="workspace-options"
            role="dialog"
            aria-label="Switch organization"
            aria-busy={busy}
            style={position}
          >
            <div className="workspace-menu-heading">
              <Building2 size={18} aria-hidden="true" />
              <div>
                <strong>Your organizations</strong>
                <p>Choose where you want to work.</p>
              </div>
            </div>
            <label className="workspace-menu-search">
              <Search size={16} aria-hidden="true" />
              <span className="sr-only">Find an organization</span>
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Find an organization…"
                autoFocus
              />
            </label>
            <div className="administration-workspace-options">
              {workspaces.isPending ? (
                <p role="status">Loading organizations…</p>
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
                        aria-label={`${workspace.name}, ${workspace.role}${workspace.current ? ', current organization' : ''}`}
                        onClick={() => void enter(`/workspaces/${workspace.id}/switch`)}
                      >
                        <span className="administration-workspace-initial" aria-hidden="true">
                          {workspace.name[0]?.toUpperCase()}
                        </span>
                        <span>
                          <strong title={workspace.name}>{workspace.name}</strong>
                          <small>
                            {workspace.current ? 'Current organization' : workspace.role}
                          </small>
                        </span>
                        {workspace.current && <Check size={17} />}
                      </button>
                    ))}
                  {!workspaces.data?.some((w) =>
                    w.name.toLowerCase().includes(search.toLowerCase()),
                  ) && <p role="status">No organizations match your search.</p>}
                </>
              )}
            </div>
            <button
              className="administration-menu-action"
              disabled={busy}
              onClick={() => {
                setOpen(false);
                setCreate(true);
              }}
            >
              <Plus size={17} />
              Create organization
            </button>
            <Link
              className="administration-menu-action"
              to="/administration"
              aria-disabled={busy}
              onClick={(event) => {
                if (busy) event.preventDefault();
                else setOpen(false);
              }}
            >
              <Settings2 size={17} />
              Manage organization
            </Link>
          </div>,
          document.body,
        )}
      {create &&
        createPortal(
          <Modal
            title="Create an organization"
            onClose={() => {
              if (!busy) setCreate(false);
            }}
          >
            <form className="administration-form modal-body" onSubmit={createWorkspace}>
              <p>
                Give your next team a home. You’ll become its owner and switch into the new
                organization.
              </p>
              <label>
                Organization name
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
                  Create organization
                </Button>
              </div>
            </form>
          </Modal>,
          document.body,
        )}
    </div>
  );
}
