import type { Express, Request } from 'express';
import { z } from 'zod';
import type { SavedView } from '../../shared/types.js';
import { canWrite, HttpError } from '../auth.js';
import type { Database } from '../db.js';
import { queryIssues } from '../gql.js';
import { id } from '../seed.js';

interface ViewsContext {
  app: Express;
  db: Database;
  audit(req: Request, action: string, target: string, detail?: string): Promise<void>;
  broadcast(req: Request): void;
}
const fields = z.object({
  name: z.string().trim().min(1).max(120),
  query: z.string().max(4000),
  sharing: z.enum(['private', 'workspace']),
});
function validateQuery(req: Request, query: string) {
  // Parsing an empty result set validates the complete grammar without loading private work.
  queryIssues(query, [], { user: req.user, projects: [], statuses: [], members: [], sprints: [] });
}

export function registerViewRoutes({ app, db, audit, broadcast }: ViewsContext) {
  async function editableView(req: Request) {
    canWrite(req);
    const view = await db.one<SavedView>(
      'SELECT id,name,query,owner_id,sharing FROM saved_views WHERE id = ? AND workspace_id = ?',
      [String(req.params.id), req.workspaceId],
    );
    if (!view || (view.sharing === 'private' && view.owner_id !== req.user.id))
      throw new HttpError(404, 'View not found.');
    if (view.owner_id !== req.user.id && !['owner', 'admin'].includes(req.user.role))
      throw new HttpError(
        403,
        'Only the view owner or a workspace administrator can update this view.',
        'FORBIDDEN',
      );
    return view;
  }
  app.post('/api/v1/views', async (req, res) => {
    canWrite(req);
    const body = fields
      .extend({ sharing: fields.shape.sharing.default('private') })
      .strict()
      .parse(req.body);
    validateQuery(req, body.query);
    const view = { ...body, id: id(), owner_id: req.user.id };
    await db.transaction(async () => {
      await db.insert('saved_views', { ...view, workspace_id: req.workspaceId });
      await audit(req, 'view.created', view.id, JSON.stringify({ sharing: body.sharing }));
    });
    broadcast(req);
    res.status(201).json(view);
  });
  app.patch('/api/v1/views/:id', async (req, res) => {
    const view = await db.transaction(async () => {
      const current = await editableView(req);
      const changes = fields
        .partial()
        .strict()
        .refine((value) => Object.keys(value).length > 0, 'Choose a setting to update.')
        .parse(req.body);
      validateQuery(req, changes.query ?? current.query);
      for (const [field, value] of Object.entries(changes))
        await db.run(`UPDATE saved_views SET \`${field}\` = ? WHERE id = ? AND workspace_id = ?`, [
          value,
          current.id,
          req.workspaceId,
        ]);
      await audit(
        req,
        'view.updated',
        current.id,
        JSON.stringify({ fields: Object.keys(changes) }),
      );
      return { ...current, ...changes };
    });
    broadcast(req);
    res.json(view);
  });
  app.delete('/api/v1/views/:id', async (req, res) => {
    await db.transaction(async () => {
      const current = await editableView(req);
      await db.run('DELETE FROM saved_views WHERE id = ? AND workspace_id = ?', [
        current.id,
        req.workspaceId,
      ]);
      await audit(req, 'view.deleted', current.id, JSON.stringify({ sharing: current.sharing }));
    });
    broadcast(req);
    res.json({ ok: true });
  });
}
