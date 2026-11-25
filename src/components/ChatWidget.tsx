import { useState, useEffect, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { MessageSquare, Send, Trash2, ExternalLink } from 'lucide-react';
import { api, post, del } from '../lib/api';
import { useGrace } from '../context';
import type { ChatChannel, ChatMessage } from '../../shared/types';

interface ChatWidgetProps {
  channelId?: string;
  teamId?: string;
  projectId?: string;
  title?: string;
}

export function ChatWidget({ channelId, teamId, projectId, title }: ChatWidgetProps) {
  const { data: ctx, openIssue } = useGrace();
  const qc = useQueryClient();
  const [inputText, setInputText] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Discover channels
  const { data: channelsData } = useQuery<{ channels: ChatChannel[] }>({
    queryKey: ['chat-channels', ctx?.workspace.id],
    queryFn: () => api('/chat/channels'),
    refetchInterval: 5000,
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
    refetchInterval: 3000,
  });

  const messages = messagesData?.messages || [];

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length]);

  const sendMutation = useMutation({
    mutationFn: (content: string) =>
      post<ChatMessage>(`/chat/channels/${resolvedChannelId}/messages`, { content }),
    onSuccess: (newMsg) => {
      setInputText('');
      qc.setQueryData(
        ['chat-messages', resolvedChannelId],
        (old: { channel: ChatChannel; messages: ChatMessage[] } | undefined) =>
          old ? { ...old, messages: [...old.messages, newMsg] } : old,
      );
      qc.invalidateQueries({ queryKey: ['chat-channels'] });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (msgId: string) => del(`/chat/messages/${msgId}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['chat-messages', resolvedChannelId] });
    },
  });

  const handleSend = () => {
    if (!inputText.trim() || sendMutation.isPending || !resolvedChannelId) return;
    sendMutation.mutate(inputText.trim());
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const renderMessageContent = (text: string) => {
    const issueRegex = /([A-Z]{2,10}-\d+)/g;
    const parts = text.split(issueRegex);
    return parts.map((part, i) => {
      const matched = ctx?.issues.find((issue) => issue.key === part);
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
            return (
              <div key={msg.id} className="chat-message-row">
                <div
                  className="chat-avatar"
                  style={{ background: msg.sender_color || '#3b82f6', width: 28, height: 28, fontSize: 11 }}
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
                      {new Date(msg.created_at).toLocaleTimeString([], {
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </span>
                    {(isSelf || ['owner', 'admin'].includes(ctx?.user.role || '')) && (
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

      <footer className="chat-input-bar">
        <div className="chat-input-box">
          <textarea
            className="chat-textarea"
            rows={1}
            placeholder={`Message #${targetChannel.name}…`}
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            onKeyDown={handleKeyDown}
          />
          <button
            className="chat-send-btn"
            onClick={handleSend}
            disabled={!inputText.trim() || sendMutation.isPending}
          >
            <Send size={14} />
          </button>
        </div>
      </footer>
    </div>
  );
}
