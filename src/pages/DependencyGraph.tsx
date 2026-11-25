import { useState, useRef, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api, del } from '../lib/api';
import { useGrace } from '../context';
import { Badge, Button } from '../components/ui';
import { GitBranch, AlertTriangle, CheckCircle2, Circle, ArrowRight, Trash2, ZoomIn, ZoomOut, RotateCcw } from 'lucide-react';

interface GraphNode {
  id: string;
  key: string;
  summary: string;
  status_name: string;
  status_category: string;
  priority: string;
  assignee_name: string | null;
  story_points: number;
}
interface GraphEdge {
  id: string;
  source_id: string;
  target_id: string;
  type: string;
}
interface DependencyGraph {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

const PRIORITY_COLOR: Record<string, string> = {
  urgent: '#e53e3e',
  high: '#ed8936',
  medium: '#3182ce',
  low: '#38a169',
  none: '#a0aec0',
};
const STATUS_CAT_COLOR: Record<string, string> = {
  todo: '#718096',
  'in-progress': '#3182ce',
  done: '#38a169',
};
const LINK_TYPE_LABEL: Record<string, string> = {
  blocks: 'Blocks',
  'is-blocked-by': 'Blocked by',
  duplicates: 'Duplicates',
  'is-duplicated-by': 'Duplicated by',
  'relates-to': 'Relates to',
  causes: 'Causes',
  'is-caused-by': 'Caused by',
};
const LINK_TYPE_COLOR: Record<string, string> = {
  blocks: '#e53e3e',
  'is-blocked-by': '#e53e3e',
  duplicates: '#805ad5',
  'is-duplicated-by': '#805ad5',
  'relates-to': '#718096',
  causes: '#ed8936',
  'is-caused-by': '#ed8936',
};

export function DependencyGraphPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const { data: ctx } = useGrace();
  const qc = useQueryClient();
  const [scale, setScale] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const [selected, setSelected] = useState<string | null>(null);
  const [filterType, setFilterType] = useState<string>('all');
  const svgRef = useRef<SVGSVGElement>(null);

  const project = ctx?.projects.find((p) => p.id === projectId);

  const { data, isLoading } = useQuery<DependencyGraph>({
    queryKey: ['dependency-graph', projectId],
    queryFn: () => api(`/projects/${projectId}/dependency-graph`),
    enabled: !!projectId,
  });

  const removeLinkMutation = useMutation({
    mutationFn: (linkId: string) => del(`/issue-links/${linkId}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['dependency-graph', projectId] }),
  });

  // Simple force-layout: assign positions in a grid
  const positions = useRef<Map<string, { x: number; y: number }>>(new Map());
  useEffect(() => {
    if (!data?.nodes.length) return;
    const cols = Math.ceil(Math.sqrt(data.nodes.length));
    data.nodes.forEach((n, i) => {
      if (!positions.current.has(n.id)) {
        const col = i % cols;
        const row = Math.floor(i / cols);
        positions.current.set(n.id, { x: 60 + col * 220, y: 60 + row * 130 });
      }
    });
  }, [data?.nodes]);

  const filteredEdges = (data?.edges ?? []).filter(
    (e) => filterType === 'all' || e.type === filterType,
  );

  const blockedIds = new Set(
    filteredEdges.filter((e) => e.type === 'is-blocked-by' || e.type === 'blocks').map((e) => e.target_id),
  );

  const selectedNode = data?.nodes.find((n) => n.id === selected);
  const selectedEdges = data?.edges.filter(
    (e) => e.source_id === selected || e.target_id === selected,
  ) ?? [];

  if (isLoading) {
    return (
      <div className="dep-graph-page">
        <div className="dep-loading">
          <GitBranch size={32} className="dep-loading-icon" />
          <p>Loading dependency graph…</p>
        </div>
      </div>
    );
  }

  if (!data || data.nodes.length === 0) {
    return (
      <div className="dep-graph-page">
        <div className="dep-empty">
          <GitBranch size={48} />
          <h3>No issues yet</h3>
          <p>Create some issues and link them to visualize dependencies.</p>
          <Link to={`/projects/${projectId}/board`}>
            <Button>Go to board</Button>
          </Link>
        </div>
      </div>
    );
  }

  const edgesOnly = filteredEdges.length === 0;

  return (
    <div className="dep-graph-page">
      {/* Header */}
      <div className="dep-header">
        <div className="dep-header-left">
          <GitBranch size={20} />
          <h1>Dependency Graph</h1>
          {project && <span className="dep-project-name">{project.name}</span>}
        </div>
        <div className="dep-header-controls">
          <select
            className="dep-filter-select"
            value={filterType}
            onChange={(e) => setFilterType(e.target.value)}
          >
            <option value="all">All link types</option>
            {Object.entries(LINK_TYPE_LABEL).map(([k, v]) => (
              <option key={k} value={k}>{v}</option>
            ))}
          </select>
          <div className="dep-zoom-controls">
            <button className="dep-zoom-btn" onClick={() => setScale((s) => Math.min(s + 0.2, 2.5))}>
              <ZoomIn size={15} />
            </button>
            <button className="dep-zoom-btn" onClick={() => setScale((s) => Math.max(s - 0.2, 0.3))}>
              <ZoomOut size={15} />
            </button>
            <button className="dep-zoom-btn" onClick={() => { setScale(1); setOffset({ x: 0, y: 0 }); }}>
              <RotateCcw size={15} />
            </button>
          </div>
        </div>
      </div>

      {/* Stats bar */}
      <div className="dep-stats-bar">
        <span className="dep-stat">
          <strong>{data.nodes.length}</strong> issues
        </span>
        <span className="dep-stat">
          <strong>{data.edges.length}</strong> dependencies
        </span>
        <span className="dep-stat dep-stat-blocked">
          <AlertTriangle size={13} />
          <strong>{blockedIds.size}</strong> blocked
        </span>
        <span className="dep-stat dep-stat-done">
          <CheckCircle2 size={13} />
          <strong>{data.nodes.filter((n) => n.status_category === 'done').length}</strong> done
        </span>
      </div>

      <div className="dep-layout">
        {/* Graph canvas */}
        <div
          className="dep-canvas-wrap"
          onMouseDown={(e) => { setDragging(true); setDragStart({ x: e.clientX - offset.x, y: e.clientY - offset.y }); }}
          onMouseMove={(e) => { if (dragging) setOffset({ x: e.clientX - dragStart.x, y: e.clientY - dragStart.y }); }}
          onMouseUp={() => setDragging(false)}
          onMouseLeave={() => setDragging(false)}
          onWheel={(e) => setScale((s) => Math.min(2.5, Math.max(0.3, s - e.deltaY * 0.001)))}
        >
          <svg
            ref={svgRef}
            className="dep-svg"
            style={{ cursor: dragging ? 'grabbing' : 'grab' }}
          >
            <defs>
              {Object.entries(LINK_TYPE_COLOR).map(([type, color]) => (
                <marker
                  key={type}
                  id={`arrow-${type}`}
                  markerWidth="8" markerHeight="8"
                  refX="6" refY="3"
                  orient="auto"
                >
                  <path d="M0,0 L0,6 L8,3 z" fill={color} />
                </marker>
              ))}
            </defs>
            <g transform={`translate(${offset.x},${offset.y}) scale(${scale})`}>
              {/* Edges */}
              {filteredEdges.map((edge) => {
                const src = positions.current.get(edge.source_id);
                const tgt = positions.current.get(edge.target_id);
                if (!src || !tgt) return null;
                const color = LINK_TYPE_COLOR[edge.type] ?? '#718096';
                const mx = (src.x + tgt.x) / 2;
                const my = (src.y + tgt.y) / 2;
                return (
                  <g key={edge.id}>
                    <line
                      x1={src.x + 90} y1={src.y + 30}
                      x2={tgt.x + 90} y2={tgt.y + 30}
                      stroke={color} strokeWidth={2} strokeOpacity={0.7}
                      markerEnd={`url(#arrow-${edge.type})`}
                    />
                    <text x={mx + 90} y={my + 25} fontSize={9} fill={color} textAnchor="middle">
                      {LINK_TYPE_LABEL[edge.type] ?? edge.type}
                    </text>
                  </g>
                );
              })}
              {/* Nodes */}
              {data.nodes.map((node) => {
                const pos = positions.current.get(node.id) ?? { x: 0, y: 0 };
                const isBlocked = blockedIds.has(node.id);
                const isDone = node.status_category === 'done';
                const isSelected = selected === node.id;
                const priColor = PRIORITY_COLOR[node.priority] ?? '#a0aec0';
                const catColor = STATUS_CAT_COLOR[node.status_category] ?? '#718096';
                return (
                  <g
                    key={node.id}
                    transform={`translate(${pos.x},${pos.y})`}
                    onClick={() => setSelected(isSelected ? null : node.id)}
                    style={{ cursor: 'pointer' }}
                  >
                    <rect
                      width={180} height={60}
                      rx={8} ry={8}
                      fill={isSelected ? '#ebf4ff' : isBlocked ? '#fff5f5' : '#fff'}
                      stroke={isSelected ? '#3182ce' : isBlocked ? '#fc8181' : '#e2e8f0'}
                      strokeWidth={isSelected ? 2 : 1.5}
                    />
                    {/* Priority indicator */}
                    <rect x={0} y={0} width={4} height={60} rx={2} fill={priColor} />
                    {/* Status dot */}
                    <circle cx={165} cy={12} r={5} fill={catColor} />
                    {/* Key */}
                    <text x={12} y={16} fontSize={10} fontWeight="bold" fill="#2d3748">
                      {node.key}
                    </text>
                    {/* Summary (clipped) */}
                    <text x={12} y={32} fontSize={10} fill="#4a5568">
                      {node.summary.length > 22 ? node.summary.slice(0, 22) + '…' : node.summary}
                    </text>
                    {/* Status */}
                    <text x={12} y={48} fontSize={9} fill="#718096">
                      {node.status_name} · {node.story_points}pts
                    </text>
                    {isBlocked && (
                      <text x={130} y={48} fontSize={9} fill="#e53e3e">⛔ blocked</text>
                    )}
                    {isDone && (
                      <text x={148} y={48} fontSize={9} fill="#38a169">✓</text>
                    )}
                  </g>
                );
              })}
            </g>
          </svg>
          {edgesOnly && (
            <div className="dep-no-edges-hint">
              No dependencies of type "{LINK_TYPE_LABEL[filterType] ?? filterType}". Try "All link types".
            </div>
          )}
        </div>

        {/* Detail panel */}
        {selectedNode && (
          <div className="dep-detail-panel">
            <div className="dep-detail-header">
              <span className="dep-detail-key">{selectedNode.key}</span>
              <Link to={`?issue=${selectedNode.id}`} className="dep-detail-link">
                <ArrowRight size={14} />
              </Link>
            </div>
            <p className="dep-detail-summary">{selectedNode.summary}</p>
            <div className="dep-detail-meta">
              <Badge tone={selectedNode.status_category === 'done' ? 'success' : selectedNode.status_category === 'in-progress' ? 'info' : 'neutral'}>
                {selectedNode.status_name}
              </Badge>
              <span className="dep-detail-pts">{selectedNode.story_points} pts</span>
              {selectedNode.assignee_name && (
                <span className="dep-detail-assignee">👤 {selectedNode.assignee_name}</span>
              )}
            </div>
            <div className="dep-detail-links">
              <h4>Dependencies ({selectedEdges.length})</h4>
              {selectedEdges.length === 0 && <p className="dep-detail-empty">No links</p>}
              {selectedEdges.map((edge) => {
                const other = data.nodes.find(
                  (n) => n.id === (edge.source_id === selectedNode.id ? edge.target_id : edge.source_id),
                );
                const isSource = edge.source_id === selectedNode.id;
                return (
                  <div key={edge.id} className="dep-detail-link-row">
                    <span
                      className="dep-detail-link-type"
                      style={{ color: LINK_TYPE_COLOR[edge.type] ?? '#718096' }}
                    >
                      {isSource ? LINK_TYPE_LABEL[edge.type] : `← ${LINK_TYPE_LABEL[edge.type]}`}
                    </span>
                    <span className="dep-detail-link-key">{other?.key}</span>
                    <span className="dep-detail-link-summary">{other?.summary?.slice(0, 30)}</span>
                    <button
                      className="dep-detail-remove"
                      title="Remove link"
                      onClick={() => removeLinkMutation.mutate(edge.id)}
                    >
                      <Trash2 size={12} />
                    </button>
                  </div>
                );
              })}
            </div>
            <div className="dep-detail-actions">
              <Link to={`/projects/${projectId}/board`}>
                <Button>Open on board</Button>
              </Link>
            </div>
          </div>
        )}
      </div>

      {/* Legend */}
      <div className="dep-legend">
        {Object.entries(LINK_TYPE_LABEL).map(([k, v]) => (
          <span key={k} className="dep-legend-item">
            <span className="dep-legend-line" style={{ background: LINK_TYPE_COLOR[k] }} />
            {v}
          </span>
        ))}
      </div>
    </div>
  );
}
