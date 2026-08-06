'use client';

import { useEffect, useState, useCallback, KeyboardEvent } from 'react';
import styles from '../agents/trade-sentinel/ts-agent.module.css';
import {
  Building2, MapPin, Package, Plus, X, Sparkles,
  AlertCircle, RefreshCw, Save, CheckCircle2, ShieldCheck,
} from 'lucide-react';

const API = 'http://localhost:7777/api/v1/gts';

/* ────────────── Types ────────────── */

type Product = { name: string; description?: string; hs_code?: string; eccn?: string };
type Profile = {
  id?: number;
  company_name: string;
  industry?: string;
  business_type?: string;
  business_overview?: string;
  export_countries?: string[];
  import_countries?: string[];
  monitor_countries?: string[];
  certifications?: string[];
  monitoring_preferences?: string[];
  top_suppliers?: string[];
  additional_context?: string;
  // Tier-A trade-exposure fields
  incoterms?: string[];
  volume_tier?: string;
  end_use_category?: string;
  products?: Product[];
};

type Question = { question: string; options: string[] };

const EMPTY: Profile = {
  company_name: '', industry: '', business_type: '', business_overview: '',
  export_countries: [], import_countries: [], monitor_countries: [],
  certifications: [], monitoring_preferences: [], top_suppliers: [],
  additional_context: '',
  incoterms: [], volume_tier: '', end_use_category: '',
  products: [{ name: '', description: '', hs_code: '', eccn: '' }],
};

/* ────────────── Trade-exposure options ────────────── */

const INCOTERMS_OPTIONS = ['EXW', 'FCA', 'FAS', 'FOB', 'CFR', 'CIF', 'CPT', 'CIP', 'DAP', 'DPU', 'DDP'];

const VOLUME_TIERS = [
  { value: '<1M',      label: 'Under $1M',        hint: 'Below EU General Authorisation thresholds, no bond required' },
  { value: '1-10M',    label: '$1M – $10M',       hint: 'Standard bond, CTPAT-eligible above this' },
  { value: '10-100M',  label: '$10M – $100M',     hint: 'Continuous bond, AEO/OEA typically worthwhile' },
  { value: '100M+',    label: 'Over $100M',       hint: 'Managed AEO status, dedicated broker relationships' },
];

const END_USE_OPTIONS = [
  { value: 'commercial',   label: 'Commercial (B2B/B2C civilian)',      hint: 'Standard EAR99 baseline unless product is dual-use' },
  { value: 'military',     label: 'Military / defense',                  hint: 'ITAR / USML analysis mandatory, deemed-export exposure high' },
  { value: 'government',   label: 'Government (non-military)',           hint: 'End-use statements required; foreign SOE screening applies' },
  { value: 'state_owned',  label: 'State-owned enterprise buyers',       hint: 'OFAC 50%-rule + EU Article 5aa exposure' },
  { value: 'research',     label: 'Research / academia',                 hint: 'Deemed-export & fundamental-research exclusions apply' },
  { value: 'consumer',     label: 'Consumer / retail',                   hint: 'CPSC, GPSR, marketplace-liability regimes engage' },
  { value: 'mixed',        label: 'Mixed / multiple',                    hint: 'Every applicable regime runs — highest analytical fan-out' },
];

/* ────────────── Component ────────────── */

export default function ProfilePage() {
  const [profile, setProfile] = useState<Profile>(EMPTY);
  const [loadedProfile, setLoadedProfile] = useState<Profile | null>(null);
  const [profileLoading, setProfileLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [profileError, setProfileError] = useState<string | null>(null);

  const [analyzing, setAnalyzing] = useState(false);
  const [questions, setQuestions] = useState<Question[] | null>(null);
  // Keys are either numeric (Q index → selected option / free-text / "__custom__" marker)
  // or `${i}_custom` (raw text held while user is typing in the free-text field).
  const [answers, setAnswers] = useState<Record<string | number, string>>({});
  const [enriching, setEnriching] = useState(false);

  const loadProfile = useCallback(async () => {
    setProfileLoading(true);
    setProfileError(null);
    try {
      const r = await fetch(`${API}/profile`, { credentials: 'include' });
      if (!r.ok) {
        setProfileError(`Failed to load profile: ${r.status} ${await r.text()}`);
        setLoadedProfile(null);
        return;
      }
      const p: Profile | null = await r.json();
      if (p) {
        const normalised: Profile = {
          ...EMPTY,
          ...p,
          products: p.products?.length ? p.products : EMPTY.products,
        };
        setProfile(normalised);
        setLoadedProfile(normalised);
      } else {
        setLoadedProfile(null);
      }
    } catch (e) {
      setProfileError((e as Error).message);
    } finally {
      setProfileLoading(false);
    }
  }, []);

  useEffect(() => { loadProfile(); }, [loadProfile]);

  const update = <K extends keyof Profile>(k: K, v: Profile[K]) => setProfile(p => ({ ...p, [k]: v }));

  const saveProfile = async (): Promise<Profile | null> => {
    setProfileError(null);
    setSaving(true);
    try {
      const body = { ...profile, products: (profile.products ?? []).filter(p => p.name.trim()) };
      const r = await fetch(`${API}/profile`, {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!r.ok) { setProfileError(await r.text()); return null; }
      const s = await r.json();
      const normalised: Profile = {
        ...EMPTY,
        ...s,
        products: s.products?.length ? s.products : EMPTY.products,
      };
      setProfile(normalised);
      setLoadedProfile(normalised);
      setSaved(true); setTimeout(() => setSaved(false), 2000);
      await loadProfile();
      return normalised;
    } catch (e) { setProfileError((e as Error).message); return null; }
    finally { setSaving(false); }
  };

  const runAnalyze = async () => {
    if (!profile.company_name.trim() || !profile.business_overview?.trim()) {
      setProfileError('Company name and business overview are required.');
      return;
    }
    const s = await saveProfile();
    if (!s) return;
    setAnalyzing(true); setQuestions(null); setAnswers({});
    try {
      const r = await fetch(`${API}/profile/questions`, {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ profile: s }),
      });
      if (!r.ok) { setProfileError(await r.text()); return; }
      const data = await r.json();
      setQuestions(data.questions ?? []);
    } catch (e) { setProfileError((e as Error).message); }
    finally { setAnalyzing(false); }
  };

  const submitAnswers = async () => {
    if (!questions) return;
    setEnriching(true);
    try {
      const answered = questions
        .map((q, i) => {
          const a = answers[i];
          // "__custom__" is the marker for the free-text option before the
          // user has typed anything — treat as unanswered.
          if (!a || a === '__custom__' || !a.trim()) return null;
          return { question: q.question, answer: a.trim() };
        })
        .filter((qa): qa is { question: string; answer: string } => qa !== null);
      const r = await fetch(`${API}/profile/enrich`, {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ profile, answers: answered }),
      });
      if (!r.ok) { setProfileError(await r.text()); return; }
      const data = await r.json();
      setProfile(p => ({ ...p, additional_context: data.enriched_context, id: data.profile?.id }));
      setQuestions(null);
      setSaved(true); setTimeout(() => setSaved(false), 2000);
    } catch (e) { setProfileError((e as Error).message); }
    finally { setEnriching(false); }
  };

  const isDirty = loadedProfile
    ? JSON.stringify({ ...loadedProfile, id: undefined }) !== JSON.stringify({ ...profile, id: undefined })
    : Boolean(profile.company_name || profile.business_overview);
  const profileExists = Boolean(loadedProfile);

  return (
    <div className={styles.page}>
      <div className={styles.topBar}>
        <div className={styles.agentHeader}>
          <div className={styles.agentIconBox} style={{ background: 'rgba(216,155,74,0.12)', border: '1px solid rgba(216,155,74,0.35)' }}>
            <Building2 size={22} color="#D89B4A" />
          </div>
          <div className={styles.agentTitleBlock}>
            <h1 className={styles.agentName}>Company Profile</h1>
            <div className={styles.agentSubRow}>
              <span>
                {profileLoading
                  ? 'Loading profile…'
                  : profileExists
                    ? <><strong style={{ color: 'var(--text-primary)' }}>{loadedProfile?.company_name}</strong>{isDirty && <em style={{ color: '#f59e0b', marginLeft: 6 }}>(unsaved)</em>}</>
                    : 'No profile yet — this is what every sweep sees'}
              </span>
              <span>·</span>
              <span>Consumed by all 6 specialists on every run</span>
            </div>
          </div>
        </div>
      </div>

      <div className={styles.body}>
        {profileError && <div className={styles.error}><AlertCircle size={14} /> {profileError}</div>}

        <div className={styles.section}>
          <div className={styles.sectionHeader}><Building2 size={13} /> Company Information</div>
          <div className={styles.fieldsRow}>
            <Field label="Company Name *" value={profile.company_name} onChange={v => update('company_name', v)} placeholder="e.g. Acme Batteries Ltd." />
            <Field label="Industry" value={profile.industry ?? ''} onChange={v => update('industry', v)} placeholder="e.g. EV Battery Manufacturing" />
          </div>
          <Field label="Business Type" value={profile.business_type ?? ''} onChange={v => update('business_type', v)} placeholder="Manufacturer / Distributor / Trader" />
          <div className={styles.field}>
            <label className={styles.label}>Business Overview *</label>
            <textarea className={styles.textarea} placeholder="What does the company do? Products, key customers, scale."
              value={profile.business_overview ?? ''} onChange={e => update('business_overview', e.target.value)} />
          </div>
        </div>

        <div className={styles.section}>
          <div className={styles.sectionHeader}><MapPin size={13} /> Geographies & Compliance</div>
          <div className={styles.fieldsRow}>
            <ChipsField label="Export Countries"   values={profile.export_countries ?? []}       onChange={v => update('export_countries', v)}       placeholder="Press Enter" />
            <ChipsField label="Import Countries"   values={profile.import_countries ?? []}       onChange={v => update('import_countries', v)}       placeholder="Press Enter" />
            <ChipsField label="Monitor Countries"  values={profile.monitor_countries ?? []}      onChange={v => update('monitor_countries', v)}      placeholder="Press Enter" />
          </div>
          <div className={styles.fieldsRow}>
            <ChipsField label="Certifications"          values={profile.certifications ?? []}          onChange={v => update('certifications', v)}          placeholder="ISO 9001, IATF 16949…" />
            <ChipsField label="Monitoring Preferences"  values={profile.monitoring_preferences ?? []} onChange={v => update('monitoring_preferences', v)}  placeholder="weekly digest, critical only…" />
          </div>
          <ChipsField label='Top Suppliers by spend — for OFAC / BIS / UN screening' values={profile.top_suppliers ?? []} onChange={v => update('top_suppliers', v)} placeholder='e.g. "CATL (China)"' />
        </div>

        {/* ── Trade Exposure ── */}
        <div className={styles.section}>
          <div className={styles.sectionHeader}><ShieldCheck size={13} /> Trade Exposure</div>
          <p className={styles.hint} style={{ marginBottom: 10 }}>
            How your shipments move and who your buyers really are. Each specialist agent uses this to move from generic advice to sharp, situation-specific findings.
          </p>

          <div className={styles.field}>
            <label className={styles.label}>Incoterms 2020 — trade terms you actually use</label>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 4 }}>
              {INCOTERMS_OPTIONS.map(term => {
                const active = (profile.incoterms ?? []).includes(term);
                return (
                  <button
                    key={term}
                    type="button"
                    onClick={() => {
                      const cur = profile.incoterms ?? [];
                      update('incoterms', active ? cur.filter(x => x !== term) : [...cur, term]);
                    }}
                    style={{
                      padding: '5px 12px', fontSize: 12, fontWeight: 600, borderRadius: 100,
                      background: active ? 'rgba(216,155,74,0.14)' : 'transparent',
                      color: active ? '#D89B4A' : 'var(--text-secondary)',
                      border: active ? '1px solid rgba(216,155,74,0.5)' : '1px solid var(--border-color)',
                      cursor: 'pointer',
                    }}
                    title={
                      term === 'DDP' ? 'Delivered Duty Paid — exporter carries customs + duty + PGA burden' :
                      term === 'EXW' ? 'Ex Works — buyer carries everything from the factory door' :
                      term === 'FOB' ? 'Free On Board — risk transfers at loading port' :
                      undefined
                    }
                  >
                    {term}
                  </button>
                );
              })}
            </div>
            <p className={styles.hint} style={{ marginTop: 6, fontSize: 11 }}>
              <strong>DDP</strong> → duty & PGA burden on you. <strong>EXW / FOB</strong> → on the buyer. This flips the customs-tariff analysis.
            </p>
          </div>

          <div className={styles.field}>
            <label className={styles.label}>Annual export/import volume</label>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 4 }}>
              {VOLUME_TIERS.map(tier => (
                <label key={tier.value} style={{
                  display: 'flex', gap: 10, alignItems: 'flex-start', cursor: 'pointer',
                  padding: '8px 12px', borderRadius: 8,
                  border: profile.volume_tier === tier.value ? '1px solid rgba(216,155,74,0.5)' : '1px solid var(--border-color)',
                  background: profile.volume_tier === tier.value ? 'rgba(216,155,74,0.06)' : 'transparent',
                }}>
                  <input
                    type="radio" name="volume_tier"
                    checked={profile.volume_tier === tier.value}
                    onChange={() => update('volume_tier', tier.value)}
                    style={{ accentColor: '#D89B4A', marginTop: 3 }}
                  />
                  <div>
                    <div style={{ fontSize: 13, color: 'var(--text-primary)', fontWeight: 500 }}>{tier.label}</div>
                    <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 2 }}>{tier.hint}</div>
                  </div>
                </label>
              ))}
            </div>
          </div>

          <div className={styles.field}>
            <label className={styles.label}>Primary end-use / end-user category</label>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 4 }}>
              {END_USE_OPTIONS.map(opt => (
                <label key={opt.value} style={{
                  display: 'flex', gap: 10, alignItems: 'flex-start', cursor: 'pointer',
                  padding: '8px 12px', borderRadius: 8,
                  border: profile.end_use_category === opt.value ? '1px solid rgba(216,155,74,0.5)' : '1px solid var(--border-color)',
                  background: profile.end_use_category === opt.value ? 'rgba(216,155,74,0.06)' : 'transparent',
                }}>
                  <input
                    type="radio" name="end_use_category"
                    checked={profile.end_use_category === opt.value}
                    onChange={() => update('end_use_category', opt.value)}
                    style={{ accentColor: '#D89B4A', marginTop: 3 }}
                  />
                  <div>
                    <div style={{ fontSize: 13, color: 'var(--text-primary)', fontWeight: 500 }}>{opt.label}</div>
                    <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 2 }}>{opt.hint}</div>
                  </div>
                </label>
              ))}
            </div>
          </div>
        </div>

        <div className={styles.section}>
          <div className={styles.sectionHeader}><Package size={13} /> Products</div>
          <p className={styles.hint} style={{ marginBottom: 10, fontSize: 11 }}>
            <strong>HS Code</strong> drives import-duty analysis. <strong>ECCN / USML</strong> drives export-control (dual-use). Leave ECCN blank or type <em>&quot;unknown&quot;</em> if you haven&apos;t classified yet — the export-control agent will flag it for you.
          </p>
          <div className={styles.productList}>
            {(profile.products ?? []).map((p, i) => (
              <div key={i} className={styles.productRow}>
                <input className={styles.input} placeholder="Name" value={p.name}
                  onChange={e => update('products', (profile.products ?? []).map((x, j) => j === i ? { ...x, name: e.target.value } : x))} />
                <input className={styles.input} placeholder="Description" value={p.description ?? ''}
                  onChange={e => update('products', (profile.products ?? []).map((x, j) => j === i ? { ...x, description: e.target.value } : x))} />
                <input className={styles.input} placeholder="HS Code (opt)" value={p.hs_code ?? ''}
                  onChange={e => update('products', (profile.products ?? []).map((x, j) => j === i ? { ...x, hs_code: e.target.value } : x))} />
                <input className={styles.input} placeholder="ECCN / EAR99 / unknown" value={p.eccn ?? ''}
                  onChange={e => update('products', (profile.products ?? []).map((x, j) => j === i ? { ...x, eccn: e.target.value } : x))} />
                <button className={`${styles.iconBtn} ${styles.iconBtnDanger}`}
                  onClick={() => update('products', (profile.products ?? []).filter((_, j) => j !== i))}
                  disabled={(profile.products ?? []).length <= 1}>
                  <X size={14} />
                </button>
              </div>
            ))}
            <button className={styles.secondaryBtn} style={{ alignSelf: 'flex-start' }}
              onClick={() => update('products', [...(profile.products ?? []), { name: '', description: '', hs_code: '', eccn: '' }])}>
              <Plus size={13} /> Add product
            </button>
          </div>
        </div>

        {profile.additional_context && (
          <div className={styles.section}>
            <div className={styles.enrichedLabel}>
              <Sparkles size={11} style={{ display: 'inline', verticalAlign: '-1px', marginRight: 4 }} />
              Enriched context (from Onboarding Copilot)
            </div>
            <div className={styles.enrichedBox}>{profile.additional_context}</div>
          </div>
        )}

        <div className={styles.footerRow}>
          <div className={styles.hint}>
            {saved && <span className={styles.savedBadge}><CheckCircle2 size={13} /> Profile saved</span>}
            {!saved && profileExists && !isDirty && <span className={styles.hint}><CheckCircle2 size={12} style={{ verticalAlign: '-2px', color: '#10b981' }} /> Loaded from server · in sync</span>}
            {!saved && isDirty && <span className={styles.hint} style={{ color: '#f59e0b' }}><AlertCircle size={12} style={{ verticalAlign: '-2px' }} /> Unsaved changes</span>}
          </div>
          <div style={{ display: 'flex', gap: 10 }}>
            <button className={styles.secondaryBtn} onClick={loadProfile} disabled={saving || profileLoading}>
              <RefreshCw size={13} /> Reload
            </button>
            <button className={styles.secondaryBtn} onClick={saveProfile} disabled={saving || !isDirty}>
              <Save size={13} /> {saving ? 'Saving…' : profileExists ? 'Update' : 'Save'}
            </button>
            <button className={styles.primaryBtn} onClick={runAnalyze} disabled={analyzing || saving}>
              {analyzing ? <span className={styles.spinner} /> : <Sparkles size={13} />}
              {analyzing ? 'Analyzing…' : 'Analyze & Enrich'}
            </button>
          </div>
        </div>
      </div>

      {questions && questions.length > 0 && (
        <div className={styles.modalOverlay} onClick={() => setQuestions(null)}>
          <div className={styles.modal} onClick={e => e.stopPropagation()}>
            <div className={styles.modalHeader}>
              <h3 className={styles.modalTitle}>
                <Sparkles size={16} style={{ display: 'inline', verticalAlign: '-2px', marginRight: 6, color: '#3b82f6' }} />
                Onboarding Copilot found {questions.length} blindspot{questions.length === 1 ? '' : 's'}
              </h3>
              <button className={styles.iconBtn} onClick={() => setQuestions(null)}><X size={14} /></button>
            </div>
            <p className={styles.modalSubtitle}>
              Question count is driven by what&apos;s missing — an empty profile gets more, a rich one gets fewer. Answer what you can; skip anything you don&apos;t know.
              <br />
              <span style={{ color: 'var(--text-secondary)', fontSize: 11 }}>
                <strong style={{ color: '#D89B4A' }}>{Object.values(answers).filter(a => a && a.trim()).length}</strong>
                <span> / {questions.length} answered · every answer sharpens the next sweep</span>
              </span>
            </p>
            {questions.map((q, i) => {
              const current = answers[i] ?? '';
              const isCustom = current === '__custom__';
              return (
                <div key={i} className={styles.qBlock}>
                  <div className={styles.qText}>{i + 1}. {q.question}</div>
                  <div className={styles.optionsCol}>
                    {q.options.map(opt => (
                      <button
                        key={opt}
                        className={`${styles.optionBtn} ${current === opt ? styles.optionActive : ''}`}
                        onClick={() => setAnswers(prev => ({ ...prev, [i]: opt }))}
                      >
                        {opt}
                      </button>
                    ))}
                    <button
                      className={`${styles.optionBtn} ${isCustom ? styles.optionActive : ''}`}
                      onClick={() => setAnswers(prev => ({ ...prev, [i]: '__custom__' }))}
                      style={{ fontStyle: 'italic', color: isCustom ? undefined : 'var(--text-secondary)' }}
                    >
                      + Write my own answer…
                    </button>
                    {isCustom && (
                      <input
                        autoFocus
                        placeholder="Type your answer here"
                        value={answers[`${i}_custom`] ?? ''}
                        onChange={e => setAnswers(prev => ({
                          ...prev,
                          [`${i}_custom`]: e.target.value,
                          [i]: e.target.value.trim() ? e.target.value : '__custom__',
                        }))}
                        style={{
                          width: '100%', marginTop: 4,
                          padding: '8px 12px', fontSize: 13, borderRadius: 8,
                          background: 'rgba(255,255,255,0.04)',
                          border: '1px solid rgba(216,155,74,0.4)',
                          color: 'var(--text-primary)',
                        }}
                      />
                    )}
                  </div>
                </div>
              );
            })}
            <div className={styles.modalActions}>
              <button className={styles.secondaryBtn} onClick={() => setQuestions(null)}>Skip all</button>
              <button className={styles.primaryBtn} onClick={submitAnswers}
                disabled={enriching || Object.values(answers).filter(a => a && a !== '__custom__' && a.trim()).length === 0}>
                {enriching ? <span className={styles.spinner} /> : <CheckCircle2 size={13} />}
                {enriching ? 'Enriching…' : `Save & Enrich (${Object.values(answers).filter(a => a && a !== '__custom__' && a.trim()).length} answer${Object.values(answers).filter(a => a && a !== '__custom__' && a.trim()).length === 1 ? '' : 's'})`}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ────────────── Helpers ────────────── */

function Field({ label, value, onChange, placeholder }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <div className={styles.field}>
      <label className={styles.label}>{label}</label>
      <input className={styles.input} value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder} />
    </div>
  );
}

function ChipsField({ label, placeholder, values, onChange }: {
  label: string; placeholder?: string; values: string[]; onChange: (v: string[]) => void;
}) {
  const [draft, setDraft] = useState('');
  const commit = () => { const v = draft.trim(); if (!v) return; if (!values.includes(v)) onChange([...values, v]); setDraft(''); };
  const handleKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); commit(); }
    else if (e.key === 'Backspace' && !draft && values.length > 0) onChange(values.slice(0, -1));
  };
  return (
    <div className={styles.field}>
      <label className={styles.label}>{label}</label>
      <div className={styles.chipsField}>
        {values.map(v => (
          <span key={v} className={styles.chip}>
            {v}
            <button className={styles.chipRemove} onClick={() => onChange(values.filter(x => x !== v))}><X size={11} /></button>
          </span>
        ))}
        <input className={styles.chipInput} placeholder={placeholder} value={draft}
          onChange={e => setDraft(e.target.value)} onKeyDown={handleKey} onBlur={commit} />
      </div>
    </div>
  );
}
