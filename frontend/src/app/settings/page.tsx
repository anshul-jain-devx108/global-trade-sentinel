'use client';

import { useState, useEffect, useCallback } from 'react';
import styles from './page.module.css';
import { User, Bell, ShieldCheck, Play, Pause, Zap, RefreshCw, AlertCircle, CheckCircle2 } from 'lucide-react';

type Tab = 'profile' | 'notifications' | 'stack';

const GTS = 'http://localhost:7777/api/v1/gts';

const AUTO_RUN_OPTIONS = [
  { value: 'manual',  label: 'Manual only',       hint: 'Sweeps only when you click "Run Sweep Now"' },
  { value: 'daily',   label: 'Daily',             hint: 'One sweep every 24 hours' },
  { value: 'weekly',  label: 'Weekly',            hint: 'One sweep every 7 days' },
  { value: 'monthly', label: 'Monthly',           hint: 'One sweep every 30 days' },
];

type ScheduleInfo = {
  preset: string;
  schedule_id: string | null;
  enabled: boolean;
  next_run_at: number | null;   // unix seconds
  cron_expr: string | null;
};

type ScheduleRun = {
  id: string | null;
  status: string | null;
  triggered_at: number | null;  // unix seconds
  completed_at: number | null;
  error: string | null;
};

const fmtEpoch = (s: number | null) => s ? new Date(s * 1000).toLocaleString() : '—';

const DIGEST_OPTIONS = [
  { value: 'off',       label: 'Off' },
  { value: 'critical',  label: 'Critical findings only' },
  { value: 'daily',     label: 'Daily digest of new findings' },
  { value: 'weekly',    label: 'Weekly digest' },
];

export default function SettingsPage() {
  const [activeTab, setActiveTab] = useState<Tab>('profile');
  const [emailDigest, setEmailDigest] = useState('critical');
  const [notifyOnSweep, setNotifyOnSweep] = useState(true);

  const [user, setUser] = useState<{ id: string; email: string; full_name: string; role: string } | null>(null);

  // Live schedule state from the AgentOS runtime
  const [sched, setSched] = useState<ScheduleInfo | null>(null);
  const [schedRuns, setSchedRuns] = useState<ScheduleRun[] | null>(null);
  const [schedBusy, setSchedBusy] = useState(false);
  const [schedError, setSchedError] = useState<string | null>(null);

  useEffect(() => {
    fetch('http://localhost:7777/api/v1/auth/me', { credentials: 'include' })
      .then(res => res.ok ? res.json() : null)
      .then(data => {
        if (data) {
          setUser(data);
        }
      })
      .catch(err => console.error("Failed to load profile", err));
  }, []);

  const loadSchedule = useCallback(async () => {
    try {
      const r = await fetch(`${GTS}/schedule`, { credentials: 'include' });
      if (r.ok) setSched(await r.json());
    } catch (e) { setSchedError((e as Error).message); }
  }, []);

  const loadScheduleRuns = useCallback(async () => {
    try {
      const r = await fetch(`${GTS}/schedule/runs?limit=10`, { credentials: 'include' });
      if (r.ok) {
        const data = await r.json();
        setSchedRuns(data.runs ?? []);
      }
    } catch { /* noop */ }
  }, []);

  useEffect(() => {
    if (activeTab === 'notifications') {
      loadSchedule();
      loadScheduleRuns();
    }
  }, [activeTab, loadSchedule, loadScheduleRuns]);

  const changePreset = async (preset: string) => {
    setSchedBusy(true); setSchedError(null);
    try {
      const r = await fetch(`${GTS}/schedule`, {
        method: 'PUT', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ preset }),
      });
      if (!r.ok) { setSchedError(await r.text()); return; }
      await loadSchedule();
    } catch (e) { setSchedError((e as Error).message); }
    finally { setSchedBusy(false); }
  };

  const toggleEnabled = async () => {
    if (!sched?.schedule_id) return;
    setSchedBusy(true); setSchedError(null);
    try {
      const endpoint = sched.enabled ? 'disable' : 'enable';
      const r = await fetch(`${GTS}/schedule/${endpoint}`, {
        method: 'POST', credentials: 'include',
      });
      if (!r.ok) { setSchedError(await r.text()); return; }
      await loadSchedule();
    } catch (e) { setSchedError((e as Error).message); }
    finally { setSchedBusy(false); }
  };

  const triggerNow = async () => {
    setSchedBusy(true); setSchedError(null);
    try {
      const r = await fetch(`${GTS}/schedule/trigger`, {
        method: 'POST', credentials: 'include',
      });
      if (!r.ok) { setSchedError(await r.text()); return; }
      await loadScheduleRuns();
    } catch (e) { setSchedError((e as Error).message); }
    finally { setSchedBusy(false); }
  };

  const getInitials = (name: string) => {
    if (!name) return "?";
    return name.split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase();
  };

  return (
    <div className={styles.pageContainer}>
      <header className={styles.header}>
        <h1 className={styles.title}>Settings</h1>
        <p className={styles.subtitle}>Manage your account, sweep cadence, and notifications.</p>
      </header>

      <div className={styles.contentWrapper}>

        {/* Sidebar Nav */}
        <nav className={styles.settingsNav}>
          <button
            className={`${styles.navItem} ${activeTab === 'profile' ? styles.navItemActive : ''}`}
            onClick={() => setActiveTab('profile')}
          >
            <User size={16} /> Profile
          </button>
          <button
            className={`${styles.navItem} ${activeTab === 'notifications' ? styles.navItemActive : ''}`}
            onClick={() => setActiveTab('notifications')}
          >
            <Bell size={16} /> Sweep &amp; Notifications
          </button>
          <button
            className={`${styles.navItem} ${activeTab === 'stack' ? styles.navItemActive : ''}`}
            onClick={() => setActiveTab('stack')}
          >
            <ShieldCheck size={16} /> Stack
          </button>
        </nav>

        {/* Content Area */}
        <div className={styles.settingsContent}>

          {/* PROFILE TAB */}
          {activeTab === 'profile' && (
            <div className={styles.section}>
              <h2 className={styles.sectionTitle}>Profile Information</h2>
              <div className={styles.card}>

                <div className={styles.avatarSection}>
                  <div className={styles.avatar}>{getInitials(user?.full_name || "")}</div>
                  <div style={{ display: 'flex', gap: '12px' }}>
                    <button className={styles.uploadBtn}>Upload new photo</button>
                    <button className={styles.removeBtn}>Remove</button>
                  </div>
                </div>

                <div className={styles.formGroup}>
                  <label className={styles.label}>Full Name</label>
                  <div style={{ color: 'var(--text-secondary)', fontSize: '14px', marginTop: '4px', padding: '8px 12px', background: 'rgba(255, 255, 255, 0.03)', borderRadius: '8px', border: '1px solid rgba(255, 255, 255, 0.05)' }}>
                    {user?.full_name || "Loading..."}
                  </div>
                </div>

                <div className={styles.formGroup}>
                  <label className={styles.label}>Email Address</label>
                  <div style={{ color: 'var(--text-secondary)', fontSize: '14px', marginTop: '4px', padding: '8px 12px', background: 'rgba(255, 255, 255, 0.03)', borderRadius: '8px', border: '1px solid rgba(255, 255, 255, 0.05)' }}>
                    {user?.email || "Loading..."}
                  </div>
                </div>

              </div>
            </div>
          )}

          {/* NOTIFICATIONS TAB */}
          {activeTab === 'notifications' && (
            <div className={styles.section}>
              <h2 className={styles.sectionTitle}>Auto-Run Cadence</h2>
              <div className={styles.card}>
                <p style={{ color: 'var(--text-secondary)', fontSize: 13, marginBottom: 16, lineHeight: 1.6 }}>
                  How often the Sentinel team should sweep the primary sources without you triggering it. Runs on AgentOS&apos;s scheduler. You can still hit &quot;Run Sweep Now&quot; at any time.
                </p>

                {schedError && (
                  <div style={{
                    display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', marginBottom: 12,
                    background: 'rgba(239, 68, 68, 0.08)', border: '1px solid rgba(239, 68, 68, 0.28)',
                    borderRadius: 8, fontSize: 12, color: '#fecaca',
                  }}>
                    <AlertCircle size={13} /> {schedError}
                  </div>
                )}

                {AUTO_RUN_OPTIONS.map(opt => (
                  <label key={opt.value} className={styles.formGroup} style={{ display: 'flex', gap: 12, alignItems: 'flex-start', cursor: 'pointer', padding: '8px 4px', opacity: schedBusy ? 0.6 : 1 }}>
                    <input
                      type="radio"
                      name="autorun"
                      checked={sched?.preset === opt.value}
                      onChange={() => changePreset(opt.value)}
                      disabled={schedBusy}
                      style={{ accentColor: '#D89B4A', marginTop: 3 }}
                    />
                    <div>
                      <div style={{ fontSize: 14, color: 'var(--text-primary)', fontWeight: 500 }}>{opt.label}</div>
                      <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 2 }}>{opt.hint}</div>
                    </div>
                  </label>
                ))}

                {sched && sched.schedule_id && (
                  <div style={{
                    marginTop: 16, padding: '12px 14px',
                    background: 'rgba(216,155,74,0.06)', border: '1px solid rgba(216,155,74,0.22)',
                    borderRadius: 10, display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center',
                  }}>
                    <span style={{
                      display: 'inline-flex', alignItems: 'center', gap: 6,
                      padding: '3px 10px', borderRadius: 100, fontSize: 11, fontWeight: 600,
                      background: sched.enabled ? 'rgba(16,185,129,0.14)' : 'rgba(180,180,180,0.14)',
                      color: sched.enabled ? '#10b981' : '#888',
                      border: `1px solid ${sched.enabled ? 'rgba(16,185,129,0.3)' : 'rgba(180,180,180,0.28)'}`,
                    }}>
                      {sched.enabled
                        ? <><CheckCircle2 size={11} /> Active</>
                        : <><Pause size={11} /> Paused</>}
                    </span>
                    {sched.next_run_at && sched.enabled && (
                      <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                        Next run: <strong style={{ color: 'var(--text-primary)' }}>{fmtEpoch(sched.next_run_at)}</strong>
                      </span>
                    )}
                    <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
                      <button
                        onClick={toggleEnabled}
                        disabled={schedBusy}
                        style={{
                          display: 'inline-flex', alignItems: 'center', gap: 6,
                          padding: '6px 12px', fontSize: 12, fontWeight: 600,
                          background: 'rgba(255,255,255,0.06)', border: '1px solid var(--border-color)',
                          borderRadius: 8, color: 'var(--text-primary)', cursor: schedBusy ? 'not-allowed' : 'pointer',
                        }}
                      >
                        {sched.enabled ? <><Pause size={12} /> Pause</> : <><Play size={12} /> Resume</>}
                      </button>
                      <button
                        onClick={triggerNow}
                        disabled={schedBusy || !sched.enabled}
                        title={!sched.enabled ? 'Resume the schedule first' : 'Run this schedule right now, without waiting for the next tick'}
                        style={{
                          display: 'inline-flex', alignItems: 'center', gap: 6,
                          padding: '6px 12px', fontSize: 12, fontWeight: 600,
                          background: '#D89B4A', color: '#000',
                          borderRadius: 8, cursor: (schedBusy || !sched.enabled) ? 'not-allowed' : 'pointer',
                          opacity: (schedBusy || !sched.enabled) ? 0.5 : 1,
                        }}
                      >
                        <Zap size={12} /> Trigger now
                      </button>
                    </div>
                  </div>
                )}

                {sched && !sched.schedule_id && sched.preset === 'manual' && (
                  <p style={{ marginTop: 12, fontSize: 12, color: 'var(--text-secondary)', fontStyle: 'italic' }}>
                    Currently manual — no scheduled row on the runtime. Pick a cadence above to create one.
                  </p>
                )}
              </div>

              {schedRuns && schedRuns.length > 0 && (
                <>
                  <h2 className={styles.sectionTitle} style={{ marginTop: 20, display: 'flex', alignItems: 'center', gap: 8 }}>
                    Recent scheduled runs
                    <button
                      onClick={loadScheduleRuns}
                      style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '3px 8px', fontSize: 11, background: 'rgba(255,255,255,0.05)', border: '1px solid var(--border-color)', borderRadius: 6, color: 'var(--text-secondary)' }}
                    >
                      <RefreshCw size={11} /> Refresh
                    </button>
                  </h2>
                  <div className={styles.card}>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                      {schedRuns.map((r, i) => (
                        <div key={r.id ?? i} style={{
                          display: 'flex', alignItems: 'center', gap: 12,
                          padding: '8px 12px', fontSize: 12,
                          borderBottom: i === schedRuns.length - 1 ? 'none' : '1px solid var(--border-color)',
                        }}>
                          <span style={{
                            padding: '2px 8px', borderRadius: 6, fontSize: 10, fontWeight: 700, letterSpacing: 0.4, textTransform: 'uppercase',
                            background: r.status === 'success' ? 'rgba(16,185,129,0.15)' : r.status === 'failed' ? 'rgba(239,68,68,0.15)' : 'rgba(180,180,180,0.14)',
                            color: r.status === 'success' ? '#10b981' : r.status === 'failed' ? '#ef4444' : '#888',
                          }}>
                            {r.status ?? 'unknown'}
                          </span>
                          <span style={{ color: 'var(--text-secondary)' }}>
                            {fmtEpoch(r.triggered_at)}
                          </span>
                          {r.error && (
                            <span style={{ color: '#fecaca', fontSize: 11, marginLeft: 'auto', maxWidth: 260, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={r.error}>
                              {r.error}
                            </span>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                </>
              )}

              <h2 className={styles.sectionTitle} style={{ marginTop: 20 }}>Email Digest</h2>
              <div className={styles.card}>
                <p style={{ color: 'var(--text-secondary)', fontSize: 13, marginBottom: 16, lineHeight: 1.6 }}>
                  When Sentinel should send you findings by email.
                </p>
                {DIGEST_OPTIONS.map(opt => (
                  <label key={opt.value} className={styles.formGroup} style={{ display: 'flex', gap: 12, alignItems: 'center', cursor: 'pointer', padding: '8px 4px' }}>
                    <input
                      type="radio"
                      name="digest"
                      checked={emailDigest === opt.value}
                      onChange={() => setEmailDigest(opt.value)}
                      style={{ accentColor: '#D89B4A' }}
                    />
                    <span style={{ fontSize: 14, color: 'var(--text-primary)' }}>{opt.label}</span>
                  </label>
                ))}
              </div>

              <h2 className={styles.sectionTitle} style={{ marginTop: 20 }}>In-app Alerts</h2>
              <div className={styles.card}>
                <div className={styles.toggleRow}>
                  <div className={styles.toggleInfo}>
                    <span className={styles.toggleTitle}>Notify on sweep completion</span>
                    <span className={styles.toggleDesc}>Get a toast when a sweep finishes with new findings.</span>
                  </div>
                  <div
                    className={`${styles.switch} ${notifyOnSweep ? styles.switchActive : ''}`}
                    onClick={() => setNotifyOnSweep(!notifyOnSweep)}
                  >
                    <div className={styles.switchHandle} />
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* STACK TAB */}
          {activeTab === 'stack' && (
            <div className={styles.section}>
              <h2 className={styles.sectionTitle}>Sentinel Stack</h2>

              <div className={styles.card}>
                <div className={styles.formGroup}>
                  <label className={styles.label}>Agent Framework &amp; Runtime</label>
                  <div style={{ color: 'var(--text-primary)', fontSize: '14px', marginTop: '4px', padding: '10px 14px', background: 'rgba(216, 155, 74, 0.06)', borderRadius: '8px', border: '1px solid rgba(216, 155, 74, 0.2)', lineHeight: 1.6 }}>
                    <strong>Agno</strong> — Agent Framework and High-Performance Runtime for Multi-Agent Systems. The sweep is an Agno Team (leader + 6 specialists). AgentOS provides the runtime: runs, sessions, traces, and the SchedulePoller behind Auto-Run.
                  </div>
                </div>

                <div className={styles.formGroup}>
                  <label className={styles.label}>Retrieval</label>
                  <div style={{ color: 'var(--text-primary)', fontSize: '14px', marginTop: '4px', padding: '10px 14px', background: 'rgba(216, 155, 74, 0.06)', borderRadius: '8px', border: '1px solid rgba(216, 155, 74, 0.2)', lineHeight: 1.6 }}>
                    <strong>You.com Research API</strong> — Real-Time Web Data Layer for AI. Domain-scoped queries against a whitelist of authoritative sources, country filters, and freshness windows. Every finding is grounded in a deep-link citation.
                  </div>
                </div>

                <div className={styles.formGroup}>
                  <label className={styles.label}>Primary sources swept</label>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 6 }}>
                    {['Federal Register', 'EUR-Lex', 'OFAC', 'BIS', 'USTR', 'TARIC', 'WTO', 'ECHA'].map(s => (
                      <span key={s} style={{
                        fontSize: 11,
                        color: '#D89B4A',
                        background: 'rgba(216, 155, 74, 0.06)',
                        border: '1px solid rgba(216, 155, 74, 0.22)',
                        padding: '5px 11px',
                        borderRadius: 100,
                        letterSpacing: 0.4,
                      }}>{s}</span>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          )}


        </div>
      </div>
    </div>
  );
}
