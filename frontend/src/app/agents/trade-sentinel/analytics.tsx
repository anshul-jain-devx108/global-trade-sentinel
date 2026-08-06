'use client';

import { useEffect, useMemo, useState, useCallback } from 'react';
import {
  Activity, Coins, Cpu, Layers, RefreshCw, AlertCircle, Zap,
  TrendingUp, Calendar, Sigma,
} from 'lucide-react';
import styles from './ts-agent.module.css';

// /metrics + /metrics/refresh are AgentOS built-ins mounted at the ROOT,
// not under /api/v1/gts. See CLAUDE.md AgentOS-features rule.
const API = 'http://localhost:7777';

/* ────────────── Types (mirror Agno's MetricsResponse) ────────────── */

type TokenMetrics = {
  input_tokens?: number;
  output_tokens?: number;
  total_tokens?: number;
  cache_read_tokens?: number;
  cache_write_tokens?: number;
  reasoning_tokens?: number;
};

type ModelMetric = { model_id: string; model_provider?: string; count: number };

type DayMetric = {
  id: string;
  date: string;
  agent_runs_count: number;
  agent_sessions_count: number;
  team_runs_count: number;
  team_sessions_count: number;
  workflow_runs_count: number;
  workflow_sessions_count: number;
  users_count: number;
  token_metrics: TokenMetrics;
  model_metrics: ModelMetric[];
};

type MetricsResponse = { metrics: DayMetric[]; updated_at?: string | null };

/* ────────────── Helpers ────────────── */

const nfmt = new Intl.NumberFormat('en-US');
const compactFmt = new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 });

function isoDate(daysAgo: number): string {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  return d.toISOString().slice(0, 10);
}

function shortDate(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

/* ────────────── Analytics Tab ────────────── */

const RANGE_OPTIONS: { label: string; days: number }[] = [
  { label: '7d', days: 7 },
  { label: '30d', days: 30 },
  { label: '90d', days: 90 },
  { label: '180d', days: 180 },
  { label: '365d', days: 365 },
  { label: 'All', days: 0 },       // 0 → sentinel for "everything since project start"
];

// Agno's metrics table doesn't predate the project — we cap the "All" preset
// at 2 years to keep the query bounded. Anything older than this in the DB
// would still be returned by the "All" click; this cap only affects the
// starting_date we send.
const ALL_CAP_DAYS = 730;

/**
 * Usage & Cost view — operational-persona (ops/finance/admin), not the
 * compliance-officer's daily surface. Lives at `/usage` in the sidebar,
 * decoupled from the findings dashboard.
 */
export default function AnalyticsTab() {
  const [days, setDays] = useState<number>(30);
  const [customMode, setCustomMode] = useState(false);
  const [customFrom, setCustomFrom] = useState<string>(isoDate(30));
  const [customTo, setCustomTo] = useState<string>(isoDate(0));
  const [data, setData] = useState<MetricsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setError(null);

    let from: string, to: string;
    if (customMode) {
      if (!customFrom || !customTo) { setError('Select both start and end dates.'); setLoading(false); return; }
      if (customFrom > customTo)    { setError('Start date must be before end date.'); setLoading(false); return; }
      from = customFrom; to = customTo;
    } else {
      const window = days === 0 ? ALL_CAP_DAYS : days;
      from = isoDate(window - 1);
      to = isoDate(0);
    }

    try {
      const q = new URLSearchParams({ starting_date: from, ending_date: to });
      const r = await fetch(`${API}/metrics?${q.toString()}`, { credentials: 'include' });
      if (!r.ok) { setError(`Failed: ${r.status} ${await r.text()}`); return; }
      setData(await r.json());
    } catch (e) { setError((e as Error).message); }
    finally { setLoading(false); }
  }, [days, customMode, customFrom, customTo]);

  useEffect(() => { load(); }, [load]);
  // Note: /metrics/refresh is NOT called on mount because Agno 2.8.2's
  // Postgres `calculate_date_metrics` crashes with
  // `'str' object has no attribute 'get'` on session rows where
  // `session_data` came back as a JSON string instead of a jsonb dict.
  // The manual "Refresh" button below still fires it — same crash, but
  // at least it's user-initiated, not a page-load spam. Fix is upstream
  // (or a one-off SQL migration to normalise the column).

  const refreshBackend = async () => {
    try {
      await fetch(`${API}/metrics/refresh`, { method: 'POST', credentials: 'include' });
      await load();
    } catch (e) { setError((e as Error).message); }
  };

  const rows = data?.metrics ?? [];

  const totals = useMemo(() => {
    let teamRuns = 0, agentRuns = 0;
    let inp = 0, out = 0, tot = 0, cache = 0;
    const modelAgg: Record<string, { count: number; provider?: string }> = {};
    const activeDays = new Set<string>();

    rows.forEach(r => {
      const runs = (r.team_runs_count ?? 0) + (r.agent_runs_count ?? 0);
      teamRuns += r.team_runs_count ?? 0;
      agentRuns += r.agent_runs_count ?? 0;
      inp += r.token_metrics?.input_tokens ?? 0;
      out += r.token_metrics?.output_tokens ?? 0;
      tot += r.token_metrics?.total_tokens ?? 0;
      cache += r.token_metrics?.cache_read_tokens ?? 0;
      if (runs > 0) activeDays.add(r.date);
      (r.model_metrics ?? []).forEach(m => {
        const key = m.model_id;
        if (!modelAgg[key]) modelAgg[key] = { count: 0, provider: m.model_provider };
        modelAgg[key].count += m.count ?? 0;
      });
    });

    const models = Object.entries(modelAgg)
      .map(([id, v]) => ({ id, count: v.count, provider: v.provider }))
      .sort((a, b) => b.count - a.count);

    // Rough estimate at $0.15 / M input tokens + $0.60 / M output tokens.
    // Directional only — actual pricing depends on which Agno-selected model
    // handles each run. Refine per-model when we surface real cost data.
    const dollarCost = (inp / 1_000_000) * 0.15 + (out / 1_000_000) * 0.60;
    const avgTokensPerSweep = teamRuns > 0 ? Math.round(tot / teamRuns) : 0;
    const cacheHitRate = inp > 0 ? Math.round((cache / inp) * 100) : 0;

    return {
      teamRuns, agentRuns, inp, out, tot, cache, models, dollarCost,
      activeDayCount: activeDays.size,
      avgTokensPerSweep,
      cacheHitRate,
    };
  }, [rows]);

  const activeRows = useMemo(() => rows.filter(r => (r.team_runs_count ?? 0) + (r.agent_runs_count ?? 0) > 0), [rows]);
  const isEmpty = totals.teamRuns === 0 && totals.agentRuns === 0;

  // Effective window length in days — for the "Days active" tile denominator.
  const windowDays = useMemo(() => {
    if (customMode) {
      const from = new Date(customFrom).getTime();
      const to = new Date(customTo).getTime();
      if (isNaN(from) || isNaN(to) || to < from) return 1;
      return Math.max(1, Math.round((to - from) / (1000 * 60 * 60 * 24)) + 1);
    }
    return days === 0 ? ALL_CAP_DAYS : days;
  }, [customMode, customFrom, customTo, days]);

  const windowLabel = customMode
    ? `${customFrom} → ${customTo}`
    : days === 0 ? `all time (up to ${ALL_CAP_DAYS}d)` : `last ${days} days`;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Toolbar */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, justifyContent: 'space-between', flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <div style={{
            display: 'inline-flex', background: 'var(--bg-card,#17181b)',
            border: '1px solid var(--border-color)', borderRadius: 8, padding: 3,
          }}>
            {RANGE_OPTIONS.map(r => {
              const active = !customMode && days === r.days;
              return (
                <button
                  key={r.days}
                  onClick={() => { setDays(r.days); setCustomMode(false); }}
                  style={{
                    padding: '5px 12px',
                    fontSize: 12, fontWeight: 500,
                    borderRadius: 6, border: 'none', cursor: 'pointer',
                    background: active ? '#3b82f6' : 'transparent',
                    color: active ? 'white' : 'var(--text-secondary)',
                  }}
                >
                  {r.label}
                </button>
              );
            })}
            <button
              onClick={() => setCustomMode(m => !m)}
              style={{
                padding: '5px 12px',
                fontSize: 12, fontWeight: 500,
                borderRadius: 6, border: 'none', cursor: 'pointer',
                background: customMode ? '#3b82f6' : 'transparent',
                color: customMode ? 'white' : 'var(--text-secondary)',
                display: 'inline-flex', alignItems: 'center', gap: 4,
              }}
            >
              <Calendar size={12} /> Custom
            </button>
          </div>

          {customMode && (
            <div style={{
              display: 'inline-flex', alignItems: 'center', gap: 6,
              background: 'var(--bg-card,#17181b)', border: '1px solid var(--border-color)',
              borderRadius: 8, padding: '4px 8px',
            }}>
              <input
                type="date"
                value={customFrom}
                max={customTo || undefined}
                onChange={e => setCustomFrom(e.target.value)}
                style={{
                  background: 'transparent', color: 'var(--text-primary)',
                  border: '1px solid var(--border-color)', borderRadius: 6,
                  padding: '4px 6px', fontSize: 12, fontFamily: 'inherit',
                  colorScheme: 'dark',
                }}
              />
              <span style={{ color: 'var(--text-muted,#888)', fontSize: 12 }}>→</span>
              <input
                type="date"
                value={customTo}
                min={customFrom || undefined}
                max={isoDate(0)}
                onChange={e => setCustomTo(e.target.value)}
                style={{
                  background: 'transparent', color: 'var(--text-primary)',
                  border: '1px solid var(--border-color)', borderRadius: 6,
                  padding: '4px 6px', fontSize: 12, fontFamily: 'inherit',
                  colorScheme: 'dark',
                }}
              />
              <button
                onClick={load}
                disabled={loading}
                style={{
                  padding: '4px 10px', fontSize: 11, fontWeight: 600,
                  background: '#3b82f6', color: 'white', border: 'none',
                  borderRadius: 6, cursor: 'pointer',
                }}
              >Apply</button>
            </div>
          )}
        </div>

        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {data?.updated_at && (
            <span className={styles.hint} style={{ fontSize: 11 }}>
              Updated {new Date(data.updated_at).toLocaleString([], { hour: '2-digit', minute: '2-digit', month: 'short', day: 'numeric' })}
            </span>
          )}
          <button className={styles.secondaryBtn} onClick={refreshBackend} disabled={loading}
            style={{ padding: '5px 10px', fontSize: 11 }}>
            <RefreshCw size={11} /> Refresh
          </button>
        </div>
      </div>

      {error && <div className={styles.error}><AlertCircle size={14} /> {error}</div>}

      {isEmpty && !loading && (
        <div style={{
          padding: 32, textAlign: 'center',
          background: 'var(--bg-card,#17181b)', border: '1px dashed var(--border-color)', borderRadius: 12,
        }}>
          <div style={{ fontSize: 14, color: 'var(--text-primary)', marginBottom: 6 }}>No activity in {windowLabel}</div>
          <div className={styles.hint}>Run a sweep from the Overview tab — analytics will populate automatically.</div>
        </div>
      )}

      {!isEmpty && (
        <>
          {/* Row 1: Headline KPIs */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 10 }}>
            <StatTile
              label="Sweeps"
              value={compactFmt.format(totals.teamRuns)}
              sub={`${totals.activeDayCount} active day${totals.activeDayCount === 1 ? '' : 's'}`}
              accent="#3b82f6"
              icon={<Activity size={13} />}
            />
            <StatTile
              label="Agent runs"
              value={compactFmt.format(totals.agentRuns)}
              sub={totals.teamRuns > 0 ? `${(totals.agentRuns / totals.teamRuns).toFixed(1)} per sweep` : ''}
              accent="#8b5cf6"
              icon={<Cpu size={13} />}
            />
            <StatTile
              label="Tokens"
              value={compactFmt.format(totals.tot)}
              sub={`in ${compactFmt.format(totals.inp)} · out ${compactFmt.format(totals.out)}`}
              accent="#10b981"
              icon={<Zap size={13} />}
            />
            <StatTile
              label="Est. cost"
              value={`$${totals.dollarCost.toFixed(2)}`}
              sub="Estimate — directional only"
              accent="#f59e0b"
              icon={<Coins size={13} />}
            />
          </div>

          {/* Row 2: Efficiency stats */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 10 }}>
            <StatTile
              label="Avg tokens / sweep"
              value={compactFmt.format(totals.avgTokensPerSweep)}
              sub="Total ÷ sweep count"
              accent="#64748b"
              icon={<Sigma size={13} />}
            />
            <StatTile
              label="Cache hit"
              value={`${totals.cacheHitRate}%`}
              sub={`${compactFmt.format(totals.cache)} tokens cached`}
              accent="#0ea5e9"
              icon={<TrendingUp size={13} />}
            />
            <StatTile
              label="Days active"
              value={`${totals.activeDayCount} / ${windowDays}`}
              sub={`${Math.round((totals.activeDayCount / windowDays) * 100)}% coverage`}
              accent="#a78bfa"
              icon={<Calendar size={13} />}
            />
          </div>

          {/* Row 3: Activity sparkline — full width now that severity donut moved to Overview */}
          <Card title="Activity" subtitle={`${totals.teamRuns + totals.agentRuns} total runs across ${totals.activeDayCount} days`}>
            <Sparkline rows={rows} />
          </Card>

          {/* Row 4: Two columns — Models + top active days */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 12 }}>
            <Card title="Models" subtitle="Runs by model / provider" icon={<Layers size={13} />}>
              {totals.models.length === 0
                ? <div className={styles.hint}>No model calls recorded.</div>
                : <ModelBreakdown models={totals.models} />}
            </Card>

            <Card title="Top active days" subtitle="Sorted by total runs" icon={<Calendar size={13} />}>
              {activeRows.length === 0 ? (
                <div className={styles.hint}>No active days in this window.</div>
              ) : (
                <ActivityTable rows={activeRows} />
              )}
            </Card>
          </div>
        </>
      )}
    </div>
  );
}

/* ────────────── Building blocks ────────────── */

function StatTile({ label, value, sub, accent, icon }: {
  label: string; value: string; sub?: string; accent: string; icon: React.ReactNode;
}) {
  return (
    <div style={{
      padding: '12px 14px',
      background: 'var(--bg-card,#17181b)',
      border: '1px solid var(--border-color)',
      borderRadius: 10,
      display: 'flex', flexDirection: 'column', gap: 4,
      minWidth: 0,
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{
          fontSize: 10, fontWeight: 600, color: 'var(--text-muted,#888)',
          textTransform: 'uppercase', letterSpacing: '0.6px', whiteSpace: 'nowrap',
          overflow: 'hidden', textOverflow: 'ellipsis',
        }}>{label}</span>
        <span style={{ color: accent, display: 'inline-flex' }}>{icon}</span>
      </div>
      <div style={{
        fontSize: 22, fontWeight: 700, color: 'var(--text-primary)',
        lineHeight: 1.1, fontFamily: 'ui-monospace, monospace',
      }}>{value}</div>
      {sub && <div style={{
        fontSize: 10.5, color: 'var(--text-muted,#888)',
        whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
      }}>{sub}</div>}
    </div>
  );
}

function Card({ title, subtitle, icon, children }: {
  title: string; subtitle?: string; icon?: React.ReactNode; children: React.ReactNode;
}) {
  return (
    <div style={{
      background: 'var(--bg-card,#17181b)',
      border: '1px solid var(--border-color)',
      borderRadius: 12,
      padding: '14px 16px',
      display: 'flex', flexDirection: 'column', gap: 12,
      minWidth: 0, overflow: 'hidden',
    }}>
      <div>
        <div style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.6px', color: 'var(--text-secondary)', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          {icon}{title}
        </div>
        {subtitle && <div style={{ fontSize: 11, color: 'var(--text-muted,#888)', marginTop: 2 }}>{subtitle}</div>}
      </div>
      {children}
    </div>
  );
}

/* Sparkline — compact bar chart that scales down; empty days become thin baseline ticks. */
function Sparkline({ rows }: { rows: DayMetric[] }) {
  if (rows.length === 0) return null;
  const H = 90;
  const gap = 3;
  const barW = 100 / rows.length; // percentage-based

  const max = Math.max(1, ...rows.map(r => (r.team_runs_count ?? 0) + (r.agent_runs_count ?? 0)));

  return (
    <div style={{ width: '100%', minWidth: 0 }}>
      <div style={{
        display: 'flex', alignItems: 'flex-end', gap: `${gap}px`,
        height: H, padding: '4px 0',
      }}>
        {rows.map((r) => {
          const team = r.team_runs_count ?? 0;
          const agent = r.agent_runs_count ?? 0;
          const total = team + agent;
          const totalH = total === 0 ? 2 : Math.max(4, (total / max) * H);
          const teamH = total === 0 ? 0 : (team / total) * totalH;
          const agentH = total === 0 ? 0 : (agent / total) * totalH;
          return (
            <div
              key={r.id ?? r.date}
              title={`${shortDate(r.date)} — ${total} runs (${team} sweeps, ${agent} agents)`}
              style={{
                flex: `1 1 ${barW}%`,
                minWidth: 3,
                height: totalH,
                display: 'flex', flexDirection: 'column',
                background: total === 0 ? 'var(--border-color)' : 'transparent',
                borderRadius: 2,
                overflow: 'hidden',
              }}
            >
              {total > 0 && (
                <>
                  <div style={{ height: teamH, background: '#3b82f6' }} />
                  <div style={{ height: agentH, background: '#8b5cf6' }} />
                </>
              )}
            </div>
          );
        })}
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: 'var(--text-muted,#888)', marginTop: 6 }}>
        <span>{shortDate(rows[0].date)}</span>
        {rows.length > 2 && <span>{shortDate(rows[Math.floor(rows.length / 2)].date)}</span>}
        <span>{shortDate(rows[rows.length - 1].date)}</span>
      </div>
      <div style={{ display: 'flex', gap: 14, fontSize: 11, color: 'var(--text-secondary)', marginTop: 8 }}>
        <LegendDot color="#3b82f6" label="Sweeps" />
        <LegendDot color="#8b5cf6" label="Agent runs" />
        <LegendDot color="var(--border-color)" label="Idle day" />
      </div>
    </div>
  );
}

function LegendDot({ color, label }: { color: string; label: string }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
      <span style={{ display: 'inline-block', width: 10, height: 10, background: color, borderRadius: 2 }} />
      {label}
    </span>
  );
}

/* Model breakdown — horizontal bars */
function ModelBreakdown({ models }: { models: { id: string; count: number; provider?: string }[] }) {
  const max = Math.max(1, ...models.map(m => m.count));
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {models.map(m => (
        <div key={m.id}>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 4, gap: 8 }}>
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: 'var(--text-primary)' }}>
              <strong>{m.id}</strong>
              {m.provider && <span style={{ color: 'var(--text-muted,#888)', marginLeft: 6 }}>· {m.provider}</span>}
            </span>
            <span className={styles.hint} style={{ whiteSpace: 'nowrap' }}>{nfmt.format(m.count)}</span>
          </div>
          <div style={{ height: 5, background: 'var(--bg-input,#1a1b1e)', borderRadius: 3, overflow: 'hidden' }}>
            <div style={{ width: `${(m.count / max) * 100}%`, height: '100%', background: '#3b82f6' }} />
          </div>
        </div>
      ))}
    </div>
  );
}

/* Compact table of the busiest days */
function ActivityTable({ rows }: { rows: DayMetric[] }) {
  const sorted = [...rows]
    .sort((a, b) => ((b.team_runs_count + b.agent_runs_count) - (a.team_runs_count + a.agent_runs_count)))
    .slice(0, 6);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <div style={{ display: 'grid', gridTemplateColumns: '90px 60px 60px 1fr', fontSize: 10, color: 'var(--text-muted,#888)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px', padding: '4px 0' }}>
        <span>Date</span>
        <span style={{ textAlign: 'right' }}>Sweeps</span>
        <span style={{ textAlign: 'right' }}>Agents</span>
        <span style={{ textAlign: 'right' }}>Tokens</span>
      </div>
      {sorted.map(r => (
        <div key={r.id ?? r.date} style={{
          display: 'grid', gridTemplateColumns: '90px 60px 60px 1fr',
          fontSize: 12, alignItems: 'center', padding: '6px 0',
          borderTop: '1px solid var(--border-color)',
        }}>
          <span style={{ color: 'var(--text-primary)' }}>{shortDate(r.date)}</span>
          <span style={{ textAlign: 'right', color: '#3b82f6', fontFamily: 'ui-monospace,monospace' }}>{r.team_runs_count ?? 0}</span>
          <span style={{ textAlign: 'right', color: '#8b5cf6', fontFamily: 'ui-monospace,monospace' }}>{r.agent_runs_count ?? 0}</span>
          <span style={{ textAlign: 'right', color: 'var(--text-secondary)', fontFamily: 'ui-monospace,monospace' }}>{compactFmt.format(r.token_metrics?.total_tokens ?? 0)}</span>
        </div>
      ))}
    </div>
  );
}

