import { useEffect, useRef, type ReactNode, type ButtonHTMLAttributes } from 'react';
import {
  ArrowDown,
  ArrowUp,
  Minus,
  ChevronsUp,
  Check,
  Square,
  Bookmark,
  Bug,
  Layers,
  X,
  LoaderCircle,
  Circle,
  CheckCircle2,
} from 'lucide-react';
import type { User, Priority, IssueType, Status } from '../../shared/types';
export function Button({
  children,
  variant = 'primary',
  className = '',
  busy,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  busy?: boolean;
}) {
  return (
    <button className={`btn ${variant} ${className}`} {...props} disabled={props.disabled || busy}>
      {busy && <LoaderCircle size={15} className="spin" />}
      {children}
    </button>
  );
}
export function IconButton({
  label,
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { label: string }) {
  return (
    <button className="icon-btn" aria-label={label} title={label} {...props}>
      {children}
    </button>
  );
}
export function Avatar({
  user,
  size = 28,
}: {
  user?: Pick<User, 'name' | 'color'> | null;
  size?: number;
}) {
  return (
    <span
      className="avatar"
      title={user?.name || 'Unassigned'}
      style={{
        background: user?.color || '#edf0ed',
        width: size,
        height: size,
        fontSize: size * 0.34,
      }}
    >
      {user?.name
        .split(' ')
        .map((n) => n[0])
        .slice(0, 2)
        .join('') || '—'}
    </span>
  );
}
export function AvatarGroup({ users, size = 27 }: { users: User[]; size?: number }) {
  return (
    <span className="avatar-group">
      {users.slice(0, 4).map((u) => (
        <Avatar key={u.id} user={u} size={size} />
      ))}
      {users.length > 4 && <span className="avatar more-avatar">+{users.length - 4}</span>}
    </span>
  );
}
export function PriorityIcon({
  priority,
  withLabel = false,
}: {
  priority: Priority;
  withLabel?: boolean;
}) {
  const Icon =
    priority === 'critical'
      ? ChevronsUp
      : priority === 'high'
        ? ArrowUp
        : priority === 'medium'
          ? Minus
          : ArrowDown;
  return (
    <span className={`priority ${priority}`} title={`${priority} priority`}>
      <Icon size={14} />
      {withLabel && <span>{priority}</span>}
    </span>
  );
}
export function TypeIcon({ type }: { type: IssueType }) {
  const Icon =
    type === 'bug'
      ? Bug
      : type === 'story'
        ? Bookmark
        : type === 'epic'
          ? Layers
          : type === 'subtask'
            ? Square
            : Check;
  return (
    <span className={`type-icon ${type}`} title={type}>
      <Icon size={11} strokeWidth={2.5} />
    </span>
  );
}
export function StatusPill({ status }: { status?: Status }) {
  return (
    <span className="status-pill">
      {status?.category === 'done' ? (
        <CheckCircle2 size={13} color={status.color} />
      ) : (
        <Circle
          size={12}
          fill={status?.category === 'active' ? status.color : 'none'}
          color={status?.color}
        />
      )}{' '}
      {status?.name || 'Unknown'}
    </span>
  );
}
export function Badge({ children, tone = 'neutral' }: { children: ReactNode; tone?: string }) {
  return <span className={`badge ${tone}`}>{children}</span>;
}
export function Empty({
  title,
  text,
  action,
}: {
  title: string;
  text?: string;
  action?: ReactNode;
}) {
  return (
    <div className="empty-state">
      <div className="empty-icon">
        <Layers size={25} />
      </div>
      <h3>{title}</h3>
      {text && <p>{text}</p>}
      {action}
    </div>
  );
}
export function Modal({
  title,
  children,
  onClose,
  wide = false,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const previous = document.activeElement as HTMLElement;
    const el = ref.current;
    const focusable = () =>
      Array.from(
        el?.querySelectorAll<HTMLElement>(
          'button:not(:disabled),input,select,textarea,[tabindex="0"],a[href]',
        ) || [],
      ).filter(
        (node) =>
          node.offsetParent !== null &&
          !node.hasAttribute('disabled') &&
          node.closest('[role="dialog"]') === el,
      );
    (
      focusable().find((node) => ['INPUT', 'TEXTAREA'].includes(node.tagName)) || focusable()[0]
    )?.focus();
    const key = (e: KeyboardEvent) => {
      const dialogs = document.querySelectorAll('[role="dialog"]');
      if (dialogs[dialogs.length - 1] !== el) return;
      if (e.key === 'Escape') {
        e.preventDefault();
        closeRef.current();
      }
      if (e.key === 'Tab') {
        const elements = focusable();
        const first = elements[0],
          last = elements[elements.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last?.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first?.focus();
        }
      }
    };
    document.addEventListener('keydown', key);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', key);
      document.body.style.overflow = overflow;
      previous?.focus();
    };
  }, []);
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={`modal ${wide ? 'wide' : ''}`}
      >
        <header>
          <h2>{title}</h2>
          <IconButton label="Close dialog" onClick={onClose}>
            <X size={19} />
          </IconButton>
        </header>
        {children}
      </div>
    </div>
  );
}
export function relativeTime(value: string) {
  const mins = Math.max(0, Math.floor((Date.now() - Date.parse(value)) / 60000));
  return mins < 1
    ? 'Just now'
    : mins < 60
      ? `${mins}m ago`
      : mins < 1440
        ? `${Math.floor(mins / 60)}h ago`
        : `${Math.floor(mins / 1440)}d ago`;
}
export const formatDate = (
  date: string,
  options: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric' },
) =>
  date
    ? new Intl.DateTimeFormat(undefined, options).format(
        new Date(date.length === 10 ? date + 'T12:00:00' : date),
      )
    : 'No date';
