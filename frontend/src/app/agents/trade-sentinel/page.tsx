'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import Link from 'next/link';
import styles from './ts-agent.module.css';
import {
  Globe, Play, Building2, CheckCircle2,
  ShieldCheck, AlertCircle, TrendingUp, Zap, Check, ShieldAlert,
  FileWarning, RefreshCw, Filter, XCircle,
} from 'lucide-react';
import { SPECIALISTS, SpecialistPill, SweepThinking, EventRow, RegEvent, AgentReport } from './components';
import DarkSelect from '@/components/DarkSelect';

const API = 'http://localhost:7777/api/v1/gts';
const POLL_MS = 4000;
const PAGE_SIZE = 25;

/* ────────────── Types ────────────── */

type Profile = {
  id?: number;
  company_name: string;
  industry?: string;
  business_type?: string;
  business_overview?: string;
};

type SweepTask = {
  id: string | null;
  run_id?: string;
  status: 'running' | 'done' | 'error' | 'idle' | 'cancelled';
  started_at?: string;
  finished_at?: string | null;
  result?: {
    added?: number;
    duplicates?: number;
    updated?: number;
    agent_reports?: AgentReport[];
    events?: unknown[];
    error?: string;
  } | null;
  error?: string | null;
};

type Stats = { critical: number; warning: number; info: number; total_entities: number };

/* ────────────── Component ────────────── */

export default function TradeSentinelDashboard() {

  // Profile state — read-only snapshot so the header can show
  // "Profile: <company>" and the empty state can link to /profile.
  const [loadedProfile, setLoadedProfile] = useState<Profile | null>(null);
  const [profileLoading, setProfileLoading] = useState(true);

  // Overview: stats, events, filters
  const [stats, setStats] = useState<Stats>({ critical: 0, warning: 0, info: 0, total_entities: 0 });
  const [events, setEvents] = useState<RegEvent[]>([]);
  const [totalEvents, setTotalEvents] = useState(0);
  const [severityFilter, setSeverityFilter] = useState('ALL');
  const [typeFilter, setTypeFilter] = useState('ALL');
  const [statusFilter, setStatusFilter] = useState('OPEN');
  const [loadingEvents, setLoadingEvents] = useState(false);
  const [listError, setListError] = useState<string | null>(null);

  // Sweep run + polling
  const [task, setTask] = useState<SweepTask | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const startedAtRef = useRef<number | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Schedule
  const [schedule, setSchedule] = useState<'manual' | 'daily' | 'weekly' | 'monthly'>('manual');

  /* ── Loaders ─────────────────────────────────────────────── */

  const loadProfile = useCallback(async () => {
    setProfileLoading(true);
    try {
      const r = await fetch(`${API}/profile`, { credentials: 'include' });
      if (!r.ok) { setLoadedProfile(null); return; }
      const p: Profile | null = await r.json();
      setLoadedProfile(p ?? null);
    } catch {
      setLoadedProfile(null);
    } finally {
      setProfileLoading(false);
    }
  }, []);

  const buildQuery = useCallback(() => {
    const q = new URLSearchParams();
    if (severityFilter !== 'ALL') q.set('severity', severityFilter);
    if (typeFilter !== 'ALL')     q.set('type', typeFilter);
    if (statusFilter === 'OPEN')         q.set('status', 'NEW,ACKNOWLEDGED');
    else if (statusFilter === 'NEW')     q.set('status', 'NEW');
    else if (statusFilter === 'ACK')     q.set('status', 'ACKNOWLEDGED');
    else if (statusFilter === 'DISMISSED') q.set('status', 'DISMISSED');
    q.set('limit', String(PAGE_SIZE));
    q.set('offset', '0');
    return q.toString();
  }, [severityFilter, typeFilter, statusFilter]);

  const loadEvents = useCallback(async () => {
    setLoadingEvents(true);
    setListError(null);
    try {
      const r = await fetch(`${API}/events?${buildQuery()}`, { credentials: 'include' });
      if (!r.ok) { setListError(await r.text()); return; }
      const data = await r.json();
      setEvents(data.items ?? []);
      setTotalEvents(data.total ?? 0);
    } catch (e) {
      setListError((e as Error).message);
    } finally {
      setLoadingEvents(false);
    }
  }, [buildQuery]);

  const loadStats = useCallback(async () => {
    try {
      const r = await fetch(`${API}/events/stats`, { credentials: 'include' });
      if (r.ok) setStats(await r.json());
    } catch {/* noop */}
  }, []);

  const loadSchedule = useCallback(async () => {
    try {
      const r = await fetch(`${API}/schedule`, { credentials: 'include' });
      if (r.ok) {
        const d = await r.json();
        if (d?.preset) setSchedule(d.preset);
      }
    } catch {/* noop */}
  }, []);

  const loadLatestTask = useCallback(async () => {
    try {
      const r = await fetch(`${API}/sweep/latest`, { credentials: 'include' });
      if (!r.ok) return;
      const t: SweepTask = await r.json();
      if (t?.id) setTask(t);
    } catch {/* noop */}
  }, []);

  useEffect(() => { loadProfile(); loadSchedule(); loadLatestTask(); }, [loadProfile, loadSchedule, loadLatestTask]);
  useEffect(() => { loadEvents(); loadStats(); }, [loadEvents, loadStats]);

  /* ── Sweep polling (survives refresh via /sweep/latest) ── */

  useEffect(() => {
    if (task?.status !== 'running') {
      if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
      startedAtRef.current = null;
      setElapsed(0);
      return;
    }
    if (!startedAtRef.current) {
      startedAtRef.current = task.started_at ? new Date(task.started_at).getTime() : Date.now();
    }
    const tick = () => setElapsed(Math.floor((Date.now() - (startedAtRef.current ?? Date.now())) / 1000));
    tick();
    pollRef.current = setInterval(async () => {
      tick();
      if (!task?.id) return;
      try {
        const r = await fetch(`${API}/sweep/${task.id}`, { credentials: 'include' });
        if (!r.ok) return;
        const t: SweepTask = await r.json();
        setTask(t);
        if (t.status !== 'running') {
          await Promise.all([loadEvents(), loadStats()]);
        }
      } catch {/* keep polling */}
    }, POLL_MS);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [task?.id, task?.status, task?.started_at, loadEvents, loadStats]);

  /* ── Actions ─────────────────────────────────────────────── */

  const cancelSweep = async () => {
    if (!task?.id) return;
    try {
      const r = await fetch(`${API}/sweep/${task.id}/cancel`, {
        method: 'POST', credentials: 'include',
      });
      if (!r.ok) { setListError(await r.text()); return; }
      const t: SweepTask = await r.json();
      setTask(t);
    } catch (e) { setListError((e as Error).message); }
  };

  const runSweep = async () => {
    const body = {
      query: 'Run a full compliance sweep for the current company profile.',
      use_profile: true,
    };
    try {
      const r = await fetch(`${API}/sweep`, {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!r.ok) { setListError(await r.text()); return; }
      const t: SweepTask = await r.json();
      setTask(t);
    } catch (e) { setListError((e as Error).message); }
  };

  const handleStatusChange = async (id: string, newStatus: string) => {
    // Optimistic
    setEvents(prev => prev.map(e => e.id === id ? { ...e, status: newStatus } : e));
    try {
      await fetch(`${API}/events/${id}/status`, {
        method: 'PATCH', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: newStatus }),
      });
      await Promise.all([loadEvents(), loadStats()]);
    } catch {/* rollback via next load */ loadEvents(); }
  };

  const changeSchedule = async (preset: typeof schedule) => {
    setSchedule(preset);
    try {
      await fetch(`${API}/schedule`, {
        method: 'PUT', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ preset }),
      });
    } catch {/* noop */}
  };

  const reports: Record<string, AgentReport> = {};
  (task?.result?.agent_reports ?? []).forEach(r => { reports[r.agent_id] = r; });
  const running = task?.status === 'running';
  const cronActive = schedule !== 'manual';

  const profileExists = Boolean(loadedProfile);

  /* ── Render ──────────────────────────────────────────────── */

  return (
    <div className={styles.page}>
      <div className={styles.topBar}>
        <div className={styles.agentHeader}>
          <div className={styles.agentIconBox} style={{ background: 'rgba(216,155,74,0.12)', border: '1px solid rgba(216,155,74,0.35)' }}>
            <ShieldCheck size={22} color="#D89B4A" />
          </div>
          <div className={styles.agentTitleBlock}>
            <h1 className={styles.agentName}>Trade Sentinel</h1>
            <div className={styles.agentSubRow}>
              <span className={`${styles.statusDot} ${running ? styles.dotPaused : styles.dotRunning}`} />
              <span>{running ? `Sweeping… ${elapsed}s` : 'Ready'}</span>
              <span>·</span>
              <span>
                {profileLoading
                  ? 'Loading profile…'
                  : profileExists
                    ? <>Profile: <Link href="/profile" style={{ color: 'var(--text-primary)', textDecoration: 'underline', textDecorationColor: 'rgba(216,155,74,0.35)', textUnderlineOffset: 3 }}>{loadedProfile?.company_name}</Link></>
                    : <Link href="/profile" style={{ color: '#f59e0b', textDecoration: 'underline', textDecorationColor: 'rgba(245,158,11,0.4)', textUnderlineOffset: 3 }}>No profile yet — set one →</Link>}
              </span>
              <span>·</span>
              <span>Auto-Run: <strong style={{ color: 'var(--text-primary)' }}>{schedule}</strong></span>
              <span style={{
                marginLeft: 6,
                fontSize: 10,
                fontWeight: 700,
                letterSpacing: '1px',
                textTransform: 'uppercase',
                color: '#D89B4A',
                background: 'rgba(216,155,74,0.08)',
                border: '1px solid rgba(216,155,74,0.28)',
                padding: '3px 9px',
                borderRadius: 100,
              }}>
                Agno · You.com
              </span>
            </div>
          </div>
        </div>
        <div className={styles.topActions}>
          <DarkSelect
            value={schedule}
            onChange={v => changeSchedule(v as typeof schedule)}
            width={150}
            options={[
              { value: 'manual',  label: 'Manual only' },
              { value: 'daily',   label: 'Daily' },
              { value: 'weekly',  label: 'Weekly' },
              { value: 'monthly', label: 'Monthly' },
            ]}
          />
          {running ? (
            <button
              className={styles.primaryBtn}
              onClick={cancelSweep}
              style={{ background: 'rgba(239,68,68,0.15)', border: '1px solid rgba(239,68,68,0.45)', color: '#fecaca' }}
              title="Stop the current sweep. Any events already persisted stay saved."
            >
              <XCircle size={13} /> Cancel Sweep ({elapsed}s)
            </button>
          ) : (
            <button
              className={styles.primaryBtn}
              onClick={runSweep}
              disabled={cronActive}
              title={cronActive ? `Auto-run is set to ${schedule}. Switch schedule to "Manual only" to run on demand.` : undefined}
            >
              <Play size={13} />
              {cronActive ? `Cron: ${schedule}` : 'Run Sweep Now'}
            </button>
          )}
        </div>
      </div>

      <div className={styles.body}>
            {running && <SweepThinking elapsedSec={elapsed} reports={reports} />}

            {!running && task?.status === 'done' && task.result && (
              <div style={{
                display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap',
                padding: '10px 14px', background: 'var(--bg-card,#17181b)',
                border: '1px solid var(--border-color)', borderRadius: 10,
              }}>
                <span style={{ fontSize: 10, fontWeight: 600, letterSpacing: '0.6px', color: 'var(--text-muted,#888)', textTransform: 'uppercase' }}>
                  Last sweep
                </span>
                <span style={{ width: 1, height: 16, background: 'var(--border-color)' }} />
                {typeof task.result.added === 'number' && (
                  <span style={{ fontSize: 12, color: task.result.added > 0 ? '#ef4444' : '#10b981', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                    {task.result.added > 0 ? <TrendingUp size={12} /> : <Check size={12} />}
                    +{task.result.added} new · {task.result.duplicates ?? 0} duplicates
                  </span>
                )}
                <span style={{ width: 1, height: 16, background: 'var(--border-color)' }} />
                {SPECIALISTS.map(s => <SpecialistPill key={s.id} spec={s} entry={reports[s.id]} />)}
              </div>
            )}

            {!running && task?.status === 'error' && (
              <div className={styles.error}><AlertCircle size={14} /> Sweep failed: {task.error}</div>
            )}

            {!running && task?.status === 'cancelled' && (
              <div style={{
                display: 'flex', alignItems: 'center', gap: 8,
                padding: '10px 14px',
                background: 'rgba(239,68,68,0.08)',
                border: '1px solid rgba(239,68,68,0.28)',
                borderRadius: 10, fontSize: 13, color: '#fecaca',
              }}>
                <XCircle size={14} /> Sweep cancelled. Any events collected before cancellation are already persisted.
              </div>
            )}

            {/* KPI cards */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12 }}>
              <KpiCard label="Critical Action Required" value={stats.critical}       icon={<ShieldAlert size={14} />} color="#ef4444" hint={stats.critical ? 'Blocking findings — review first' : 'No blocking findings'} />
              <KpiCard label="Review Needed"            value={stats.warning}        icon={<FileWarning size={14} />} color="#f59e0b" hint={stats.warning ? `${stats.warning} to triage` : 'Clear'} />
              <KpiCard label="Entities Impacted"        value={stats.total_entities} icon={<Globe size={14} />}       color="#3b82f6" hint={stats.total_entities ? 'Across your portfolio' : 'None in scope'} />
              <KpiCard label="Active Specialists"       value={6}                    icon={<Zap size={14} />}         color="#10b981" hint="Sanctions · Export · Regulatory · Customs · Trade · Geo" />
            </div>

            {/* Filter bar */}
            <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap',
              background: 'var(--bg-card,#17181b)', border: '1px solid var(--border-color)', padding: '10px 14px', borderRadius: 10 }}>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, color: 'var(--text-secondary)', fontSize: 12, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                <Filter size={13} /> Filters
              </span>
              <DarkSelect value={typeFilter} onChange={setTypeFilter} width={170} options={[
                { value: 'ALL', label: 'All types' },
                { value: 'TARIFF', label: 'Tariffs' },
                { value: 'SANCTION', label: 'Sanctions' },
                { value: 'REGULATORY', label: 'Regulatory' },
                { value: 'EXPORT_CONTROL', label: 'Export controls' },
                { value: 'GEO_RISK', label: 'Geo risk' },
                { value: 'TRADE_AGREEMENT', label: 'Trade agreements' },
              ]} />
              <DarkSelect value={severityFilter} onChange={setSeverityFilter} width={160} options={[
                { value: 'ALL', label: 'All severities' },
                { value: 'CRITICAL', label: 'Critical' },
                { value: 'WARNING', label: 'Warning' },
                { value: 'INFO', label: 'Info' },
              ]} />
              <DarkSelect value={statusFilter} onChange={setStatusFilter} width={180} options={[
                { value: 'OPEN', label: 'Open (New + Ack)' },
                { value: 'NEW', label: 'New only' },
                { value: 'ACK', label: 'Acknowledged' },
                { value: 'DISMISSED', label: 'Dismissed' },
                { value: 'ALL', label: 'All statuses' },
              ]} />
              <button className={styles.secondaryBtn} style={{ marginLeft: 'auto' }} onClick={() => { loadEvents(); loadStats(); }}>
                <RefreshCw size={12} /> Refresh
              </button>
              <span style={{ fontSize: 11, color: 'var(--text-muted,#888)' }}>
                Showing <strong style={{ color: 'var(--text-secondary)' }}>{events.length}</strong> of <strong style={{ color: 'var(--text-secondary)' }}>{totalEvents}</strong>
              </span>
            </div>

            {/* Event list */}
            <div>
              {listError && <div className={styles.error}><AlertCircle size={14} /> {listError}</div>}
              {loadingEvents && events.length === 0 && (
                <div className={styles.hint} style={{ padding: 20, textAlign: 'center' }}>Loading events…</div>
              )}
              {!loadingEvents && events.length === 0 && !listError && (
                <div style={{ padding: '40px 24px', textAlign: 'center', color: 'var(--text-muted,#888)', fontSize: 13, border: '1px dashed var(--border-color)', borderRadius: 12 }}>
                  {totalEvents === 0 ? (
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14 }}>
                      <ShieldCheck size={28} color="#D89B4A" style={{ opacity: 0.6 }} />
                      <div style={{ fontSize: 14, color: 'var(--text-primary)', fontWeight: 600 }}>
                        No regulatory events yet.
                      </div>
                      <div style={{ maxWidth: 460, lineHeight: 1.6 }}>
                        Set your Company Profile, run a sweep, and every finding will land here with a deep-link citation to the primary source.
                      </div>
                      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'center', marginTop: 4 }}>
                        <Link href="/profile" className={styles.secondaryBtn}>
                          <Building2 size={12} /> 1 · Set Profile
                        </Link>
                        <button className={styles.primaryBtn} onClick={runSweep} disabled={running || cronActive}>
                          <Play size={12} /> 2 · Run Sweep
                        </button>
                        <span className={styles.secondaryBtn} style={{ cursor: 'default', opacity: 0.6 }}>
                          <CheckCircle2 size={12} /> 3 · Review Events
                        </span>
                      </div>
                    </div>
                  ) : (
                    'No events match the current filters.'
                  )}
                </div>
              )}
              {events.map(ev => <EventRow key={ev.id} event={ev} onStatusChange={handleStatusChange} />)}
            </div>
      </div>
    </div>
  );
}

/* ────────────── Small helpers ────────────── */

function KpiCard({ label, value, icon, color, hint }: { label: string; value: number; icon: React.ReactNode; color: string; hint: string }) {
  return (
    <div style={{ padding: '14px 16px', background: 'var(--bg-card,#17181b)', border: '1px solid var(--border-color)', borderRadius: 12, position: 'relative', overflow: 'hidden' }}>
      <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 2, background: color, opacity: 0.7 }} />
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>{label}</span>
        <div style={{ color, padding: 5, borderRadius: 6, background: `${color}18`, border: `1px solid ${color}44`, display: 'flex' }}>{icon}</div>
      </div>
      <div style={{ fontSize: 28, fontWeight: 700, color: 'var(--text-primary)', lineHeight: 1, fontFamily: 'monospace' }}>{value}</div>
      <div style={{ fontSize: 10.5, color: 'var(--text-muted,#888)', marginTop: 6 }}>{hint}</div>
    </div>
  );
}

