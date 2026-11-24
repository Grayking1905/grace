import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api, post, del } from '../lib/api';
import { useGrace } from '../context';
import { Button } from '../components/ui';
import { GitBranch, Plus, Trash2, AlertTriangle, ExternalLink } from 'lucide-react';
import type { LinkType } from '../../shared/types';

interface IssueLink {
  id: string;
  target_id: string;
  source_id: string;
  type: string;
  key: string;
  summary: string;
  priority: string;
  status_name: string;
}
interface DependencyResponse {
  outgoing: IssueLink[];
  incoming: IssueLink[];
}

const LINK_TYPES: { value: LinkType; label: string }[] = [
  { value: 'blocks', label: 'Blocks' },
  { value: 'is-blocked-by', label: 'Is blocked by' },
  { value: 'duplicates', label: 'Duplicates' },
  { value: 'is-duplicated-by', label: 'Is duplicated by' },
  { value: 'relates-to', label: 'Relates to' },
  { value: 'causes', label: 'Causes' },
  { value: 'is-caused-by', label: 'Is caused by' },
];
const LINK_COLOR: Record<string, string> = {
  blocks: '#e53e3e',
  'is-blocked-by': '#e53e3e',
  duplicates: '#805ad5',
  'is-duplicated-by': '#805ad5',
  'relates-to': '#718096',
  causes: '#ed8936',
  'is-caused-by': '#ed8936',
};

interface Props {
  issueId: string;
  onNavigate?: (issueId: string) => void;
}

export function IssueDependencies({ issueId, onNavigate }: Props) {
  const { data: ctx } = useGrace();
  const qc = useQueryClient();
  const [adding, setAdding] = useState(false);
  const [linkType, setLinkType] = useState<LinkType>('blocks');
  const [targetSearch, setTargetSearch] = useState('');

  const { data, isLoading } = useQuery<DependencyResponse>({
    queryKey: ['issue-links', issueId],
    queryFn: () => api(`/issues/${issueId}/links`),
    enabled: !!issueId,
  });

  const addMutation = useMutation({
    mutationFn: ({ targetId, type }: { targetId: string; type: string }) =>
      post(`/issues/${issueId}/links`, { target_id: targetId, type }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['issue-links', issueId] });
      qc.invalidateQueries({ queryKey: ['issue', issueId] });
      setAdding(false);
      setTargetSearch('');
    },
  });

  const removeMutation = useMutation({
    mutationFn: (linkId: string) => del(`/issue-links/${linkId}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['issue-links', issueId] });
    },
  });

  // Search issues for the add picker
  const allIssues = ctx?.issues ?? [];
  const searchResults = targetSearch.length >= 1
    ? allIssues.filter(
        (i) =>
          i.id !== issueId &&
          (i.key.toLowerCase().includes(targetSearch.toLowerCase()) ||
            i.summary.toLowerCase().includes(targetSearch.toLowerCase())),
      ).slice(0, 8)
    : [];

  const hasBlocker = (data?.incoming ?? []).some((l) => l.type === 'blocks');
  const outgoing = data?.outgoing ?? [];
  const incoming = data?.incoming ?? [];
  const total = outgoing.length + incoming.length;

  return (
    <div className="issue-deps-section">
      <div className="issue-deps-header">
        <GitBranch size={15} />
        <h4>Dependencies {total > 0 && <span className="issue-deps-count">{total}</span>}</h4>
        {hasBlocker && (
          <span className="issue-deps-blocked-badge">
            <AlertTriangle size={12} />
            Blocked
          </span>
        )}
        <button className="issue-deps-add-btn" onClick={() => setAdding((v) => !v)}>
          <Plus size={14} />
          Add
        </button>
      </div>

      {/* Add form */}
      {adding && (
        <div className="issue-deps-add-form">
          <select
            className="issue-deps-type-select"
            value={linkType}
            onChange={(e) => setLinkType(e.target.value as LinkType)}
          >
            {LINK_TYPES.map((lt) => (
              <option key={lt.value} value={lt.value}>{lt.label}</option>
            ))}
          </select>
          <div className="issue-deps-search-wrap">
            <input
              className="issue-deps-search"
              placeholder="Search by key or title…"
              value={targetSearch}
              onChange={(e) => setTargetSearch(e.target.value)}
              autoFocus
            />
            {searchResults.length > 0 && (
              <div className="issue-deps-dropdown">
                {searchResults.map((issue) => (
                  <button
                    key={issue.id}
                    className="issue-deps-dropdown-item"
                    onClick={() => addMutation.mutate({ targetId: issue.id, type: linkType })}
                  >
                    <span className="issue-deps-dropdown-key">{issue.key}</span>
                    <span className="issue-deps-dropdown-summary">{issue.summary}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
          <button className="issue-deps-cancel" onClick={() => setAdding(false)}>Cancel</button>
        </div>
      )}

      {isLoading && <p className="issue-deps-loading">Loading…</p>}

      {/* Outgoing links */}
      {outgoing.length > 0 && (
        <div className="issue-deps-group">
          <span className="issue-deps-group-label">This issue</span>
          {outgoing.map((link) => (
            <div key={link.id} className="issue-deps-row">
              <span
                className="issue-deps-type-badge"
                style={{ color: LINK_COLOR[link.type] ?? '#718096' }}
              >
                {LINK_TYPES.find((t) => t.value === link.type)?.label ?? link.type}
              </span>
              <button
                className="issue-deps-issue-btn"
                onClick={() => onNavigate?.(link.target_id)}
              >
                <span className="issue-deps-key">{link.key}</span>
                <span className="issue-deps-summary">{link.summary}</span>
              </button>
              <span className="issue-deps-status">{link.status_name}</span>
              <button
                className="issue-deps-remove"
                onClick={() => removeMutation.mutate(link.id)}
                title="Remove link"
              >
                <Trash2 size={12} />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Incoming links */}
      {incoming.length > 0 && (
        <div className="issue-deps-group">
          <span className="issue-deps-group-label">Linked from</span>
          {incoming.map((link) => (
            <div key={link.id} className="issue-deps-row issue-deps-row-incoming">
              <button
                className="issue-deps-issue-btn"
                onClick={() => onNavigate?.(link.source_id)}
              >
                <span className="issue-deps-key">{link.key}</span>
                <span className="issue-deps-summary">{link.summary}</span>
              </button>
              <span
                className="issue-deps-type-badge"
                style={{ color: LINK_COLOR[link.type] ?? '#718096' }}
              >
                {LINK_TYPES.find((t) => t.value === link.type)?.label ?? link.type}
                {' '}this issue
              </span>
              <span className="issue-deps-status">{link.status_name}</span>
              <button
                className="issue-deps-remove"
                onClick={() => removeMutation.mutate(link.id)}
                title="Remove link"
              >
                <Trash2 size={12} />
              </button>
            </div>
          ))}
        </div>
      )}

      {!isLoading && total === 0 && !adding && (
        <p className="issue-deps-empty">No dependencies linked. Click Add to create one.</p>
      )}
    </div>
  );
}
