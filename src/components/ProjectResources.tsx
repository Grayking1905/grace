import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import {
  FileText,
  Plus,
  Edit3,
  Trash2,
  Users,
  CheckCircle2,
  MessageSquare,
  ExternalLink,
  Layers,
  Sparkles,
  BookOpen,
  Share2,
} from 'lucide-react';
import { api, post, put, del } from '../lib/api';
import { useGrace } from '../context';
import type { Project, ProjectDocument } from '../../shared/types';
import { Badge, Button, Modal, Avatar, Empty, formatDate } from './ui';
import { ChatWidget } from './ChatWidget';

export function ProjectDocsView({ project }: { project: Project }) {
  const { data: ctx, run } = useGrace();
  const qc = useQueryClient();
  const [selectedDocId, setSelectedDocId] = useState<string | null>(null);
  const [filterCategory, setFilterCategory] = useState<string>('all');
  const [modalMode, setModalMode] = useState<'create' | 'edit' | null>(null);
  const [editingDoc, setEditingDoc] = useState<ProjectDocument | null>(null);

  // Form states
  const [title, setTitle] = useState('');
  const [category, setCategory] = useState('general');
  const [content, setContent] = useState('');
  const [isPublic, setIsPublic] = useState(true);

  const { data: docs = [], isLoading } = useQuery<ProjectDocument[]>({
    queryKey: ['project-docs', project.id],
    queryFn: () => api(`/projects/${project.id}/documents`),
  });

  const filteredDocs = filterCategory === 'all'
    ? docs
    : docs.filter((d) => d.category === filterCategory);

  const activeDoc = docs.find((d) => d.id === selectedDocId) || filteredDocs[0] || null;

  const openCreate = () => {
    setEditingDoc(null);
    setTitle('');
    setCategory('general');
    setContent('');
    setIsPublic(true);
    setModalMode('create');
  };

  const openEdit = (doc: ProjectDocument) => {
    setEditingDoc(doc);
    setTitle(doc.title);
    setCategory(doc.category);
    setContent(doc.content);
    setIsPublic(doc.is_public ?? true);
    setModalMode('edit');
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;

    if (modalMode === 'create') {
      const created = await run(
        () =>
          post<ProjectDocument>(`/projects/${project.id}/documents`, {
            title,
            category,
            content,
            is_public: isPublic,
          }),
        'Document created.',
      );
      if (created) {
        qc.invalidateQueries({ queryKey: ['project-docs', project.id] });
        setSelectedDocId(created.id);
        setModalMode(null);
      }
    } else if (modalMode === 'edit' && editingDoc) {
      const updated = await run(
        () =>
          put<ProjectDocument>(`/projects/${project.id}/documents/${editingDoc.id}`, {
            title,
            category,
            content,
            is_public: isPublic,
          }),
        'Document updated.',
      );
      if (updated) {
        qc.invalidateQueries({ queryKey: ['project-docs', project.id] });
        setModalMode(null);
      }
    }
  };

  const handleDelete = async (docId: string) => {
    if (!confirm('Are you sure you want to delete this document?')) return;
    const ok = await run(
      () => del(`/projects/${project.id}/documents/${docId}`),
      'Document deleted.',
    );
    if (ok) {
      qc.invalidateQueries({ queryKey: ['project-docs', project.id] });
      if (selectedDocId === docId) setSelectedDocId(null);
    }
  };

  const categories = ['all', 'general', 'architecture', 'api', 'guide'];

  return (
    <div className="project-docs-layout">
      {/* Sidebar */}
      <aside className="project-docs-sidebar">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span className="project-docs-nav-group-title">Documents ({docs.length})</span>
          <Button variant="secondary" onClick={openCreate} style={{ padding: '4px 8px', fontSize: 12 }}>
            <Plus size={14} /> New
          </Button>
        </div>

        {/* Category Pills */}
        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginBottom: 8 }}>
          {categories.map((cat) => (
            <button
              key={cat}
              className={`btn ${filterCategory === cat ? 'primary' : 'ghost'}`}
              style={{ padding: '2px 8px', fontSize: 11, textTransform: 'capitalize' }}
              onClick={() => setFilterCategory(cat)}
            >
              {cat}
            </button>
          ))}
        </div>

        {/* Document list */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, overflowY: 'auto' }}>
          {filteredDocs.map((doc) => (
            <button
              key={doc.id}
              className={`project-doc-item ${activeDoc?.id === doc.id ? 'active' : ''}`}
              onClick={() => setSelectedDocId(doc.id)}
            >
              <FileText size={15} style={{ flexShrink: 0 }} />
              <div style={{ flex: 1, minWidth: 0, textAlign: 'left' }}>
                <div style={{ fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {doc.title}
                </div>
                <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                  {doc.category} · {formatDate(doc.updated_at)}
                </div>
              </div>
            </button>
          ))}

          {filteredDocs.length === 0 && (
            <div style={{ padding: '20px 8px', textAlign: 'center', color: 'var(--text-muted)', fontSize: 12 }}>
              No documents in this category.
            </div>
          )}
        </div>
      </aside>

      {/* Main Document Viewer */}
      <main className="project-doc-viewer">
        {activeDoc ? (
          <>
            <div className="project-doc-title-row">
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                  <h2 style={{ margin: 0, fontSize: 20 }}>{activeDoc.title}</h2>
                  <Badge tone="blue">{activeDoc.category}</Badge>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 12, color: 'var(--text-muted)' }}>
                  <span>Updated {formatDate(activeDoc.updated_at)}</span>
                  {activeDoc.author_name && <span>by {activeDoc.author_name}</span>}
                </div>
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <Button variant="secondary" onClick={() => openEdit(activeDoc)}>
                  <Edit3 size={14} /> Edit
                </Button>
                <Button variant="ghost" onClick={() => handleDelete(activeDoc.id)}>
                  <Trash2 size={14} />
                </Button>
              </div>
            </div>

            <div className="project-doc-body">
              {activeDoc.content || <em style={{ color: 'var(--text-muted)' }}>No content yet. Click Edit to write.</em>}
            </div>
          </>
        ) : (
          <Empty
            title="No documents yet"
            text="Document requirements, architecture decisions, and developer guides for this project."
            action={
              <Button onClick={openCreate}>
                <Plus size={16} /> Create first document
              </Button>
            }
          />
        )}
      </main>

      {/* Create / Edit Modal */}
      {modalMode && (
        <Modal
          title={modalMode === 'create' ? 'Create Project Document' : 'Edit Document'}
          onClose={() => setModalMode(null)}
        >
          <form onSubmit={handleSubmit} className="team-member-modal-form">
            <div className="team-member-modal-field">
              <label>Title</label>
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="e.g. Architecture Overview & Service Specs"
                required
                autoFocus
              />
            </div>

            <div className="team-member-modal-field">
              <label>Category</label>
              <select value={category} onChange={(e) => setCategory(e.target.value)}>
                <option value="general">General</option>
                <option value="architecture">Architecture</option>
                <option value="api">API Documentation</option>
                <option value="guide">Guide & Onboarding</option>
              </select>
            </div>

            <div className="team-member-modal-field">
              <label>Content (Markdown or plain text)</label>
              <textarea
                value={content}
                onChange={(e) => setContent(e.target.value)}
                rows={12}
                placeholder="Document your architecture, endpoints, or specs..."
                style={{
                  width: '100%',
                  padding: '10px',
                  borderRadius: 6,
                  border: '1px solid var(--border)',
                  fontFamily: 'monospace',
                  fontSize: 13,
                  lineHeight: 1.5,
                }}
              />
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 14 }}>
              <Button variant="secondary" type="button" onClick={() => setModalMode(null)}>
                Cancel
              </Button>
              <Button type="submit">
                {modalMode === 'create' ? 'Create Document' : 'Save Changes'}
              </Button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}

interface SharedResourcesData {
  project: {
    id: string;
    name: string;
    key: string;
    description: string;
  };
  teams: Array<{
    id: string;
    name: string;
    slug: string;
    color: string;
    description: string;
  }>;
  documents: Array<{
    id: string;
    title: string;
    category: string;
    updated_at: string;
  }>;
  work_items: Array<{
    id: string;
    title: string;
    kind: string;
    state: string;
    team_id: string;
  }>;
  team_progress: Array<{
    team_id: string;
    team_name: string;
    team_color: string;
    total_issues: number;
    completed_issues: number;
    total_points: number;
    completion_rate: number;
  }>;
}

export function ProjectSharedResourcesView({ project }: { project: Project }) {
  const { data: resData, isLoading } = useQuery<SharedResourcesData>({
    queryKey: ['project-shared-resources', project.id],
    queryFn: () => api(`/projects/${project.id}/shared-resources`),
  });

  const teams = resData?.teams || [];
  const docs = resData?.documents || [];
  const workItems = resData?.work_items || [];
  const teamProgress = resData?.team_progress || [];

  return (
    <div className="shared-resources-layout">
      {/* Collaborating Teams Banner */}
      <div className="collaborating-teams-banner">
        <div className="collaborating-teams-left">
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Users size={20} color="var(--primary)" />
            <strong style={{ fontSize: 15 }}>Collaborating Teams</strong>
          </div>
          <div className="collaborating-teams-tags">
            {teams.map((t) => (
              <Link to={`/teams/${t.id}`} key={t.id} className="team-collab-tag">
                <span
                  style={{
                    width: 8,
                    height: 8,
                    borderRadius: '50%',
                    background: t.color || '#3b82f6',
                  }}
                />
                {t.name}
              </Link>
            ))}
            {teams.length === 0 && (
              <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>
                No teams specifically assigned. Workspace members share access.
              </span>
            )}
          </div>
        </div>

        <div style={{ display: 'flex', gap: 10 }}>
          <Link to={`/projects/${project.id}/chat`} className="btn primary" style={{ fontSize: 13, display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <MessageSquare size={15} /> Project Chat
          </Link>
          <Link to={`/projects/${project.id}/docs`} className="btn secondary" style={{ fontSize: 13, display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <BookOpen size={15} /> All Docs
          </Link>
        </div>
      </div>

      {/* Cross-Team Progress Comparison */}
      <div className="team-contributions-section">
        <div className="team-contributions-header">
          <div className="team-contributions-title">
            <Layers size={17} />
            Cross-Team Delivery Progress
          </div>
          <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
            Comparing issues & story points across collaborating teams
          </span>
        </div>

        {teamProgress.length > 0 ? (
          <table className="team-contributions-table">
            <thead>
              <tr>
                <th>Team</th>
                <th>Assigned Issues</th>
                <th>Completed Issues</th>
                <th>Story Points</th>
                <th>Completion Rate</th>
              </tr>
            </thead>
            <tbody>
              {teamProgress.map((tp) => (
                <tr key={tp.team_id}>
                  <td>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 600 }}>
                      <span
                        style={{
                          width: 10,
                          height: 10,
                          borderRadius: '50%',
                          background: tp.team_color || '#3b82f6',
                        }}
                      />
                      <Link to={`/teams/${tp.team_id}`} style={{ color: 'inherit', textDecoration: 'none' }}>
                        {tp.team_name}
                      </Link>
                    </div>
                  </td>
                  <td>{tp.total_issues}</td>
                  <td>{tp.completed_issues}</td>
                  <td>{tp.total_points} pts</td>
                  <td>
                    <div className="team-progress-bar-wrap">
                      <div className="team-progress-track">
                        <div
                          className={`team-progress-fill ${tp.completion_rate >= 100 ? 'green' : ''}`}
                          style={{ width: `${Math.min(tp.completion_rate, 100)}%` }}
                        />
                      </div>
                      <span style={{ fontSize: 12, fontWeight: 600 }}>{tp.completion_rate}%</span>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <div style={{ padding: '24px', textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>
            Assign teams in Project Settings to see cross-team velocity and progress tracking.
          </div>
        )}
      </div>

      {/* Grid: Shared Docs & Work Items */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 20 }}>
        {/* Shared Documents Section */}
        <div className="panel" style={{ padding: 18 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
            <h3 style={{ margin: 0, fontSize: 15, display: 'flex', alignItems: 'center', gap: 8 }}>
              <FileText size={17} /> Project Knowledge & Specs
            </h3>
            <Link to={`/projects/${project.id}/docs`} style={{ fontSize: 12, color: 'var(--primary)', fontWeight: 600 }}>
              View all
            </Link>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {docs.slice(0, 5).map((d) => (
              <Link
                key={d.id}
                to={`/projects/${project.id}/docs`}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '8px 12px',
                  borderRadius: 6,
                  border: '1px solid var(--border)',
                  background: 'var(--bg-secondary)',
                  textDecoration: 'none',
                  color: 'inherit',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <FileText size={15} color="var(--primary)" />
                  <span style={{ fontSize: 13, fontWeight: 600 }}>{d.title}</span>
                </div>
                <Badge tone="gray">{d.category}</Badge>
              </Link>
            ))}

            {docs.length === 0 && (
              <div style={{ padding: '20px 0', textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>
                No documentation added yet.
              </div>
            )}
          </div>
        </div>

        {/* Connected Work Items (BRDs, Standups) */}
        <div className="panel" style={{ padding: 18 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
            <h3 style={{ margin: 0, fontSize: 15, display: 'flex', alignItems: 'center', gap: 8 }}>
              <Sparkles size={17} /> Connected BRDs & Deliverables
            </h3>
            <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{workItems.length} items</span>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {workItems.slice(0, 5).map((w) => (
              <div
                key={w.id}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '8px 12px',
                  borderRadius: 6,
                  border: '1px solid var(--border)',
                  background: 'var(--bg-secondary)',
                }}
              >
                <div>
                  <div style={{ fontSize: 13, fontWeight: 600 }}>{w.title}</div>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'capitalize' }}>
                    {w.kind} · {w.state}
                  </div>
                </div>
                <Badge tone={w.state === 'done' || w.state === 'approved' ? 'green' : 'amber'}>
                  {w.state}
                </Badge>
              </div>
            ))}

            {workItems.length === 0 && (
              <div style={{ padding: '20px 0', textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>
                No cross-team work items linked yet.
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export function ProjectChatView({ project }: { project: Project }) {
  return (
    <div style={{ marginTop: 16 }}>
      <ChatWidget
        projectId={project.id}
        title={`#${project.key.toLowerCase()} Project Room`}
      />
    </div>
  );
}
