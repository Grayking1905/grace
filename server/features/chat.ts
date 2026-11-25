import type { Express, Request, Response } from 'express';
import type { Server } from 'socket.io';
import { z } from 'zod';
import type { Database } from '../db.js';
import { HttpError } from '../auth.js';
import { id, now } from '../seed.js';
import type { ChatChannel, ChatMessage } from '../../shared/types.js';

const createChannelSchema = z.object({
  name: z.string().trim().min(2).max(120),
  kind: z.enum(['team', 'project', 'direct', 'general', 'topic']),
  team_id: z.string().optional().nullable(),
  project_id: z.string().optional().nullable(),
  description: z.string().trim().max(1000).default(''),
});

const postMessageSchema = z.object({
  content: z.string().trim().min(1).max(5000),
  attachments: z.array(z.string()).default([]),
});

export function registerChatRoutes(
  app: Express,
  db: Database,
  io?: Server,
  broadcast?: (req: Request) => void,
) {
  // Helper to ensure initial default channels exist
  async function ensureDefaultChannels(workspaceId: string, userId: string) {
    const existing = await db.all<{ id: string; kind: string; team_id: string | null; project_id: string | null }>(
      'SELECT id, kind, team_id, project_id FROM chat_channels WHERE workspace_id = ?',
      [workspaceId],
    );

    const hasGeneral = existing.some((c) => c.kind === 'general');
    if (!hasGeneral) {
      await db.insert('chat_channels', {
        id: id(),
        workspace_id: workspaceId,
        name: 'general',
        kind: 'general',
        team_id: null,
        project_id: null,
        description: 'General discussion for all workspace members',
        created_by: userId,
        created_at: now(),
        updated_at: now(),
      });
    }

    // Ensure channels for existing teams
    const teams = await db.all<{ id: string; name: string }>(
      'SELECT id, name FROM organization_teams WHERE workspace_id = ?',
      [workspaceId],
    );
    for (const t of teams) {
      if (!existing.some((c) => c.kind === 'team' && c.team_id === t.id)) {
        await db.insert('chat_channels', {
          id: id(),
          workspace_id: workspaceId,
          name: `${t.name.toLowerCase().replace(/[^a-z0-9_-]/g, '-')}-team`,
          kind: 'team',
          team_id: t.id,
          project_id: null,
          description: `Dedicated chat for ${t.name}`,
          created_by: userId,
          created_at: now(),
          updated_at: now(),
        });
      }
    }

    // Ensure channels for active projects
    const projects = await db.all<{ id: string; key: string; name: string }>(
      'SELECT id, `key`, name FROM projects WHERE workspace_id = ? AND archived_at IS NULL',
      [workspaceId],
    );
    for (const p of projects) {
      if (!existing.some((c) => c.kind === 'project' && c.project_id === p.id)) {
        await db.insert('chat_channels', {
          id: id(),
          workspace_id: workspaceId,
          name: `proj-${p.key.toLowerCase()}`,
          kind: 'project',
          team_id: null,
          project_id: p.id,
          description: `Collaboration room for project ${p.name} (${p.key})`,
          created_by: userId,
          created_at: now(),
          updated_at: now(),
        });
      }
    }
  }

  // GET /api/v1/chat/channels — list accessible channels with unread counts
  app.get('/api/v1/chat/channels', async (req: Request, res: Response) => {
    if (!req.user) throw new HttpError(401, 'Not authenticated');
    const wid = req.workspaceId;
    const uid = req.user.id;

    await ensureDefaultChannels(wid, uid);

    const channels = await db.all<ChatChannel>(
      `SELECT c.* FROM chat_channels c WHERE c.workspace_id = ? ORDER BY c.kind, c.name`,
      [wid],
    );

    // Get read times for current user
    const reads = await db.all<{ channel_id: string; last_read_at: string }>(
      'SELECT channel_id, last_read_at FROM chat_reads WHERE workspace_id = ? AND user_id = ?',
      [wid, uid],
    );
    const readMap = new Map(reads.map((r) => [r.channel_id, r.last_read_at]));

    // Get unread counts and last messages
    const enriched = await Promise.all(
      channels.map(async (c) => {
        const lastRead = readMap.get(c.id) || '2000-01-01T00:00:00Z';
        const unreadRow = await db.one<{ count: number }>(
          'SELECT COUNT(*) AS count FROM chat_messages WHERE channel_id = ? AND created_at > ? AND sender_id != ?',
          [c.id, lastRead, uid],
        );
        const lastMsg = await db.one<{ id: string; content: string; sender_name: string; created_at: string }>(
          `SELECT m.id, m.content, u.name AS sender_name, m.created_at
           FROM chat_messages m
           JOIN users u ON u.id = m.sender_id
           WHERE m.channel_id = ?
           ORDER BY m.created_at DESC LIMIT 1`,
          [c.id],
        );
        return {
          ...c,
          unread_count: unreadRow?.count ?? 0,
          last_message: lastMsg || null,
        };
      }),
    );

    res.json({ channels: enriched });
  });

  // POST /api/v1/chat/channels — create custom channel
  app.post('/api/v1/chat/channels', async (req: Request, res: Response) => {
    if (!req.user) throw new HttpError(401, 'Not authenticated');
    const body = createChannelSchema.parse(req.body);
    const wid = req.workspaceId;
    const uid = req.user.id;
    const channelId = id();

    await db.insert('chat_channels', {
      id: channelId,
      workspace_id: wid,
      name: body.name.toLowerCase().replace(/[^a-z0-9_-]/g, '-'),
      kind: body.kind,
      team_id: body.team_id || null,
      project_id: body.project_id || null,
      description: body.description,
      created_by: uid,
      created_at: now(),
      updated_at: now(),
    });

    const channel = await db.one<ChatChannel>(
      'SELECT * FROM chat_channels WHERE id = ?',
      [channelId],
    );

    if (io) io.to(`workspace:${wid}`).emit('chat.channel_created', channel);
    if (broadcast) broadcast(req);

    res.status(201).json(channel);
  });

  // GET /api/v1/chat/channels/:channelId/messages — message list
  app.get('/api/v1/chat/channels/:channelId/messages', async (req: Request, res: Response) => {
    if (!req.user) throw new HttpError(401, 'Not authenticated');
    const channelId = String(req.params.channelId);
    const wid = req.workspaceId;

    const channel = await db.one<ChatChannel>(
      'SELECT * FROM chat_channels WHERE id = ? AND workspace_id = ?',
      [channelId, wid],
    );
    if (!channel) throw new HttpError(404, 'Channel not found');

    const rows = await db.all<{
      id: string;
      workspace_id: string;
      channel_id: string;
      sender_id: string;
      content: string;
      attachments: string;
      pinned: number;
      created_at: string;
      updated_at: string;
      sender_name: string;
      sender_color: string;
      sender_role: string;
      sender_team_role: string | null;
    }>(
      `SELECT m.*, u.name AS sender_name, u.color AS sender_color, mem.role AS sender_role,
              ep.team_role AS sender_team_role
       FROM chat_messages m
       JOIN users u ON u.id = m.sender_id
       JOIN memberships mem ON mem.user_id = u.id AND mem.workspace_id = m.workspace_id
       LEFT JOIN employee_profiles ep ON ep.user_id = u.id AND ep.workspace_id = m.workspace_id
       WHERE m.channel_id = ? AND m.workspace_id = ?
       ORDER BY m.created_at ASC LIMIT 200`,
      [channelId, wid],
    );

    const messages: ChatMessage[] = rows.map((r) => ({
      id: r.id,
      workspace_id: r.workspace_id,
      channel_id: r.channel_id,
      sender_id: r.sender_id,
      sender_name: r.sender_name,
      sender_color: r.sender_color,
      sender_role: r.sender_role,
      sender_team_role: r.sender_team_role || undefined,
      content: r.content,
      attachments: JSON.parse(r.attachments || '[]'),
      pinned: r.pinned,
      created_at: r.created_at,
      updated_at: r.updated_at,
    }));

    // Auto mark as read
    const existingRead = await db.one(
      'SELECT user_id FROM chat_reads WHERE channel_id = ? AND user_id = ?',
      [channelId, req.user.id],
    );
    if (existingRead) {
      await db.run(
        'UPDATE chat_reads SET last_read_at = ? WHERE channel_id = ? AND user_id = ?',
        [now(), channelId, req.user.id],
      );
    } else {
      await db.insert('chat_reads', {
        workspace_id: wid,
        channel_id: channelId,
        user_id: req.user.id,
        last_read_at: now(),
      });
    }

    res.json({ channel, messages });
  });

  // POST /api/v1/chat/channels/:channelId/messages — send message
  app.post('/api/v1/chat/channels/:channelId/messages', async (req: Request, res: Response) => {
    if (!req.user) throw new HttpError(401, 'Not authenticated');
    const channelId = String(req.params.channelId);
    const wid = req.workspaceId;
    const body = postMessageSchema.parse(req.body);

    const channel = await db.one<ChatChannel>(
      'SELECT * FROM chat_channels WHERE id = ? AND workspace_id = ?',
      [channelId, wid],
    );
    if (!channel) throw new HttpError(404, 'Channel not found');

    const msgId = id();
    const timestamp = now();
    await db.insert('chat_messages', {
      id: msgId,
      workspace_id: wid,
      channel_id: channelId,
      sender_id: req.user.id,
      content: body.content,
      attachments: JSON.stringify(body.attachments),
      pinned: 0,
      created_at: timestamp,
      updated_at: timestamp,
    });

    // Update read state for sender
    const readExists = await db.one(
      'SELECT user_id FROM chat_reads WHERE channel_id = ? AND user_id = ?',
      [channelId, req.user.id],
    );
    if (readExists) {
      await db.run(
        'UPDATE chat_reads SET last_read_at = ? WHERE channel_id = ? AND user_id = ?',
        [timestamp, channelId, req.user.id],
      );
    } else {
      await db.insert('chat_reads', {
        workspace_id: wid,
        channel_id: channelId,
        user_id: req.user.id,
        last_read_at: timestamp,
      });
    }

    const senderTeam = await db.one<{ team_role: string }>(
      'SELECT team_role FROM employee_profiles WHERE workspace_id = ? AND user_id = ?',
      [wid, req.user.id],
    );

    const message: ChatMessage = {
      id: msgId,
      workspace_id: wid,
      channel_id: channelId,
      sender_id: req.user.id,
      sender_name: req.user.name,
      sender_color: req.user.color,
      sender_role: req.user.role,
      sender_team_role: senderTeam?.team_role,
      content: body.content,
      attachments: body.attachments,
      pinned: 0,
      created_at: timestamp,
      updated_at: timestamp,
    };

    if (io) {
      io.to(`workspace:${wid}`).emit('chat.message', message);
    }
    if (broadcast) broadcast(req);

    res.status(201).json(message);
  });

  // POST /api/v1/chat/channels/:channelId/read — mark read
  app.post('/api/v1/chat/channels/:channelId/read', async (req: Request, res: Response) => {
    if (!req.user) throw new HttpError(401, 'Not authenticated');
    const channelId = String(req.params.channelId);
    const wid = req.workspaceId;
    const timestamp = now();

    const readExists = await db.one(
      'SELECT user_id FROM chat_reads WHERE channel_id = ? AND user_id = ?',
      [channelId, req.user.id],
    );
    if (readExists) {
      await db.run(
        'UPDATE chat_reads SET last_read_at = ? WHERE channel_id = ? AND user_id = ?',
        [timestamp, channelId, req.user.id],
      );
    } else {
      await db.insert('chat_reads', {
        workspace_id: wid,
        channel_id: channelId,
        user_id: req.user.id,
        last_read_at: timestamp,
      });
    }

    res.json({ ok: true });
  });

  // DELETE /api/v1/chat/messages/:messageId — delete message
  app.delete('/api/v1/chat/messages/:messageId', async (req: Request, res: Response) => {
    if (!req.user) throw new HttpError(401, 'Not authenticated');
    const messageId = String(req.params.messageId);
    const wid = req.workspaceId;

    const message = await db.one<{ id: string; sender_id: string; channel_id: string }>(
      'SELECT id, sender_id, channel_id FROM chat_messages WHERE id = ? AND workspace_id = ?',
      [messageId, wid],
    );
    if (!message) throw new HttpError(404, 'Message not found');

    const isAdmin = ['owner', 'admin'].includes(req.user.role);
    if (message.sender_id !== req.user.id && !isAdmin) {
      throw new HttpError(403, 'You can only delete your own messages');
    }

    await db.run('DELETE FROM chat_messages WHERE id = ? AND workspace_id = ?', [messageId, wid]);

    if (io) {
      io.to(`workspace:${wid}`).emit('chat.message_deleted', { id: messageId, channel_id: message.channel_id });
    }
    if (broadcast) broadcast(req);

    res.json({ ok: true });
  });
}
