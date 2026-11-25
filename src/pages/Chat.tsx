import React, { useState, useEffect, useRef, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useParams, useNavigate } from 'react-router-dom';
import {
  MessageSquare,
  Hash,
  Users,
  FolderKanban,
  Plus,
  Send,
  Trash2,
  ExternalLink,
  Search,
  Sparkles,
  Pin,
  CornerUpLeft,
  Forward,
  Smile,
  Edit3,
  Paperclip,
  Image as ImageIcon,
  Film,
  Mic,
  MapPin,
  UserCheck,
  Sticker,
  Link as LinkIcon,
  Bold,
  Italic,
  Underline as UnderlineIcon,
  Strikethrough as StrikethroughIcon,
  Code,
  FileCode,
  Quote,
  List,
  CheckSquare,
  Table as TableIcon,
  Minus,
  ArrowRight as ArrowRightIcon,
  X,
  Play,
  Pause,
  Download,
} from 'lucide-react';
import { api, post, del, patch } from '../lib/api';
import { useGrace } from '../context';
import { Avatar, Badge, Button, Modal } from '../components/ui';
import type { ChatChannel, ChatMessage, ChatChannelKind, ChatAttachment } from '../../shared/types';
import { emitRealtimeEvent, useRealtimeEvent } from '../lib/useWorkspaceRealtime';

export function ChatPage() {
  const { channelId } = useParams();
  const navigate = useNavigate();
  const { data: ctx, connection, openIssue, toast } = useGrace();
  const qc = useQueryClient();

  const [activeChannelId, setActiveChannelId] = useState<string | null>(channelId || null);
  const [inputText, setInputText] = useState('');
  const [searchFilter, setSearchFilter] = useState('');
  const [inChannelSearch, setInChannelSearch] = useState('');
  const [typingUsers, setTypingUsers] = useState<Record<string, string>>({});

  // Modals state
  const [createOpen, setCreateOpen] = useState(false);
  const [newKind, setNewKind] = useState<ChatChannelKind>('team');
  const [newName, setNewName] = useState('');
  const [newDesc, setNewDesc] = useState('');
  const [newTeamId, setNewTeamId] = useState(ctx?.organization?.teams[0]?.id || '');
  const [newProjectId, setNewProjectId] = useState(ctx?.projects[0]?.id || '');

  // Direct message modal state
  const [dmModalOpen, setDmModalOpen] = useState(false);
  const [dmTargetUserId, setDmTargetUserId] = useState('');

  // Forward message modal state
  const [forwardMsg, setForwardMsg] = useState<ChatMessage | null>(null);
  const [forwardTargetChannelId, setForwardTargetChannelId] = useState('');

  // Message interaction states
  const [replyingTo, setReplyingTo] = useState<ChatMessage | null>(null);
  const [editingMsgId, setEditingMsgId] = useState<string | null>(null);
  const [editingText, setEditingText] = useState('');
  const [pendingAttachments, setPendingAttachments] = useState<ChatAttachment[]>([]);
  const [showEmojiPickerForMsg, setShowEmojiPickerForMsg] = useState<string | null>(null);
  const [attachmentModalType, setAttachmentModalType] = useState<string | null>(null);

  // Attachment inputs
  const [attachUrl, setAttachUrl] = useState('');
  const [attachName, setAttachName] = useState('');

  // Voice note simulator
  const [playingVoiceId, setPlayingVoiceId] = useState<string | null>(null);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const prevChannelRef = useRef<string | null>(null);
  const lastTypingSentRef = useRef(0);
  const typingTimeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const channelsQueryKey = ['chat-channels', ctx?.workspace.id] as const;

  // Load channels
  const { data: channelsData } = useQuery<{ channels: ChatChannel[] }>({
    queryKey: channelsQueryKey,
    queryFn: () => api('/chat/channels'),
    staleTime: 30000,
    refetchInterval: connection === 'connected' ? false : 15000,
  });

  const channels = channelsData?.channels || [];

  const selectChannel = (nextId: string) => {
    setActiveChannelId(nextId);
    setTypingUsers({});
    qc.setQueryData(
      channelsQueryKey,
      (old: { channels: ChatChannel[] } | undefined) =>
        old
          ? {
              ...old,
              channels: old.channels.map((c) =>
                c.id === nextId ? { ...c, unread_count: 0 } : c,
              ),
            }
          : old,
    );
    navigate(`/chat/${nextId}`);
  };

  // Pick first channel if none selected
  useEffect(() => {
    if (!activeChannelId && channels.length > 0) {
      const general = channels.find((c) => c.kind === 'general') || channels[0];
      setActiveChannelId(general.id);
    }
  }, [channels, activeChannelId]);

  useEffect(() => {
    if (channelId && channelId !== activeChannelId) {
      setActiveChannelId(channelId);
      setTypingUsers({});
    }
  }, [channelId, activeChannelId]);

  useEffect(() => {
    if (!newTeamId && ctx?.organization?.teams[0]?.id) {
      setNewTeamId(ctx.organization.teams[0].id);
    }
    if (!newProjectId && ctx?.projects[0]?.id) {
      setNewProjectId(ctx.projects[0].id);
    }
  }, [ctx?.organization?.teams, ctx?.projects, newTeamId, newProjectId]);

  // Load messages for active channel
  const { data: messagesData, isLoading: loadingMessages } = useQuery<{
    channel: ChatChannel;
    messages: ChatMessage[];
  }>({
    queryKey: ['chat-messages', activeChannelId],
    queryFn: () => api(`/chat/channels/${activeChannelId}/messages`),
    enabled: !!activeChannelId,
    staleTime: 30000,
    refetchInterval: connection === 'connected' ? false : 15000,
  });

  const messages = messagesData?.messages || [];
  const currentChannel = messagesData?.channel || channels.find((c) => c.id === activeChannelId);

  // Real-time event handlers backed by shared Socket.IO connection
  useRealtimeEvent('chat.message', (msg: ChatMessage) => {
    if (msg.channel_id === activeChannelId) {
      setTypingUsers((prev) => {
        if (!prev[msg.sender_id]) return prev;
        const next = { ...prev };
        delete next[msg.sender_id];
        return next;
      });
    }

    qc.setQueryData(
      ['chat-messages', msg.channel_id],
      (old: { channel: ChatChannel; messages: ChatMessage[] } | undefined) => {
        if (!old) return old;
        if (old.messages.some((m) => m.id === msg.id)) return old;
        const optIdx = old.messages.findIndex(
          (m) =>
            m.id.startsWith('opt-') &&
            m.sender_id === msg.sender_id &&
            m.content === msg.content,
        );
        if (optIdx >= 0) {
          const next = [...old.messages];
          next[optIdx] = msg;
          return { ...old, messages: next };
        }
        return { ...old, messages: [...old.messages, msg] };
      },
    );

    let channelKnown = false;
    qc.setQueryData(
      channelsQueryKey,
      (old: { channels: ChatChannel[] } | undefined) => {
        if (!old) return old;
        return {
          ...old,
          channels: old.channels.map((c) => {
            if (c.id !== msg.channel_id) return c;
            channelKnown = true;
            const incrementUnread =
              msg.channel_id !== activeChannelId && msg.sender_id !== ctx?.user.id;
            return {
              ...c,
              unread_count: incrementUnread ? (c.unread_count || 0) + 1 : 0,
              last_message: {
                id: msg.id,
                content: msg.content,
                sender_name: msg.sender_name || 'Member',
                created_at: msg.created_at,
              },
            };
          }),
        };
      },
    );
    if (!channelKnown) {
      void qc.invalidateQueries({ queryKey: channelsQueryKey });
    }
  });

  useRealtimeEvent(
    'chat.reaction',
    ({
      message_id,
      channel_id,
      reactions,
    }: {
      message_id: string;
      channel_id?: string;
      reactions?: Array<{ emoji: string; count: number; users: string[]; has_reacted?: boolean }>;
    }) => {
      const targetChannelId = channel_id || activeChannelId;
      if (!targetChannelId || !reactions) return;
      qc.setQueryData(
        ['chat-messages', targetChannelId],
        (old: { channel: ChatChannel; messages: ChatMessage[] } | undefined) => {
          if (!old) return old;
          return {
            ...old,
            messages: old.messages.map((m) =>
              m.id === message_id
                ? {
                    ...m,
                    reactions: reactions.map((r) => ({
                      ...r,
                      has_reacted: ctx?.user.id ? r.users.includes(ctx.user.id) : false,
                    })),
                  }
                : m,
            ),
          };
        },
      );
    },
  );

  useRealtimeEvent('chat.message_updated', (updatedMsg: ChatMessage) => {
    qc.setQueryData(
      ['chat-messages', updatedMsg.channel_id],
      (old: { channel: ChatChannel; messages: ChatMessage[] } | undefined) => {
        if (!old) return old;
        return {
          ...old,
          messages: old.messages.map((m) =>
            m.id === updatedMsg.id ? { ...m, ...updatedMsg } : m,
          ),
        };
      },
    );
  });

  useRealtimeEvent(
    'chat.message_pinned',
    ({
      message_id,
      channel_id,
      pinned,
    }: {
      message_id: string;
      channel_id?: string;
      pinned: number;
    }) => {
      const targetChannelId = channel_id || activeChannelId;
      if (!targetChannelId) return;
      qc.setQueryData(
        ['chat-messages', targetChannelId],
        (old: { channel: ChatChannel; messages: ChatMessage[] } | undefined) => {
          if (!old) return old;
          return {
            ...old,
            messages: old.messages.map((m) => (m.id === message_id ? { ...m, pinned } : m)),
          };
        },
      );
    },
  );

  useRealtimeEvent(
    'chat.message_deleted',
    (payload: { id?: string; message_id?: string; channel_id?: string }) => {
      const deletedId = payload.id || payload.message_id;
      const targetChannelId = payload.channel_id || activeChannelId;
      if (!deletedId || !targetChannelId) return;
      qc.setQueryData(
        ['chat-messages', targetChannelId],
        (old: { channel: ChatChannel; messages: ChatMessage[] } | undefined) => {
          if (!old) return old;
          return {
            ...old,
            messages: old.messages.filter((m) => m.id !== deletedId),
          };
        },
      );
    },
  );

  useRealtimeEvent('chat.channel_created', (newChannel: ChatChannel) => {
    qc.setQueryData(
      channelsQueryKey,
      (old: { channels: ChatChannel[] } | undefined) => {
        if (!old || old.channels.some((c) => c.id === newChannel.id)) return old;
        return { ...old, channels: [...old.channels, newChannel] };
      },
    );
  });

  useRealtimeEvent(
    'chat.read',
    ({ channel_id, user_id }: { channel_id: string; user_id: string }) => {
      if (user_id !== ctx?.user.id) return;
      qc.setQueryData(
        channelsQueryKey,
        (old: { channels: ChatChannel[] } | undefined) =>
          old
            ? {
                ...old,
                channels: old.channels.map((c) =>
                  c.id === channel_id ? { ...c, unread_count: 0 } : c,
                ),
              }
            : old,
      );
    },
  );

  useRealtimeEvent(
    'chat.typing',
    (payload: { channel_id: string; user_id: string; user_name: string; is_typing: boolean }) => {
      if (payload.channel_id !== activeChannelId || payload.user_id === ctx?.user.id) return;
      setTypingUsers((prev) => {
        const next = { ...prev };
        if (payload.is_typing) next[payload.user_id] = payload.user_name;
        else delete next[payload.user_id];
        return next;
      });
    },
  );

  // Instant scroll on channel switch, smooth scroll on new messages
  useEffect(() => {
    const channelSwitched = prevChannelRef.current !== activeChannelId;
    prevChannelRef.current = activeChannelId;
    messagesEndRef.current?.scrollIntoView({
      behavior: channelSwitched ? 'auto' : 'smooth',
    });
  }, [messages.length, activeChannelId]);

  // Send message mutation (optimistic)
  const sendMutation = useMutation({
    mutationFn: (payload: {
      content: string;
      reply_to_id?: string;
      attachments?: ChatAttachment[];
      tempId: string;
    }) =>
      post<ChatMessage>(`/chat/channels/${activeChannelId}/messages`, {
        content: payload.content,
        reply_to_id: payload.reply_to_id,
        attachments: payload.attachments,
      }),
    onMutate: (payload) => {
      const targetChannelId = activeChannelId || '';
      const previousReply = replyingTo;
      const previousAttachments = pendingAttachments;
      setInputText('');
      if (textareaRef.current) textareaRef.current.style.height = 'auto';
      setReplyingTo(null);
      setPendingAttachments([]);
      clearTimeout(typingTimeoutRef.current);
      if (targetChannelId) {
        emitRealtimeEvent('chat.typing', { channel_id: targetChannelId, is_typing: false });
      }
      const optimistic: ChatMessage = {
        id: payload.tempId,
        workspace_id: ctx?.workspace.id || '',
        channel_id: targetChannelId,
        sender_id: ctx?.user.id || '',
        sender_name: ctx?.user.name || 'You',
        sender_color: ctx?.user.color || '#0f5f44',
        sender_role: ctx?.user.role || 'member',
        sender_team_role: ctx?.user.team_role,
        reply_to_id: payload.reply_to_id || null,
        reply_to: previousReply
          ? {
              id: previousReply.id,
              sender_name: previousReply.sender_name || 'Member',
              content: previousReply.content.slice(0, 140),
            }
          : null,
        edited: 0,
        content: payload.content,
        attachments: payload.attachments || [],
        pinned: 0,
        reactions: [],
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      qc.setQueryData(
        ['chat-messages', targetChannelId],
        (old: { channel: ChatChannel; messages: ChatMessage[] } | undefined) =>
          old ? { ...old, messages: [...old.messages, optimistic] } : old,
      );
      return {
        tempId: payload.tempId,
        targetChannelId,
        content: payload.content,
        previousReply,
        previousAttachments,
      };
    },
    onSuccess: (newMsg, _vars, context) => {
      const targetChannelId = context?.targetChannelId || activeChannelId;
      qc.setQueryData(
        ['chat-messages', targetChannelId],
        (old: { channel: ChatChannel; messages: ChatMessage[] } | undefined) => {
          if (!old) return old;
          const alreadyExists = old.messages.some((m) => m.id === newMsg.id);
          return {
            ...old,
            messages: alreadyExists
              ? old.messages.filter((m) => m.id !== context?.tempId)
              : old.messages.map((m) => (m.id === context?.tempId ? newMsg : m)),
          };
        },
      );
    },
    onError: (err, _vars, context) => {
      if (context) {
        setInputText(context.content);
        setReplyingTo(context.previousReply);
        setPendingAttachments(context.previousAttachments);
        qc.setQueryData(
          ['chat-messages', context.targetChannelId],
          (old: { channel: ChatChannel; messages: ChatMessage[] } | undefined) =>
            old
              ? { ...old, messages: old.messages.filter((m) => m.id !== context.tempId) }
              : old,
        );
      }
      toast((err as Error).message || 'Could not send message.', true);
    },
  });

  // Delete message mutation (optimistic)
  const deleteMutation = useMutation({
    mutationFn: (msgId: string) => del(`/chat/messages/${msgId}`),
    onMutate: (msgId) => {
      const targetChannelId = activeChannelId;
      qc.setQueryData(
        ['chat-messages', targetChannelId],
        (old: { channel: ChatChannel; messages: ChatMessage[] } | undefined) =>
          old ? { ...old, messages: old.messages.filter((m) => m.id !== msgId) } : old,
      );
      return { targetChannelId };
    },
    onError: (err, _vars, context) => {
      void qc.invalidateQueries({ queryKey: ['chat-messages', context?.targetChannelId] });
      toast((err as Error).message || 'Could not delete message.', true);
    },
  });

  // Edit message mutation (optimistic)
  const editMutation = useMutation({
    mutationFn: ({ messageId, content }: { messageId: string; content: string }) =>
      patch<ChatMessage>(`/chat/messages/${messageId}`, { content }),
    onMutate: ({ messageId, content }) => {
      const targetChannelId = activeChannelId;
      setEditingMsgId(null);
      setEditingText('');
      qc.setQueryData(
        ['chat-messages', targetChannelId],
        (old: { channel: ChatChannel; messages: ChatMessage[] } | undefined) =>
          old
            ? {
                ...old,
                messages: old.messages.map((m) =>
                  m.id === messageId ? { ...m, content, edited: 1 } : m,
                ),
              }
            : old,
      );
      return { targetChannelId };
    },
    onError: (err, _vars, context) => {
      void qc.invalidateQueries({ queryKey: ['chat-messages', context?.targetChannelId] });
      toast((err as Error).message || 'Could not edit message.', true);
    },
  });

  // Toggle reaction mutation (optimistic)
  const toggleReactionMutation = useMutation({
    mutationFn: ({ messageId, emoji }: { messageId: string; emoji: string }) =>
      post(`/chat/messages/${messageId}/reactions`, { emoji }),
    onMutate: ({ messageId, emoji }) => {
      const targetChannelId = activeChannelId;
      const uid = ctx?.user.id || '';
      qc.setQueryData(
        ['chat-messages', targetChannelId],
        (old: { channel: ChatChannel; messages: ChatMessage[] } | undefined) => {
          if (!old) return old;
          return {
            ...old,
            messages: old.messages.map((m) => {
              if (m.id !== messageId) return m;
              const reactions = [...(m.reactions || [])];
              const idx = reactions.findIndex((r) => r.emoji === emoji);
              if (idx >= 0) {
                const existing = reactions[idx];
                if (existing.has_reacted) {
                  if (existing.count <= 1) reactions.splice(idx, 1);
                  else {
                    reactions[idx] = {
                      ...existing,
                      count: existing.count - 1,
                      users: existing.users.filter((u) => u !== uid),
                      has_reacted: false,
                    };
                  }
                } else {
                  reactions[idx] = {
                    ...existing,
                    count: existing.count + 1,
                    users: [...existing.users, uid],
                    has_reacted: true,
                  };
                }
              } else {
                reactions.push({ emoji, count: 1, users: [uid], has_reacted: true });
              }
              return { ...m, reactions };
            }),
          };
        },
      );
      return { targetChannelId };
    },
    onError: (_err, _vars, context) => {
      void qc.invalidateQueries({ queryKey: ['chat-messages', context?.targetChannelId] });
    },
  });

  // Toggle pin mutation (optimistic)
  const pinMutation = useMutation({
    mutationFn: (messageId: string) => post(`/chat/messages/${messageId}/pin`, {}),
    onMutate: (messageId) => {
      const targetChannelId = activeChannelId;
      qc.setQueryData(
        ['chat-messages', targetChannelId],
        (old: { channel: ChatChannel; messages: ChatMessage[] } | undefined) =>
          old
            ? {
                ...old,
                messages: old.messages.map((m) =>
                  m.id === messageId ? { ...m, pinned: m.pinned ? 0 : 1 } : m,
                ),
              }
            : old,
      );
      return { targetChannelId };
    },
    onError: (_err, _vars, context) => {
      void qc.invalidateQueries({ queryKey: ['chat-messages', context?.targetChannelId] });
    },
  });

  // Forward message mutation
  const forwardMutation = useMutation({
    mutationFn: () =>
      post(`/chat/messages/${forwardMsg?.id}/forward`, {
        target_channel_id: forwardTargetChannelId,
      }),
    onSuccess: () => {
      setForwardMsg(null);
      setForwardTargetChannelId('');
      toast('Message forwarded.');
    },
  });

  // Create channel mutation
  const createChannelMutation = useMutation({
    mutationFn: () =>
      post<ChatChannel>('/chat/channels', {
        name: newName,
        kind: newKind,
        team_id: newKind === 'team' ? newTeamId : null,
        project_id: newKind === 'project' ? newProjectId : null,
        description: newDesc,
      }),
    onSuccess: (ch) => {
      setCreateOpen(false);
      setNewName('');
      setNewDesc('');
      qc.setQueryData(
        channelsQueryKey,
        (old: { channels: ChatChannel[] } | undefined) =>
          old && !old.channels.some((c) => c.id === ch.id)
            ? { ...old, channels: [...old.channels, ch] }
            : old,
      );
      selectChannel(ch.id);
    },
  });

  // Create or get DM mutation
  const createDmMutation = useMutation({
    mutationFn: (targetUserId: string) =>
      post<ChatChannel>('/chat/direct', { target_user_id: targetUserId }),
    onSuccess: (ch) => {
      setDmModalOpen(false);
      setDmTargetUserId('');
      qc.setQueryData(
        channelsQueryKey,
        (old: { channels: ChatChannel[] } | undefined) =>
          old && !old.channels.some((c) => c.id === ch.id)
            ? { ...old, channels: [...old.channels, ch] }
            : old,
      );
      selectChannel(ch.id);
    },
  });

  const handleSend = () => {
    if (!inputText.trim() && pendingAttachments.length === 0) return;
    sendMutation.mutate({
      content: inputText.trim(),
      reply_to_id: replyingTo ? replyingTo.id : undefined,
      attachments: pendingAttachments.length > 0 ? pendingAttachments : undefined,
      tempId: `opt-${Date.now()}-${Math.random()}`,
    });
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value;
    setInputText(val);
    e.target.style.height = 'auto';
    e.target.style.height = `${Math.min(e.target.scrollHeight, 140)}px`;
    if (!activeChannelId) return;
    const nowTs = Date.now();
    if (nowTs - lastTypingSentRef.current > 1600 && val.trim()) {
      lastTypingSentRef.current = nowTs;
      emitRealtimeEvent('chat.typing', { channel_id: activeChannelId, is_typing: true });
    }
    clearTimeout(typingTimeoutRef.current);
    typingTimeoutRef.current = setTimeout(() => {
      emitRealtimeEvent('chat.typing', { channel_id: activeChannelId, is_typing: false });
    }, 2000);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const issueLookup = useMemo(() => {
    const map = new Map<string, { id: string; key: string; summary: string }>();
    for (const issue of ctx?.issues || []) map.set(issue.key, issue);
    return map;
  }, [ctx?.issues]);

  const typingNames = Object.values(typingUsers);

  // Formatting insert helper
  const insertFormatting = (prefix: string, suffix: string = '') => {
    if (!textareaRef.current) return;
    const el = textareaRef.current;
    const start = el.selectionStart;
    const end = el.selectionEnd;
    const val = inputText;
    const selected = val.substring(start, end);
    const replacement = prefix + selected + suffix;
    setInputText(val.substring(0, start) + replacement + val.substring(end));
    setTimeout(() => {
      el.focus();
      el.setSelectionRange(start + prefix.length, end + prefix.length);
    }, 0);
  };

  // Group channels by category
  const filteredChannels = channels.filter((c) =>
    (c.displayName || c.name).toLowerCase().includes(searchFilter.toLowerCase()),
  );
  const generalChannels = filteredChannels.filter((c) => c.kind === 'general');
  const teamChannels = filteredChannels.filter((c) => c.kind === 'team');
  const projectChannels = filteredChannels.filter((c) => c.kind === 'project');
  const directChannels = filteredChannels.filter((c) => c.kind === 'direct');

  // Filter messages by in-channel search
  const displayedMessages = inChannelSearch.trim()
    ? messages.filter((m) =>
        m.content.toLowerCase().includes(inChannelSearch.toLowerCase()) ||
        m.sender_name?.toLowerCase().includes(inChannelSearch.toLowerCase()),
      )
    : messages;

  const pinnedMessages = messages.filter((m) => m.pinned === 1);

  // Render markdown text
  const renderMessageContent = (text: string) => {
    const lines = text.split('\n');
    return lines.map((line, lineIdx) => {
      // Horizontal rule
      if (line.trim() === '---' || line.trim() === '***') {
        return <hr key={lineIdx} />;
      }
      // Blockquote
      if (line.startsWith('> ')) {
        return <blockquote key={lineIdx}>{renderSpans(line.substring(2))}</blockquote>;
      }
      // Checklist
      if (line.startsWith('- [ ] ') || line.startsWith('- [x] ')) {
        const checked = line.startsWith('- [x] ');
        return (
          <div key={lineIdx} style={{ display: 'flex', alignItems: 'center', gap: 6, margin: '2px 0' }}>
            <input type="checkbox" readOnly checked={checked} />
            <span>{renderSpans(line.substring(6))}</span>
          </div>
        );
      }
      // Bullet list
      if (line.startsWith('- ') || line.startsWith('* ')) {
        return (
          <div key={lineIdx} style={{ display: 'flex', alignItems: 'center', gap: 6, margin: '2px 0' }}>
            <span style={{ fontSize: 18, lineHeight: 1 }}>•</span>
            <span>{renderSpans(line.substring(2))}</span>
          </div>
        );
      }
      // Regular line
      return (
        <div key={lineIdx} style={{ minHeight: line ? undefined : '0.8em' }}>
          {renderSpans(line)}
        </div>
      );
    });
  };

  const renderSpans = (text: string) => {
    // Replace arrow syntax
    let res = text.replace(/->/g, '→').replace(/<-/g, '←');

    // Split on code blocks / inline code, bold, italic, mentions, hashtags, issue keys
    const tokenRegex = /(`[^`]+`|\*\*[^*]+\*\*|\*[^*]+\*|<u>[^<]+<\/u>|~~[^~]+~~|@[A-Za-z0-9_.-]+|#[A-Za-z0-9_-]+|[A-Z]{2,10}-\d+)/g;
    const parts = res.split(tokenRegex);

    return parts.map((part, i) => {
      if (!part) return null;
      // Inline code
      if (part.startsWith('`') && part.endsWith('`') && part.length >= 2) {
        return <code key={i}>{part.slice(1, -1)}</code>;
      }
      // Bold
      if (part.startsWith('**') && part.endsWith('**') && part.length >= 4) {
        return <strong key={i}>{part.slice(2, -2)}</strong>;
      }
      // Italic
      if (part.startsWith('*') && part.endsWith('*') && part.length >= 2) {
        return <em key={i}>{part.slice(1, -1)}</em>;
      }
      // Underline
      if (part.startsWith('<u>') && part.endsWith('</u>')) {
        return <u key={i}>{part.slice(3, -4)}</u>;
      }
      // Strikethrough
      if (part.startsWith('~~') && part.endsWith('~~') && part.length >= 4) {
        return <del key={i}>{part.slice(2, -2)}</del>;
      }
      // Mention
      if (part.startsWith('@')) {
        return (
          <span
            key={i}
            style={{
              fontWeight: 600,
              color: 'var(--green)',
              background: 'var(--green-light)',
              padding: '1px 5px',
              borderRadius: 4,
            }}
          >
            {part}
          </span>
        );
      }
      // Hashtag
      if (part.startsWith('#') && !/^[A-Z]{2,10}-\d+$/.test(part.substring(1))) {
        return (
          <span
            key={i}
            style={{
              fontWeight: 600,
              color: 'var(--blue, #38bdf8)',
              background: 'var(--blue-light, rgba(56, 189, 248, 0.15))',
              padding: '1px 5px',
              borderRadius: 4,
            }}
          >
            {part}
          </span>
        );
      }
      // Issue key
      const matchedIssue = issueLookup.get(part);
      if (matchedIssue) {
        return (
          <button
            key={i}
            className="chat-issue-tag"
            onClick={() => openIssue(matchedIssue.id)}
            title={`${matchedIssue.key}: ${matchedIssue.summary}`}
          >
            <span>#{part}</span>
            <ExternalLink size={10} />
          </button>
        );
      }
      return <span key={i}>{part}</span>;
    });
  };

  return (
    <div className="chat-page">
      {/* Sidebar */}
      <aside className="chat-sidebar">
        <div className="chat-sidebar-header">
          <div className="chat-sidebar-title">
            <MessageSquare size={18} />
            <span>Chat Channels</span>
          </div>
          <div className="chat-sidebar-actions">
            <button
              className="chat-new-channel-btn"
              title="New Channel"
              onClick={() => setCreateOpen(true)}
            >
              <Plus size={15} />
            </button>
          </div>
        </div>

        <div className="chat-search-wrap">
          <input
            className="chat-search-input"
            placeholder="Search channels or DMs…"
            value={searchFilter}
            onChange={(e) => setSearchFilter(e.target.value)}
          />
        </div>

        <div className="chat-channels-list">
          {/* General / Workspace */}
          {generalChannels.length > 0 && (
            <div>
              <div className="chat-channel-group-header">
                <span className="chat-channel-group-title">Workspace</span>
              </div>
              {generalChannels.map((c) => (
                <button
                  key={c.id}
                  className={`chat-channel-item ${c.id === activeChannelId ? 'active' : ''}`}
                  onClick={() => selectChannel(c.id)}
                >
                  <div className="chat-channel-left">
                    <Hash size={15} />
                    <span className="chat-channel-name">{c.name}</span>
                  </div>
                  {!!c.unread_count && c.unread_count > 0 && (
                    <span className="chat-unread-badge">{c.unread_count}</span>
                  )}
                </button>
              ))}
            </div>
          )}

          {/* Direct Messages (1-on-1) */}
          <div>
            <div className="chat-channel-group-header">
              <span className="chat-channel-group-title">Direct Messages</span>
              <button
                className="chat-group-add-btn"
                title="New Direct Message"
                onClick={() => setDmModalOpen(true)}
              >
                <Plus size={13} />
              </button>
            </div>
            {directChannels.length === 0 ? (
              <div style={{ padding: '4px 8px', fontSize: 12, color: 'var(--muted)' }}>
                No direct messages yet.
              </div>
            ) : (
              directChannels.map((c) => (
                <button
                  key={c.id}
                  className={`chat-channel-item ${c.id === activeChannelId ? 'active' : ''}`}
                  onClick={() => selectChannel(c.id)}
                >
                  <div className="chat-channel-left">
                    <Avatar
                      user={{
                        name: c.displayName || c.name,
                        color: c.target_user?.color || '#10b981',
                      }}
                      size={20}
                    />
                    <span className="chat-channel-name">{c.displayName || c.name}</span>
                  </div>
                  {!!c.unread_count && c.unread_count > 0 && (
                    <span className="chat-unread-badge">{c.unread_count}</span>
                  )}
                </button>
              ))
            )}
          </div>

          {/* Team Channels */}
          {teamChannels.length > 0 && (
            <div>
              <div className="chat-channel-group-header">
                <span className="chat-channel-group-title">Team Channels</span>
              </div>
              {teamChannels.map((c) => {
                const team = ctx?.organization?.teams.find((t) => t.id === c.team_id);
                return (
                  <button
                    key={c.id}
                    className={`chat-channel-item ${c.id === activeChannelId ? 'active' : ''}`}
                    onClick={() => selectChannel(c.id)}
                  >
                    <div className="chat-channel-left">
                      <span
                        style={{
                          width: 8,
                          height: 8,
                          borderRadius: '50%',
                          background: team?.color || '#10b981',
                          flexShrink: 0,
                        }}
                      />
                      <span className="chat-channel-name">#{c.name}</span>
                    </div>
                    {!!c.unread_count && c.unread_count > 0 && (
                      <span className="chat-unread-badge">{c.unread_count}</span>
                    )}
                  </button>
                );
              })}
            </div>
          )}

          {/* Project Multi-team Rooms */}
          {projectChannels.length > 0 && (
            <div>
              <div className="chat-channel-group-header">
                <span className="chat-channel-group-title">Project Collaboration</span>
              </div>
              {projectChannels.map((c) => {
                return (
                  <button
                    key={c.id}
                    className={`chat-channel-item ${c.id === activeChannelId ? 'active' : ''}`}
                    onClick={() => selectChannel(c.id)}
                  >
                    <div className="chat-channel-left">
                      <FolderKanban size={14} />
                      <span className="chat-channel-name">#{c.name}</span>
                    </div>
                    {!!c.unread_count && c.unread_count > 0 && (
                      <span className="chat-unread-badge">{c.unread_count}</span>
                    )}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </aside>

      {/* Main Chat Feed */}
      <main className="chat-main">
        {currentChannel ? (
          <>
            <header className="chat-header">
              <div className="chat-header-info">
                <div className="chat-header-title">
                  {currentChannel.kind === 'direct' ? (
                    <Avatar
                      user={{
                        name: currentChannel.displayName || currentChannel.name,
                        color: currentChannel.target_user?.color || '#10b981',
                      }}
                      size={24}
                    />
                  ) : currentChannel.kind === 'team' ? (
                    <Users size={18} />
                  ) : currentChannel.kind === 'project' ? (
                    <FolderKanban size={18} />
                  ) : (
                    <Hash size={18} />
                  )}
                  <span>
                    {currentChannel.kind === 'direct' ? currentChannel.displayName : `#${currentChannel.name}`}
                  </span>
                  <Badge tone={currentChannel.kind === 'direct' ? 'neutral' : 'info'}>
                    {currentChannel.kind}
                  </Badge>
                </div>
                {currentChannel.description && (
                  <div className="chat-header-desc">{currentChannel.description}</div>
                )}
              </div>

              <div className="chat-header-actions">
                <span
                  className={`chat-live-pill ${connection === 'connected' ? 'live' : 'offline'}`}
                  title={connection === 'connected' ? 'Real-time updates active' : 'Reconnecting…'}
                >
                  <i />
                  {connection === 'connected' ? 'Live' : 'Syncing'}
                </span>
                <div className="chat-search-header-box">
                  <Search size={13} style={{ color: 'var(--muted)' }} />
                  <input
                    placeholder="Search in chat…"
                    value={inChannelSearch}
                    onChange={(e) => setInChannelSearch(e.target.value)}
                  />
                  {inChannelSearch && (
                    <button
                      style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--muted)', padding: 0 }}
                      onClick={() => setInChannelSearch('')}
                    >
                      <X size={12} />
                    </button>
                  )}
                </div>
              </div>
            </header>

            {/* Pinned Messages Banner */}
            {pinnedMessages.length > 0 && (
              <div className="chat-pinned-banner">
                <div className="chat-pinned-content">
                  <Pin size={13} style={{ color: 'var(--amber, #f59e0b)' }} />
                  <strong>{pinnedMessages.length} Pinned</strong>
                  <span>{pinnedMessages[pinnedMessages.length - 1].content.slice(0, 60)}…</span>
                </div>
              </div>
            )}

            {/* Messages Feed */}
            <div className="chat-messages-container">
              {loadingMessages ? (
                <div className="chat-empty-feed">Loading messages…</div>
              ) : displayedMessages.length === 0 ? (
                <div className="chat-empty-feed">
                  <MessageSquare size={36} />
                  <p>
                    {inChannelSearch
                      ? `No messages matching "${inChannelSearch}"`
                      : `No messages in ${currentChannel.displayName || currentChannel.name} yet.`}
                  </p>
                  <small>Send the first message to start the conversation!</small>
                </div>
              ) : (
                displayedMessages.map((msg) => {
                  const isSelf = msg.sender_id === ctx?.user.id;
                  const isPending = msg.id.startsWith('opt-');
                  const canDelete = !isPending && (isSelf || ['owner', 'admin'].includes(ctx?.user.role || ''));

                  return (
                    <div
                      key={msg.id}
                      className={`chat-message-row ${msg.pinned ? 'is-pinned' : ''} ${isPending ? 'is-pending' : ''}`}
                    >
                      <div
                        className="chat-avatar"
                        style={{ background: msg.sender_color || '#10b981' }}
                      >
                        {(msg.sender_name || 'U').charAt(0).toUpperCase()}
                      </div>

                      <div className="chat-message-content-wrap">
                        {/* Parent Reply Preview */}
                        {msg.reply_to && (
                          <div className="chat-reply-parent">
                            <CornerUpLeft size={11} />
                            <strong>{msg.reply_to.sender_name}:</strong>
                            <span>{msg.reply_to.content.slice(0, 50)}</span>
                          </div>
                        )}

                        {/* Forward Attribution */}
                        {msg.forwarded_from && (
                          <div className="chat-forwarded-pill">
                            <Forward size={11} />
                            <span>Forwarded from #{msg.forwarded_from}</span>
                          </div>
                        )}

                        <div className="chat-message-meta">
                          <span className="chat-message-sender">{msg.sender_name}</span>
                          {msg.sender_team_role && (
                            <span className="chat-role-pill">{msg.sender_team_role}</span>
                          )}
                          <span className="chat-message-time">
                            {new Date(msg.created_at).toLocaleTimeString([], {
                              hour: '2-digit',
                              minute: '2-digit',
                            })}
                          </span>
                          {!!msg.edited && <span className="chat-edited-pill">(edited)</span>}
                          {!!msg.pinned && (
                            <span className="chat-pinned-badge">
                              <Pin size={10} /> Pinned
                            </span>
                          )}
                        </div>

                        {/* Message Body or Inline Editor */}
                        {editingMsgId === msg.id ? (
                          <div style={{ marginTop: 4, display: 'flex', flexDirection: 'column', gap: 6 }}>
                            <textarea
                              className="chat-textarea"
                              style={{
                                border: '1px solid var(--border)',
                                borderRadius: 6,
                                padding: 8,
                                background: 'var(--surface)',
                              }}
                              value={editingText}
                              onChange={(e) => setEditingText(e.target.value)}
                            />
                            <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                              <Button
                                variant="secondary"
                                onClick={() => setEditingMsgId(null)}
                              >
                                Cancel
                              </Button>
                              <Button
                                busy={editMutation.isPending}
                                onClick={() =>
                                  editMutation.mutate({ messageId: msg.id, content: editingText.trim() })
                                }
                              >
                                Save
                              </Button>
                            </div>
                          </div>
                        ) : (
                          <div className="chat-message-body">
                            {renderMessageContent(msg.content)}
                          </div>
                        )}

                        {/* Attachments rendering */}
                        {msg.attachments && msg.attachments.length > 0 && (
                          <div className="chat-attachments-list">
                            {msg.attachments.map((att, idx) => {
                              const parsed: ChatAttachment =
                                typeof att === 'string'
                                  ? { id: String(idx), name: att, type: 'file', url: att }
                                  : att;

                              if (parsed.type === 'image') {
                                return (
                                  <img
                                    key={parsed.id || idx}
                                    src={parsed.url}
                                    alt={parsed.name}
                                    className="chat-attachment-image"
                                    onClick={() => window.open(parsed.url, '_blank')}
                                  />
                                );
                              }
                              if (parsed.type === 'video') {
                                return (
                                  <video
                                    key={parsed.id || idx}
                                    src={parsed.url}
                                    controls
                                    style={{ maxWidth: 320, borderRadius: 8, border: '1px solid var(--border)' }}
                                  />
                                );
                              }
                              if (parsed.type === 'audio') {
                                const isPlaying = playingVoiceId === (parsed.id || String(idx));
                                return (
                                  <div key={parsed.id || idx} className="chat-voice-note-player">
                                    <button
                                      className="chat-action-btn"
                                      onClick={() =>
                                        setPlayingVoiceId(isPlaying ? null : parsed.id || String(idx))
                                      }
                                    >
                                      {isPlaying ? <Pause size={14} /> : <Play size={14} />}
                                    </button>
                                    <div className="chat-voice-waveform">
                                      {[8, 14, 22, 12, 18, 24, 16, 10, 20, 14, 8, 16].map((h, bIdx) => (
                                        <div
                                          key={bIdx}
                                          className="chat-voice-bar"
                                          style={{
                                            height: isPlaying ? Math.max(6, (h * 1.3) % 24) : h,
                                          }}
                                        />
                                      ))}
                                    </div>
                                    <span style={{ fontSize: 11, color: 'var(--muted)' }}>
                                      {isPlaying ? 'Playing…' : '0:14'}
                                    </span>
                                  </div>
                                );
                              }
                              if (parsed.type === 'sticker') {
                                return (
                                  <img
                                    key={parsed.id || idx}
                                    src={parsed.url}
                                    alt="Sticker"
                                    className="chat-sticker-img"
                                  />
                                );
                              }
                              if (parsed.type === 'location') {
                                return (
                                  <div key={parsed.id || idx} className="chat-location-card">
                                    <MapPin size={20} style={{ color: 'var(--green)' }} />
                                    <div>
                                      <strong>{parsed.name || 'Shared Location'}</strong>
                                      <div style={{ fontSize: 11, color: 'var(--muted)' }}>
                                        {parsed.url || '37.7749° N, 122.4194° W'}
                                      </div>
                                    </div>
                                  </div>
                                );
                              }
                              if (parsed.type === 'contact') {
                                return (
                                  <div key={parsed.id || idx} className="chat-contact-card">
                                    <UserCheck size={20} style={{ color: 'var(--blue, #38bdf8)' }} />
                                    <div>
                                      <strong>{parsed.name}</strong>
                                      <div style={{ fontSize: 11, color: 'var(--muted)' }}>
                                        {parsed.url || 'Contact Info'}
                                      </div>
                                    </div>
                                  </div>
                                );
                              }
                              // Document / File / Link
                              return (
                                <a
                                  key={parsed.id || idx}
                                  href={parsed.url || '#'}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="chat-attachment-file"
                                >
                                  <Paperclip size={16} />
                                  <div style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                    <div>{parsed.name}</div>
                                    {parsed.size && (
                                      <small style={{ color: 'var(--muted)' }}>
                                        {(parsed.size / 1024).toFixed(1)} KB
                                      </small>
                                    )}
                                  </div>
                                  <Download size={14} style={{ color: 'var(--muted)' }} />
                                </a>
                              );
                            })}
                          </div>
                        )}

                        {/* Reactions Bar */}
                        {msg.reactions && msg.reactions.length > 0 && (
                          <div className="chat-reactions-row">
                            {msg.reactions.map((r) => (
                              <button
                                key={r.emoji}
                                className={`chat-reaction-pill ${r.has_reacted ? 'reacted' : ''}`}
                                onClick={() =>
                                  toggleReactionMutation.mutate({ messageId: msg.id, emoji: r.emoji })
                                }
                              >
                                <span>{r.emoji}</span>
                                <span>{r.count}</span>
                              </button>
                            ))}
                            <button
                              className="chat-reaction-add-btn"
                              title="Add reaction"
                              onClick={() => setShowEmojiPickerForMsg(msg.id)}
                            >
                              <Smile size={12} />
                            </button>
                          </div>
                        )}
                      </div>

                      {/* Hover Action Bar */}
                      <div className="chat-action-bar">
                        {/* Quick Reaction buttons */}
                        {['👍', '❤️', '🚀', '👀'].map((emoji) => (
                          <button
                            key={emoji}
                            className="chat-action-btn"
                            title={`React with ${emoji}`}
                            onClick={() =>
                              toggleReactionMutation.mutate({ messageId: msg.id, emoji })
                            }
                          >
                            <span>{emoji}</span>
                          </button>
                        ))}

                        <button
                          className="chat-action-btn"
                          title="More reactions"
                          onClick={() => setShowEmojiPickerForMsg(msg.id)}
                        >
                          <Smile size={13} />
                        </button>

                        <button
                          className="chat-action-btn"
                          title="Reply"
                          onClick={() => setReplyingTo(msg)}
                        >
                          <CornerUpLeft size={13} />
                        </button>

                        <button
                          className="chat-action-btn"
                          title="Forward message"
                          onClick={() => {
                            setForwardMsg(msg);
                            setForwardTargetChannelId(
                              channels.find((c) => c.id !== activeChannelId)?.id || '',
                            );
                          }}
                        >
                          <Forward size={13} />
                        </button>

                        <button
                          className="chat-action-btn"
                          title={msg.pinned ? 'Unpin' : 'Pin'}
                          onClick={() => pinMutation.mutate(msg.id)}
                        >
                          <Pin size={13} style={{ color: msg.pinned ? 'var(--amber, #f59e0b)' : undefined }} />
                        </button>

                        {isSelf && (
                          <button
                            className="chat-action-btn"
                            title="Edit message"
                            onClick={() => {
                              setEditingMsgId(msg.id);
                              setEditingText(msg.content);
                            }}
                          >
                            <Edit3 size={13} />
                          </button>
                        )}

                        {canDelete && (
                          <button
                            className="chat-action-btn delete"
                            title="Delete message"
                            onClick={() => deleteMutation.mutate(msg.id)}
                          >
                            <Trash2 size={13} />
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })
              )}
              <div ref={messagesEndRef} />
            </div>

            {/* Composer Bar */}
            <footer className="chat-composer">
              {/* Replying Banner */}
              {replyingTo && (
                <div className="chat-reply-banner">
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <CornerUpLeft size={13} />
                    <span>
                      Replying to <strong>{replyingTo.sender_name}</strong>: "{replyingTo.content.slice(0, 60)}"
                    </span>
                  </div>
                  <button
                    style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--muted)' }}
                    onClick={() => setReplyingTo(null)}
                  >
                    <X size={13} />
                  </button>
                </div>
              )}

              {/* Pending Attachments */}
              {pendingAttachments.length > 0 && (
                <div className="chat-pending-attachments">
                  {pendingAttachments.map((att, idx) => (
                    <div key={idx} className="chat-pending-chip">
                      <Paperclip size={12} />
                      <span>{att.name}</span>
                      <button
                        style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--muted)' }}
                        onClick={() =>
                          setPendingAttachments((prev) => prev.filter((_, i) => i !== idx))
                        }
                      >
                        <X size={11} />
                      </button>
                    </div>
                  ))}
                </div>
              )}

              {/* Formatting Toolbar */}
              <div className="chat-formatting-toolbar">
                <button
                  className="chat-tool-btn"
                  title="Bold (**text**)"
                  onClick={() => insertFormatting('**', '**')}
                >
                  <Bold size={13} />
                </button>
                <button
                  className="chat-tool-btn"
                  title="Italic (*text*)"
                  onClick={() => insertFormatting('*', '*')}
                >
                  <Italic size={13} />
                </button>
                <button
                  className="chat-tool-btn"
                  title="Underline (<u>text</u>)"
                  onClick={() => insertFormatting('<u>', '</u>')}
                >
                  <UnderlineIcon size={13} />
                </button>
                <button
                  className="chat-tool-btn"
                  title="Strikethrough (~~text~~)"
                  onClick={() => insertFormatting('~~', '~~')}
                >
                  <StrikethroughIcon size={13} />
                </button>
                <button
                  className="chat-tool-btn"
                  title="Inline code (`code`)"
                  onClick={() => insertFormatting('`', '`')}
                >
                  <Code size={13} />
                </button>
                <button
                  className="chat-tool-btn"
                  title="Code block"
                  onClick={() => insertFormatting('```\n', '\n```')}
                >
                  <FileCode size={13} />
                </button>
                <button
                  className="chat-tool-btn"
                  title="Quote (> text)"
                  onClick={() => insertFormatting('> ')}
                >
                  <Quote size={13} />
                </button>
                <button
                  className="chat-tool-btn"
                  title="Bullet list"
                  onClick={() => insertFormatting('- ')}
                >
                  <List size={13} />
                </button>
                <button
                  className="chat-tool-btn"
                  title="Checklist"
                  onClick={() => insertFormatting('- [ ] ')}
                >
                  <CheckSquare size={13} />
                </button>
                <button
                  className="chat-tool-btn"
                  title="Table"
                  onClick={() =>
                    insertFormatting('| Column 1 | Column 2 |\n|---|---|\n| Item 1 | Item 2 |\n')
                  }
                >
                  <TableIcon size={13} />
                </button>
                <button
                  className="chat-tool-btn"
                  title="Horizontal rule"
                  onClick={() => insertFormatting('\n---\n')}
                >
                  <Minus size={13} />
                </button>
                <button
                  className="chat-tool-btn"
                  title="Arrow (→)"
                  onClick={() => insertFormatting('→ ')}
                >
                  <ArrowRightIcon size={13} />
                </button>

                <div className="chat-tool-divider" />

                {/* Media and attachments pickers */}
                <button
                  className="chat-tool-btn"
                  title="Attach File / Document"
                  onClick={() => setAttachmentModalType('file')}
                >
                  <Paperclip size={13} />
                </button>
                <button
                  className="chat-tool-btn"
                  title="Attach Image"
                  onClick={() => setAttachmentModalType('image')}
                >
                  <ImageIcon size={13} />
                </button>
                <button
                  className="chat-tool-btn"
                  title="Attach Video"
                  onClick={() => setAttachmentModalType('video')}
                >
                  <Film size={13} />
                </button>
                <button
                  className="chat-tool-btn"
                  title="Send Voice Note"
                  onClick={() => {
                    setPendingAttachments((prev) => [
                      ...prev,
                      {
                        id: `voice-${Date.now()}`,
                        name: 'Voice Note (0:14)',
                        type: 'audio',
                        url: '#voice-note',
                      },
                    ]);
                  }}
                >
                  <Mic size={13} />
                </button>
                <button
                  className="chat-tool-btn"
                  title="Send Sticker"
                  onClick={() => setAttachmentModalType('sticker')}
                >
                  <Sticker size={13} />
                </button>
                <button
                  className="chat-tool-btn"
                  title="Share Location"
                  onClick={() => setAttachmentModalType('location')}
                >
                  <MapPin size={13} />
                </button>
                <button
                  className="chat-tool-btn"
                  title="Share Contact"
                  onClick={() => setAttachmentModalType('contact')}
                >
                  <UserCheck size={13} />
                </button>
                <button
                  className="chat-tool-btn"
                  title="Share Link"
                  onClick={() => setAttachmentModalType('link')}
                >
                  <LinkIcon size={13} />
                </button>
              </div>

              {typingNames.length > 0 && (
                <div className="chat-typing-indicator">
                  {typingNames.length === 1
                    ? `${typingNames[0]} is typing…`
                    : `${typingNames.join(', ')} are typing…`}
                </div>
              )}

              {/* Text Input Box */}
              <div className="chat-input-box">
                <textarea
                  ref={textareaRef}
                  className="chat-textarea"
                  rows={1}
                  placeholder={`Message ${currentChannel.displayName || '#' + currentChannel.name} (type issue keys like DCP-1 to link)…`}
                  value={inputText}
                  onChange={handleInputChange}
                  onKeyDown={handleKeyDown}
                />
                <button
                  className="chat-send-btn"
                  onClick={handleSend}
                  disabled={!inputText.trim() && pendingAttachments.length === 0}
                  title="Send message (Enter)"
                >
                  <Send size={15} />
                </button>
              </div>

              <div className="chat-input-hints">
                <span>
                  Press <strong>Enter</strong> to send, <strong>Shift+Enter</strong> for newline
                </span>
                {ctx?.issues[0] && (
                  <button
                    className="chat-quick-tag-btn"
                    onClick={() => setInputText((t) => `${t} #${ctx.issues[0].key} `)}
                  >
                    <Sparkles size={11} />
                    Tag #{ctx.issues[0].key}
                  </button>
                )}
              </div>
            </footer>
          </>
        ) : (
          <div className="chat-empty-feed">
            <MessageSquare size={48} />
            <p>Select a channel or direct message on the left to start chatting.</p>
          </div>
        )}
      </main>

      {/* Direct Message (DM) Modal */}
      {dmModalOpen && (
        <Modal title="New Direct Message" onClose={() => setDmModalOpen(false)}>
          <div className="team-member-modal-form">
            <p style={{ fontSize: 13, color: 'var(--muted)', margin: 0 }}>
              Choose a workspace member to start a 1-on-1 private conversation.
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 300, overflowY: 'auto', marginTop: 10 }}>
              {ctx?.members
                .filter((m) => m.id !== ctx?.user.id && m.active !== false)
                .map((m) => (
                  <button
                    key={m.id}
                    className="chat-channel-item"
                    style={{ border: '1px solid var(--border)' }}
                    onClick={() => createDmMutation.mutate(m.id)}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <Avatar user={m} size={28} />
                      <div>
                        <strong>{m.name}</strong>
                        <div style={{ fontSize: 11, color: 'var(--muted)' }}>{m.email}</div>
                      </div>
                    </div>
                  </button>
                ))}
            </div>
          </div>
        </Modal>
      )}

      {/* Forward Message Modal */}
      {forwardMsg && (
        <Modal title="Forward Message" onClose={() => setForwardMsg(null)}>
          <div className="team-member-modal-form">
            <p style={{ fontSize: 13, color: 'var(--muted)', margin: 0 }}>
              Forward message: "{forwardMsg.content.slice(0, 80)}"
            </p>
            <div className="team-member-modal-field" style={{ marginTop: 12 }}>
              <label>Select Destination Channel / DM</label>
              <select
                value={forwardTargetChannelId}
                onChange={(e) => setForwardTargetChannelId(e.target.value)}
              >
                <option value="">Select a channel…</option>
                {channels
                  .filter((c) => c.id !== activeChannelId)
                  .map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.displayName || `#${c.name}`} ({c.kind})
                    </option>
                  ))}
              </select>
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 14 }}>
              <Button variant="secondary" onClick={() => setForwardMsg(null)}>
                Cancel
              </Button>
              <Button
                disabled={!forwardTargetChannelId || forwardMutation.isPending}
                busy={forwardMutation.isPending}
                onClick={() => forwardMutation.mutate()}
              >
                Forward Message
              </Button>
            </div>
          </div>
        </Modal>
      )}

      {/* Attachment Modal */}
      {attachmentModalType && (
        <Modal
          title={`Attach ${attachmentModalType.charAt(0).toUpperCase() + attachmentModalType.slice(1)}`}
          onClose={() => {
            setAttachmentModalType(null);
            setAttachUrl('');
            setAttachName('');
          }}
        >
          <div className="team-member-modal-form">
            {attachmentModalType === 'sticker' ? (
              <div>
                <p style={{ fontSize: 13, color: 'var(--muted)' }}>Choose a sticker to send:</p>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10 }}>
                  {[
                    'https://images.unsplash.com/photo-1534447677768-be436bb09401?w=100&auto=format&fit=crop',
                    'https://images.unsplash.com/photo-1579783900882-c0d3dad7b119?w=100&auto=format&fit=crop',
                    'https://images.unsplash.com/photo-1563089145-599997674d42?w=100&auto=format&fit=crop',
                    'https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?w=100&auto=format&fit=crop',
                  ].map((url, sIdx) => (
                    <button
                      key={sIdx}
                      style={{ padding: 4, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8, cursor: 'pointer' }}
                      onClick={() => {
                        setPendingAttachments((prev) => [
                          ...prev,
                          { id: `sticker-${Date.now()}`, name: 'Sticker', type: 'sticker', url },
                        ]);
                        setAttachmentModalType(null);
                      }}
                    >
                      <img src={url} alt="Sticker" style={{ width: '100%', height: 60, objectFit: 'cover', borderRadius: 6 }} />
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <>
                <div className="team-member-modal-field">
                  <label>{attachmentModalType === 'contact' ? 'Contact Name' : 'Name / Label'}</label>
                  <input
                    placeholder={attachmentModalType === 'contact' ? 'e.g. Jane Doe' : 'e.g. Project Architecture'}
                    value={attachName}
                    onChange={(e) => setAttachName(e.target.value)}
                  />
                </div>
                <div className="team-member-modal-field">
                  <label>
                    {attachmentModalType === 'location'
                      ? 'Location / Address / Coordinates'
                      : attachmentModalType === 'contact'
                        ? 'Email / Phone / Details'
                        : 'File / Media URL'}
                  </label>
                  <input
                    placeholder={
                      attachmentModalType === 'location'
                        ? 'e.g. San Francisco Office, 4th Floor'
                        : attachmentModalType === 'contact'
                          ? 'jane@example.com'
                          : 'https://example.com/asset.png'
                    }
                    value={attachUrl}
                    onChange={(e) => setAttachUrl(e.target.value)}
                  />
                </div>
                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 14 }}>
                  <Button
                    variant="secondary"
                    onClick={() => {
                      setAttachmentModalType(null);
                      setAttachUrl('');
                      setAttachName('');
                    }}
                  >
                    Cancel
                  </Button>
                  <Button
                    disabled={!attachName.trim()}
                    onClick={() => {
                      setPendingAttachments((prev) => [
                        ...prev,
                        {
                          id: `att-${Date.now()}`,
                          name: attachName.trim(),
                          type: attachmentModalType as any,
                          url: attachUrl.trim() || undefined,
                        },
                      ]);
                      setAttachmentModalType(null);
                      setAttachUrl('');
                      setAttachName('');
                    }}
                  >
                    Add Attachment
                  </Button>
                </div>
              </>
            )}
          </div>
        </Modal>
      )}

      {/* Emoji Picker Popup Modal */}
      {showEmojiPickerForMsg && (
        <Modal
          title="Add Reaction"
          onClose={() => setShowEmojiPickerForMsg(null)}
        >
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: 10, padding: 8 }}>
            {['👍', '👎', '❤️', '🔥', '🎉', '🚀', '👀', '💡', '👏', '🙌', '✨', '💯', '✅', '❌', '⚡', '🌟', '🎯', '🤔'].map(
              (emoji) => (
                <button
                  key={emoji}
                  style={{
                    fontSize: 24,
                    padding: '8px 0',
                    borderRadius: 8,
                    border: '1px solid var(--border)',
                    background: 'var(--surface)',
                    cursor: 'pointer',
                  }}
                  onClick={() => {
                    toggleReactionMutation.mutate({ messageId: showEmojiPickerForMsg, emoji });
                    setShowEmojiPickerForMsg(null);
                  }}
                >
                  {emoji}
                </button>
              ),
            )}
          </div>
        </Modal>
      )}

      {/* Create Channel Modal */}
      {createOpen && (
        <Modal title="Create Chat Channel" onClose={() => setCreateOpen(false)}>
          <div className="team-member-modal-form">
            <div className="team-member-modal-field">
              <label>Channel Type</label>
              <select
                value={newKind}
                onChange={(e) => setNewKind(e.target.value as ChatChannelKind)}
              >
                <option value="team">Team Channel</option>
                <option value="project">Project Collaboration Channel</option>
                <option value="general">General Channel</option>
              </select>
            </div>

            {newKind === 'team' && (
              <div className="team-member-modal-field">
                <label>Team</label>
                <select value={newTeamId} onChange={(e) => setNewTeamId(e.target.value)}>
                  {ctx?.organization?.teams.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {newKind === 'project' && (
              <div className="team-member-modal-field">
                <label>Project</label>
                <select value={newProjectId} onChange={(e) => setNewProjectId(e.target.value)}>
                  {ctx?.projects.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} ({p.key})
                    </option>
                  ))}
                </select>
              </div>
            )}

            <div className="team-member-modal-field">
              <label>Channel Name</label>
              <input
                placeholder="e.g. sprint-planning or qa-sync"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
              />
            </div>

            <div className="team-member-modal-field">
              <label>Description</label>
              <input
                placeholder="What is this channel for?"
                value={newDesc}
                onChange={(e) => setNewDesc(e.target.value)}
              />
            </div>

            <Button
              disabled={!newName.trim() || createChannelMutation.isPending}
              onClick={() => createChannelMutation.mutate()}
            >
              Create Channel
            </Button>
          </div>
        </Modal>
      )}
    </div>
  );
}
