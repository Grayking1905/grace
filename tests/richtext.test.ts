import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../server/app.js';
import { Database } from '../server/db.js';
import { sanitizeRichText } from '../server/richtext.js';

let app: Awaited<ReturnType<typeof createApp>>;
let owner: ReturnType<typeof request.agent>;
const csrf = { 'X-Grace-CSRF': '1' };
const content =
  '<ul data-type="taskList"><li data-type="taskItem" data-checked="true"><label><input type="checkbox" checked></label><div><p>Reviewed</p></div></li></ul><table><tbody><tr><th colspan="2" rowspan="1" colwidth="150,200"><p>Milestone</p></th></tr><tr><td><p>Ship</p></td><td><p>Friday</p></td></tr></tbody></table>';
beforeAll(async () => {
  app = await createApp({ db: new Database('sqlite', ':memory:'), seed: true });
  owner = request.agent(app.app);
  expect((await owner.post('/api/v1/auth/demo').set(csrf)).status).toBe(200);
});
afterAll(async () => {
  app.io.close();
  await app.db.close();
});
describe('Rich content persistence', () => {
  it('preserves checklist/table semantics but strips executable markup and unsafe destinations', () => {
    const cleaned = sanitizeRichText(
      content +
        '<script>steal()</script><img src=x onerror=steal()><a href="javascript:steal()" onclick="steal()">Bad</a><a href="https://example.test" target="_blank" rel="opener">Good</a>',
    );
    expect(cleaned).toContain('data-type="taskList"');
    expect(cleaned).toContain('data-checked="true"');
    expect(cleaned).toContain('<table>');
    expect(cleaned).toContain('colspan="2"');
    expect(cleaned).toContain('colwidth="150,200"');
    expect(cleaned).not.toMatch(/<script|<input|<img|onclick|javascript:|onerror|rel="opener"/);
    expect(cleaned).toContain('rel="noopener noreferrer nofollow"');
    expect(sanitizeRichText(cleaned)).toBe(cleaned);
  });
  it('round-trips the same supported editor nodes in issues, pages, and page history', async () => {
    const created = await owner
      .post('/api/v1/issues')
      .set(csrf)
      .send({ project_id: 'project-platform', summary: 'Editor round-trip', description: content });
    expect(created.status).toBe(201);
    const issue = await owner.get(`/api/v1/issues/${created.body.id}`);
    expect(issue.body.issue.description).toBe(sanitizeRichText(content));
    const page = await owner.post('/api/v1/pages').set(csrf).send({ title: 'Rich document' });
    const saved = await owner
      .patch(`/api/v1/pages/${page.body.id}`)
      .set(csrf)
      .send({ title: '  Rich document  ', content, version: 1 });
    expect(saved.status).toBe(200);
    expect(saved.body.page).toMatchObject({
      id: page.body.id,
      title: 'Rich document',
      content: sanitizeRichText(content),
      version: 2,
    });
    const bootstrap = await owner.get('/api/v1/bootstrap');
    const stored = bootstrap.body.pages.find((p: { id: string }) => p.id === page.body.id);
    expect(stored.content).toBe(sanitizeRichText(content));
    expect(
      (
        await owner
          .patch(`/api/v1/pages/${page.body.id}`)
          .set(csrf)
          .send({ title: 'Rich document', content: content + '<p>Next revision</p>', version: 2 })
      ).status,
    ).toBe(200);
    const history = await owner.get(`/api/v1/pages/${page.body.id}/versions`);
    expect(history.body.find((p: { version: number }) => p.version === 2).content).toBe(
      sanitizeRichText(content),
    );
  });
});
