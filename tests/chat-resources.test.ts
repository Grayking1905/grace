import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import request from 'supertest';
import { createApp } from '../server/app.js';
import { Database } from '../server/db.js';
import type { OrganizationTeam } from '../shared/organization.js';
import type { ChatChannel, ChatMessage, ProjectDocument } from '../shared/types.js';

const csrf = { 'X-Grace-CSRF': '1' };
let service: Awaited<ReturnType<typeof createApp>>;
let owner: ReturnType<typeof request.agent>;
let member: ReturnType<typeof request.agent>;
let frontendTeam: OrganizationTeam;
let backendTeam: OrganizationTeam;

beforeAll(async () => {
  service = await createApp({
    db: new Database('sqlite', ':memory:'),
    seed: true,
    mailer: async () => {},
  });
  owner = request.agent(service.app);
  member = request.agent(service.app);

  await owner.post('/api/v1/auth/demo').set(csrf);
  await member
    .post('/api/v1/auth/login')
    .set(csrf)
    .send({ email: 'sarah@grace.local', password: 'GraceDemo2026!' });

  const orgRes = await owner.get('/api/v1/organization');
  frontendTeam = orgRes.body.teams.find((t: OrganizationTeam) => t.slug === 'frontend');
  backendTeam = orgRes.body.teams.find((t: OrganizationTeam) => t.slug === 'backend');
});

afterAll(async () => {
  await service.accounts.flush();
  service.io.close();
  await service.db.close();
});

describe('Chat System API', () => {
  let generalChannel: ChatChannel;
  let testMsgId: string;

  it('lists channels and auto-creates default general, team, and project channels', async () => {
    const res = await owner.get('/api/v1/chat/channels');
    expect(res.status).toBe(200);
    expect(res.body.channels).toBeDefined();
    expect(Array.isArray(res.body.channels)).toBe(true);

    // Should contain a general channel
    generalChannel = res.body.channels.find((c: ChatChannel) => c.kind === 'general');
    expect(generalChannel).toBeDefined();
    expect(generalChannel.name).toBe('general');
  });

  it('creates custom topic channel', async () => {
    const res = await owner
      .post('/api/v1/chat/channels')
      .set(csrf)
      .send({
        name: 'design-critique',
        topic: 'Weekly design critiques and UI feedback',
        kind: 'topic',
      });

    expect(res.status).toBe(201);
    expect(res.body.name).toBe('design-critique');
    expect(res.body.kind).toBe('topic');
  });

  it('sends a message in the channel and returns enriched sender details', async () => {
    const res = await owner
      .post(`/api/v1/chat/channels/${generalChannel.id}/messages`)
      .set(csrf)
      .send({
        content: 'Hello team! Check out DCP-1 for today sprint priorities.',
        attachments: [],
      });

    expect(res.status).toBe(201);
    expect(res.body.content).toContain('DCP-1');
    expect(res.body.sender_name).toBeDefined();
    testMsgId = res.body.id;
  });

  it('lists channel messages and tracks read state', async () => {
    const res = await owner.get(`/api/v1/chat/channels/${generalChannel.id}/messages`);
    expect(res.status).toBe(200);
    expect(res.body.messages.length).toBeGreaterThan(0);
    expect(res.body.messages.some((m: ChatMessage) => m.id === testMsgId)).toBe(true);

    // Mark read
    const readRes = await owner
      .post(`/api/v1/chat/channels/${generalChannel.id}/read`)
      .set(csrf);
    expect(readRes.status).toBe(200);
    expect(readRes.body.ok).toBe(true);
  });

  it('allows message deletion by sender or admin', async () => {
    const delRes = await owner
      .delete(`/api/v1/chat/messages/${testMsgId}`)
      .set(csrf);
    expect(delRes.status).toBe(200);
    expect(delRes.body.ok).toBe(true);

    const checkRes = await owner.get(`/api/v1/chat/channels/${generalChannel.id}/messages`);
    expect(checkRes.body.messages.some((m: ChatMessage) => m.id === testMsgId)).toBe(false);
  });
});

describe('Project Documentation & Shared Resources API', () => {
  let createdDocId: string;
  const projectId = 'project-platform';

  it('creates a project document with category', async () => {
    const res = await owner
      .post(`/api/v1/projects/${projectId}/documents`)
      .set(csrf)
      .send({
        title: 'Platform Architecture & Microservices',
        content: '# Architecture Overview\nOur platform utilizes modular services.',
        category: 'architecture',
        is_public: true,
      });

    expect(res.status).toBe(201);
    expect(res.body.title).toBe('Platform Architecture & Microservices');
    expect(res.body.category).toBe('architecture');
    createdDocId = res.body.id;
  });

  it('lists project documents', async () => {
    const res = await owner.get(`/api/v1/projects/${projectId}/documents`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.some((d: ProjectDocument) => d.id === createdDocId)).toBe(true);
  });

  it('updates project document', async () => {
    const res = await owner
      .put(`/api/v1/projects/${projectId}/documents/${createdDocId}`)
      .set(csrf)
      .send({
        title: 'Platform Architecture v2',
        content: '# Updated specs',
        category: 'architecture',
        is_public: true,
      });

    expect(res.status).toBe(200);
    expect(res.body.title).toBe('Platform Architecture v2');
  });

  it('assigns multiple teams to the project and retrieves shared resources with cross-team progress', async () => {
    // Multi-team assignment
    const assignRes = await owner
      .put(`/api/v1/projects/${projectId}/teams`)
      .set(csrf)
      .send({
        team_ids: [frontendTeam.id, backendTeam.id],
      });
    expect(assignRes.status).toBe(200);
    expect(assignRes.body.team_ids).toContain(frontendTeam.id);
    expect(assignRes.body.team_ids).toContain(backendTeam.id);

    // Fetch shared resources
    const sharedRes = await owner.get(`/api/v1/projects/${projectId}/shared-resources`);
    expect(sharedRes.status).toBe(200);
    expect(sharedRes.body.teams.length).toBe(2);
    expect(sharedRes.body.documents.length).toBeGreaterThan(0);
    expect(sharedRes.body.team_progress).toBeDefined();
    expect(Array.isArray(sharedRes.body.team_progress)).toBe(true);
  });

  it('deletes project document', async () => {
    const delRes = await owner
      .delete(`/api/v1/projects/${projectId}/documents/${createdDocId}`)
      .set(csrf);
    expect(delRes.status).toBe(200);
    expect(delRes.body.ok).toBe(true);
  });
});

describe('Team Member Management & Contributions API', () => {
  it('adds a member to a team and assigns team role', async () => {
    const res = await owner
      .post(`/api/v1/organization/teams/${frontendTeam.id}/members`)
      .set(csrf)
      .send({
        user_id: 'user-sarah',
        team_role: 'lead',
      });

    expect(res.status).toBe(201);
    expect(res.body.ok).toBe(true);
  });

  it('retrieves member contributions breakdown with points and completion stats', async () => {
    const res = await owner.get(`/api/v1/organization/teams/${frontendTeam.id}/contributions`);
    expect(res.status).toBe(200);
    expect(res.body.team.id).toBe(frontendTeam.id);
    expect(Array.isArray(res.body.members)).toBe(true);
    expect(res.body.members.length).toBeGreaterThan(0);
    expect(res.body.members[0]).toHaveProperty('assigned_issues');
    expect(res.body.members[0]).toHaveProperty('completed_issues');
    expect(res.body.members[0]).toHaveProperty('story_points');
  });

  it('removes a member from a team', async () => {
    const res = await owner
      .delete(`/api/v1/organization/teams/${frontendTeam.id}/members/user-sarah`)
      .set(csrf);

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });
});

describe('Project Lifecycle & Deletion', () => {
  it('allows admin to delete an empty or disposable project', async () => {
    // Create a temporary project
    const createPrj = await owner
      .post('/api/v1/projects')
      .set(csrf)
      .send({
        name: 'Temporary Sandbox Project',
        key: 'TSP',
        description: 'To test deletion',
        template: 'kanban',
        lead_id: 'user-alex',
        visibility: 'workspace',
      });

    expect(createPrj.status).toBe(201);
    const tempProjectId = createPrj.body.id;

    // Delete project
    const delRes = await owner
      .delete(`/api/v1/projects/${tempProjectId}`)
      .set(csrf);

    expect(delRes.status).toBe(200);
    expect(delRes.body.ok).toBe(true);

    // Verify it is gone
    const verifyRes = await owner.get(`/api/v1/projects/${tempProjectId}/administration`);
    expect(verifyRes.status).toBe(404);
  });
});
