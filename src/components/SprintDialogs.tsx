import { useState, type FormEvent } from 'react';
import { Check, CircleCheck, CircleDashed } from 'lucide-react';
import type { Project, Sprint } from '../../shared/types';
import { useGrace } from '../context';
import { post } from '../lib/api';
import { Button, Modal } from './ui';
export function CreateSprint({ project, onClose }: { project: Project; onClose: () => void }) {
  const { run } = useGrace();
  const [busy, setBusy] = useState(false);
  const end = new Date();
  end.setDate(end.getDate() + 14);
  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setBusy(true);
    const body = Object.fromEntries(new FormData(e.currentTarget));
    const result = await run(
      () => post('/sprints', { ...body, project_id: project.id }),
      'A fresh sprint is ready to plan.',
    );
    setBusy(false);
    if (result) onClose();
  };
  return (
    <Modal title="Find your next rhythm" onClose={onClose}>
      <form onSubmit={submit}>
        <div className="modal-body">
          <label>
            Sprint name
            <input name="name" placeholder="e.g. Sprint 9" required maxLength={120} autoFocus />
          </label>
          <label>
            Sprint goal
            <textarea
              name="goal"
              rows={3}
              placeholder="What would a great sprint look like?"
              maxLength={2000}
            />
          </label>
          <div className="form-row">
            <label>
              Start date
              <input
                type="date"
                name="start_date"
                defaultValue={new Date().toISOString().slice(0, 10)}
                required
              />
            </label>
            <label>
              End date
              <input
                type="date"
                name="end_date"
                defaultValue={end.toISOString().slice(0, 10)}
                required
              />
            </label>
          </div>
        </div>
        <div className="modal-footer">
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" busy={busy}>
            Create sprint
          </Button>
        </div>
      </form>
    </Modal>
  );
}
export function CompleteSprint({ sprint, onClose }: { sprint: Sprint; onClose: () => void }) {
  const { data, run } = useGrace();
  const [busy, setBusy] = useState(false);
  const items = data.issues.filter((i) => i.sprint_id === sprint.id);
  const done = items.filter(
    (i) => data.statuses.find((s) => s.id === i.status_id)?.category === 'done',
  );
  return (
    <Modal title={`Wrap up ${sprint.name}`} onClose={onClose}>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          const body = Object.fromEntries(new FormData(e.currentTarget));
          const result = await run(
            () =>
              post(`/sprints/${sprint.id}/complete`, {
                destination_id: body.destination_id || null,
              }),
            'Sprint complete. Take a moment to celebrate.',
          );
          setBusy(false);
          if (result) onClose();
        }}
      >
        <div className="modal-body">
          <div className="sprint-completion-stats">
            <div>
              <CircleCheck size={22} />
              <strong>{done.length}</strong>
              <span>Completed</span>
            </div>
            <div>
              <CircleDashed size={22} />
              <strong>{items.length - done.length}</strong>
              <span>To carry forward</span>
            </div>
          </div>
          <p>
            Every step counts. Your completed work stays with this sprint, and unfinished issues
            will be marked as carry-over.
          </p>
          <label>
            Move unfinished work to
            <select name="destination_id">
              <option value="">Backlog</option>
              {data.sprints
                .filter((s) => s.project_id === sprint.project_id && s.state === 'future')
                .map((s) => (
                  <option value={s.id} key={s.id}>
                    {s.name}
                  </option>
                ))}
            </select>
          </label>
        </div>
        <div className="modal-footer">
          <Button type="button" variant="secondary" onClick={onClose}>
            Keep working
          </Button>
          <Button type="submit" busy={busy}>
            Complete sprint <Check size={15} />
          </Button>
        </div>
      </form>
    </Modal>
  );
}
