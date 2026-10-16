import { useEffect, useState } from 'react';
import { Check, Trash2, X, Layers } from 'lucide-react';
import type { Issue } from '../../shared/types';
import type { BulkIssueInput, BulkIssueResult } from '../../shared/planning';
import { useGrace } from '../context';
import { post } from '../lib/api';
import { Button, IconButton, Modal } from './ui';
import '../planning.css';

export function BulkIssueActions({ issues, onClear }: { issues: Issue[]; onClear: () => void }) {
  const { data, run } = useGrace();
  const [field, setField] = useState('priority');
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const projectIds = new Set(issues.map((i) => i.project_id));
  const singleProject = projectIds.size === 1 ? issues[0]?.project_id : null;
  const hasClosedScope = issues.some(
    (i) => data.sprints.find((s) => s.id === i.sprint_id)?.state === 'closed',
  );
  useEffect(() => {
    setField('priority');
    setValue('');
  }, [singleProject, hasClosedScope]);
  if (!issues.length) return null;
  const submit = async (deleted = false) => {
    const changes: BulkIssueInput['changes'] = deleted
      ? { deleted: true }
      : field === 'labels'
        ? {
            labels: value
              .split(',')
              .map((v) => v.trim())
              .filter(Boolean),
          }
        : { [field]: value === '__none' ? null : value };
    setBusy(true);
    const result = await run(
      () =>
        post<BulkIssueResult>('/issues/bulk', {
          items: issues.map((i) => ({ id: i.id, version: i.version })),
          changes,
        }),
      deleted ? `${issues.length} issues moved to trash.` : `${issues.length} issues updated.`,
    );
    setBusy(false);
    if (result) {
      setConfirm(false);
      onClear();
    }
  };
  return (
    <>
      <div className="bulk-actions" role="region" aria-label="Bulk issue actions">
        <span className="bulk-count">
          <Layers size={16} />
          <strong>{issues.length}</strong> selected
        </span>
        <select
          aria-label="Bulk action"
          value={field}
          onChange={(e) => {
            setField(e.target.value);
            setValue('');
          }}
          disabled={busy}
        >
          <option value="priority">Set priority</option>
          <option value="assignee_id">Assign to</option>
          <option value="labels">Replace labels</option>
          {singleProject && (
            <>
              <option value="status_id">Move to status</option>
              {!hasClosedScope && <option value="sprint_id">Move to cycle</option>}
            </>
          )}
        </select>
        {field === 'labels' ? (
          <input
            aria-label="Bulk labels"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder="Labels, separated by commas"
            maxLength={800}
          />
        ) : (
          <select
            aria-label="Bulk action value"
            value={value}
            onChange={(e) => setValue(e.target.value)}
          >
            <option value="" disabled>
              Choose a value…
            </option>
            {field === 'priority' ? (
              ['critical', 'high', 'medium', 'low', 'lowest'].map((p) => (
                <option key={p} value={p}>
                  {p[0].toUpperCase() + p.slice(1)}
                </option>
              ))
            ) : field === 'assignee_id' ? (
              <>
                <option value="__none">Unassigned</option>
                {data.members
                  .filter((m) => m.role !== 'viewer')
                  .map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name}
                    </option>
                  ))}
              </>
            ) : field === 'status_id' ? (
              data.statuses
                .filter((s) => s.project_id === singleProject)
                .map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))
            ) : (
              <>
                <option value="__none">Backlog</option>
                {data.sprints
                  .filter((s) => s.project_id === singleProject && s.state !== 'closed')
                  .map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
              </>
            )}
          </select>
        )}
        <Button busy={busy} disabled={field !== 'labels' && !value} onClick={() => submit()}>
          <Check size={14} />
          Apply
        </Button>
        <IconButton
          label="Move selected issues to trash"
          disabled={busy}
          onClick={() => setConfirm(true)}
        >
          <Trash2 size={17} />
        </IconButton>
        <IconButton label="Clear selection" disabled={busy} onClick={onClear}>
          <X size={17} />
        </IconButton>
        <small>
          {singleProject
            ? 'Changes apply together.'
            : 'Select one project to change status or cycle.'}{' '}
          If work has changed, reselect it to retry.
        </small>
      </div>
      {confirm && (
        <Modal title={`Move ${issues.length} issues to trash?`} onClose={() => setConfirm(false)}>
          <div className="modal-body">
            <p>
              These issues will leave active views. A workspace administrator can restore them from
              Administration within 30 days.
            </p>
          </div>
          <div className="modal-footer">
            <Button variant="secondary" onClick={() => setConfirm(false)}>
              Cancel
            </Button>
            <Button variant="danger" busy={busy} onClick={() => submit(true)}>
              <Trash2 size={15} />
              Move to trash
            </Button>
          </div>
        </Modal>
      )}
    </>
  );
}
