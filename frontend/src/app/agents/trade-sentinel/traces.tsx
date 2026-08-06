'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  Activity, RefreshCw, AlertCircle, ChevronRight, ChevronDown,
  Cpu, Wrench, Users, Zap, CheckCircle2, XCircle, Clock,
  Filter, X,
} from 'lucide-react';
import DarkSelect from '@/components/DarkSelect';
import styles from './ts-agent.module.css';

// AgentOS mounts /traces + /specialists at the ROOT (no /api/v1/gts prefix).
// See CLAUDE.md: "wire UI to the existing AgentOS route before writing a
// bespoke /api/v1/gts/* endpoint." /api/v1/gts/specialists is the ONE custom
// route we still hit — handled with a per-call override below.
const API = 'http://localhost:7777';
const GTS_API = 'http://localhost:7777/api/v1/gts';
const PAGE_SIZE = 20;

/* ────────────── Filter schema (from AgentOS) ────────────── */

type FilterFieldType = 'enum' | 'string' | 'number' | 'datetime';
type FilterField = {
  key: string;
  label: string;
  type: FilterFieldType;
  operators: string[];
  values: string[] | null;
};
type FilterSchema = { fields: FilterField[]; logical_operators: string[] };

// Time-range preset — resolved to an ISO start_time before the request goes out.
type TimeRange = 'ALL' | '1H' | '24H' | '7D' | '30D';
const TIME_RANGE_MS: Record<Exclude<TimeRange, 'ALL'>, number> = {
  '1H':  1 * 60 * 60 * 1000,
  '24H': 24 * 60 * 60 * 1000,
  '7D':  7 * 24 * 60 * 60 * 1000,
  '30D': 30 * 24 * 60 * 60 * 1000,
};

/* ────────────── Types (subset of Agno TraceSummary / TraceDetail) ────────────── */

type TraceSummary = {
  trace_id: string;
  name: string;
  status: 'OK' | 'ERROR' | 'UNSET' | string;
  duration: string;
  start_time: string;
  end_time: string;
  total_spans: number;
  error_count: number;
  input?: string | null;
  run_id?: string | null;
  session_id?: string | null;
  agent_id?: string | null;
  team_id?: string | null;
  workflow_id?: string | null;
  created_at: string;
};

type PaginationMeta = { page: number; limit: number; total_pages: number; total_count: number; search_time_ms?: number };
type TraceListResponse = {
  // Agno's actual shape (>=2.6): { data: [...], meta: {...} }
  data?: TraceSummary[];
  meta?: PaginationMeta;
  // Fallback shapes older/other Agno builds might return
  traces?: TraceSummary[];
  items?: TraceSummary[];
  total?: number;
};

type TraceNode = {
  id: string;
  name: string;
  type: 'AGENT' | 'TEAM' | 'WORKFLOW' | 'LLM' | 'TOOL' | 'CHAIN' | string;
  duration: string;
  start_time: string;
  end_time: string;
  status: string;
  input?: string | null;
  output?: string | null;
  error?: string | null;
  spans?: TraceNode[] | null;
  metadata?: Record<string, unknown> | null;
};

type TraceDetail = {
  trace_id: string;
  name: string;
  status: string;
  duration: string;
  start_time: string;
  end_time: string;
  total_spans: number;
  error_count: number;
  input?: string | null;
  output?: string | null;
  error?: string | null;
  // Span-tree shape drift across Agno versions:
  //   >= 2.8: { tree: TraceNode[] }   ← current
  //   older : { root: TraceNode }  or  { spans: TraceNode[] }
  tree?: TraceNode[] | null;
  root?: TraceNode | null;
  spans?: TraceNode[] | null;
};

function pickRootNode(d: TraceDetail | null): TraceNode | undefined {
  if (!d) return undefined;
  if (Array.isArray(d.tree) && d.tree.length > 0) return d.tree[0];
  if (d.root) return d.root;
  if (Array.isArray(d.spans) && d.spans.length > 0) return d.spans[0];
  return undefined;
}

/* ────────────── Helpers ────────────── */

function fmtWhen(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function statusColor(s: string): string {
  if (s === 'OK') return '#10b981';
  if (s === 'ERROR') return '#ef4444';
  return '#6b7280';
}

function typeIcon(type: string) {
  switch (type) {
    case 'AGENT':    return <Cpu size={12} />;
    case 'TEAM':     return <Users size={12} />;
    case 'WORKFLOW': return <Activity size={12} />;
    case 'LLM':      return <Zap size={12} />;
    case 'TOOL':     return <Wrench size={12} />;
    default:         return <Activity size={12} />;
  }
}

function typeColor(type: string): string {
  switch (type) {
    case 'AGENT':    return '#8b5cf6';
    case 'TEAM':     return '#3b82f6';
    case 'WORKFLOW': return '#0ea5e9';
    case 'LLM':      return '#10b981';
    case 'TOOL':     return '#f59e0b';
    default:         return '#64748b';
  }
}

/* ────────────── Traces Tab ────────────── */

type Specialist = { id: string; name: string; role: string; enabled: boolean };

export default function TracesTab() {
  const [page, setPage] = useState(1);
  const [items, setItems] = useState<TraceSummary[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);

  // Filter schema is fetched once — dropdowns/inputs are driven by it.
  const [schema, setSchema] = useState<FilterSchema | null>(null);
  const [specialists, setSpecialists] = useState<Specialist[]>([]);

  // Filter state — kept generic so a schema change doesn't require rewriting UI.
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'OK' | 'ERROR'>('ALL');
  const [agentFilter, setAgentFilter] = useState<string>('ALL');   // 'ALL' | 'sweep-leader' | specialist_id
  const [timeRange, setTimeRange] = useState<TimeRange>('ALL');
  // Advanced (collapsed by default)
  const [showAdv, setShowAdv] = useState(false);
  const [sessionFilter, setSessionFilter] = useState('');
  const [runFilter, setRunFilter] = useState('');
  const [minDurationMs, setMinDurationMs] = useState('');
  const [nameContains, setNameContains] = useState('');

  // ── Load filter schema + specialist list once
  useEffect(() => {
    fetch(`${API}/traces/filter-schema`, { credentials: 'include' })
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d) setSchema(d); })
      .catch(() => { /* schema is optional — filters still work with defaults */ });

    fetch(`${GTS_API}/specialists`, { credentials: 'include' })
      .then(r => r.ok ? r.json() : [])
      .then(setSpecialists)
      .catch(() => { /* fall back to empty list — agent filter just shows None */ });
  }, []);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const q = new URLSearchParams({ page: String(page), limit: String(PAGE_SIZE) });
      if (statusFilter !== 'ALL') q.set('status', statusFilter);
      if (agentFilter !== 'ALL') {
        // sweep-leader is a team, everything else is an agent id.
        if (agentFilter === 'sweep-leader') q.set('team_id', 'sweep-leader');
        else                                q.set('agent_id', agentFilter);
      }
      if (timeRange !== 'ALL') {
        const startMs = Date.now() - TIME_RANGE_MS[timeRange];
        q.set('start_time', new Date(startMs).toISOString());
      }
      if (sessionFilter.trim()) q.set('session_id', sessionFilter.trim());
      if (runFilter.trim())     q.set('run_id', runFilter.trim());
      // AgentOS supports duration_ms via its filter DSL but the /traces
      // endpoint's query params don't; we send it best-effort so newer
      // Agno builds that accept it just work. Older builds ignore it.
      if (minDurationMs.trim() && !isNaN(Number(minDurationMs))) q.set('duration_ms_gte', minDurationMs.trim());
      if (nameContains.trim())  q.set('name_contains', nameContains.trim());

      const r = await fetch(`${API}/traces?${q.toString()}`, { credentials: 'include' });
      if (!r.ok) { setError(`Failed: ${r.status} ${await r.text()}`); return; }
      const data: TraceListResponse = await r.json();
      const list = data.data ?? data.traces ?? data.items ?? [];
      setItems(list);
      setTotal(data.meta?.total_count ?? data.total ?? list.length);
    } catch (e) { setError((e as Error).message); }
    finally { setLoading(false); }
  }, [page, statusFilter, agentFilter, timeRange, sessionFilter, runFilter, minDurationMs, nameContains]);

  useEffect(() => { load(); }, [load]);

  // Reset to page 1 when any filter changes.
  const resetPageAnd = <T,>(setter: (v: T) => void) => (v: T) => { setPage(1); setter(v); };

  const activeFilterCount =
    (statusFilter !== 'ALL' ? 1 : 0) +
    (agentFilter !== 'ALL' ? 1 : 0) +
    (timeRange !== 'ALL' ? 1 : 0) +
    (sessionFilter.trim() ? 1 : 0) +
    (runFilter.trim() ? 1 : 0) +
    (minDurationMs.trim() ? 1 : 0) +
    (nameContains.trim() ? 1 : 0);

  const clearAll = () => {
    setStatusFilter('ALL'); setAgentFilter('ALL'); setTimeRange('ALL');
    setSessionFilter(''); setRunFilter(''); setMinDurationMs(''); setNameContains('');
    setPage(1);
  };

  // Build the agent-id options: All, sweep-leader (team), + every specialist.
  const agentOptions = [
    { value: 'ALL', label: 'All actors' },
    { value: 'sweep-leader', label: 'Team: sweep-leader' },
    ...specialists.map(s => ({ value: s.id, label: `Agent: ${s.name}` })),
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {/* ── Filter bar ── */}
      <div style={{
        display: 'flex', flexDirection: 'column', gap: 10,
        padding: '12px 14px',
        background: 'var(--bg-card,#17181b)',
        border: '1px solid var(--border-color)',
        borderRadius: 10,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px', color: 'var(--text-secondary)' }}>
            <Filter size={12} /> Filters
            {schema && <span style={{ fontSize: 9, fontWeight: 500, letterSpacing: 0.4, color: 'var(--text-muted,#888)' }}>· {schema.fields.length} available</span>}
          </span>

          {/* Status segmented control */}
          <div style={{
            display: 'inline-flex', background: 'rgba(255,255,255,0.03)',
            border: '1px solid var(--border-color)', borderRadius: 8, padding: 2,
          }}>
            {(['ALL', 'OK', 'ERROR'] as const).map(s => {
              const active = statusFilter === s;
              return (
                <button
                  key={s}
                  onClick={() => resetPageAnd(setStatusFilter)(s)}
                  style={{
                    padding: '4px 12px', fontSize: 11, fontWeight: 600,
                    borderRadius: 6, border: 'none', cursor: 'pointer',
                    background: active
                      ? (s === 'OK' ? '#10b981' : s === 'ERROR' ? '#ef4444' : '#3b82f6')
                      : 'transparent',
                    color: active ? 'white' : 'var(--text-secondary)',
                  }}
                >
                  {s === 'ALL' ? 'All' : s === 'OK' ? 'OK' : 'Errored'}
                </button>
              );
            })}
          </div>

          {/* Agent / Team dropdown */}
          <DarkSelect
            value={agentFilter}
            onChange={resetPageAnd(setAgentFilter)}
            width={200}
            options={agentOptions}
          />

          {/* Time range segmented control */}
          <div style={{
            display: 'inline-flex', background: 'rgba(255,255,255,0.03)',
            border: '1px solid var(--border-color)', borderRadius: 8, padding: 2,
          }}>
            {(['ALL', '1H', '24H', '7D', '30D'] as const).map(r => {
              const active = timeRange === r;
              return (
                <button
                  key={r}
                  onClick={() => resetPageAnd(setTimeRange)(r)}
                  style={{
                    padding: '4px 10px', fontSize: 11, fontWeight: 600,
                    borderRadius: 6, border: 'none', cursor: 'pointer',
                    background: active ? '#D89B4A' : 'transparent',
                    color: active ? 'black' : 'var(--text-secondary)',
                  }}
                >
                  {r === 'ALL' ? 'Any time' : `Last ${r}`}
                </button>
              );
            })}
          </div>

          <button
            onClick={() => setShowAdv(v => !v)}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 4,
              padding: '4px 10px', fontSize: 11, fontWeight: 600,
              background: 'transparent', border: '1px solid var(--border-color)',
              borderRadius: 6, color: 'var(--text-secondary)', cursor: 'pointer',
            }}
          >
            {showAdv ? <ChevronDown size={11} /> : <ChevronRight size={11} />} Advanced
          </button>

          {activeFilterCount > 0 && (
            <button
              onClick={clearAll}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 4,
                padding: '4px 10px', fontSize: 11, fontWeight: 600,
                background: 'transparent', border: '1px solid rgba(239,68,68,0.35)',
                borderRadius: 6, color: '#fecaca', cursor: 'pointer',
              }}
              title="Reset all filters"
            >
              <X size={11} /> Clear {activeFilterCount}
            </button>
          )}

          <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--text-muted,#888)' }}>
            {loading ? 'Loading…' : `${total} trace${total === 1 ? '' : 's'}`}
          </span>
          <button className={styles.secondaryBtn} onClick={load} disabled={loading}
            style={{ padding: '5px 10px', fontSize: 11 }}>
            <RefreshCw size={11} /> Refresh
          </button>
        </div>

        {showAdv && (
          <div style={{
            display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 10,
            paddingTop: 8, borderTop: '1px solid var(--border-color)',
          }}>
            <AdvField label="Name contains" value={nameContains} onChange={resetPageAnd(setNameContains)} placeholder="e.g. sanctions" />
            <AdvField label="Session ID" value={sessionFilter} onChange={resetPageAnd(setSessionFilter)} placeholder="Exact match" mono />
            <AdvField label="Run ID" value={runFilter} onChange={resetPageAnd(setRunFilter)} placeholder="Exact match" mono />
            <AdvField label="Min duration (ms)" value={minDurationMs} onChange={resetPageAnd(setMinDurationMs)} placeholder="e.g. 30000" />
          </div>
        )}
      </div>

      {error && <div className={styles.error}><AlertCircle size={14} /> {error}</div>}

      {items.length === 0 && !loading && !error && (
        <div style={{
          padding: 32, textAlign: 'center',
          background: 'var(--bg-card,#17181b)', border: '1px dashed var(--border-color)', borderRadius: 12,
        }}>
          <div style={{ fontSize: 14, color: 'var(--text-primary)', marginBottom: 6 }}>
            {activeFilterCount > 0 ? 'No traces match the current filters' : 'No traces yet'}
          </div>
          <div className={styles.hint}>
            {activeFilterCount > 0
              ? 'Widen the time range or clear a filter to see more.'
              : 'Run a sweep to generate spans. Each run captures every LLM call, tool call, and delegation.'}
          </div>
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {items.map(t => (
          <TraceRow
            key={t.trace_id}
            trace={t}
            expanded={expanded === t.trace_id}
            onToggle={() => setExpanded(prev => prev === t.trace_id ? null : t.trace_id)}
          />
        ))}
      </div>

      {total > PAGE_SIZE && (
        <div style={{ display: 'flex', gap: 8, justifyContent: 'center', paddingTop: 8 }}>
          <button className={styles.secondaryBtn} disabled={page <= 1} onClick={() => setPage(p => p - 1)}>Prev</button>
          <span className={styles.hint}>Page {page} / {Math.max(1, Math.ceil(total / PAGE_SIZE))}</span>
          <button className={styles.secondaryBtn} disabled={page >= Math.ceil(total / PAGE_SIZE)} onClick={() => setPage(p => p + 1)}>Next</button>
        </div>
      )}
    </div>
  );
}

function AdvField({ label, value, onChange, placeholder, mono }: {
  label: string; value: string; onChange: (v: string) => void; placeholder?: string; mono?: boolean;
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <label style={{ fontSize: 10, fontWeight: 600, letterSpacing: 0.4, textTransform: 'uppercase', color: 'var(--text-muted,#888)' }}>
        {label}
      </label>
      <input
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        style={{
          padding: '6px 10px', fontSize: 12,
          background: 'rgba(255,255,255,0.04)', border: '1px solid var(--border-color)',
          borderRadius: 6, color: 'var(--text-primary)',
          fontFamily: mono ? 'ui-monospace, monospace' : undefined,
        }}
      />
    </div>
  );
}

/* ────────────── Row + detail ────────────── */

function TraceRow({ trace, expanded, onToggle }: { trace: TraceSummary; expanded: boolean; onToggle: () => void }) {
  const [detail, setDetail] = useState<TraceDetail | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);

  useEffect(() => {
    if (!expanded || detail) return;
    let cancelled = false;
    (async () => {
      setLoadingDetail(true); setDetailError(null);
      try {
        const r = await fetch(`${API}/traces/${trace.trace_id}`, { credentials: 'include' });
        if (!r.ok) { setDetailError(`Failed: ${r.status} ${await r.text()}`); return; }
        if (!cancelled) setDetail(await r.json());
      } catch (e) { if (!cancelled) setDetailError((e as Error).message); }
      finally { if (!cancelled) setLoadingDetail(false); }
    })();
    return () => { cancelled = true; };
  }, [expanded, detail, trace.trace_id]);

  const isErr = trace.status === 'ERROR';
  const color = statusColor(trace.status);

  return (
    <div style={{
      background: 'var(--bg-card,#17181b)',
      border: '1px solid var(--border-color)',
      borderLeft: `3px solid ${color}`,
      borderRadius: 10,
      overflow: 'hidden',
    }}>
      <div onClick={onToggle} style={{ padding: '12px 14px', display: 'flex', alignItems: 'center', gap: 12, cursor: 'pointer' }}>
        <span style={{ color, display: 'inline-flex' }}>
          {isErr ? <XCircle size={14} /> : trace.status === 'OK' ? <CheckCircle2 size={14} /> : <Clock size={14} />}
        </span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <strong style={{ fontSize: 13, color: 'var(--text-primary)' }}>{trace.name}</strong>
            {trace.team_id  && <Chip color="#3b82f6" label={`team:${trace.team_id}`} />}
            {trace.agent_id && <Chip color="#8b5cf6" label={`agent:${trace.agent_id}`} />}
            {trace.error_count > 0 && <Chip color="#ef4444" label={`${trace.error_count} error${trace.error_count === 1 ? '' : 's'}`} />}
          </div>
          <div style={{ fontSize: 11, color: 'var(--text-muted,#888)', marginTop: 2, display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <span>{fmtWhen(trace.start_time)}</span>
            <span>· {trace.duration}</span>
            <span>· {trace.total_spans} span{trace.total_spans === 1 ? '' : 's'}</span>
            {trace.run_id && <span style={{ fontFamily: 'ui-monospace,monospace', opacity: 0.6 }}>· {trace.run_id.slice(0, 8)}</span>}
          </div>
          {trace.input && <div style={{ fontSize: 11.5, color: 'var(--text-secondary)', marginTop: 4, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{trace.input}</div>}
        </div>
        {expanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
      </div>

      {expanded && (
        <div style={{ padding: '0 14px 14px 14px', borderTop: '1px solid var(--border-color)' }}>
          {loadingDetail && <div className={styles.hint} style={{ padding: 12 }}>Loading spans…</div>}
          {detailError && <div className={styles.error} style={{ marginTop: 10 }}><AlertCircle size={14} /> {detailError}</div>}
          {detail && (
            <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 10 }}>
              {detail.error && (
                <div className={styles.error}><AlertCircle size={14} /> {detail.error}</div>
              )}
              {detail.input && (
                <Block title="Input">{detail.input}</Block>
              )}
              {detail.output && (
                <Block title="Output">{detail.output}</Block>
              )}
              <div>
                <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--text-muted,#888)', textTransform: 'uppercase', letterSpacing: '0.6px', marginBottom: 6 }}>Span tree</div>
                {(() => {
                  // Prefer the tree[] array so we render every top-level node,
                  // not just the first one. Fall back to legacy shapes.
                  const nodes: TraceNode[] = Array.isArray(detail.tree) && detail.tree.length > 0
                    ? detail.tree
                    : detail.root
                      ? [detail.root]
                      : (detail.spans ?? []);
                  if (nodes.length === 0) return <div className={styles.hint}>No spans in this trace.</div>;
                  return nodes.map((n, i) => <SpanTree key={n.id ?? i} node={n} />);
                })()}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function Chip({ color, label }: { color: string; label: string }) {
  return (
    <span style={{
      fontSize: 10, padding: '2px 6px', borderRadius: 6,
      background: `${color}18`, border: `1px solid ${color}44`, color,
      fontFamily: 'ui-monospace,monospace', whiteSpace: 'nowrap',
    }}>{label}</span>
  );
}

function Block({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--text-muted,#888)', textTransform: 'uppercase', letterSpacing: '0.6px', marginBottom: 4 }}>{title}</div>
      <div style={{
        fontSize: 12, color: 'var(--text-primary)', lineHeight: 1.55,
        background: 'var(--bg-input,#1a1b1e)', border: '1px solid var(--border-color)',
        borderRadius: 6, padding: '8px 10px', whiteSpace: 'pre-wrap',
        maxHeight: 200, overflowY: 'auto',
      }}>{children}</div>
    </div>
  );
}

/* ────────────── Span tree ────────────── */

function SpanTree({ node }: { node?: TraceNode | null }) {
  if (!node) return <div className={styles.hint}>No spans in this trace.</div>;
  return <SpanNode node={node} depth={0} />;
}

function SpanNode({ node, depth }: { node: TraceNode; depth: number }) {
  const [open, setOpen] = useState(depth < 2);
  const hasKids = !!node.spans?.length;
  const isErr = node.status === 'ERROR';
  const tColor = typeColor(node.type);

  return (
    <div style={{ marginLeft: depth === 0 ? 0 : 14 }}>
      <div
        onClick={() => setOpen(o => !o)}
        style={{
          display: 'flex', alignItems: 'center', gap: 8,
          padding: '5px 8px', borderRadius: 6, cursor: hasKids ? 'pointer' : 'default',
          background: depth === 0 ? 'var(--bg-input,#1a1b1e)' : 'transparent',
          border: depth === 0 ? '1px solid var(--border-color)' : '1px solid transparent',
          marginBottom: 2,
        }}
      >
        <span style={{ width: 12, display: 'inline-flex', color: 'var(--text-muted,#888)' }}>
          {hasKids ? (open ? <ChevronDown size={12} /> : <ChevronRight size={12} />) : null}
        </span>
        <span style={{ color: tColor, display: 'inline-flex' }}>{typeIcon(node.type)}</span>
        <span style={{
          fontSize: 10, padding: '1px 6px', borderRadius: 4,
          background: `${tColor}18`, color: tColor,
          fontFamily: 'ui-monospace,monospace', fontWeight: 600,
        }}>{node.type}</span>
        <span style={{ fontSize: 12, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{node.name}</span>
        <span style={{ fontSize: 11, color: 'var(--text-muted,#888)', marginLeft: 'auto', fontFamily: 'ui-monospace,monospace', whiteSpace: 'nowrap' }}>{node.duration}</span>
        {isErr && <span style={{ color: '#ef4444' }}><XCircle size={12} /></span>}
      </div>

      {open && (
        <div style={{ marginLeft: 10, paddingLeft: 8, borderLeft: '1px dashed var(--border-color)' }}>
          {node.error && (
            <div style={{ fontSize: 12, color: '#ef4444', padding: '4px 8px' }}>Error: {node.error}</div>
          )}
          {(node.input || node.output || node.metadata) && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: '4px 0' }}>
              {node.metadata && Object.keys(node.metadata).length > 0 && (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                  {Object.entries(node.metadata).slice(0, 6).map(([k, v]) => (
                    <span key={k} style={{
                      fontSize: 10, fontFamily: 'ui-monospace,monospace',
                      padding: '1px 6px', borderRadius: 4,
                      background: 'var(--bg-input,#1a1b1e)',
                      border: '1px solid var(--border-color)',
                      color: 'var(--text-secondary)',
                    }}>{k}: {String(v).slice(0, 60)}</span>
                  ))}
                </div>
              )}
              {node.input && <MiniBlock label="in" text={node.input} />}
              {node.output && <MiniBlock label="out" text={node.output} />}
            </div>
          )}
          {hasKids && node.spans!.map(child => <SpanNode key={child.id} node={child} depth={depth + 1} />)}
        </div>
      )}
    </div>
  );
}

function MiniBlock({ label, text }: { label: string; text: string }) {
  const [expanded, setExpanded] = useState(false);
  const truncated = text.length > 240;
  const display = expanded || !truncated ? text : text.slice(0, 240) + '…';
  return (
    <div style={{
      fontSize: 11.5, color: 'var(--text-primary)', lineHeight: 1.55,
      background: 'var(--bg-input,#1a1b1e)', border: '1px solid var(--border-color)',
      borderRadius: 6, padding: '6px 8px', whiteSpace: 'pre-wrap',
      maxHeight: expanded ? 400 : 120, overflowY: 'auto',
    }}>
      <span style={{ fontSize: 9, fontWeight: 600, color: 'var(--text-muted,#888)', textTransform: 'uppercase', marginRight: 6 }}>{label}</span>
      {display}
      {truncated && (
        <button onClick={() => setExpanded(v => !v)} style={{
          marginLeft: 6, fontSize: 10, color: '#3b82f6', background: 'transparent', border: 'none', cursor: 'pointer', padding: 0,
        }}>{expanded ? 'show less' : 'show more'}</button>
      )}
    </div>
  );
}
