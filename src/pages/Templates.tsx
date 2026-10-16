import { useState, type FormEvent } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Plus, FileText, Pencil, Trash2, ArrowUpRight } from 'lucide-react';
import { useGrace } from '../context';
import { api, patch, post } from '../lib/api';
import { Button, Badge, Empty, Modal } from '../components/ui';
import { Editor } from '../components/Editor';
import type { IssueTemplate } from '../../shared/templates';
export function TemplatesPage() {
  const { data, run, openCreate } = useGrace();
  const [edit, setEdit] = useState<IssueTemplate | 'new' | null>(null);
  const [remove, setRemove] = useState<IssueTemplate | null>(null);
  const query = useQuery({
    queryKey: ['issue-templates', data.workspace.id],
    queryFn: () => api<IssueTemplate[]>('/issue-templates'),
  });
  return (
    <div className="page">
      <div className="page-heading">
        <div>
          <span className="eyebrow">START WITH THE CONTEXT THAT MATTERS</span>
          <h1>Issue templates</h1>
          <p>Reusable briefs, acceptance criteria, checklists, and sensible defaults.</p>
        </div>
        <Button onClick={() => setEdit('new')} disabled={data.user.role === 'viewer'}>
          <Plus size={16} />
          New template
        </Button>
      </div>
      {query.error ? (
        <p className="form-error">{query.error.message}</p>
      ) : query.isPending ? (
        <p>Loading templates…</p>
      ) : query.data?.length ? (
        <div className="module-grid">
          {query.data.map((template) => (
            <article className="module-card" key={template.id}>
              <div className="module-card-head">
                <span className="module-symbol">
                  <FileText size={20} />
                </span>
                <Badge>
                  {data.projects.find((p) => p.id === template.project_id)?.name || 'Workspace'}
                </Badge>
              </div>
              <h3>{template.name}</h3>
              <p className="module-description">
                {template.description || 'A shared starting point for useful work.'}
              </p>
              <div className="planning-header-actions">
                <Button
                  onClick={() =>
                    openCreate({
                      ...template.defaults,
                      project_id:
                        template.project_id || data.projects.find((p) => p.can_write !== false)?.id,
                    })
                  }
                  disabled={!data.projects.length || data.user.role === 'viewer'}
                >
                  Use template
                  <ArrowUpRight size={14} />
                </Button>
                {(template.created_by === data.user.id ||
                  ['owner', 'admin'].includes(data.user.role)) && (
                  <>
                    <Button variant="secondary" onClick={() => setEdit(template)}>
                      <Pencil size={14} />
                      Edit
                    </Button>
                    <Button
                      variant="ghost"
                      aria-label={`Delete ${template.name}`}
                      onClick={() => setRemove(template)}
                    >
                      <Trash2 size={15} />
                    </Button>
                  </>
                )}
              </div>
            </article>
          ))}
        </div>
      ) : (
        <Empty
          title="A useful starting point for every issue"
          text="Create a rich issue template for recurring work and team standards."
        />
      )}
      {edit && (
        <TemplateForm template={edit === 'new' ? undefined : edit} onClose={() => setEdit(null)} />
      )}{' '}
      {remove && (
        <Modal title="Delete this template?" onClose={() => setRemove(null)}>
          <div className="modal-body">
            <p>Existing issues are unchanged. This reusable template will be removed.</p>
          </div>
          <div className="modal-footer">
            <Button variant="secondary" onClick={() => setRemove(null)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              onClick={async () => {
                if (
                  await run(
                    () =>
                      api(`/issue-templates/${remove.id}`, {
                        method: 'DELETE',
                        body: JSON.stringify({ version: remove.version }),
                      }),
                    'Template deleted.',
                  )
                )
                  setRemove(null);
              }}
            >
              Delete template
            </Button>
          </div>
        </Modal>
      )}
    </div>
  );
}
function TemplateForm({ template, onClose }: { template?: IssueTemplate; onClose: () => void }) {
  const { data, run } = useGrace();
  const [description, setDescription] = useState(template?.defaults.description || '');
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const values = Object.fromEntries(new FormData(e.currentTarget));
    const body = {
      name: String(values.name),
      description: String(values.description),
      defaults: {
        summary: String(values.summary),
        description,
        type: String(values.type),
        priority: String(values.priority),
        story_points: Number(values.story_points) || 0,
        labels: String(values.labels)
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean),
      },
    };
    setBusy(true);
    const result = await run(
      () =>
        template
          ? patch(`/issue-templates/${template.id}`, { ...body, version: template.version })
          : post('/issue-templates', { ...body, project_id: values.project_id || null }),
      'Template saved.',
    );
    setBusy(false);
    if (result) onClose();
  };
  return (
    <Modal
      title={template ? 'Edit issue template' : 'Create an issue template'}
      onClose={onClose}
      wide
    >
      <form onSubmit={submit}>
        <div className="modal-body">
          <div className="form-row">
            <label>
              Template name
              <input name="name" required maxLength={120} defaultValue={template?.name} autoFocus />
            </label>
            <label>
              Scope
              <select
                name="project_id"
                defaultValue={template?.project_id || ''}
                disabled={!!template}
              >
                {['owner', 'admin'].includes(data.user.role) && <option value="">Workspace</option>}
                {data.projects
                  .filter((p) => p.can_write !== false)
                  .map((p) => (
                    <option value={p.id} key={p.id}>
                      {p.name}
                    </option>
                  ))}
              </select>
            </label>
          </div>
          <label>
            When to use this template
            <input name="description" maxLength={2000} defaultValue={template?.description} />
          </label>
          <label>
            Default issue title
            <input name="summary" maxLength={255} defaultValue={template?.defaults.summary} />
          </label>
          <div className="form-row three">
            <label>
              Issue type
              <select name="type" defaultValue={template?.defaults.type || 'task'}>
                {['task', 'story', 'bug', 'epic', 'subtask'].map((type) => (
                  <option key={type}>{type}</option>
                ))}
              </select>
            </label>
            <label>
              Priority
              <select name="priority" defaultValue={template?.defaults.priority || 'medium'}>
                {['critical', 'high', 'medium', 'low', 'lowest'].map((p) => (
                  <option key={p}>{p}</option>
                ))}
              </select>
            </label>
            <label>
              Points
              <input
                type="number"
                name="story_points"
                min={0}
                max={1000}
                defaultValue={template?.defaults.story_points || 0}
              />
            </label>
          </div>
          <label>
            Labels
            <input name="labels" defaultValue={template?.defaults.labels?.join(', ')} />
          </label>
          <label>
            Default description
            <Editor content={description} onChange={setDescription} />
          </label>
        </div>
        <div className="modal-footer">
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" busy={busy}>
            Save template
          </Button>
        </div>
      </form>
    </Modal>
  );
}
