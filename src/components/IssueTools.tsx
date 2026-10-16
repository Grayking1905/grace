import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ArrowUp, ArrowDown, ArrowRightLeft, Users } from 'lucide-react';
import type { Issue, User } from '../../shared/types';
import { useGrace } from '../context';
import { api, post } from '../lib/api';
import { Button, Modal, IconButton, Avatar } from './ui';
export function IssuePlanningTools({
  issue,
  watchers,
  write,
}: {
  issue: Issue;
  watchers: string[];
  write: boolean;
}) {
  const { data, run } = useGrace();
  const [move, setMove] = useState(false);
  const [watch, setWatch] = useState(false);
  const [destination, setDestination] = useState('');
  const targets = data.projects.filter((p) => p.id !== issue.project_id && p.can_write !== false);
  return (
    <>
      <div className="planning-header-actions">
        <Button
          variant="secondary"
          disabled={!write || !targets.length}
          onClick={() => setMove(true)}
        >
          <ArrowRightLeft size={14} />
          Move issue
        </Button>
        <Button variant="secondary" disabled={!write} onClick={() => setWatch(true)}>
          <Users size={14} />
          Manage watchers
        </Button>
      </div>
      {move && (
        <Modal title={`Move ${issue.key}`} onClose={() => setMove(false)}>
          <div className="modal-body">
            <p>
              The issue keeps its identity, history, comments, and files. Its old key will continue
              to resolve, subject to the destination’s permissions. Cycle and module membership are
              cleared.
            </p>
            <p className="account-help">
              Moves currently support standalone issues. Detach hierarchy relationships before
              moving.
            </p>
            <label>
              Destination project
              <select
                aria-label="Move destination"
                value={destination}
                onChange={(e) => setDestination(e.target.value)}
              >
                <option value="" disabled>
                  Choose a project…
                </option>
                {targets.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} · {p.key}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="modal-footer">
            <Button variant="secondary" onClick={() => setMove(false)}>
              Cancel
            </Button>
            <Button
              disabled={!destination}
              onClick={async () => {
                if (
                  await run(
                    () =>
                      post(`/issues/${issue.id}/move`, {
                        project_id: destination,
                        version: issue.version,
                      }),
                    'Issue moved. Its old key still works.',
                  )
                )
                  setMove(false);
              }}
            >
              Move issue
            </Button>
          </div>
        </Modal>
      )}
      {watch && <WatcherPicker issue={issue} watchers={watchers} onClose={() => setWatch(false)} />}
    </>
  );
}
function WatcherPicker({
  issue,
  watchers,
  onClose,
}: {
  issue: Issue;
  watchers: string[];
  onClose: () => void;
}) {
  const { run } = useGrace();
  const [selected, setSelected] = useState(new Set(watchers));
  const [busy, setBusy] = useState(false);
  const people = useQuery({
    queryKey: ['issue-people', issue.id],
    queryFn: () => api<User[]>(`/issues/${issue.id}/people`),
  });
  return (
    <Modal title="People watching this issue" onClose={onClose}>
      <div className="modal-body">
        <p>Only active people with project access can watch this work.</p>
        {people.error && <p className="form-error">{people.error.message}</p>}
        {people.data?.map((person) => (
          <label key={person.id} className="issue-picker-row">
            <input
              type="checkbox"
              checked={selected.has(person.id)}
              onChange={(e) =>
                setSelected((previous) => {
                  const next = new Set(previous);
                  e.target.checked ? next.add(person.id) : next.delete(person.id);
                  return next;
                })
              }
            />
            <Avatar user={person} />
            {person.name}
          </label>
        ))}
      </div>
      <div className="modal-footer">
        <Button variant="secondary" onClick={onClose}>
          Cancel
        </Button>
        <Button
          busy={busy}
          disabled={!people.data}
          onClick={async () => {
            setBusy(true);
            const visible = new Set(people.data?.map((p) => p.id));
            const result = await run(
              () =>
                api(`/issues/${issue.id}/watchers`, {
                  method: 'PUT',
                  body: JSON.stringify({ user_ids: [...selected].filter((id) => visible.has(id)) }),
                }),
              'Watchers updated.',
            );
            setBusy(false);
            if (result) onClose();
          }}
        >
          Save watchers
        </Button>
      </div>
    </Modal>
  );
}
export function BacklogRankControls({ issue, items }: { issue: Issue; items: Issue[] }) {
  const { data, run } = useGrace();
  const index = items.findIndex((i) => i.id === issue.id);
  const disabled =
    data.user.role === 'viewer' ||
    data.projects.find((p) => p.id === issue.project_id)?.can_write === false;
  const move = (direction: 'up' | 'down') => {
    const before = direction === 'up' ? items[index - 1]?.id || null : items[index + 2]?.id || null;
    const after = direction === 'up' ? items[index - 2]?.id || null : items[index + 1]?.id || null;
    return run(
      () =>
        post(`/issues/${issue.id}/rank`, {
          version: issue.version,
          before_id: before,
          after_id: after,
        }),
      'Planning order updated.',
    );
  };
  return (
    <span style={{ display: 'flex' }}>
      <IconButton
        label={`Move ${issue.key} up`}
        disabled={disabled || index <= 0}
        onClick={() => move('up')}
      >
        <ArrowUp size={13} />
      </IconButton>
      <IconButton
        label={`Move ${issue.key} down`}
        disabled={disabled || index === items.length - 1}
        onClick={() => move('down')}
      >
        <ArrowDown size={13} />
      </IconButton>
    </span>
  );
}
