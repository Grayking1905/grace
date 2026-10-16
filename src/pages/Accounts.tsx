import { useEffect, useState, type FormEvent } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Check, Mail, ShieldCheck, UserRoundX } from 'lucide-react';
import { api, patch, post } from '../lib/api';
import { useGrace } from '../context';
import { Avatar, Badge, Button, Modal, formatDate } from '../components/ui';
import { notificationEvents, type NotificationPreference } from '../../shared/notifications';
import '../accounts.css';

export function PublicAccountPage() {
  const location = useLocation();
  const mode = location.pathname.split('/').pop();
  const [token] = useState(
    () => new URLSearchParams(window.location.hash.slice(1)).get('token') || '',
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [complete, setComplete] = useState(false);
  useEffect(() => {
    if (window.location.hash) window.history.replaceState(null, '', window.location.pathname);
  }, []);
  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    const form = Object.fromEntries(new FormData(e.currentTarget));
    try {
      if (mode === 'reset' && form.password !== form.confirm)
        throw new Error('The two passwords must match.');
      await post(
        mode === 'forgot'
          ? '/auth/forgot-password'
          : mode === 'verify'
            ? '/auth/verify-email'
            : '/auth/reset-password',
        mode === 'forgot'
          ? { email: form.email }
          : mode === 'verify'
            ? { token }
            : { token, password: form.password },
      );
      setComplete(true);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <main className="account-link-page">
      <Link to="/" className="brand">
        <img src="/grace.svg" alt="" width={34} />
        <span>grace.</span>
      </Link>
      <section className="panel account-link-card">
        <span className="account-emblem">
          <ShieldCheck size={25} />
        </span>
        <h1>
          {mode === 'forgot'
            ? 'Let’s get you back in.'
            : mode === 'verify'
              ? 'Verify your email.'
              : 'A fresh start for your password.'}
        </h1>
        {complete ? (
          <div role="status">
            <p>
              {mode === 'forgot'
                ? 'If an account matches this email, a reset link will be sent. Check your inbox and spam folder.'
                : mode === 'verify'
                  ? 'Your email is verified. You can return to your workspace.'
                  : 'Your password has changed and existing sessions have been signed out. Sign in with your new password.'}
            </p>
            <Link className="btn primary" to="/">
              {mode === 'verify' ? 'Open Grace' : 'Back to sign in'}
            </Link>
          </div>
        ) : (
          <form onSubmit={submit}>
            <p>
              {mode === 'verify'
                ? 'Confirm this email belongs to you. This link can be used once.'
                : mode === 'forgot'
                  ? 'We’ll email a one-time link to help you choose a new password.'
                  : 'Choose a password with at least 10 characters.'}
            </p>
            {mode === 'forgot' ? (
              <label>
                Email address
                <input name="email" type="email" required autoComplete="email" />
              </label>
            ) : mode === 'reset' ? (
              <>
                <label>
                  New password
                  <input
                    name="password"
                    type="password"
                    required
                    minLength={10}
                    maxLength={128}
                    autoComplete="new-password"
                  />
                </label>
                <label>
                  Confirm password
                  <input
                    name="confirm"
                    type="password"
                    required
                    minLength={10}
                    maxLength={128}
                    autoComplete="new-password"
                  />
                </label>
              </>
            ) : null}
            {mode !== 'forgot' && !token && (
              <p className="form-error">This link is incomplete. Request a new email from Grace.</p>
            )}
            {error && (
              <p className="form-error" role="alert">
                {error}
              </p>
            )}
            <Button busy={busy} disabled={mode !== 'forgot' && !token} type="submit">
              {mode === 'verify'
                ? 'Verify email'
                : mode === 'reset'
                  ? 'Change password'
                  : 'Send reset link'}
            </Button>
            <Link to="/">Back to Grace</Link>
          </form>
        )}
      </section>
    </main>
  );
}
interface Security {
  email: string;
  verified_at: string | null;
  smtp_configured: boolean;
  deliveries: { id: string; kind: string; state: string; error_code: string; created_at: string }[];
}
export function AccountSecurityPage() {
  const { data, run } = useGrace();
  const security = useQuery({
    queryKey: ['account-security', data.user.id],
    queryFn: () => api<Security>('/account/security'),
  });
  const prefs = useQuery({
    queryKey: ['notification-preferences', data.workspace.id, data.user.id],
    queryFn: () => api<NotificationPreference[]>('/account/notifications'),
  });
  return (
    <div className="page account-settings">
      <div className="page-heading">
        <div>
          <span className="eyebrow">KEEP YOUR ACCOUNT IN GOOD HANDS</span>
          <h1>Security & notifications</h1>
          <p>Manage your identity and choose what deserves your attention.</p>
        </div>
      </div>
      <section className="panel account-panel">
        <div className="panel-heading">
          <div>
            <h2>Email verification</h2>
            <p>{data.user.email}</p>
          </div>
          <Badge tone={security.data?.verified_at ? 'green' : 'amber'}>
            {security.data?.verified_at ? 'Verified' : 'Not verified'}
          </Badge>
        </div>
        <div className="account-panel-body">
          {security.error ? (
            <p className="form-error">{security.error.message}</p>
          ) : (
            <>
              <p>
                {security.data?.verified_at
                  ? `Verified ${formatDate(security.data.verified_at)}.`
                  : 'Use a one-time email link to confirm your address.'}
              </p>
              {!security.data?.verified_at && (
                <Button
                  onClick={() =>
                    run(() => post('/account/verification'), 'Verification email requested.')
                  }
                >
                  <Mail size={16} />
                  Send verification email
                </Button>
              )}
              <p className="account-help">
                SMTP{' '}
                {security.data?.smtp_configured
                  ? 'is configured on the server.'
                  : 'is not configured yet. Set the SMTP variables in .env and restart the API to enable delivery.'}
              </p>
              <Link className="btn secondary" to="/account/forgot">
                Request a password reset
              </Link>
            </>
          )}
        </div>
      </section>
      <section className="panel account-panel">
        <div className="panel-heading">
          <div>
            <h2>Notification preferences</h2>
            <p>Set each event independently for this workspace.</p>
          </div>
        </div>
        <div className="account-panel-body">
          {prefs.error ? (
            <p className="form-error">{prefs.error.message}</p>
          ) : (
            notificationEvents.map((event) => {
              const pref = prefs.data?.find((p) => p.event === event) || {
                event,
                in_app: true,
                email: false,
              };
              return (
                <div className="preference-row" key={event}>
                  <strong>
                    {event === 'watcher'
                      ? 'Watcher assignment'
                      : event[0].toUpperCase() + event.slice(1)}
                  </strong>
                  {(['in_app', 'email'] as const).map((channel) => (
                    <label key={channel}>
                      <input
                        type="checkbox"
                        checked={pref[channel]}
                        disabled={!prefs.data}
                        onChange={(e) =>
                          run(
                            () =>
                              patch('/account/notifications', {
                                ...pref,
                                [channel]: e.target.checked,
                              }),
                            'Preferences saved.',
                          )
                        }
                      />
                      {channel === 'in_app' ? 'In Grace' : 'Email'}
                    </label>
                  ))}
                </div>
              );
            })
          )}
        </div>
      </section>
      {security.data?.deliveries.length ? (
        <section className="panel account-panel">
          <div className="panel-heading">
            <h2>Recent email delivery</h2>
          </div>
          <div className="account-panel-body">
            {security.data.deliveries.map((item) => (
              <div className="preference-row" key={item.id}>
                <span>
                  {item.kind === 'verify'
                    ? 'Email verification'
                    : item.kind === 'reset'
                      ? 'Password reset'
                      : 'Notification'}{' '}
                  · {formatDate(item.created_at)}
                </span>
                <Badge
                  tone={
                    item.state === 'sent' ? 'green' : item.state === 'failed' ? 'amber' : 'neutral'
                  }
                >
                  {item.state}
                </Badge>
                {item.error_code && <small>{item.error_code}</small>}
              </div>
            ))}
          </div>
        </section>
      ) : null}
      {['owner', 'admin'].includes(data.user.role) && <MemberLifecycle />}
    </div>
  );
}
function MemberLifecycle() {
  const { data, run } = useGrace();
  const [confirm, setConfirm] = useState<{ id: string; name: string } | null>(null);
  const members = useQuery({
    queryKey: ['member-lifecycle', data.workspace.id],
    queryFn: () =>
      api<
        {
          id: string;
          name: string;
          email: string;
          color: string;
          role: string;
          deactivated_at: string | null;
        }[]
      >('/administration/members'),
  });
  return (
    <section className="panel account-panel">
      <div className="panel-heading">
        <div>
          <h2>Member access</h2>
          <p>
            Deactivation ends workspace sessions and prevents sign-in here. Existing work is
            retained.
          </p>
        </div>
      </div>
      <div className="account-panel-body">
        {members.error && <p className="form-error">{members.error.message}</p>}
        {members.data?.map((member) => (
          <div className="member-lifecycle-row" key={member.id}>
            <Avatar user={member} />
            <span>
              <strong>{member.name}</strong>
              <small>{member.email}</small>
            </span>
            <Badge tone={member.deactivated_at ? 'amber' : 'green'}>
              {member.deactivated_at ? 'Inactive' : member.role}
            </Badge>
            <Button
              variant="secondary"
              disabled={member.role === 'owner' || member.id === data.user.id}
              onClick={() =>
                member.deactivated_at
                  ? run(() => post(`/members/${member.id}/reactivate`), 'Member reactivated.')
                  : setConfirm(member)
              }
            >
              {member.deactivated_at ? <Check size={14} /> : <UserRoundX size={14} />}{' '}
              {member.deactivated_at ? 'Reactivate' : 'Deactivate'}
            </Button>
          </div>
        ))}
      </div>
      {confirm && (
        <Modal title={`Deactivate ${confirm.name}?`} onClose={() => setConfirm(null)}>
          <div className="modal-body">
            <p>
              Their current workspace sessions will end. Issues, comments, and assignments remain
              available for the team. You can reactivate this membership later.
            </p>
          </div>
          <div className="modal-footer">
            <Button variant="secondary" onClick={() => setConfirm(null)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              onClick={async () => {
                const result = await run(
                  () => post(`/members/${confirm.id}/deactivate`),
                  'Member deactivated.',
                );
                if (result) setConfirm(null);
              }}
            >
              Deactivate member
            </Button>
          </div>
        </Modal>
      )}
    </section>
  );
}
