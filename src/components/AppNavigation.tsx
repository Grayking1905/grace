import { useEffect, useState } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import {
  House,
  CircleCheck,
  FolderKanban,
  Users,
  FileText,
  Inbox,
  ChartNoAxesCombined,
  ChevronRight,
  LayoutGrid,
  SlidersHorizontal,
  CopyPlus,
  Settings,
  ShieldCheck,
  CircleHelp,
} from 'lucide-react';
import { useGrace } from '../context';
export function AppNavigation({ openHelp }: { openHelp: () => void }) {
  const { data } = useGrace();
  const location = useLocation();
  const extra = [
    { to: '/portfolio', label: 'Portfolio', icon: LayoutGrid },
    { to: '/views', label: 'Saved views', icon: SlidersHorizontal },
    { to: '/templates', label: 'Issue templates', icon: CopyPlus },
    { to: '/manager', label: 'Team planning', icon: ChartNoAxesCombined },
    { to: '/team', label: 'People directory', icon: Users },
  ];
  const advanced = extra.some(
    (n) => location.pathname === n.to || location.pathname.startsWith(`${n.to}/`),
  );
  const [expanded, setExpanded] = useState(advanced);
  useEffect(() => {
    if (advanced) setExpanded(true);
  }, [location.pathname, advanced]);
  const teamLink = data.organization?.can_admin
    ? '/teams'
    : data.organization
      ? `/teams/${data.organization.employee.team_id}`
      : '/team';
  const primary = [
    { to: '/', label: 'Home', icon: House },
    { to: '/my-work', label: 'My work', icon: CircleCheck },
    { to: '/projects', label: 'Projects', icon: FolderKanban },
    { to: teamLink, label: data.organization?.can_admin ? 'Teams' : 'My team', icon: Users },
    { to: '/pages', label: 'Documents', icon: FileText },
    { to: '/inbox', label: 'Inbox', icon: Inbox },
  ];
  const unread = data.notifications.filter((n) => !n.read_at).length;
  return (
    <>
      <div className="nav-group simple-primary-nav">
        {primary.map((n) => (
          <NavLink
            to={n.to}
            end={n.to === '/'}
            key={n.label}
            className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}
          >
            <n.icon size={18} />
            <span>{n.label}</span>
            {n.to === '/inbox' && unread > 0 && <span className="nav-count">{unread}</span>}
          </NavLink>
        ))}
      </div>
      <NavLink to="/reports" className="nav-item">
        <ChartNoAxesCombined size={18} />
        <span>Reports</span>
      </NavLink>
      <button
        className={`nav-item more-tools-toggle ${expanded ? 'expanded' : ''}`}
        aria-expanded={expanded}
        aria-controls="additional-tools"
        onClick={() => setExpanded((v) => !v)}
      >
        <LayoutGrid size={18} />
        <span>More tools</span>
        <ChevronRight size={15} />
      </button>
      {expanded && (
        <div id="additional-tools" className="additional-tools">
          {(data.organization?.can_admin || data.organization?.can_manage_team) && (
            <NavLink to="/organization" className="nav-item">
              <ShieldCheck size={16} />
              <span>{data.organization.can_admin ? 'Manage organization' : 'Manage my team'}</span>
            </NavLink>
          )}
          {extra.map((n) => (
            <NavLink to={n.to} key={n.to} className="nav-item">
              <n.icon size={16} />
              <span>{n.label}</span>
            </NavLink>
          ))}
        </div>
      )}
      <div className="simple-nav-settings">
        <NavLink to="/settings" className="nav-item">
          <Settings size={18} />
          <span>Settings</span>
        </NavLink>
        <button
          className="nav-help"
          aria-label="Help & shortcuts"
          title="Help & shortcuts (?)"
          onClick={openHelp}
        >
          <CircleHelp size={19} />
        </button>
      </div>
    </>
  );
}
