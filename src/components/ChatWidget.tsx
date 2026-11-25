import { useState, useEffect, useRef, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { MessageSquare, Send, Trash2, ExternalLink } from 'lucide-react';
import { api, post, del } from '../lib/api';
import { useGrace } from '../context';
import type { ChatChannel, ChatMessage } from '../../shared/types';
import { emitRealtimeEvent, useRealtimeEvent } from '../lib/useWorkspaceRealtime';

interface ChatWidgetProps {
  channelId?: string;
  teamId?: string;
  projectId?: string;
  title?: string;
}

export function ChatWidget({ channelId, teamId, projectId, title }: ChatWidgetProps) {
  const { data: ctx, connection, openIssue } = useGrace();
  const qc = useQueryClient();
  const [inputText, setInputText] = useState('');
  const [typingUsers, setTypingUsers] = useState<Record<string, string>>({});
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const lastTypingSentRef = useRef(0);
  const typingTimeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const channelsQueryKey = ['chat-channels', ctx?.workspace.id] as const;

  const { data: channelsData } = useQuery<{ channels: ChatChannel[] }>({
    queryKey: channelsQueryKey,
    queryFn: () => api('/chat/channels'),
    staleTime: 30000,
    refetchInterval: connection === 'connected' ? false : 15000,
  });

  const channels = channelsData?.channels || [];
  const targetChannel =
    channels.find((c) => c.id === channelId) ||
    (teamId ? channels.find((c) => c.kind === 'team' && c.team_id === teamId) : null) ||
    (projectId ? channels.find((c) => c.kind === 'project' && c.project_id === projectId) : null) ||
    channels.find((c) => c.kind === 'general');

  const resolvedChannelId = targetChannel?.id;

  const { data: messagesData, isLoading } = useQuery<{
    channel: ChatChannel;
    messages: ChatMessage[];
  }>({
    queryKey: ['chat-messages', resolvedChannelId],
    queryFn: () => api(`/chat/channels/${resolvedChannelId}/messages`),
    enabled: !!resolvedChannelId,
    staleTime: 30000,
    refetchInterval: connection === 'connected' ? false : 15000,
  });

  const messages = messagesData?.messages || [];

  useRealtimeEvent('chat.message', (msg: ChatMessage) => {
    if (!resolvedChannelId || msg.channel_id !== resolvedChannelId) return;
    setTypingUsers((prev) => {
      if (!prev[msg.sender_id]) return prev;
      const next = { ...prev };
      delete next[msg.sender_id];
      return next;
    });
    qc.setQueryData(
      ['chat-messages', resolvedChannelId],
      (old: { channel: ChatChannel; messages: ChatMessage[] } | undefined) => {
        if (!old) return old;
        if (old.messages.some((m) => m.id === msg.id)) return old;
        const idx = old.messages.findIndex(
          (m) =>
            m.id.startsWith('opt-') &&
            m.sender_id === msg.sender_id &&
            m.content === msg.content,
        );
        if (idx >= 0) {
          const next = [...old.messages];
          next[idx] = msg;
          return { ...old, messages: next };
        }
        return { ...old, messages: [...old.messages, msg] };
      },
    );
  });

  useRealtimeEvent('chat.message_updated', (updatedMsg: ChatMessage) => {
    if (!resolvedChannelId || updatedMsg.channel_id !== resolvedChannelId) return;
    qc.setQueryData(
      ['chat-messages', resolvedChannelId],
      (old: { channel: ChatChannel; messages: ChatMessage[] } | undefined) =>
        old
          ? {
              ...old,
              messages: old.messages.map((m) =>
                m.id === updatedMsg.id ? { ...m, ...updatedMsg } : m,
              ),
            }
          : old,
    );
  });

  useRealtimeEvent(
    'chat.message_deleted',
    (payload: { id?: string; message_id?: string; channel_id?: string }) => {
      const deletedId = payload.id || payload.message_id;
      if (!deletedId || !resolvedChannelId) return;
      if (payload.channel_id && payload.channel_id !== resolvedChannelId) return;
      qc.setQueryData(
        ['chat-messages', resolvedChannelId],
        (old: { channel: ChatChannel; messages: ChatMessage[] } | undefined) =>
          old
            ? { ...old, messages: old.messages.filter((m) => m.id !== deletedId) }
            : old,
      );
    },
  );

  useRealtimeEvent(
    'chat.typing',
    (payload: { channel_id: string; user_id: string; user_name: string; is_typing: boolean }) => {
      if (payload.channel_id !== resolvedChannelId || payload.user_id === ctx?.user.id) return;
      setTypingUsers((prev) => {
        const next = { ...prev };
        if (payload.is_typing) next[payload.user_id] = payload.user_name;
        else delete next[payload.user_id];
        return next;
      });
    },
  );

  useEffect(() => {
    setTypingUsers({});
  }, [resolvedChannelId]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length]);

  const sendMutation = useMutation({
    mutationFn: (payload: { content: string; tempId: string }) =>
      post<ChatMessage>(`/chat/channels/${resolvedChannelId}/messages`, { content: payload.content }),
    onMutate: async ({ content, tempId }) => {
      setInputText('');
      clearTimeout(typingTimeoutRef.current);
      if (resolvedChannelId) {
        emitRealtimeEvent('chat.typing', { channel_id: resolvedChannelId, is_typing: false });
      }
      const optimistic: ChatMessage = {
        id: tempId,
        workspace_id: ctx?.workspace.id || '',
        channel_id: resolvedChannelId || '',
        sender_id: ctx?.user.id || '',
        sender_name: ctx?.user.name || 'You',
        sender_color: ctx?.user.color || '#0f5f44',
        sender_role: ctx?.user.role || 'member',
        sender_team_role: ctx?.user.team_role,
        edited: 0,
        content,
        attachments: [],
        pinned: 0,
        reactions: [],
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      qc.setQueryData(
        ['chat-messages', resolvedChannelId],
        (old: { channel: ChatChannel; messages: ChatMessage[] } | undefined) =>
          old ? { ...old, messages: [...old.messages, optimistic] } : old,
      );
      return { tempId, content };
    },
    onSuccess: (newMsg, _vars, context) => {
      qc.setQueryData(
        ['chat-messages', resolvedChannelId],
        (old: { channel: ChatChannel; messages: ChatMessage[] } | undefined) => {
          if (!old) return old;
          const alreadyHasReal = old.messages.some((m) => m.id === newMsg.id);
          return {
            ...old,
            messages: alreadyHasReal
              ? old.messages.filter((m) => m.id !== context?.tempId)
              : old.messages.map((m) => (m.id === context?.tempId ? newMsg : m)),
          };
        },
      );
    },
    onError: (_err, _vars, context) => {
      if (!context) return;
      setInputText(context.content);
      qc.setQueryData(
        ['chat-messages', resolvedChannelId],
        (old: { channel: ChatChannel; messages: ChatMessage[] } | undefined) =>
          old
            ? { ...old, messages: old.messages.filter((m) => m.id !== context.tempId) }
            : old,
      );
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (msgId: string) => del(`/chat/messages/${msgId}`),
    onMutate: (msgId) => {
      qc.setQueryData(
        ['chat-messages', resolvedChannelId],
        (old: { channel: ChatChannel; messages: ChatMessage[] } | undefined) =>
          old ? { ...old, messages: old.messages.filter((m) => m.id !== msgId) } : old,
      );
    },
  });

  const handleSend = () => {
    const trimmed = inputText.trim();
    if (!trimmed || !resolvedChannelId) return;
    sendMutation.mutate({ content: trimmed, tempId: `opt-${Date.now()}-${Math.random()}` });
  };

  const handleInputChange = (val: string) => {
    setInputText(val);
    if (!resolvedChannelId) return;
    const nowTs = Date.now();
    if (nowTs - lastTypingSentRef.current > 1600 && val.trim()) {
      lastTypingSentRef.current = nowTs;
      emitRealtimeEvent('chat.typing', { channel_id: resolvedChannelId, is_typing: true });
    }
    clearTimeout(typingTimeoutRef.current);
    typingTimeoutRef.current = setTimeout(() => {
      emitRealtimeEvent('chat.typing', { channel_id: resolvedChannelId, is_typing: false });
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
    for (const i of ctx?.issues || []) map.set(i.key, i);
    return map;
  }, [ctx?.issues]);

  const renderMessageContent = (text: string) => {
    const issueRegex = /([A-Z]{2,10}-\d+)/g;
    const parts = text.split(issueRegex);
    return parts.map((part, i) => {
      const matched = issueLookup.get(part);
      if (matched) {
        return (
          <button
            key={i}
            className="chat-issue-tag"
            onClick={() => openIssue(matched.id)}
            title={`${matched.key}: ${matched.summary}`}
          >
            <span>#{part}</span>
            <ExternalLink size={10} />
          </button>
        );
      }
      return <span key={i}>{part}</span>;
    });
  };

  const typingNames = Object.values(typingUsers);

  if (!targetChannel) {
    return (
      <div className="chat-widget-embedded" style={{ alignItems: 'center', justifyContent: 'center' }}>
        <MessageSquare size={32} color="#94a3b8" />
        <p style={{ color: '#64748b', fontSize: 13, marginTop: 8 }}>No chat channel found.</p>
      </div>
    );
  }

  return (
    <div className="chat-widget-embedded">
      <header className="chat-header">
        <div className="chat-header-info">
          <div className="chat-header-title">
            <MessageSquare size={16} />
            <span>{title || `#${targetChannel.name}`}</span>
            <span
              className={`chat-live-pill ${connection === 'connected' ? 'live' : 'offline'}`}
              title={connection === 'connected' ? 'Real-time updates active' : 'Reconnecting…'}
            >
              <i />
              {connection === 'connected' ? 'Live' : 'Syncing'}
            </span>
          </div>
          {targetChannel.description && (
            <div className="chat-header-desc">{targetChannel.description}</div>
          )}
        </div>
      </header>

      <div className="chat-messages-container">
        {isLoading ? (
          <div className="chat-empty-feed">Loading messages…</div>
        ) : messages.length === 0 ? (
          <div className="chat-empty-feed">
            <MessageSquare size={32} />
            <p>No messages yet in #{targetChannel.name}.</p>
          </div>
        ) : (
          messages.map((msg) => {
            const isSelf = msg.sender_id === ctx?.user.id;
            const isPending = msg.id.startsWith('opt-');
            return (
              <div
                key={msg.id}
                className={`chat-message-row ${isPending ? 'is-pending' : ''}`}
              >
                <div
                  className="chat-avatar"
                  style={{ background: msg.sender_color || '#0f5f44', width: 28, height: 28, fontSize: 11 }}
                >
                  {(msg.sender_name || 'U').charAt(0).toUpperCase()}
                </div>
                <div className="chat-message-content-wrap">
                  <div className="chat-message-meta">
                    <span className="chat-message-sender" style={{ fontSize: 12 }}>{msg.sender_name}</span>
                    {msg.sender_team_role && (
                      <span className="chat-role-pill">{msg.sender_team_role}</span>
                    )}
                    <span className="chat-message-time" style={{ fontSize: 10 }}>
                      {isPending
                        ? 'Sending…'
                        : new Date(msg.created_at).toLocaleTimeString([], {
                            hour: '2-digit',
                            minute: '2-digit',
                          })}
                    </span>
                    {!isPending && (isSelf || ['owner', 'admin'].includes(ctx?.user.role || '')) && (
                      <button
                        className="chat-message-delete-btn"
                        onClick={() => deleteMutation.mutate(msg.id)}
                      >
                        <Trash2 size={11} />
                      </button>
                    )}
                  </div>
                  <div className="chat-message-body" style={{ fontSize: 13 }}>
                    {renderMessageContent(msg.content)}
                  </div>
                </div>
              </div>
            );
          })
        )}
        <div ref={messagesEndRef} />
      </div>

      {typingNames.length > 0 && (
        <div className="chat-typing-indicator">
          {typingNames.length === 1
            ? `${typingNames[0]} is typing…`
            : `${typingNames.join(', ')} are typing…`}
        </div>
      )}

      <footer className="chat-input-bar">
        <div className="chat-input-box">
          <textarea
            className="chat-textarea"
            rows={1}
            placeholder={`Message #${targetChannel.name}…`}
            value={inputText}
            onChange={(e) => handleInputChange(e.target.value)}
            onKeyDown={handleKeyDown}
          />
          <button
            className="chat-send-btn"
            onClick={handleSend}
            disabled={!inputText.trim()}
          >
            <Send size={14} />
          </button>
        </div>
      </footer>
    </div>
  );
}
