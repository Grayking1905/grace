import { lazy, Suspense, useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import {
  NavLink,
  Routes,
  Route,
  Navigate,
  useLocation,
  useNavigate,
  useSearchParams,
  Link,
} from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { io } from 'socket.io-client';
import {
  Search,
  Plus,
  CopyPlus,
  ChevronDown,
  ChevronRight,
  ChevronsUpDown,
  House,
  CircleCheck,
  Inbox,
  FolderKanban,
  FileText,
  ChartNoAxesCombined,
  Users,
  Settings,
  CircleHelp,
  ArrowUpRight,
  Command,
  X,
  Check,
  Menu,
  LogOut,
  Sparkles,
  PanelLeftClose,
  LayoutGrid,
  SlidersHorizontal,
  ShieldCheck,
} from 'lucide-react';
import type { Bootstrap, Issue, Project } from '../shared/types';
import { api, post, ApiError } from './lib/api';
import { GraceProvider, useGrace } from './context';
import { Avatar, Badge, Button, IconButton, Modal, TypeIcon } from './components/ui';
import { Editor } from './components/Editor';
import { WorkspaceSwitcher } from './components/WorkspaceSwitcher';
import { PublicAccountPage } from './pages/Accounts';
import { projectTemplates } from '../shared/templates';
const TemplatesPage = lazy(() =>
  import('./pages/Templates').then((m) => ({ default: m.TemplatesPage })),
);
const PortfolioPage = lazy(() =>
  import('./pages/Portfolio').then((m) => ({ default: m.PortfolioPage })),
);
const AccountSecurityPage = lazy(() =>
  import('./pages/Accounts').then((m) => ({ default: m.AccountSecurityPage })),
);
const IssueDrawer = lazy(() =>
  import('./components/IssueDrawer').then((m) => ({ default: m.IssueDrawer })),
);
const Dashboard = lazy(() => import('./pages/Workspace').then((m) => ({ default: m.Dashboard })));
const MyWork = lazy(() => import('./pages/Workspace').then((m) => ({ default: m.MyWork })));
const Projects = lazy(() => import('./pages/Workspace').then((m) => ({ default: m.Projects })));
const InboxPage = lazy(() => import('./pages/Workspace').then((m) => ({ default: m.InboxPage })));
const ProjectPage = lazy(() => import('./pages/Project').then((m) => ({ default: m.ProjectPage })));
const PagesPage = lazy(() => import('./pages/Tools').then((m) => ({ default: m.PagesPage })));
const ReportsPage = lazy(() => import('./pages/Tools').then((m) => ({ default: m.ReportsPage })));
const TeamPage = lazy(() => import('./pages/Tools').then((m) => ({ default: m.TeamPage })));
const ManagerPage = lazy(() => import('./pages/Tools').then((m) => ({ default: m.ManagerPage })));
const ViewsPage = lazy(() => import('./pages/Tools').then((m) => ({ default: m.ViewsPage })));
const SettingsPage = lazy(() =>
  import('./pages/Settings').then((m) => ({ default: m.SettingsPage })),
);
const AdministrationPage = lazy(() =>
  import('./pages/Administration').then((m) => ({ default: m.AdministrationPage })),
);

type Toast = {
  id: number;
  message: string;
  error: boolean;
  action?: { label: string; run: () => void };
};
export default function App() {
  const location = useLocation();
  const publicAccount = /^\/account\/(forgot|verify|reset)$/.test(location.pathname);
  const queryClient = useQueryClient();
  const bootstrap = useQuery({
    queryKey: ['bootstrap'],
    queryFn: () => api<Bootstrap>('/bootstrap'),
    enabled: !publicAccount,
  });
  const [searchParams, setSearchParams] = useSearchParams();
  const [createDefaults, setCreateDefaults] = useState<Record<string, unknown> | null>(null);
  const [projectCreate, setProjectCreate] = useState(false);
  const [commandOpen, setCommandOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const navigate = useNavigate();
  const toast = useCallback(
    (message: string, error = false, action?: { label: string; run: () => void }) => {
      const id = Date.now() + Math.random();
      setToasts((t) => [...t.slice(-3), { id, message, error, action }]);
      setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), action ? 10000 : 5500);
    },
    [],
  );
  const refresh = useCallback(async () => {
    await queryClient.invalidateQueries();
  }, [queryClient]);
  const run = useCallback(
    async <T,>(task: () => Promise<T>, message?: string): Promise<T | undefined> => {
      try {
        const result = await task();
        await refresh();
        if (message) toast(message);
        return result;
      } catch (e) {
        toast((e as Error).message, true);
        return undefined;
      }
    },
    [refresh, toast],
  );
  const openIssue = useCallback(
    (id: string) => {
      setSearchParams((p) => {
        p.set('issue', id);
        return p;
      });
    },
    [setSearchParams],
  );
  const openCreate = useCallback(
    (defaults: Record<string, unknown> = {}) => setCreateDefaults(defaults),
    [],
  );
  const closeCreate = useCallback(() => setCreateDefaults(null), []);
  const closeProjectCreate = useCallback(() => setProjectCreate(false), []);
  const closeIssue = useCallback(() => {
    setSearchParams((p) => {
      p.delete('issue');
      return p;
    });
  }, [setSearchParams]);
  const data = bootstrap.data;
  useEffect(() => {
    if (!data?.user.id) return;
    const socket = io({ withCredentials: true });
    let timer: ReturnType<typeof setTimeout> | undefined;
    socket.on('workspace.updated', () => {
      clearTimeout(timer);
      timer = setTimeout(() => queryClient.invalidateQueries(), 100);
    });
    socket.on('connect_error', () => {});
    return () => {
      clearTimeout(timer);
      socket.disconnect();
    };
  }, [data?.user.id, queryClient]);
  useEffect(() => {
    let prefix = '';
    const listener = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (e.key === 'k' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        setCommandOpen((o) => !o);
        return;
      }
      if (target.closest('input,textarea,select,[contenteditable="true"],[role="dialog"]')) return;
      if (e.key === '/') {
        e.preventDefault();
        setCommandOpen(true);
      }
      if (e.key.toLowerCase() === 'c' && data?.user.role !== 'viewer') {
        e.preventDefault();
        const pid = /projects\/([^/]+)/.exec(location.pathname)?.[1];
        openCreate(pid ? { project_id: pid } : {});
      }
      if (e.key === '?') {
        e.preventDefault();
        setHelpOpen(true);
      }
      if (prefix === 'g' && data?.projects[0]) {
        if (e.key === 'b') navigate(`/projects/${data.projects[0].id}/board`);
        if (e.key === 'k') navigate(`/projects/${data.projects[0].id}/backlog`);
        prefix = '';
      } else if (e.key === 'g') {
        prefix = 'g';
        setTimeout(() => {
          prefix = '';
        }, 1000);
      }
    };
    document.addEventListener('keydown', listener);
    return () => document.removeEventListener('keydown', listener);
  }, [data, location.pathname, navigate, openCreate]);
  if (publicAccount) return <PublicAccountPage />;
  if (bootstrap.isPending)
    return (
      <div className="app-loading">
        <img src="/grace.svg" width="46" alt="Grace" />
        <span>Making room for good work…</span>
        <div className="loading-line" />
      </div>
    );
  if (!data) {
    if (bootstrap.error instanceof ApiError && bootstrap.error.status === 401)
      return <Login onSuccess={refresh} />;
    return (
      <div className="fatal">
        <img src="/grace.svg" width="48" alt="Grace" />
        <h1>We couldn’t reach your workspace.</h1>
        <p>{bootstrap.error?.message}</p>
        <Button onClick={() => bootstrap.refetch()}>Try again</Button>
      </div>
    );
  }
  const context = {
    data,
    refresh,
    run,
    toast,
    openIssue,
    openCreate,
    openProjectCreate: () => setProjectCreate(true),
  };
  return (
    <GraceProvider value={context}>
      <Shell openCommand={() => setCommandOpen(true)} openHelp={() => setHelpOpen(true)}>
        {bootstrap.isError && (
          <div className="offline-banner">
            Your connection was interrupted. Showing your latest saved work.{' '}
            <button onClick={() => bootstrap.refetch()}>Retry</button>
          </div>
        )}
        {data.user.email_verified === false && (
          <div className="offline-banner">
            Your email is not verified. <Link to="/security">Open account security</Link> to request
            a verification link.
          </div>
        )}
        <Suspense
          fallback={
            <div className="page">
              <div className="skeleton" />
              <div className="skeleton" />
            </div>
          }
        >
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/invite" element={<InvitationAccept />} />
            <Route path="/my-work" element={<MyWork />} />
            <Route path="/inbox" element={<InboxPage />} />
            <Route path="/projects" element={<Projects />} />
            <Route path="/projects/:projectId/:view?" element={<ProjectPage />} />
            <Route path="/pages/:pageId?" element={<PagesPage />} />
            <Route path="/reports" element={<ReportsPage />} />
            <Route path="/team" element={<TeamPage />} />
            <Route path="/manager" element={<ManagerPage />} />
            <Route path="/views/:viewId?" element={<ViewsPage />} />
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="/administration" element={<AdministrationPage />} />
            <Route path="/security" element={<AccountSecurityPage />} />
            <Route path="/templates" element={<TemplatesPage />} />
            <Route path="/portfolio" element={<PortfolioPage />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </Suspense>
      </Shell>
      {createDefaults && <CreateIssue defaults={createDefaults} onClose={closeCreate} />}
      {projectCreate && <CreateProject onClose={closeProjectCreate} />}
      {searchParams.get('issue') && (
        <Suspense
          fallback={
            <div className="modal-backdrop">
              <div className="modal wide">
                <div className="drawer-loading">
                  <div className="skeleton" />
                </div>
              </div>
            </div>
          }
        >
          <IssueDrawer
            key={searchParams.get('issue')}
            issueId={searchParams.get('issue')!}
            onClose={closeIssue}
          />
        </Suspense>
      )}
      {commandOpen && <CommandPalette onClose={() => setCommandOpen(false)} />}
      {helpOpen && (
        <Modal title="A few shortcuts. A little more flow." onClose={() => setHelpOpen(false)}>
          <div className="shortcut-list">
            {[
              ['Create an issue', 'C'],
              ['Search everything', 'Ctrl / ⌘ K'],
              ['Open search', '/'],
              ['Go to board', 'G then B'],
              ['Go to backlog', 'G then K'],
              ['Shortcut help', '?'],
              ['Close a dialog', 'Esc'],
            ].map(([label, key]) => (
              <div key={label}>
                <span>{label}</span>
                <kbd>{key}</kbd>
              </div>
            ))}
          </div>
        </Modal>
      )}
      <div className="toast-stack" aria-live="polite">
        {toasts.map((t) => (
          <div className={`toast ${t.error ? 'error' : ''}`} key={t.id}>
            {t.error ? <CircleHelp size={18} /> : <Check size={18} />}
            <span>{t.message}</span>
            {t.action && (
              <button
                onClick={() => {
                  t.action!.run();
                  setToasts((ts) => ts.filter((x) => x.id !== t.id));
                }}
              >
                {t.action.label}
              </button>
            )}
            <button
              aria-label="Dismiss notification"
              onClick={() => setToasts((ts) => ts.filter((x) => x.id !== t.id))}
            >
              <X size={14} />
            </button>
          </div>
        ))}
      </div>
    </GraceProvider>
  );
}

function Shell({
  children,
  openCommand,
  openHelp,
}: {
  children: React.ReactNode;
  openCommand: () => void;
  openHelp: () => void;
}) {
  const { data, run, openCreate, openProjectCreate } = useGrace();
  const location = useLocation();
  const [mobile, setMobile] = useState(false);
  const [smallScreen, setSmallScreen] = useState(
    () => window.matchMedia('(max-width: 760px)').matches,
  );
  useEffect(() => {
    const media = window.matchMedia('(max-width: 760px)');
    const change = () => setSmallScreen(media.matches);
    media.addEventListener('change', change);
    return () => media.removeEventListener('change', change);
  }, []);
  useEffect(() => setMobile(false), [location.pathname]);
  const activeProject = data.projects.find((p) => location.pathname.includes(p.id));
  const title =
    activeProject?.name ||
    {
      '/': 'Overview',
      '/my-work': 'My work',
      '/inbox': 'Inbox',
      '/projects': 'Projects',
      '/reports': 'Reports',
      '/team': 'Team',
      '/manager': 'Manager suite',
      '/settings': 'Settings',
      '/administration': 'Administration',
      '/security': 'Account security',
      '/templates': 'Issue templates',
      '/portfolio': 'Portfolio',
    }[location.pathname] ||
    (location.pathname.startsWith('/pages') ? 'Pages' : 'Views');
  const unread = data.notifications.filter((n) => !n.read_at).length;
  const nav = [
    { to: '/', label: 'Overview', icon: House },
    { to: '/my-work', label: 'My work', icon: CircleCheck },
    { to: '/inbox', label: 'Inbox', icon: Inbox },
  ];
  return (
    <div className="app-shell">
      {mobile && <div className="sidebar-scrim" onClick={() => setMobile(false)} />}
      <aside
        className={`sidebar ${mobile ? 'is-open' : ''}`}
        aria-hidden={smallScreen && !mobile}
        inert={smallScreen && !mobile}
      >
        <Link to="/" className="brand">
          <img src="/grace.svg" width="31" height="31" alt="" />
          <span>
            grace<span className="brand-period">.</span>
          </span>
          <span className="brand-workspace">WORKSPACE</span>
        </Link>
        <WorkspaceSwitcher />
        <button className="sidebar-search" onClick={openCommand}>
          <Search size={15} />
          <span>Quick search</span>
          <kbd>⌘ K</kbd>
        </button>
        <nav aria-label="Main navigation">
          <div className="nav-group">
            {nav.map((n) => (
              <NavLink
                key={n.to}
                to={n.to}
                end
                className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}
              >
                <n.icon size={17} />
                <span>{n.label}</span>
                {n.to === '/inbox' && unread > 0 && <span className="nav-count">{unread}</span>}
              </NavLink>
            ))}
          </div>
          <div className="nav-section-label">
            <span>PROJECTS</span>
            <IconButton
              label="New project"
              onClick={openProjectCreate}
              disabled={data.user.role === 'viewer'}
            >
              <Plus size={15} />
            </IconButton>
          </div>
          <NavLink to="/projects" end className="nav-item">
            <FolderKanban size={17} />
            <span>All projects</span>
          </NavLink>
          {data.projects
            .filter((p) => p.favorite)
            .slice(0, 4)
            .map((p) => (
              <NavLink
                to={`/projects/${p.id}/board`}
                className={({ isActive }) =>
                  `nav-item project-nav ${isActive || activeProject?.id === p.id ? 'project-active' : ''}`
                }
                key={p.id}
              >
                <span className="project-dot" style={{ background: p.color }} />
                <span>{p.name}</span>
                <ChevronRight size={13} />
              </NavLink>
            ))}
          <div className="nav-section-label">WORKSPACE</div>
          {[
            { to: '/pages', label: 'Pages', icon: FileText },
            { to: '/portfolio', label: 'Portfolio', icon: LayoutGrid },
            { to: '/templates', label: 'Issue templates', icon: CopyPlus },
            { to: '/views', label: 'Views', icon: SlidersHorizontal },
            { to: '/reports', label: 'Reports', icon: ChartNoAxesCombined },
            { to: '/team', label: 'Team', icon: Users },
            { to: '/manager', label: 'Manager suite', icon: LayoutGrid },
          ].map((n) => (
            <NavLink
              key={n.to}
              to={n.to}
              className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}
            >
              <n.icon size={17} />
              <span>{n.label}</span>
              {n.to === '/manager' && <span className="small-new">NEW</span>}
            </NavLink>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="sidebar-tip">
            <Sparkles size={19} />
            <strong>Good work starts with clarity.</strong>
            <p>A shared space for your next big thing.</p>
            <button onClick={openHelp}>
              Find your flow <ArrowUpRight size={13} />
            </button>
          </div>
          <NavLink to="/settings" className="nav-item">
            <Settings size={17} />
            <span>Settings</span>
          </NavLink>
          <NavLink to="/administration" className="nav-item">
            <ShieldCheck size={17} />
            <span>Administration</span>
          </NavLink>
          <NavLink to="/security" className="nav-item">
            <ShieldCheck size={17} />
            <span>Security & alerts</span>
          </NavLink>
          <button className="nav-item" onClick={openHelp}>
            <CircleHelp size={17} />
            <span>Help & shortcuts</span>
            <kbd>?</kbd>
          </button>
          <div className="profile">
            <Avatar user={data.user} size={33} />
            <span>
              <strong>{data.user.name}</strong>
              <small>{data.user.role === 'owner' ? 'Workspace owner' : data.user.role}</small>
            </span>
            <IconButton
              label="Sign out"
              onClick={() =>
                run(async () => {
                  await post('/auth/logout');
                  window.location.reload();
                })
              }
            >
              <LogOut size={15} />
            </IconButton>
          </div>
        </div>
      </aside>
      <div className="main-shell">
        <header className="topbar">
          <div className="breadcrumb">
            <button
              className="mobile-menu icon-btn"
              aria-label="Open navigation"
              onClick={() => setMobile(true)}
            >
              <Menu size={20} />
            </button>
            <PanelLeftClose className="desktop-sidebar-icon" size={17} />
            <span className="breadcrumb-workspace">Workspace</span>
            <ChevronRight size={13} />
            <strong>{title}</strong>
            {activeProject && <Badge>{activeProject.key}</Badge>}
          </div>
          <div className="topbar-actions">
            <button className="global-search" aria-label="Search anything" onClick={openCommand}>
              <Search size={16} />
              <span>Search anything…</span>
              <kbd>⌘ K</kbd>
            </button>
            <Button
              className="top-create"
              aria-label="Create issue"
              onClick={() => openCreate(activeProject ? { project_id: activeProject.id } : {})}
              disabled={data.user.role === 'viewer'}
            >
              <Plus size={16} />
              <span>Create issue</span>
            </Button>
            <Link to="/inbox" className="notification-icon" aria-label={`Inbox, ${unread} unread`}>
              <Inbox size={19} />
              {unread > 0 && <i />}
            </Link>
            <Avatar user={data.user} size={29} />
          </div>
        </header>
        <main id="main-content" className="main-content">
          {children}
        </main>
        <footer className="app-footer">
          <span>
            <span className="connection-dot" />
            Your work, in sync.
          </span>
          <span>
            Made for a little more flow. <img src="/grace.svg" alt="" width="13" />
          </span>
        </footer>
      </div>
    </div>
  );
}

function Login({ onSuccess }: { onSuccess: () => Promise<void> }) {
  const [register, setRegister] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [params] = useSearchParams();
  const inviteToken = params.get('token');
  const navigate = useNavigate();
  const invite = useQuery({
    queryKey: ['invitation', inviteToken],
    queryFn: () =>
      api<{ email: string; workspace: string }>(
        `/auth/invite?token=${encodeURIComponent(inviteToken!)}`,
      ),
    enabled: !!inviteToken,
  });
  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError('');
    setBusy(true);
    const form = Object.fromEntries(new FormData(e.currentTarget));
    try {
      await post(register ? '/auth/register' : '/auth/login', {
        ...form,
        ...(register && inviteToken ? { invite_token: inviteToken } : {}),
      });
      await onSuccess();
      if (register && inviteToken) navigate('/');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const demo = async () => {
    setBusy(true);
    setError('');
    try {
      await post('/auth/demo');
      await onSuccess();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="login-page">
      <section className="login-story">
        <Link to="/" className="brand">
          <img src="/grace.svg" width="37" alt="" />
          <span>grace.</span>
        </Link>
        <div>
          <Badge tone="green">
            <Sparkles size={12} /> A LITTLE MORE FLOW
          </Badge>
          <h1>
            Great work.
            <br />A calmer place
            <br />
            to make it happen.
          </h1>
          <p>
            Bring your projects, people, and progress together.
            <br />
            Make space for the work that matters.
          </p>
          <div className="login-mini-board">
            <div>
              <span className="board-dot todo" />
              To do <small>3</small>
              <article>
                <span className="tag lavender">Design</span>
                <strong>Make the everyday feel effortless</strong>
                <span>
                  <TypeIcon type="story" /> GRC-12 <i>5</i>
                </span>
              </article>
            </div>
            <div>
              <span className="board-dot progress" />
              In progress <small>2</small>
              <article>
                <span className="tag sage">Experience</span>
                <strong>A better way to work, together</strong>
                <span>
                  <TypeIcon type="task" /> GRC-18 <i>3</i>
                </span>
              </article>
            </div>
          </div>
        </div>
        <span className="login-foot">A thoughtful workspace for ambitious teams.</span>
      </section>
      <section className="login-form-wrap">
        <div className="login-form">
          <span className="eyebrow">YOUR NEXT CHAPTER STARTS HERE</span>
          <h2>{register ? 'Make room for good work.' : 'Welcome back.'}</h2>
          <p>
            {register ? 'Create your own Grace workspace.' : 'A little clarity is waiting for you.'}
          </p>
          {invite.data && (
            <div className="invite-note">
              You are invited to {invite.data.workspace} as {invite.data.email}.
            </div>
          )}
          {invite.error && <div className="form-error">{invite.error.message}</div>}
          <form onSubmit={submit}>
            {register && (
              <>
                <label>
                  Your name
                  <input
                    name="name"
                    required
                    minLength={2}
                    maxLength={120}
                    autoComplete="name"
                    placeholder="Alex Morgan"
                  />
                </label>
                {!inviteToken && (
                  <label>
                    Workspace name
                    <input
                      name="workspace"
                      required
                      minLength={2}
                      maxLength={120}
                      placeholder="Acme Studio"
                    />
                  </label>
                )}
              </>
            )}
            <label>
              Email address
              <input
                name="email"
                type="email"
                required
                autoComplete="email"
                key={invite.data?.email || 'email'}
                defaultValue={invite.data?.email}
                placeholder="you@company.com"
              />
            </label>
            <label>
              Password
              <input
                name="password"
                type="password"
                required
                minLength={10}
                maxLength={128}
                autoComplete={register ? 'new-password' : 'current-password'}
                placeholder="At least 10 characters"
              />
            </label>
            {error && (
              <div className="form-error" role="alert">
                {error}
              </div>
            )}
            <Button type="submit" busy={busy}>
              {register ? 'Create workspace' : 'Sign in'} <ArrowUpRight size={16} />
            </Button>
          </form>
          {!register && <Link to="/account/forgot">Forgot your password?</Link>}
          <div className="login-divider">
            <span>or take a look around</span>
          </div>
          <Button variant="secondary" busy={busy} onClick={demo}>
            Explore the demo workspace <Sparkles size={15} />
          </Button>
          <p className="login-toggle">
            {register ? 'Already have an account?' : 'New to Grace?'}{' '}
            <button
              onClick={() => {
                setRegister(!register);
                setError('');
              }}
            >
              {register ? 'Sign in' : 'Create a workspace'}
            </button>
          </p>
          <div className="login-trust">
            <ShieldCheck size={15} /> Your workspace. Your data. Your pace.
          </div>
        </div>
      </section>
    </div>
  );
}

function InvitationAccept() {
  const { run, data } = useGrace();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const token = params.get('token');
  const invitation = useQuery({
    queryKey: ['invitation', token],
    queryFn: () =>
      api<{ email: string; workspace: string; role: string }>(
        `/auth/invite?token=${encodeURIComponent(token || '')}`,
      ),
  });
  return (
    <div className="page narrow-page">
      <div className="page-heading">
        <div>
          <span className="eyebrow">GOOD WORK HAPPENS TOGETHER</span>
          <h1>You have a place here.</h1>
        </div>
      </div>
      <div className="panel invitation-card">
        {invitation.isPending ? (
          <p>Opening your invitation…</p>
        ) : invitation.error ? (
          <p className="form-error">{invitation.error.message}</p>
        ) : (
          <>
            <Users size={32} />
            <h2>Join {invitation.data?.workspace}</h2>
            <p>
              You’ve been invited as a {invitation.data?.role}. Signed in as {data.user.email}.
            </p>
            <Button
              onClick={async () => {
                const result = await run(
                  () => post('/invites/accept', { token }),
                  'Welcome to your new workspace.',
                );
                if (result) navigate('/');
              }}
            >
              Accept invitation <ArrowUpRight size={14} />
            </Button>
          </>
        )}
      </div>
    </div>
  );
}
function CreateIssue({
  defaults,
  onClose,
}: {
  defaults: Record<string, unknown>;
  onClose: () => void;
}) {
  const { data, run, openIssue } = useGrace();
  const [projectId, setProjectId] = useState(
    String(defaults.project_id || data.projects[0]?.id || ''),
  );
  const [description, setDescription] = useState(String(defaults.description || ''));
  const [busy, setBusy] = useState(false);
  const statuses = data.statuses.filter((s) => s.project_id === projectId);
  const selectedProject = data.projects.find((p) => p.id === projectId);
  const sprints = data.sprints.filter((s) => s.project_id === projectId && s.state !== 'closed');
  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setBusy(true);
    const values = Object.fromEntries(new FormData(e.currentTarget));
    const created = await run(
      () =>
        post<Issue>('/issues', {
          ...values,
          project_id: projectId,
          description,
          assignee_id: values.assignee_id || null,
          sprint_id: values.sprint_id || null,
          parent_id: values.parent_id || null,
          story_points: Number(values.story_points) || 0,
          labels: String(values.labels || '')
            .split(',')
            .map((v) => v.trim())
            .filter(Boolean),
        }),
      'Issue created. A good place to start.',
    );
    setBusy(false);
    if (created) {
      onClose();
      openIssue(created.id);
    }
  };
  return (
    <Modal title="Create an issue" onClose={onClose} wide>
      {!data.projects.length ? (
        <div className="modal-body">
          <p>Create your first project before adding an issue.</p>
        </div>
      ) : (
        <form onSubmit={submit}>
          <div className="modal-body">
            <div className="form-row">
              <label>
                Project
                <select value={projectId} onChange={(e) => setProjectId(e.target.value)}>
                  {data.projects.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} · {p.key}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Issue type
                <select
                  name="type"
                  key={`${projectId}-type`}
                  defaultValue={String(defaults.type || selectedProject?.default_type || 'task')}
                >
                  {(
                    selectedProject?.issue_types || ['task', 'story', 'bug', 'epic', 'subtask']
                  ).map((t) => (
                    <option key={t} value={t}>
                      {t[0].toUpperCase() + t.slice(1)}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <label>
              Title <span className="required">*</span>
              <input
                name="summary"
                required
                maxLength={255}
                placeholder="What needs to happen?"
                defaultValue={String(defaults.summary || '')}
                autoFocus
              />
            </label>
            <label>
              Description
              <Editor content={description} onChange={setDescription} compact />
            </label>
            <div className="form-row three">
              <label>
                Status
                <select
                  key={projectId}
                  name="status_id"
                  defaultValue={String(defaults.status_id || statuses[0]?.id)}
                >
                  {statuses.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Priority
                <select name="priority" defaultValue={String(defaults.priority || 'medium')}>
                  {['critical', 'high', 'medium', 'low', 'lowest'].map((p) => (
                    <option key={p} value={p}>
                      {p[0].toUpperCase() + p.slice(1)}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Assignee
                <select name="assignee_id" defaultValue={String(defaults.assignee_id || '')}>
                  <option value="">Unassigned</option>
                  {data.members
                    .filter((m) => m.active !== false && m.active !== 0)
                    .map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.name}
                      </option>
                    ))}
                </select>
              </label>
            </div>
            <div className="form-row three">
              <label>
                Sprint
                <select
                  name="sprint_id"
                  key={`${projectId}-sprint`}
                  defaultValue={String(defaults.sprint_id || '')}
                >
                  <option value="">Backlog</option>
                  {sprints.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Story points
                <input
                  type="number"
                  min={0}
                  max={1000}
                  name="story_points"
                  placeholder="0"
                  defaultValue={Number(defaults.story_points) || 0}
                />
              </label>
              <label>
                Due date
                <input type="date" name="due_date" />
              </label>
            </div>
            <div className="form-row">
              <label>
                Labels
                <input
                  name="labels"
                  placeholder="Design, Frontend"
                  defaultValue={Array.isArray(defaults.labels) ? defaults.labels.join(', ') : ''}
                />
              </label>
              <label>
                Parent issue
                <select name="parent_id" defaultValue={String(defaults.parent_id || '')}>
                  <option value="">No parent</option>
                  {data.issues
                    .filter(
                      (i) =>
                        i.project_id === projectId &&
                        ['epic', 'story', 'task', 'bug'].includes(i.type),
                    )
                    .map((i) => (
                      <option key={i.id} value={i.id}>
                        {i.key} · {i.summary}
                      </option>
                    ))}
                </select>
              </label>
            </div>
          </div>
          <div className="modal-footer">
            <span>Small steps move big things.</span>
            <Button type="button" variant="secondary" onClick={onClose}>
              Cancel
            </Button>
            <Button busy={busy} type="submit">
              <Plus size={15} />
              Create issue
            </Button>
          </div>
        </form>
      )}
    </Modal>
  );
}
function CreateProject({ onClose }: { onClose: () => void }) {
  const { run } = useGrace();
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setBusy(true);
    const values = Object.fromEntries(new FormData(e.currentTarget));
    const created = await run(() => post<Project>('/projects', values), 'Your project is ready.');
    setBusy(false);
    if (created) {
      onClose();
      navigate(`/projects/${created.id}/board`);
    }
  };
  return (
    <Modal title="A new home for your next big thing" onClose={onClose}>
      <form onSubmit={submit}>
        <div className="modal-body">
          <label>
            Project name
            <input
              name="name"
              required
              minLength={2}
              maxLength={120}
              placeholder="e.g. Customer experience"
              autoFocus
            />
          </label>
          <div className="form-row">
            <label>
              Project key
              <input
                name="key"
                required
                pattern="[A-Z]{2,10}"
                maxLength={10}
                placeholder="CX"
                onChange={(e) =>
                  (e.target.value = e.target.value.toUpperCase().replace(/[^A-Z]/g, ''))
                }
              />
              <small>2–10 uppercase letters</small>
            </label>
            <label>
              Color
              <input name="color" type="color" defaultValue="#e9e3f5" />
            </label>
          </div>
          <label>
            Description
            <textarea
              name="description"
              rows={3}
              maxLength={2000}
              placeholder="A sentence about what you’re building."
            />
          </label>
          <div className="form-row">
            <label>
              Template
              <select name="template">
                {Object.entries(projectTemplates).map(([id, template]) => (
                  <option key={id} value={id}>
                    {template.name} · {template.statuses.length} states
                  </option>
                ))}
              </select>
            </label>
            <label>
              Visibility
              <select name="visibility">
                <option value="workspace">Workspace</option>
                <option value="private">Private</option>
              </select>
            </label>
          </div>
        </div>
        <div className="modal-footer">
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" busy={busy}>
            Create project
            <ArrowUpRight size={15} />
          </Button>
        </div>
      </form>
    </Modal>
  );
}
function CommandPalette({ onClose }: { onClose: () => void }) {
  const { data, openIssue, openCreate } = useGrace();
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search.trim()), 180);
    return () => clearTimeout(timer);
  }, [search]);
  const remote = useQuery({
    queryKey: ['workspace-search', data.workspace.id, debouncedSearch],
    queryFn: () =>
      api<{ items: Issue[] }>(`/search/issues?limit=8&q=${encodeURIComponent(debouncedSearch)}`),
    enabled: debouncedSearch.length >= 2,
  });
  const [selected, setSelected] = useState(0);
  const navigate = useNavigate();
  const items = useMemo(() => {
    const q = search.toLowerCase();
    return [
      ...(remote.data && debouncedSearch === search.trim() ? remote.data.items : data.issues)
        .filter(
          (i) =>
            `${i.key} ${i.summary} ${i.description.replace(/<[^>]*>/g, '')}`
              .toLowerCase()
              .includes(q) ||
            (!!remote.data && debouncedSearch === search.trim()),
        )
        .slice(0, 8)
        .map((i) => ({
          id: i.id,
          label: i.summary,
          sub: i.key,
          type: 'issue',
          run: () => openIssue(i.id),
        })),
      ...data.projects
        .filter((p) => p.name.toLowerCase().includes(q))
        .map((p) => ({
          id: p.id,
          label: p.name,
          sub: 'Project',
          type: 'project',
          run: () => navigate(`/projects/${p.id}/board`),
        })),
      ...data.pages
        .filter((p) => p.title.toLowerCase().includes(q))
        .slice(0, 3)
        .map((p) => ({
          id: p.id,
          label: p.title,
          sub: 'Page',
          type: 'page',
          run: () => navigate(`/pages/${p.id}`),
        })),
    ];
  }, [search, data, navigate, openIssue, remote.data, debouncedSearch]);
  useEffect(() => setSelected(0), [search]);
  return (
    <Modal title="Find a little clarity" onClose={onClose} wide>
      <div className="command-search">
        <Search size={21} />
        <input
          aria-label="Search issues, projects, and pages"
          autoFocus
          placeholder="Search issues, projects, and pages…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') {
              e.preventDefault();
              setSelected((s) => Math.min(s + 1, items.length - 1));
            }
            if (e.key === 'ArrowUp') {
              e.preventDefault();
              setSelected((s) => Math.max(0, s - 1));
            }
            if (e.key === 'Enter' && items[selected]) {
              items[selected].run();
              onClose();
            }
          }}
        />
        <kbd>esc</kbd>
      </div>
      <div className="command-results">
        {!search && <span className="eyebrow">RECENT WORK & QUICK ACTIONS</span>}
        {items.map((item, i) => (
          <button
            key={item.id}
            className={selected === i ? 'selected' : ''}
            onMouseEnter={() => setSelected(i)}
            onClick={() => {
              item.run();
              onClose();
            }}
          >
            {item.type === 'issue' ? (
              <CircleCheck size={17} />
            ) : item.type === 'project' ? (
              <FolderKanban size={17} />
            ) : (
              <FileText size={17} />
            )}
            <span>{item.label}</span>
            <small>{item.sub}</small>
            <ChevronRight size={13} />
          </button>
        ))}
        {!items.length && (
          <p className="command-empty">No results yet. Try an issue key or a different word.</p>
        )}
      </div>
      <div className="command-footer">
        <span>
          <kbd>↑</kbd>
          <kbd>↓</kbd> to navigate <kbd>↵</kbd> to open
        </span>
        <button
          onClick={() => {
            onClose();
            openCreate();
          }}
          disabled={data.user.role === 'viewer'}
        >
          <Plus size={14} />
          Create issue
        </button>
      </div>
    </Modal>
  );
}
