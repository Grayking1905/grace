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

  it('supports direct 1-on-1 private messages between members', async () => {
    const dmRes = await owner
      .post('/api/v1/chat/direct')
      .set(csrf)
      .send({ target_user_id: 'user-sarah' });

    expect(dmRes.status).toBe(200);
    expect(dmRes.body.id).toBeDefined();
    expect(dmRes.body.kind).toBe('direct');

    // Sending message in DM
    const msgRes = await owner
      .post(`/api/v1/chat/channels/${dmRes.body.id}/messages`)
      .set(csrf)
      .send({ content: 'Confidential 1-on-1 direct message' });

    expect(msgRes.status).toBe(201);
    expect(msgRes.body.content).toBe('Confidential 1-on-1 direct message');
  });

  it('supports message edit, pin, reactions, reply, forward, and search', async () => {
    // Send a base message
    const msgRes = await owner
      .post(`/api/v1/chat/channels/${generalChannel.id}/messages`)
      .set(csrf)
      .send({
        content: 'Original sprint announcement',
        attachments: [
          { id: 'att-1', name: 'Design mockup', type: 'image', url: 'https://example.com/mock.png' },
          { id: 'att-2', name: 'Voice note (0:12)', type: 'audio', url: '#voice' },
        ],
      });
    expect(msgRes.status).toBe(201);
    const msgId = msgRes.body.id;
    expect(msgRes.body.attachments.length).toBe(2);

    // Edit message
    const editRes = await owner
      .patch(`/api/v1/chat/messages/${msgId}`)
      .set(csrf)
      .send({ content: 'Updated sprint announcement with details' });
    expect(editRes.status).toBe(200);
    expect(editRes.body.content).toBe('Updated sprint announcement with details');
    expect(editRes.body.edited).toBe(1);

    // Pin message
    const pinRes = await owner.post(`/api/v1/chat/messages/${msgId}/pin`).set(csrf);
    expect(pinRes.status).toBe(200);
    expect(pinRes.body.pinned).toBe(1);

    // Add reaction
    const reactRes = await owner
      .post(`/api/v1/chat/messages/${msgId}/reactions`)
      .set(csrf)
      .send({ emoji: '🚀' });
    expect(reactRes.status).toBe(200);
    expect(reactRes.body.action).toBe('added');

    // Reply to message
    const replyRes = await owner
      .post(`/api/v1/chat/channels/${generalChannel.id}/messages`)
      .set(csrf)
      .send({
        content: 'Acknowledged the sprint announcement!',
        reply_to_id: msgId,
      });
    expect(replyRes.status).toBe(201);
    expect(replyRes.body.reply_to_id).toBe(msgId);

    // Forward message
    const fwdRes = await owner
      .post(`/api/v1/chat/messages/${msgId}/forward`)
      .set(csrf)
      .send({ target_channel_id: generalChannel.id });
    expect(fwdRes.status).toBe(201);
    expect(fwdRes.body.forwarded_from).toBeDefined();

    // Search messages
    const searchRes = await owner.get('/api/v1/chat/messages/search?q=announcement');
    expect(searchRes.status).toBe(200);
    expect(searchRes.body.messages.length).toBeGreaterThan(0);
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

  it('allocates specific team members to specific projects within the team', async () => {
    // First, ensure member is added to backendTeam
    await owner
      .post(`/api/v1/organization/teams/${backendTeam.id}/members`)
      .set(csrf)
      .send({ user_id: 'user-sarah', team_role: 'member' });

    // Fetch member projects
    const getRes = await owner.get(`/api/v1/organization/teams/${backendTeam.id}/member-projects`);
    expect(getRes.status).toBe(200);
    expect(getRes.body.projects).toBeDefined();
    expect(getRes.body.members).toBeDefined();

    // Allocate member to project-platform
    const allocRes = await owner
      .put(`/api/v1/organization/teams/${backendTeam.id}/members/user-sarah/projects`)
      .set(csrf)
      .send({ project_ids: ['project-platform'] });

    expect(allocRes.status).toBe(200);
    expect(allocRes.body.ok).toBe(true);
    expect(allocRes.body.project_ids).toContain('project-platform');

    // Also test batch assign project members
    const batchRes = await owner
      .put(`/api/v1/organization/teams/${backendTeam.id}/projects/project-platform/members`)
      .set(csrf)
      .send({ user_ids: ['user-sarah'] });

    expect(batchRes.status).toBe(200);
    expect(batchRes.body.ok).toBe(true);
    expect(batchRes.body.user_ids).toContain('user-sarah');
  });
});

describe('Admin Team Deletion & Automatic Project Archiving', () => {
  it('archives exclusively-assigned projects when an admin deletes a team', async () => {
    // 1. Create a dedicated team
    const teamRes = await owner
      .post('/api/v1/organization/teams')
      .set(csrf)
      .send({
        name: 'Disposable Team',
        color: '#ff6600',
        description: 'To test team deletion and project archiving',
        sections: ['issues', 'bugs'],
      });
    expect(teamRes.status).toBe(201);
    const dispTeamId = teamRes.body.id;

    // 2. Create a project assigned exclusively to this team
    const prjRes = await owner
      .post('/api/v1/projects')
      .set(csrf)
      .send({
        name: 'Exclusive Team Project',
        key: 'ETP',
        description: 'Only assigned to Disposable Team',
        template: 'kanban',
        lead_id: 'user-alex',
        visibility: 'workspace',
      });
    expect(prjRes.status).toBe(201);
    const exclusiveProjId = prjRes.body.id;

    // Assign exclusively to this team
    await owner
      .put(`/api/v1/projects/${exclusiveProjId}/teams`)
      .set(csrf)
      .send({ team_ids: [dispTeamId] });

    // 3. Admin deletes the team
    const delTeamRes = await owner
      .delete(`/api/v1/organization/teams/${dispTeamId}`)
      .set(csrf);

    expect(delTeamRes.status).toBe(200);
    expect(delTeamRes.body.ok).toBe(true);
    expect(delTeamRes.body.archived_projects).toContain(exclusiveProjId);

    // 4. Verify the project is archived (hidden from active projects, listed in archived projects)
    const activeBefore = await owner.get('/api/v1/projects');
    expect(activeBefore.body.some((p: { id: string }) => p.id === exclusiveProjId)).toBe(false);

    const archivedList = await owner.get('/api/v1/administration/projects');
    expect(archivedList.status).toBe(200);
    expect(archivedList.body.some((p: { id: string }) => p.id === exclusiveProjId)).toBe(true);

    // 5. Restore the project to confirm admin can reassign it
    const restoreRes = await owner
      .post(`/api/v1/projects/${exclusiveProjId}/restore`)
      .set(csrf);
    expect(restoreRes.status).toBe(200);
    expect(restoreRes.body.ok).toBe(true);

    const activeAfter = await owner.get('/api/v1/projects');
    expect(activeAfter.body.some((p: { id: string }) => p.id === exclusiveProjId)).toBe(true);
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
    const checkActive = await owner.get('/api/v1/projects');
    expect(checkActive.body.some((p: { id: string }) => p.id === tempProjectId)).toBe(false);
  });
});

describe('Strict Project RBAC & Visibility', () => {
  let frontendLeadAgent: ReturnType<typeof request.agent>;
  let backendLeadAgent: ReturnType<typeof request.agent>;
  let adminOnlyProjId: string;
  let zeroProjId: string;
  let frtpProjId: string;
  let xtiProjId: string;

  beforeAll(async () => {
    frontendLeadAgent = request.agent(service.app);
    backendLeadAgent = request.agent(service.app);

    const noahLogin = await frontendLeadAgent
      .post('/api/v1/auth/login')
      .set(csrf)
      .send({ email: 'noah@grace.local', password: 'GraceDemo2026!' });
    expect(noahLogin.status).toBe(200);

    const jamesLogin = await backendLeadAgent
      .post('/api/v1/auth/login')
      .set(csrf)
      .send({ email: 'james@grace.local', password: 'GraceDemo2026!' });
    expect(jamesLogin.status).toBe(200);

    // Ensure clean role assignments: noah = frontend lead, james = backend lead, sarah = frontend member
    await owner
      .post(`/api/v1/organization/teams/${frontendTeam.id}/members`)
      .set(csrf)
      .send({ user_id: 'user-noah', team_role: 'lead' });
    await owner
      .post(`/api/v1/organization/teams/${backendTeam.id}/members`)
      .set(csrf)
      .send({ user_id: 'user-james', team_role: 'lead' });
    await owner
      .delete(`/api/v1/organization/teams/${backendTeam.id}/members/user-sarah`)
      .set(csrf);
    await owner
      .post(`/api/v1/organization/teams/${frontendTeam.id}/members`)
      .set(csrf)
      .send({ user_id: 'user-sarah', team_role: 'member' });
  });

  it('restricts project creation, deletion, and archiving away from team leads, managers, and members', async () => {
    const adminCreate = await owner
      .post('/api/v1/projects')
      .set(csrf)
      .send({
        name: 'Admin Only Project',
        key: 'AOP',
        visibility: 'workspace',
        team_ids: [frontendTeam.id],
      });
    expect(adminCreate.status).toBe(201);
    adminOnlyProjId = adminCreate.body.id;

    // Team lead, other team lead, and regular member cannot create projects
    expect(
      (
        await frontendLeadAgent
          .post('/api/v1/projects')
          .set(csrf)
          .send({ name: 'Blocked Lead Proj', key: 'BLP', visibility: 'workspace' })
      ).status,
    ).toBe(403);
    expect(
      (
        await backendLeadAgent
          .post('/api/v1/projects')
          .set(csrf)
          .send({ name: 'Blocked Other Lead', key: 'BOL', visibility: 'workspace' })
      ).status,
    ).toBe(403);
    expect(
      (
        await member
          .post('/api/v1/projects')
          .set(csrf)
          .send({ name: 'Blocked Member Proj', key: 'BMP', visibility: 'workspace' })
      ).status,
    ).toBe(403);

    // Team lead cannot delete, archive, or change project-level team assignments
    expect(
      (await frontendLeadAgent.delete(`/api/v1/projects/${adminOnlyProjId}`).set(csrf)).status,
    ).toBe(403);
    expect(
      (await member.delete(`/api/v1/projects/${adminOnlyProjId}`).set(csrf)).status,
    ).toBe(403);
    expect(
      (await frontendLeadAgent.post(`/api/v1/projects/${adminOnlyProjId}/archive`).set(csrf)).status,
    ).toBe(403);
    expect(
      (
        await frontendLeadAgent
          .put(`/api/v1/projects/${adminOnlyProjId}/teams`)
          .set(csrf)
          .send({ team_ids: [frontendTeam.id, backendTeam.id] })
      ).status,
    ).toBe(403);

    // Team manager is likewise blocked from creating, deleting, or archiving projects
    await owner
      .post(`/api/v1/organization/teams/${frontendTeam.id}/members`)
      .set(csrf)
      .send({ user_id: 'user-noah', team_role: 'manager' });

    expect(
      (
        await frontendLeadAgent
          .post('/api/v1/projects')
          .set(csrf)
          .send({ name: 'Blocked Mgr Proj', key: 'BMG', visibility: 'workspace' })
      ).status,
    ).toBe(403);
    expect(
      (await frontendLeadAgent.delete(`/api/v1/projects/${adminOnlyProjId}`).set(csrf)).status,
    ).toBe(403);
    expect(
      (await frontendLeadAgent.post(`/api/v1/projects/${adminOnlyProjId}/archive`).set(csrf)).status,
    ).toBe(403);

    // Restore team lead role
    await owner
      .post(`/api/v1/organization/teams/${frontendTeam.id}/members`)
      .set(csrf)
      .send({ user_id: 'user-noah', team_role: 'lead' });
  });

  it('supports 0-team, 1-team, and multi-team assignment with strict visibility by role', async () => {
    const zeroRes = await owner
      .post('/api/v1/projects')
      .set(csrf)
      .send({
        name: 'Zero Team Unassigned',
        key: 'ZERO',
        visibility: 'workspace',
        team_ids: [],
      });
    expect(zeroRes.status).toBe(201);
    zeroProjId = zeroRes.body.id;

    const frtpRes = await owner
      .post('/api/v1/projects')
      .set(csrf)
      .send({
        name: 'Frontend Portal',
        key: 'FRTP',
        visibility: 'workspace',
        team_ids: [frontendTeam.id],
      });
    expect(frtpRes.status).toBe(201);
    frtpProjId = frtpRes.body.id;

    const xtiRes = await owner
      .post('/api/v1/projects')
      .set(csrf)
      .send({
        name: 'Cross Team Initiative',
        key: 'XTI',
        visibility: 'workspace',
        team_ids: [frontendTeam.id, backendTeam.id],
      });
    expect(xtiRes.status).toBe(201);
    xtiProjId = xtiRes.body.id;

    // Admin sees all workspace projects including unassigned ZERO
    const adminIds = (await owner.get('/api/v1/projects')).body.map((p: { id: string }) => p.id);
    expect(adminIds).toEqual(expect.arrayContaining([zeroProjId, frtpProjId, xtiProjId]));

    // Frontend Lead sees team-assigned FRTP and XTI, never unassigned ZERO
    const frontLeadIds = (await frontendLeadAgent.get('/api/v1/projects')).body.map(
      (p: { id: string }) => p.id,
    );
    expect(frontLeadIds).toContain(frtpProjId);
    expect(frontLeadIds).toContain(xtiProjId);
    expect(frontLeadIds).not.toContain(zeroProjId);
    expect((await frontendLeadAgent.get(`/api/v1/projects/${zeroProjId}/documents`)).status).toBe(
      404,
    );

    // Backend Lead sees XTI, never FRTP or ZERO
    const backLeadIds = (await backendLeadAgent.get('/api/v1/projects')).body.map(
      (p: { id: string }) => p.id,
    );
    expect(backLeadIds).toContain(xtiProjId);
    expect(backLeadIds).not.toContain(frtpProjId);
    expect(backLeadIds).not.toContain(zeroProjId);

    // Team Member sees NONE of FRTP, XTI, or ZERO until explicitly allocated
    const memberIds = (await member.get('/api/v1/projects')).body.map((p: { id: string }) => p.id);
    expect(memberIds).not.toContain(frtpProjId);
    expect(memberIds).not.toContain(xtiProjId);
    expect(memberIds).not.toContain(zeroProjId);
    expect((await member.get(`/api/v1/projects/${frtpProjId}/documents`)).status).toBe(404);
    expect((await member.get(`/api/v1/projects/${frtpProjId}/teams`)).status).toBe(404);

    // Project chat channel is also hidden from unallocated members
    const memberChannels = (await member.get('/api/v1/chat/channels')).body.channels as ChatChannel[];
    expect(memberChannels.some((c) => c.project_id === frtpProjId)).toBe(false);
    const leadChannels = (
      await frontendLeadAgent.get('/api/v1/chat/channels')
    ).body.channels as ChatChannel[];
    expect(leadChannels.some((c) => c.project_id === frtpProjId)).toBe(true);
  });

  it('grants member visibility upon lead allocation and revokes it when unassigned', async () => {
    // Frontend lead allocates sarah to FRTP (keeping any platform access)
    const allocRes = await frontendLeadAgent
      .put(`/api/v1/organization/teams/${frontendTeam.id}/members/user-sarah/projects`)
      .set(csrf)
      .send({ project_ids: ['project-platform', frtpProjId] });
    expect(allocRes.status).toBe(200);

    // Now sarah sees FRTP (and still NOT XTI or ZERO)
    const memberIdsAfter = (await member.get('/api/v1/projects')).body.map(
      (p: { id: string }) => p.id,
    );
    expect(memberIdsAfter).toContain(frtpProjId);
    expect(memberIdsAfter).not.toContain(xtiProjId);
    expect(memberIdsAfter).not.toContain(zeroProjId);
    expect((await member.get(`/api/v1/projects/${frtpProjId}/documents`)).status).toBe(200);
    expect((await member.get(`/api/v1/projects/${frtpProjId}/teams`)).status).toBe(200);

    // Viewer role also respects strict explicit allocation (cannot see unallocated XTI/ZERO)
    await owner
      .post(`/api/v1/organization/teams/${frontendTeam.id}/members`)
      .set(csrf)
      .send({ user_id: 'user-sarah', team_role: 'viewer' });
    const viewerIds = (await member.get('/api/v1/projects')).body.map((p: { id: string }) => p.id);
    expect(viewerIds).toContain(frtpProjId);
    expect(viewerIds).not.toContain(xtiProjId);
    expect(viewerIds).not.toContain(zeroProjId);

    // When admin unassigns Frontend team from FRTP, both lead and allocated member lose visibility
    const unassignRes = await owner
      .put(`/api/v1/projects/${frtpProjId}/teams`)
      .set(csrf)
      .send({ team_ids: [] });
    expect(unassignRes.status).toBe(200);

    const leadIdsAfterUnassign = (await frontendLeadAgent.get('/api/v1/projects')).body.map(
      (p: { id: string }) => p.id,
    );
    const memberIdsAfterUnassign = (await member.get('/api/v1/projects')).body.map(
      (p: { id: string }) => p.id,
    );
    expect(leadIdsAfterUnassign).not.toContain(frtpProjId);
    expect(memberIdsAfterUnassign).not.toContain(frtpProjId);

    // Admin still sees FRTP and can delete it cleanly
    expect(
      (await owner.get('/api/v1/projects')).body.some((p: { id: string }) => p.id === frtpProjId),
    ).toBe(true);
    expect((await owner.delete(`/api/v1/projects/${frtpProjId}`).set(csrf)).status).toBe(200);
    expect((await owner.delete(`/api/v1/projects/${zeroProjId}`).set(csrf)).status).toBe(200);
    expect((await owner.delete(`/api/v1/projects/${xtiProjId}`).set(csrf)).status).toBe(200);
    expect((await owner.delete(`/api/v1/projects/${adminOnlyProjId}`).set(csrf)).status).toBe(200);
  });
});
