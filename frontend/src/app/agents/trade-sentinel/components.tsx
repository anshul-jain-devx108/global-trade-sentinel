'use client';

import { CSSProperties, useEffect, useState } from 'react';
import {
  ShieldAlert, FileWarning, Scale, Coins, Handshake, Globe, Check, Circle, AlertCircle,
  Sparkles, Clock, ExternalLink, ChevronDown, ChevronRight, RefreshCw, X,
} from 'lucide-react';

/* Specialist canonical ids match the backend agent_reports.agent_id field. */
export const SPECIALISTS = [
  { id: 'sanctions-screening',   label: 'Sanctions',   icon: ShieldAlert },
  { id: 'export-control',        label: 'Export Ctrl', icon: FileWarning },
  { id: 'regulatory-compliance', label: 'Regulatory',  icon: Scale },
  { id: 'customs-tariff',        label: 'Customs',     icon: Coins },
  { id: 'trade-agreement',       label: 'Trade Agmt',  icon: Handshake },
  { id: 'geopolitical-risk',     label: 'Geo Risk',    icon: Globe },
] as const;

export type AgentReport = {
  agent_id: string;
  findings_count: number;
  status: 'success' | 'no_data' | 'rate_limited' | 'error' | string;
  note?: string | null;
};

export type Specialist = typeof SPECIALISTS[number];

function pillTheme(entry?: AgentReport) {
  if (!entry) return { bg: 'var(--bg-elevated,#1a1b1e)', border: 'var(--border-color)', color: 'var(--text-muted,#888)', icon: <Circle size={9} />, tag: 'Pending' };
  const s = entry.status;
  if (s === 'success')      return { bg: 'rgba(16,185,129,0.12)', border: 'rgba(16,185,129,0.3)', color: '#10b981', icon: <Check size={11} />, tag: entry.findings_count != null ? `${entry.findings_count} found` : 'Done' };
  if (s === 'no_data')      return { bg: 'var(--bg-elevated,#1a1b1e)', border: 'var(--border-color)', color: 'var(--text-secondary)', icon: <Check size={11} style={{ opacity: 0.5 }} />, tag: 'Clear' };
  if (s === 'rate_limited') return { bg: 'rgba(245,158,11,0.12)', border: 'rgba(245,158,11,0.3)', color: '#f59e0b', icon: <AlertCircle size={11} />, tag: 'Rate-limited' };
  if (s === 'error')        return { bg: 'rgba(239,68,68,0.12)', border: 'rgba(239,68,68,0.3)', color: '#ef4444', icon: <AlertCircle size={11} />, tag: 'Error' };
  if (s === 'running')      return { bg: 'rgba(59,130,246,0.14)', border: 'rgba(59,130,246,0.3)', color: '#3b82f6', icon: <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#3b82f6', display: 'inline-block' }} />, tag: 'Working' };
  return { bg: 'var(--bg-elevated,#1a1b1e)', border: 'var(--border-color)', color: 'var(--text-muted,#888)', icon: <Circle size={9} />, tag: s || 'Pending' };
}

export function SpecialistPill({ spec, entry }: { spec: Specialist; entry?: AgentReport }) {
  const t = pillTheme(entry);
  const SIcon = spec.icon;
  const title = entry?.note ? `${spec.label} — ${t.tag}: ${entry.note}` : `${spec.label} — ${t.tag}`;
  return (
    <div title={title} style={{
      display: 'inline-flex', alignItems: 'center', gap: 6, padding: '5px 10px', borderRadius: 999,
      background: t.bg, border: `1px solid ${t.border}`, color: t.color, fontSize: 11, fontWeight: 500,
    }}>
      {t.icon}
      <SIcon size={11} style={{ opacity: 0.7 }} />
      <span>{spec.label}</span>
      {entry && <span style={{ opacity: 0.7, marginLeft: 2 }}>· {t.tag}</span>}
    </div>
  );
}

const THINKING_MESSAGES = [
  'Thinking through your portfolio…',
  'Skimming the latest regulatory feeds…',
  'Cross-referencing HS codes with active sanctions lists…',
  'Reading source documents so you don\'t have to…',
  'Weighing which updates actually matter…',
  'Piecing the findings together…',
  'Almost there — polishing the report…',
];

export function SweepThinking({ elapsedSec, reports }: { elapsedSec: number; reports: Record<string, AgentReport> }) {
  const [idx, setIdx] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setIdx(p => (p + 1) % THINKING_MESSAGES.length), 3200);
    return () => clearInterval(t);
  }, []);
  const msg = THINKING_MESSAGES[idx];
  return (
    <div style={{
      display: 'flex', flexDirection: 'column', gap: 14, padding: '18px 22px',
      background: 'var(--bg-card,#17181b)', border: '1px solid var(--border-color)',
      borderRadius: 14, position: 'relative', overflow: 'hidden',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
        <div style={{
          width: 36, height: 36, borderRadius: 10, display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: 'linear-gradient(135deg,#6366f1 0%,#8b5cf6 100%)', color: '#fff',
        }}>
          <Sparkles size={16} />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 10, fontWeight: 600, letterSpacing: '0.6px', color: 'var(--text-muted,#888)', textTransform: 'uppercase', marginBottom: 4 }}>
            Sentinel is working <span style={{ color: 'var(--text-secondary)' }}>· {elapsedSec}s elapsed</span>
          </div>
          <div style={{ fontSize: 14, color: 'var(--text-primary)' }}>{msg}</div>
        </div>
        <div style={{ display: 'flex', gap: 5 }}>
          {[0, 1, 2].map(i => (
            <div key={i} style={{
              width: 6, height: 6, borderRadius: '50%', background: '#3b82f6',
              animation: `dotBounce 1.2s ease-in-out ${i * 0.15}s infinite`,
            }} />
          ))}
        </div>
      </div>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {SPECIALISTS.map(s => <SpecialistPill key={s.id} spec={s} entry={reports[s.id]} />)}
      </div>
      <style>{`@keyframes dotBounce {0%,80%,100%{transform:translateY(0);opacity:0.4}40%{transform:translateY(-4px);opacity:1}}`}</style>
    </div>
  );
}

/* ── Event card ────────────────────────────────────────────────── */

export type RegEvent = {
  id: string;
  event_type: string;
  severity: string;
  title: string;
  jurisdiction: string;
  published_at?: string | null;
  effective_from?: string | null;
  effective_until?: string | null;
  detected_at?: string | null;
  description: string;
  impact: string;
  status: 'NEW' | 'ACKNOWLEDGED' | 'DISMISSED' | string;
  affected_entities: string[];
  citations: { title: string; url: string }[];
};

const SEV: Record<string, { color: string; bg: string; label: string; accent: string }> = {
  CRITICAL: { color: '#ef4444', bg: 'rgba(239,68,68,0.12)',  label: 'Action Required', accent: 'rgba(239,68,68,0.06)' },
  WARNING:  { color: '#f59e0b', bg: 'rgba(245,158,11,0.12)', label: 'Review Needed',   accent: 'rgba(245,158,11,0.05)' },
  INFO:     { color: '#6b7280', bg: 'rgba(107,114,128,0.08)', label: 'FYI',             accent: 'transparent' },
};

const TYP: Record<string, { icon: typeof ShieldAlert; color: string; label: string }> = {
  TARIFF:          { icon: Coins,       color: '#f59e0b', label: 'Tariff Update' },
  SANCTION:        { icon: ShieldAlert, color: '#ef4444', label: 'Sanction Alert' },
  REGULATORY:      { icon: Scale,       color: '#3b82f6', label: 'Regulatory Change' },
  EXPORT_CONTROL:  { icon: FileWarning, color: '#a78bfa', label: 'Export Control' },
  GEO_RISK:        { icon: Globe,       color: '#f472b6', label: 'Geo Risk' },
  TRADE_AGREEMENT: { icon: Handshake,   color: '#10b981', label: 'Trade Agreement' },
};

function fmtDate(iso?: string | null) {
  if (!iso) return { abs: '—', rel: '', tone: 'muted' as const };
  const d = new Date(iso + (iso.length === 10 ? 'T00:00:00' : ''));
  if (isNaN(d.getTime())) return { abs: iso, rel: '', tone: 'muted' as const };
  const abs = d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const diff = Math.round((d.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
  let rel = '', tone: 'future' | 'recent' | 'muted' | 'old' = 'muted';
  if      (diff === 0)     { rel = 'today';    tone = 'recent'; }
  else if (diff === 1)     { rel = 'tomorrow'; tone = 'future'; }
  else if (diff === -1)    { rel = 'yesterday'; tone = 'recent'; }
  else if (diff > 0 && diff < 30)   { rel = `in ${diff}d`; tone = 'future'; }
  else if (diff > 0)                { rel = `in ${Math.round(diff/30)}mo`; tone = 'future'; }
  else if (diff > -7)               { rel = `${-diff}d ago`; tone = 'recent'; }
  else if (diff > -30)              { rel = `${-diff}d ago`; tone = 'muted'; }
  else                              { rel = `${Math.round(-diff/30)}mo ago`; tone = 'old'; }
  return { abs, rel, tone };
}

export function EventRow({ event, onStatusChange }: { event: RegEvent; onStatusChange: (id: string, s: string) => void }) {
  const [open, setOpen] = useState(event.severity === 'CRITICAL');
  const [busy, setBusy] = useState(false);
  const sev = SEV[event.severity] ?? SEV.INFO;
  const typ = TYP[event.event_type] ?? TYP.REGULATORY;
  const Icon = typ.icon;
  const eff = fmtDate(event.effective_from);
  const isAck = event.status === 'ACKNOWLEDGED';
  const isDismissed = event.status === 'DISMISSED';

  const setStatus = async (newStatus: string, e?: React.MouseEvent) => {
    e?.stopPropagation();
    setBusy(true);
    try { onStatusChange(event.id, newStatus); }
    finally { setBusy(false); }
  };

  const border: CSSProperties = {
    border: '1px solid var(--border-color)',
    borderLeft: `3px solid ${sev.color}`,
    background: `linear-gradient(90deg, ${sev.accent} 0%, var(--bg-card,#17181b) 40%)`,
    marginBottom: 8, borderRadius: 10, opacity: isDismissed ? 0.55 : 1,
  };
  return (
    <div style={border}>
      <div onClick={() => setOpen(o => !o)} style={{ display: 'flex', alignItems: 'center', padding: '14px 18px', cursor: 'pointer', gap: 14 }}>
        <div style={{
          width: 32, height: 32, borderRadius: 8, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: `${typ.color}22`, color: typ.color, border: `1px solid ${typ.color}55`,
        }}>
          <Icon size={14} />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--text-primary)' }}>{event.title}</div>
          <div style={{ fontSize: 11, color: 'var(--text-muted,#888)', marginTop: 3, display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><Clock size={10} /> Effective {eff.abs}</span>
            {eff.rel && <span style={{ color: eff.tone === 'future' ? '#3b82f6' : eff.tone === 'recent' ? '#f59e0b' : 'inherit' }}>· {eff.rel}</span>}
            <span>· {event.jurisdiction}</span>
            <span style={{ opacity: 0.55, fontFamily: 'monospace' }}>· {event.id}</span>
            {isAck && <span style={{ color: '#10b981' }}>· ✓ Acknowledged</span>}
          </div>
        </div>
        <span style={{ padding: '3px 8px', borderRadius: 6, background: `${typ.color}18`, color: typ.color, fontSize: 11, border: `1px solid ${typ.color}55` }}>{typ.label}</span>
        <span style={{ padding: '3px 8px', borderRadius: 6, background: sev.bg, color: sev.color, fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.5px', fontWeight: 600, border: `1px solid ${sev.color}55` }}>{sev.label}</span>
        {open ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
      </div>
      {open && (
        <div style={{ padding: '0 18px 18px 62px', borderTop: '1px solid var(--border-color)' }}>
          <div style={{ marginTop: 14, marginBottom: 16 }}>
            <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--text-muted,#888)', textTransform: 'uppercase', letterSpacing: '0.8px', marginBottom: 6 }}>Description</div>
            <div style={{ fontSize: 13, color: 'var(--text-primary)', lineHeight: 1.6 }}>{event.description}</div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '260px 1fr', gap: 18, marginBottom: 16 }}>
            {event.affected_entities.length > 0 && (
              <div>
                <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--text-muted,#888)', textTransform: 'uppercase', letterSpacing: '0.8px', marginBottom: 6 }}>Affected</div>
                {event.affected_entities.map((e, i) => (
                  <div key={i} style={{ fontSize: 12, padding: '5px 10px', background: 'var(--bg-input,#1a1b1e)', border: '1px solid var(--border-color)', borderRadius: 6, marginBottom: 4 }}>{e}</div>
                ))}
              </div>
            )}
            <div>
              <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--text-muted,#888)', textTransform: 'uppercase', letterSpacing: '0.8px', marginBottom: 6 }}>Impact</div>
              <div style={{ fontSize: 12.5, color: 'var(--text-primary)', lineHeight: 1.6, padding: '10px 12px', background: 'var(--bg-input,#1a1b1e)', border: '1px solid var(--border-color)', borderRadius: 6 }}>{event.impact}</div>
            </div>
          </div>
          {event.citations.length > 0 && (
            <div style={{ marginBottom: 14 }}>
              <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--text-muted,#888)', textTransform: 'uppercase', letterSpacing: '0.8px', marginBottom: 6 }}>Sources</div>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {event.citations.map((c, i) => (
                  <a key={i} href={c.url} target="_blank" rel="noreferrer" style={{
                    display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--text-secondary)',
                    background: 'var(--bg-input,#1a1b1e)', border: '1px solid var(--border-color)', padding: '5px 10px', borderRadius: 6, textDecoration: 'none',
                  }}>
                    <span style={{ maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.title || c.url}</span>
                    <ExternalLink size={11} style={{ opacity: 0.6 }} />
                  </a>
                ))}
              </div>
            </div>
          )}
          <div style={{ display: 'flex', gap: 8, paddingTop: 8 }}>
            {!isAck && !isDismissed && (
              <button disabled={busy} onClick={(e) => setStatus('ACKNOWLEDGED', e)} style={btnPrimary}>
                <Check size={12} /> Acknowledge
              </button>
            )}
            {isAck && (
              <button disabled={busy} onClick={(e) => setStatus('NEW', e)} style={btnGhost}>
                <RefreshCw size={12} /> Reopen
              </button>
            )}
            {!isDismissed && (
              <button disabled={busy} onClick={(e) => setStatus('DISMISSED', e)} style={btnGhost}>
                <X size={12} /> Dismiss
              </button>
            )}
            {isDismissed && (
              <button disabled={busy} onClick={(e) => setStatus('NEW', e)} style={btnGhost}>
                <RefreshCw size={12} /> Restore
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

const btnPrimary: CSSProperties = {
  display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 600, color: 'white',
  background: '#3b82f6', border: 'none', padding: '6px 14px', borderRadius: 6, cursor: 'pointer',
};
const btnGhost: CSSProperties = {
  display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--text-secondary)',
  background: 'transparent', border: '1px solid var(--border-color)', padding: '6px 14px', borderRadius: 6, cursor: 'pointer',
};
