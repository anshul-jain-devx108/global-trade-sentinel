'use client';

import Link from 'next/link';
import { useState } from 'react';
import useSWR from 'swr';
import styles from './agents.module.css';
import {
  Bot, CheckCircle2, Play, Clock, Zap,
  ShieldAlert, FileWarning, Scale, Ship, Handshake, Radar, Sparkles,
  ToggleLeft, ToggleRight, AlertCircle, RefreshCw,
  LucideIcon,
} from 'lucide-react';
import { GTS_API } from '@/lib/api';

/**
 * The Agents page reads specialists live from the AgentOS runtime:
 *   GET /api/v1/gts/specialists  →  [{ id, name, role, enabled }, ...]
 *
 * Toggling emits `PATCH /gts/specialists/{id}/enabled` which the server
 * persists to disk. Disabled specialists are wrapped into an XML
 * `<excluded_specialists>` block in the sweep prompt so the leader agent
 * skips delegation to them.
 *
 * SWR keeps the specialist registry cached across route switches — coming
 * back to /agents from /chat renders instantly from cache while a
 * background revalidation refreshes the toggle state.
 */

type Specialist = { id: string; name: string; role: string; enabled: boolean };

/**
 * Icon + accent color per specialist id. Anything not in the map falls back
 * to a generic Bot icon and neutral gold — so a NEW specialist added to the
 * backend renders correctly without a frontend change.
 */
const ICON_BY_ID: Record<string, LucideIcon> = {
  'sanctions-screening':   ShieldAlert,
  'export-control':        FileWarning,
  'regulatory-compliance': Scale,
  'customs-tariff':        Ship,
  'trade-agreement':       Handshake,
  'geopolitical-risk':     Radar,
};

const COLOR_BY_ID: Record<string, string> = {
  'sanctions-screening':   '#ef4444',
  'export-control':        '#f59e0b',
  'regulatory-compliance': '#8b5cf6',
  'customs-tariff':        '#3b82f6',
  'trade-agreement':       '#10b981',
  'geopolitical-risk':     '#ec4899',
};

export default function AgentsPage() {
  const {
    data: specialists,
    error: fetchError,
    isLoading,
    mutate,
  } = useSWR<Specialist[] | null>(`${GTS_API}/specialists`);

  // Local UX state — SWR handles the specialist list itself.
  const [error, setError] = useState<string | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);

  // Surface network errors that got past SWR's retry policy.
  const errorMsg = error
    ?? (fetchError ? `Unable to reach the AgentOS runtime — ${fetchError.message}. Is the GTS service running?` : null);

  const toggle = async (id: string) => {
    if (!specialists) return;
    const current = specialists.find(s => s.id === id);
    if (!current) return;
    const next = !current.enabled;

    // Optimistic update — SWR's mutate revalidates from the server after
    // the PATCH completes, so we don't need to manually re-fetch.
    setPendingId(id);
    setError(null);
    const optimistic = specialists.map(s => s.id === id ? { ...s, enabled: next } : s);
    mutate(optimistic, { revalidate: false });

    try {
      const r = await fetch(`${GTS_API}/specialists/${id}/enabled`, {
        method: 'PATCH', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: next }),
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      // Server truth wins — refetch to pick up any server-side coercion.
      mutate();
    } catch (e) {
      setError(`Failed to update ${id}: ${(e as Error).message}`);
      // Roll back optimistic change.
      mutate(specialists, { revalidate: false });
    } finally {
      setPendingId(null);
    }
  };

  const enabledCount = specialists ? specialists.filter(s => s.enabled).length : 0;

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div>
          <h1 className={styles.pageTitle}>Agents</h1>
          <p className={styles.pageSubtitle}>
            Live from the AgentOS runtime. One Agno Team, {specialists?.length ?? '…'} domain specialists — toggle any of them below to shape the next sweep.
          </p>
        </div>
        <button
          className={styles.tab}
          onClick={() => mutate()}
          disabled={isLoading}
          title="Re-fetch the registry from the AgentOS runtime"
          style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
        >
          <RefreshCw size={13} className={isLoading ? styles.spinIcon : ''} />
          Refresh
        </button>
      </header>

      {/* Error banner ─────────────────────────────────────────── */}
      {errorMsg && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: 8,
          padding: '10px 14px', marginBottom: 16,
          background: 'rgba(239, 68, 68, 0.08)',
          border: '1px solid rgba(239, 68, 68, 0.3)',
          borderRadius: 8, fontSize: 13, color: '#fecaca',
        }}>
          <AlertCircle size={14} /> {errorMsg}
        </div>
      )}

      {/* ── The Team (Leader) — always shown, non-toggleable ── */}
      <div className={styles.section}>
        <Link href="/agents/trade-sentinel" className={styles.activeCard}>
          <div className={styles.activeCardLeft}>
            <div className={styles.agentIconBox} style={{ background: 'rgba(216,155,74,0.12)', border: '1px solid rgba(216,155,74,0.3)' }}>
              <Bot size={20} color="#D89B4A" />
            </div>
            <div className={styles.agentInfo}>
              <div className={styles.agentNameRow}>
                <span className={styles.agentName}>Global Trade Sweep Team</span>
                <span className={styles.agentTypeTag}>Agno Team · sweep-leader</span>
                <span className={`${styles.statusChip} ${styles.statusRunning}`}>
                  <Play size={10} /> Live on AgentOS
                </span>
              </div>
              <p className={styles.agentDesc}>
                Master orchestrator. Reads the company profile as XML-tagged blocks, routes scoped context to each enabled specialist, deduplicates findings, and returns a typed <code>SweepReportModel</code>. Members run in parallel; the leader does no primary research itself.
              </p>
              <div className={styles.agentMeta}>
                <span><Zap size={12} /> Manual + Auto-Run (daily · weekly · monthly)</span>
                <span><Clock size={12} /> See dashboard for last sweep</span>
                <span><CheckCircle2 size={12} /> {enabledCount} of {specialists?.length ?? 0} specialists enabled</span>
              </div>
            </div>
          </div>
        </Link>
      </div>

      {/* ── Specialists (dynamic + togglable) ── */}
      <div className={styles.storePage}>
        <p className={styles.storeLabel}>
          {isLoading && !specialists
            ? 'Loading the specialist registry…'
            : 'Toggle a specialist off and the leader will skip it on the next sweep. Each specialist is scoped to its own primary-source whitelist via You.com Research API.'}
        </p>

        {isLoading && !specialists && (
          <div style={{ padding: '32px 16px', textAlign: 'center', color: 'var(--text-muted, #888)', fontSize: 13 }}>
            <RefreshCw size={20} className={styles.spinIcon} style={{ opacity: 0.6 }} />
          </div>
        )}

        {!isLoading && specialists && specialists.length === 0 && (
          <div style={{
            padding: '32px 20px', textAlign: 'center',
            color: 'var(--text-muted, #888)', fontSize: 13,
            border: '1px dashed var(--border-color)', borderRadius: 12,
          }}>
            No specialists registered on the runtime yet.
          </div>
        )}

        <div className={styles.storeGrid}>
          {specialists?.map(s => {
            const Icon = ICON_BY_ID[s.id] ?? Bot;
            const color = COLOR_BY_ID[s.id] ?? '#D89B4A';
            const isOn = s.enabled;
            const busy = pendingId === s.id;

            return (
              <div key={s.id} className={styles.comingSoonCard} style={{ opacity: isOn ? 1 : 0.55 }}>
                <div className={styles.storeCardHeader}>
                  <div className={styles.storeEmoji} style={{ background: color + '18', border: `1px solid ${color}28` }}>
                    <Icon size={20} color={color} />
                  </div>
                  <button
                    onClick={() => toggle(s.id)}
                    disabled={busy}
                    title={isOn ? 'Disable this specialist for future sweeps' : 'Re-enable this specialist'}
                    style={{ background: 'transparent', border: 'none', padding: 0, cursor: busy ? 'not-allowed' : 'pointer', display: 'inline-flex', opacity: busy ? 0.5 : 1 }}
                  >
                    {isOn
                      ? <ToggleRight size={28} color="#10b981" />
                      : <ToggleLeft size={28} color="#555" />}
                  </button>
                </div>
                <h3 className={styles.storeName}>{s.name}</h3>
                <p className={styles.storeDesc}>{s.role || 'No role description provided'}</p>
                <div className={styles.lockRow}>
                  <span style={{ fontFamily: 'monospace', fontSize: 11, color: 'var(--text-muted, #888)' }}>{s.id}</span>
                  <span style={{ marginLeft: 'auto', fontSize: 11, color: isOn ? '#10b981' : '#888' }}>
                    {busy ? 'Saving…' : isOn ? 'Enabled' : 'Disabled'}
                  </span>
                </div>
              </div>
            );
          })}
        </div>

        {/* Onboarding Copilot — surfaced honestly as an out-of-team helper */}
        <p className={styles.storeLabel} style={{ marginTop: 24 }}>
          Helper agents (not part of the sweep team)
        </p>
        <div className={styles.storeGrid}>
          <div className={styles.comingSoonCard}>
            <div className={styles.storeCardHeader}>
              <div className={styles.storeEmoji} style={{ background: 'rgba(96,165,250,0.18)', border: '1px solid rgba(96,165,250,0.28)' }}>
                <Sparkles size={20} color="#60a5fa" />
              </div>
              <span className={styles.categoryBadge}>Profile flow only</span>
            </div>
            <h3 className={styles.storeName}>Onboarding Copilot</h3>
            <p className={styles.storeDesc}>Stateless reasoning-only agent, no web tools. Generates clarifying questions and enriches the company profile for downstream sweeps.</p>
            <div className={styles.lockRow}>
              <span style={{ fontFamily: 'monospace', fontSize: 11, color: 'var(--text-muted, #888)' }}>onboarding-copilot</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
