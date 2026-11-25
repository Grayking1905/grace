import { useState, useEffect, useRef } from 'react';
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
} from 'lucide-react';
import { api, post, del } from '../lib/api';
import { useGrace } from '../context';
import { Avatar, Badge, Button, Modal } from '../components/ui';
import type { ChatChannel, ChatMessage, ChatChannelKind } from '../../shared/types';
import { useWorkspaceRealtime } from '../lib/useWorkspaceRealtime';

export function ChatPage() {
  const { channelId } = useParams();
  const navigate = useNavigate();
  const { data: ctx, openIssue } = useGrace();
  const qc = useQueryClient();

  const [activeChannelId, setActiveChannelId] = useState<string | null>(channelId || null);
  const [inputText, setInputText] = useState('');
  const [searchFilter, setSearchFilter] = useState('');
  const [createOpen, setCreateOpen] = useState(false);
  const [newKind, setNewKind] = useState<ChatChannelKind>('team');
  const [newName, setNewName] = useState('');
  const [newDesc, setNewDesc] = useState('');
  const [newTeamId, setNewTeamId] = useState(ctx?.organization?.teams[0]?.id || '');
  const [newProjectId, setNewProjectId] = useState(ctx?.projects[0]?.id || '');

  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Load channels
  const { data: channelsData, isLoading: loadingChannels } = useQuery<{ channels: ChatChannel[] }>({
    queryKey: ['chat-channels', ctx?.workspace.id],
    queryFn: () => api('/chat/channels'),
    refetchInterval: 5000,
  });

  const channels = channelsData?.channels || [];

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
    }
  }, [channelId]);

  // Load messages for active channel
  const { data: messagesData, isLoading: loadingMessages } = useQuery<{
    channel: ChatChannel;
    messages: ChatMessage[];
  }>({
    queryKey: ['chat-messages', activeChannelId],
    queryFn: () => api(`/chat/channels/${activeChannelId}/messages`),
    enabled: !!activeChannelId,
    refetchInterval: 3000,
  });

  const messages = messagesData?.messages || [];
  const currentChannel = messagesData?.channel || channels.find((c) => c.id === activeChannelId);

  // Auto scroll to bottom
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length]);

  // Send message mutation
  const sendMutation = useMutation({
    mutationFn: (content: string) =>
      post<ChatMessage>(`/chat/channels/${activeChannelId}/messages`, { content }),
    onSuccess: (newMsg) => {
      setInputText('');
      qc.setQueryData(
        ['chat-messages', activeChannelId],
        (old: { channel: ChatChannel; messages: ChatMessage[] } | undefined) =>
          old ? { ...old, messages: [...old.messages, newMsg] } : old,
      );
      qc.invalidateQueries({ queryKey: ['chat-channels'] });
    },
  });

  // Delete message mutation
  const deleteMutation = useMutation({
    mutationFn: (msgId: string) => del(`/chat/messages/${msgId}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['chat-messages', activeChannelId] });
      qc.invalidateQueries({ queryKey: ['chat-channels'] });
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
      qc.invalidateQueries({ queryKey: ['chat-channels'] });
      setActiveChannelId(ch.id);
      navigate(`/chat/${ch.id}`);
    },
  });

  const handleSend = () => {
    if (!inputText.trim() || sendMutation.isPending) return;
    sendMutation.mutate(inputText.trim());
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  // Group channels by category
  const filteredChannels = channels.filter((c) =>
    c.name.toLowerCase().includes(searchFilter.toLowerCase()),
  );
  const teamChannels = filteredChannels.filter((c) => c.kind === 'team');
  const projectChannels = filteredChannels.filter((c) => c.kind === 'project');
  const generalChannels = filteredChannels.filter((c) => c.kind === 'general' || c.kind === 'direct');

  // Render message text with issue links
  const renderMessageContent = (text: string) => {
    const issueRegex = /([A-Z]{2,10}-\d+)/g;
    const parts = text.split(issueRegex);
    return parts.map((part, i) => {
      const matchedIssue = ctx?.issues.find((issue) => issue.key === part);
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
          <button
            className="chat-new-channel-btn"
            title="Create Channel"
            onClick={() => setCreateOpen(true)}
          >
            <Plus size={15} />
          </button>
        </div>

        <div className="chat-search-wrap">
          <input
            className="chat-search-input"
            placeholder="Search channels…"
            value={searchFilter}
            onChange={(e) => setSearchFilter(e.target.value)}
          />
        </div>

        <div className="chat-channels-list">
          {/* General / Workspace */}
          {generalChannels.length > 0 && (
            <div className="chat-channel-group">
              <div className="chat-channel-group-title">Workspace</div>
              {generalChannels.map((c) => (
                <button
                  key={c.id}
                  className={`chat-channel-item ${c.id === activeChannelId ? 'active' : ''}`}
                  onClick={() => {
                    setActiveChannelId(c.id);
                    navigate(`/chat/${c.id}`);
                  }}
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

          {/* Team Channels */}
          {teamChannels.length > 0 && (
            <div className="chat-channel-group">
              <div className="chat-channel-group-title">Team Channels</div>
              {teamChannels.map((c) => {
                const team = ctx?.organization?.teams.find((t) => t.id === c.team_id);
                return (
                  <button
                    key={c.id}
                    className={`chat-channel-item ${c.id === activeChannelId ? 'active' : ''}`}
                    onClick={() => {
                      setActiveChannelId(c.id);
                      navigate(`/chat/${c.id}`);
                    }}
                  >
                    <div className="chat-channel-left">
                      <span
                        style={{
                          width: 8,
                          height: 8,
                          borderRadius: '50%',
                          background: team?.color || '#3b82f6',
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
            <div className="chat-channel-group">
              <div className="chat-channel-group-title">Project Collaboration</div>
              {projectChannels.map((c) => {
                const proj = ctx?.projects.find((p) => p.id === c.project_id);
                return (
                  <button
                    key={c.id}
                    className={`chat-channel-item ${c.id === activeChannelId ? 'active' : ''}`}
                    onClick={() => {
                      setActiveChannelId(c.id);
                      navigate(`/chat/${c.id}`);
                    }}
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
                  {currentChannel.kind === 'team' ? (
                    <Users size={18} />
                  ) : currentChannel.kind === 'project' ? (
                    <FolderKanban size={18} />
                  ) : (
                    <Hash size={18} />
                  )}
                  <span>#{currentChannel.name}</span>
                  <Badge tone="info">{currentChannel.kind}</Badge>
                </div>
                {currentChannel.description && (
                  <div className="chat-header-desc">{currentChannel.description}</div>
                )}
              </div>
            </header>

            <div className="chat-messages-container">
              {loadingMessages ? (
                <div className="chat-empty-feed">Loading messages…</div>
              ) : messages.length === 0 ? (
                <div className="chat-empty-feed">
                  <MessageSquare size={36} />
                  <p>No messages in #{currentChannel.name} yet.</p>
                  <small>Send the first message to start the conversation!</small>
                </div>
              ) : (
                messages.map((msg) => {
                  const isSelf = msg.sender_id === ctx?.user.id;
                  return (
                    <div key={msg.id} className="chat-message-row">
                      <div
                        className="chat-avatar"
                        style={{ background: msg.sender_color || '#3b82f6' }}
                      >
                        {(msg.sender_name || 'U').charAt(0).toUpperCase()}
                      </div>
                      <div className="chat-message-content-wrap">
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
                          {(isSelf || ['owner', 'admin'].includes(ctx?.user.role || '')) && (
                            <button
                              className="chat-message-delete-btn"
                              title="Delete message"
                              onClick={() => deleteMutation.mutate(msg.id)}
                            >
                              <Trash2 size={13} />
                            </button>
                          )}
                        </div>
                        <div className="chat-message-body">
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
                  placeholder={`Message #${currentChannel.name} (type issue keys like DCP-1 to link)…`}
                  value={inputText}
                  onChange={(e) => setInputText(e.target.value)}
                  onKeyDown={handleKeyDown}
                />
                <button
                  className="chat-send-btn"
                  onClick={handleSend}
                  disabled={!inputText.trim() || sendMutation.isPending}
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
            <p>Select a channel on the left to start chatting.</p>
          </div>
        )}
      </main>

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
