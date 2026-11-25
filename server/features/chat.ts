import type { Express, Request, Response } from 'express';
import type { Server } from 'socket.io';
import { z } from 'zod';
import type { Database } from '../db.js';
import { HttpError } from '../auth.js';
import { id, now } from '../seed.js';
import type { ChatChannel, ChatMessage, ChatReaction, ChatAttachment, Project } from '../../shared/types.js';

const createChannelSchema = z.object({
  name: z.string().trim().min(2).max(120),
  kind: z.enum(['team', 'project', 'direct', 'general', 'topic']),
  team_id: z.string().optional().nullable(),
  project_id: z.string().optional().nullable(),
  description: z.string().trim().max(1000).default(''),
});

const postMessageSchema = z.object({
  content: z.string().max(10000).default(''),
  attachments: z.array(z.union([z.string(), z.record(z.string(), z.unknown())])).default([]),
  reply_to_id: z.string().optional().nullable(),
});

async function fetchMessageReactions(
  db: Database,
  messageId: string,
  workspaceId: string,
  currentUserId: string,
): Promise<ChatReaction[]> {
  const rows = await db.all<{ emoji: string; user_id: string }>(
    'SELECT emoji, user_id FROM chat_reactions WHERE message_id = ? AND workspace_id = ?',
    [messageId, workspaceId],
  );

  const map = new Map<string, string[]>();
  for (const r of rows) {
    const list = map.get(r.emoji) || [];
    list.push(r.user_id);
    map.set(r.emoji, list);
  }

  const reactions: ChatReaction[] = [];
  for (const [emoji, users] of map.entries()) {
    reactions.push({
      emoji,
      count: users.length,
      users,
      has_reacted: users.includes(currentUserId),
    });
  }
  return reactions;
}

async function fetchEnrichedMessage(
  db: Database,
  messageId: string,
  workspaceId: string,
  currentUserId: string,
): Promise<ChatMessage | null> {
  const r = await db.one<{
    id: string;
    workspace_id: string;
    channel_id: string;
    sender_id: string;
    reply_to_id: string | null;
    forwarded_from: string | null;
    edited: number;
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
     WHERE m.id = ? AND m.workspace_id = ?`,
    [messageId, workspaceId],
  );
  if (!r) return null;

  let replyTo: { id: string; sender_name: string; content: string } | null = null;
  if (r.reply_to_id) {
    const parent = await db.one<{ id: string; content: string; sender_name: string }>(
      `SELECT m.id, m.content, u.name AS sender_name
       FROM chat_messages m
       JOIN users u ON u.id = m.sender_id
       WHERE m.id = ? AND m.workspace_id = ?`,
      [r.reply_to_id, workspaceId],
    );
    if (parent) {
      replyTo = {
        id: parent.id,
        sender_name: parent.sender_name,
        content: parent.content.slice(0, 140),
      };
    }
  }

  const reactions = await fetchMessageReactions(db, r.id, workspaceId, currentUserId);

  let parsedAttachments: (ChatAttachment | string)[] = [];
  try {
    parsedAttachments = JSON.parse(r.attachments || '[]');
  } catch {
    parsedAttachments = [];
  }

  return {
    id: r.id,
    workspace_id: r.workspace_id,
    channel_id: r.channel_id,
    sender_id: r.sender_id,
    sender_name: r.sender_name,
    sender_color: r.sender_color,
    sender_role: r.sender_role,
    sender_team_role: r.sender_team_role || undefined,
    reply_to_id: r.reply_to_id,
    reply_to: replyTo,
    forwarded_from: r.forwarded_from,
    edited: r.edited || 0,
    content: r.content,
    attachments: parsedAttachments,
    pinned: r.pinned,
    reactions,
    created_at: r.created_at,
    updated_at: r.updated_at,
  };
}

async function markChannelRead(
  db: Database,
  workspaceId: string,
  channelId: string,
  userId: string,
  timestamp = now(),
) {
  const existing = await db.one(
    'SELECT user_id FROM chat_reads WHERE channel_id = ? AND user_id = ?',
    [channelId, userId],
  );
  if (existing) {
    await db.run(
      'UPDATE chat_reads SET last_read_at = ? WHERE channel_id = ? AND user_id = ?',
      [timestamp, channelId, userId],
    );
  } else {
    await db.insert('chat_reads', {
      workspace_id: workspaceId,
      channel_id: channelId,
      user_id: userId,
      last_read_at: timestamp,
    });
  }
  return timestamp;
}

export function registerChatRoutes(
  app: Express,
  db: Database,
  io?: Server,
  broadcast?: (req: Request) => void,
  visibleProjects?: (req: Request) => Promise<Project[]>,
) {
  async function getVisibleProjectIds(req: Request): Promise<Set<string> | null> {
    if (!visibleProjects) return null;
    const list = await visibleProjects(req);
    return new Set(list.map((p) => p.id));
  }

  function canAccessChannel(
    req: Request,
    ch: ChatChannel,
    visibleProjectIds: Set<string> | null,
  ): boolean {
    if (ch.kind === 'direct') return ch.name.includes(req.user.id);
    if (['owner', 'admin'].includes(req.user.role)) return true;
    if (ch.kind === 'team' && ch.team_id && req.user.team_id && ch.team_id !== req.user.team_id) {
      return false;
    }
    if (ch.kind === 'project' && ch.project_id && visibleProjectIds) {
      return visibleProjectIds.has(ch.project_id);
    }
    return true;
  }
  // Helper to ensure initial default channels exist
  async function ensureDefaultChannels(workspaceId: string, userId: string) {
    const [existing, teams, projects] = await Promise.all([
      db.all<{ id: string; kind: string; team_id: string | null; project_id: string | null }>(
        'SELECT id, kind, team_id, project_id FROM chat_channels WHERE workspace_id = ?',
        [workspaceId],
      ),
      db.all<{ id: string; name: string }>(
        'SELECT id, name FROM organization_teams WHERE workspace_id = ?',
        [workspaceId],
      ),
      db.all<{ id: string; key: string; name: string }>(
        'SELECT id, `key`, name FROM projects WHERE workspace_id = ? AND archived_at IS NULL',
        [workspaceId],
      ),
    ]);

    const ts = now();
    if (!existing.some((c) => c.kind === 'general')) {
      await db.insert('chat_channels', {
        id: id(),
        workspace_id: workspaceId,
        name: 'general',
        kind: 'general',
        team_id: null,
        project_id: null,
        description: 'General discussion for all workspace members',
        created_by: userId,
        created_at: ts,
        updated_at: ts,
      });
    }

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
          created_at: ts,
          updated_at: ts,
        });
      }
    }

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
          created_at: ts,
          updated_at: ts,
        });
      }
    }
  }

  // GET /api/v1/chat/channels — list accessible channels with batched unread counts & previews
  app.get('/api/v1/chat/channels', async (req: Request, res: Response) => {
    if (!req.user) throw new HttpError(401, 'Not authenticated');
    const wid = req.workspaceId;
    const uid = req.user.id;

    await ensureDefaultChannels(wid, uid);

    const [allChannels, visibleProjectIds, workspaceUsers, unreadRows, latestMsgs] =
      await Promise.all([
        db.all<ChatChannel>(
          `SELECT c.* FROM chat_channels c WHERE c.workspace_id = ? ORDER BY c.kind, c.name`,
          [wid],
        ),
        getVisibleProjectIds(req),
        db.all<{ id: string; name: string; color: string; email: string }>(
          'SELECT u.id, u.name, u.color, u.email FROM users u JOIN memberships m ON m.user_id = u.id WHERE m.workspace_id = ?',
          [wid],
        ),
        db.all<{ channel_id: string; count: number }>(
          `SELECT m.channel_id, COUNT(*) AS count
           FROM chat_messages m
           LEFT JOIN chat_reads r ON r.channel_id = m.channel_id AND r.user_id = ? AND r.workspace_id = m.workspace_id
           WHERE m.workspace_id = ? AND m.sender_id != ? AND m.created_at > COALESCE(r.last_read_at, '2000-01-01T00:00:00Z')
           GROUP BY m.channel_id`,
          [uid, wid, uid],
        ),
        db.all<{
          channel_id: string;
          id: string;
          content: string;
          sender_name: string;
          created_at: string;
        }>(
          `SELECT m.channel_id, m.id, m.content, u.name AS sender_name, m.created_at
           FROM chat_messages m
           JOIN users u ON u.id = m.sender_id
           JOIN (
             SELECT channel_id, MAX(created_at) AS max_created_at
             FROM chat_messages
             WHERE workspace_id = ?
             GROUP BY channel_id
           ) latest ON latest.channel_id = m.channel_id AND m.created_at = latest.max_created_at
           WHERE m.workspace_id = ?`,
          [wid, wid],
        ),
      ]);

    const accessibleChannels = allChannels.filter((c) =>
      canAccessChannel(req, c, visibleProjectIds),
    );

    const userMap = new Map(workspaceUsers.map((u) => [u.id, u]));
    const unreadMap = new Map(unreadRows.map((r) => [r.channel_id, Number(r.count || 0)]));
    const lastMsgMap = new Map<
      string,
      { id: string; content: string; sender_name: string; created_at: string }
    >();
    for (const msg of latestMsgs) {
      if (!lastMsgMap.has(msg.channel_id)) {
        lastMsgMap.set(msg.channel_id, {
          id: msg.id,
          content: msg.content,
          sender_name: msg.sender_name,
          created_at: msg.created_at,
        });
      }
    }

    const enriched = accessibleChannels.map((c) => {
      let displayName = c.name;
      if (c.kind === 'direct') {
        const parts = c.name.replace('dm-', '').split('-');
        const otherId = parts.find((p) => p !== uid) || parts[0];
        const otherUser = userMap.get(otherId);
        if (otherUser) displayName = otherUser.name;
      }
      return {
        ...c,
        name: displayName,
        unread_count: unreadMap.get(c.id) ?? 0,
        last_message: lastMsgMap.get(c.id) || null,
      };
    });

    res.json({ channels: enriched });
  });

  // POST /api/v1/chat/channels — create custom channel
  app.post('/api/v1/chat/channels', async (req: Request, res: Response) => {
    if (!req.user) throw new HttpError(401, 'Not authenticated');
    const body = createChannelSchema.parse(req.body);
    const wid = req.workspaceId;
    const uid = req.user.id;
    if (
      body.kind === 'project' &&
      body.project_id &&
      !(await getVisibleProjectIds(req))?.has(body.project_id)
    ) {
      throw new HttpError(403, 'You do not have access to this project.');
    }
    if (
      body.kind === 'team' &&
      body.team_id &&
      !['owner', 'admin'].includes(req.user.role) &&
      body.team_id !== req.user.team_id
    ) {
      throw new HttpError(403, 'You can only create chat channels for your own team.');
    }
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

    res.status(201).json(channel);
  });

  // POST /api/v1/chat/direct — get or create 1-on-1 private chat channel
  app.post('/api/v1/chat/direct', async (req: Request, res: Response) => {
    if (!req.user) throw new HttpError(401, 'Not authenticated');
    const wid = req.workspaceId;
    const uid = req.user.id;
    const body = z.object({ target_user_id: z.string().min(1) }).parse(req.body);

    const targetUser = await db.one<{ id: string; name: string; color: string; email: string }>(
      'SELECT id, name, color, email FROM users WHERE id = ?',
      [body.target_user_id],
    );
    if (!targetUser) throw new HttpError(404, 'User not found');

    const uids = [uid, targetUser.id].sort();
    const dmName = `dm-${uids[0]}-${uids[1]}`;

    let channel = await db.one<ChatChannel>(
      'SELECT * FROM chat_channels WHERE workspace_id = ? AND kind = ? AND name = ?',
      [wid, 'direct', dmName],
    );

    if (!channel) {
      const channelId = id();
      await db.insert('chat_channels', {
        id: channelId,
        workspace_id: wid,
        name: dmName,
        kind: 'direct',
        team_id: null,
        project_id: null,
        description: `Direct chat with ${targetUser.name}`,
        created_by: uid,
        created_at: now(),
        updated_at: now(),
      });
      channel = await db.one<ChatChannel>('SELECT * FROM chat_channels WHERE id = ?', [channelId]);
    }

    res.json({
      ...channel,
      name: targetUser.name,
      target_user: targetUser,
    });
  });

  // GET /api/v1/chat/messages/search — search messages in channel or globally
  app.get('/api/v1/chat/messages/search', async (req: Request, res: Response) => {
    if (!req.user) throw new HttpError(401, 'Not authenticated');
    const wid = req.workspaceId;
    const q = String(req.query.q || '').trim();
    const channelId = req.query.channel_id ? String(req.query.channel_id) : undefined;
    if (!q) return res.json({ query: '', items: [], messages: [] });

    const sql = `
      SELECT m.*, u.name AS sender_name, u.color AS sender_color, c.name AS channel_name, c.kind AS channel_kind, c.team_id AS channel_team_id, c.project_id AS channel_project_id
      FROM chat_messages m
      JOIN users u ON u.id = m.sender_id
      JOIN chat_channels c ON c.id = m.channel_id
      WHERE m.workspace_id = ? AND m.content LIKE ? ${channelId ? 'AND m.channel_id = ?' : ''}
      ORDER BY m.created_at DESC LIMIT 50
    `;
    const params = channelId ? [wid, `%${q}%`, channelId] : [wid, `%${q}%`];
    const rawRows = await db.all<Record<string, unknown>>(sql, params);
    const visibleProjectIds = await getVisibleProjectIds(req);
    const rows = rawRows.filter((r) =>
      canAccessChannel(
        req,
        {
          id: String(r.channel_id),
          workspace_id: wid,
          name: String(r.channel_name),
          kind: r.channel_kind as ChatChannel['kind'],
          team_id: r.channel_team_id ? String(r.channel_team_id) : null,
          project_id: r.channel_project_id ? String(r.channel_project_id) : null,
          description: '',
          created_by: '',
          created_at: '',
          updated_at: '',
        },
        visibleProjectIds,
      ),
    );

    res.json({ query: q, items: rows, messages: rows });
  });

  // GET /api/v1/chat/channels/:channelId/messages — message list
  app.get('/api/v1/chat/channels/:channelId/messages', async (req: Request, res: Response) => {
    if (!req.user) throw new HttpError(401, 'Not authenticated');
    const channelId = String(req.params.channelId);
    const wid = req.workspaceId;

    const [channel, visibleProjectIds] = await Promise.all([
      db.one<ChatChannel>(
        'SELECT * FROM chat_channels WHERE id = ? AND workspace_id = ?',
        [channelId, wid],
      ),
      getVisibleProjectIds(req),
    ]);
    if (!channel || !canAccessChannel(req, channel, visibleProjectIds))
      throw new HttpError(404, 'Channel not found');

    const descRows = await db.all<{
      id: string;
      workspace_id: string;
      channel_id: string;
      sender_id: string;
      reply_to_id: string | null;
      forwarded_from: string | null;
      edited: number;
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
       ORDER BY m.created_at DESC LIMIT 200`,
      [channelId, wid],
    );
    const rows = descRows.reverse();

    const msgIds = rows.map((r) => r.id);
    const replyIds = [...new Set(rows.map((r) => r.reply_to_id).filter(Boolean) as string[])];

    const [rxRows, replyRows] = await Promise.all([
      msgIds.length > 0
        ? db.all<{ message_id: string; emoji: string; user_id: string }>(
            `SELECT message_id, emoji, user_id FROM chat_reactions
             WHERE workspace_id = ? AND message_id IN (${msgIds.map(() => '?').join(',')})`,
            [wid, ...msgIds],
          )
        : Promise.resolve([]),
      replyIds.length > 0
        ? db.all<{ id: string; content: string; sender_name: string }>(
            `SELECT m.id, m.content, u.name AS sender_name
             FROM chat_messages m
             JOIN users u ON u.id = m.sender_id
             WHERE m.workspace_id = ? AND m.id IN (${replyIds.map(() => '?').join(',')})`,
            [wid, ...replyIds],
          )
        : Promise.resolve([]),
      markChannelRead(db, wid, channelId, req.user.id),
    ]);

    const reactionsMap = new Map<string, ChatReaction[]>();
    if (rxRows.length > 0) {
      const grouped = new Map<string, Map<string, string[]>>();
      for (const rx of rxRows) {
        if (!grouped.has(rx.message_id)) grouped.set(rx.message_id, new Map());
        const emMap = grouped.get(rx.message_id)!;
        const uList = emMap.get(rx.emoji) || [];
        uList.push(rx.user_id);
        emMap.set(rx.emoji, uList);
      }

      for (const [mId, emMap] of grouped.entries()) {
        const rList: ChatReaction[] = [];
        for (const [emoji, users] of emMap.entries()) {
          rList.push({
            emoji,
            count: users.length,
            users,
            has_reacted: users.includes(req.user.id),
          });
        }
        reactionsMap.set(mId, rList);
      }
    }

    const replyMap = new Map<string, { id: string; sender_name: string; content: string }>();
    for (const rp of replyRows) {
      replyMap.set(rp.id, {
        id: rp.id,
        sender_name: rp.sender_name,
        content: rp.content.slice(0, 140),
      });
    }

    const messages: ChatMessage[] = rows.map((r) => {
      let parsedAttachments: (ChatAttachment | string)[] = [];
      try {
        parsedAttachments = JSON.parse(r.attachments || '[]');
      } catch {
        parsedAttachments = [];
      }

      return {
        id: r.id,
        workspace_id: r.workspace_id,
        channel_id: r.channel_id,
        sender_id: r.sender_id,
        sender_name: r.sender_name,
        sender_color: r.sender_color,
        sender_role: r.sender_role,
        sender_team_role: r.sender_team_role || undefined,
        reply_to_id: r.reply_to_id,
        reply_to: r.reply_to_id ? replyMap.get(r.reply_to_id) || null : null,
        forwarded_from: r.forwarded_from,
        edited: r.edited || 0,
        content: r.content,
        attachments: parsedAttachments,
        pinned: r.pinned,
        reactions: reactionsMap.get(r.id) || [],
        created_at: r.created_at,
        updated_at: r.updated_at,
      };
    });

    res.json({ channel, messages });
  });

  // POST /api/v1/chat/channels/:channelId/messages — send message
  app.post('/api/v1/chat/channels/:channelId/messages', async (req: Request, res: Response) => {
    if (!req.user) throw new HttpError(401, 'Not authenticated');
    const channelId = String(req.params.channelId);
    const wid = req.workspaceId;
    const body = postMessageSchema.parse(req.body);

    const [channel, visibleProjectIds] = await Promise.all([
      db.one<ChatChannel>(
        'SELECT * FROM chat_channels WHERE id = ? AND workspace_id = ?',
        [channelId, wid],
      ),
      getVisibleProjectIds(req),
    ]);
    if (!channel || !canAccessChannel(req, channel, visibleProjectIds))
      throw new HttpError(404, 'Channel not found');

    const msgId = id();
    const timestamp = now();
    await db.insert('chat_messages', {
      id: msgId,
      workspace_id: wid,
      channel_id: channelId,
      sender_id: req.user.id,
      reply_to_id: body.reply_to_id || null,
      forwarded_from: null,
      edited: 0,
      content: body.content,
      attachments: JSON.stringify(body.attachments),
      pinned: 0,
      created_at: timestamp,
      updated_at: timestamp,
    });

    await markChannelRead(db, wid, channelId, req.user.id, timestamp);
    const message = await fetchEnrichedMessage(db, msgId, wid, req.user.id);

    if (io && message) {
      io.to(`workspace:${wid}`).emit('chat.message', message);
    }

    res.status(201).json(message);
  });

  // PATCH /api/v1/chat/messages/:messageId — edit message
  app.patch('/api/v1/chat/messages/:messageId', async (req: Request, res: Response) => {
    if (!req.user) throw new HttpError(401, 'Not authenticated');
    const messageId = String(req.params.messageId);
    const wid = req.workspaceId;
    const body = z.object({ content: z.string().trim().min(1).max(10000) }).parse(req.body);

    const message = await db.one<{ id: string; sender_id: string; channel_id: string }>(
      'SELECT id, sender_id, channel_id FROM chat_messages WHERE id = ? AND workspace_id = ?',
      [messageId, wid],
    );
    if (!message) throw new HttpError(404, 'Message not found');
    if (message.sender_id !== req.user.id) {
      throw new HttpError(403, 'You can only edit your own messages');
    }

    const timestamp = now();
    await db.run(
      'UPDATE chat_messages SET content = ?, edited = 1, updated_at = ? WHERE id = ? AND workspace_id = ?',
      [body.content, timestamp, messageId, wid],
    );

    const updated = await fetchEnrichedMessage(db, messageId, wid, req.user.id);
    if (io && updated) io.to(`workspace:${wid}`).emit('chat.message_updated', updated);

    res.json(updated);
  });

  // POST /api/v1/chat/messages/:messageId/pin — toggle pin message
  app.post('/api/v1/chat/messages/:messageId/pin', async (req: Request, res: Response) => {
    if (!req.user) throw new HttpError(401, 'Not authenticated');
    const messageId = String(req.params.messageId);
    const wid = req.workspaceId;

    const message = await db.one<{ id: string; pinned: number; channel_id: string }>(
      'SELECT id, pinned, channel_id FROM chat_messages WHERE id = ? AND workspace_id = ?',
      [messageId, wid],
    );
    if (!message) throw new HttpError(404, 'Message not found');

    const newPinned = message.pinned ? 0 : 1;
    await db.run(
      'UPDATE chat_messages SET pinned = ?, updated_at = ? WHERE id = ? AND workspace_id = ?',
      [newPinned, now(), messageId, wid],
    );

    if (io) {
      io.to(`workspace:${wid}`).emit('chat.message_pinned', {
        message_id: messageId,
        channel_id: message.channel_id,
        pinned: newPinned,
      });
    }

    res.json({ ok: true, pinned: newPinned });
  });

  // POST /api/v1/chat/messages/:messageId/reactions — toggle emoji reaction
  app.post('/api/v1/chat/messages/:messageId/reactions', async (req: Request, res: Response) => {
    if (!req.user) throw new HttpError(401, 'Not authenticated');
    const messageId = String(req.params.messageId);
    const wid = req.workspaceId;
    const body = z.object({ emoji: z.string().trim().min(1).max(32) }).parse(req.body);

    const message = await db.one<{ id: string; channel_id: string }>(
      'SELECT id, channel_id FROM chat_messages WHERE id = ? AND workspace_id = ?',
      [messageId, wid],
    );
    if (!message) throw new HttpError(404, 'Message not found');

    const existing = await db.one<{ id: string }>(
      'SELECT id FROM chat_reactions WHERE workspace_id = ? AND message_id = ? AND user_id = ? AND emoji = ?',
      [wid, messageId, req.user.id, body.emoji],
    );

    if (existing) {
      await db.run('DELETE FROM chat_reactions WHERE id = ?', [existing.id]);
    } else {
      await db.insert('chat_reactions', {
        id: id(),
        workspace_id: wid,
        message_id: messageId,
        user_id: req.user.id,
        emoji: body.emoji,
        created_at: now(),
      });
    }

    const reactions = await fetchMessageReactions(db, messageId, wid, req.user.id);
    const action = existing ? 'removed' : 'added';
    if (io) {
      io.to(`workspace:${wid}`).emit('chat.reaction', {
        message_id: messageId,
        channel_id: message.channel_id,
        action,
        emoji: body.emoji,
        user_id: req.user.id,
        reactions,
      });
    }

    res.json({ ok: true, action, reactions });
  });

  // POST /api/v1/chat/messages/:messageId/forward — forward message to another channel
  app.post('/api/v1/chat/messages/:messageId/forward', async (req: Request, res: Response) => {
    if (!req.user) throw new HttpError(401, 'Not authenticated');
    const messageId = String(req.params.messageId);
    const wid = req.workspaceId;
    const body = z.object({ target_channel_id: z.string().min(1) }).parse(req.body);

    const original = await db.one<{ id: string; content: string; attachments: string; sender_id: string }>(
      'SELECT id, content, attachments, sender_id FROM chat_messages WHERE id = ? AND workspace_id = ?',
      [messageId, wid],
    );
    if (!original) throw new HttpError(404, 'Original message not found');

    const [origSender, targetChannel, visibleProjectIds] = await Promise.all([
      db.one<{ name: string }>('SELECT name FROM users WHERE id = ?', [original.sender_id]),
      db.one<ChatChannel>('SELECT * FROM chat_channels WHERE id = ? AND workspace_id = ?', [
        body.target_channel_id,
        wid,
      ]),
      getVisibleProjectIds(req),
    ]);
    if (!targetChannel || !canAccessChannel(req, targetChannel, visibleProjectIds))
      throw new HttpError(404, 'Target channel not found');

    const newMsgId = id();
    const timestamp = now();
    await db.insert('chat_messages', {
      id: newMsgId,
      workspace_id: wid,
      channel_id: body.target_channel_id,
      sender_id: req.user.id,
      reply_to_id: null,
      forwarded_from: origSender?.name || 'Someone',
      edited: 0,
      content: original.content,
      attachments: original.attachments,
      pinned: 0,
      created_at: timestamp,
      updated_at: timestamp,
    });

    const msg = await fetchEnrichedMessage(db, newMsgId, wid, req.user.id);
    if (io && msg) io.to(`workspace:${wid}`).emit('chat.message', msg);

    res.status(201).json(msg);
  });

  // POST /api/v1/chat/channels/:channelId/read — mark read
  app.post('/api/v1/chat/channels/:channelId/read', async (req: Request, res: Response) => {
    if (!req.user) throw new HttpError(401, 'Not authenticated');
    const channelId = String(req.params.channelId);
    const timestamp = await markChannelRead(db, req.workspaceId, channelId, req.user.id);
    if (io) {
      io.to(`workspace:${req.workspaceId}`).emit('chat.read', {
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

    await db.run('DELETE FROM chat_reactions WHERE message_id = ? AND workspace_id = ?', [
      messageId,
      wid,
    ]);
    await db.run('DELETE FROM chat_messages WHERE id = ? AND workspace_id = ?', [messageId, wid]);

    if (io) {
      io.to(`workspace:${wid}`).emit('chat.message_deleted', {
        id: messageId,
        message_id: messageId,
        channel_id: message.channel_id,
      });
    }

    res.json({ ok: true });
  });
}
