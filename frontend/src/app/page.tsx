'use client';

import Link from 'next/link';
import styles from './landing.module.css';
import {
  ArrowRight, Database, BarChart2, Shield,
  Clock, CheckCircle2, BrainCircuit, FileSpreadsheet,
  AlertTriangle, TrendingDown, Users, Link2, CalendarClock,
  MessageSquare, Hash
} from 'lucide-react';
import { useEffect, useState } from 'react';

const signals = [
  { icon: <AlertTriangle size={14}/>, tag: 'OFAC · SANCTIONS', title: 'New SDN addition matches cell supplier', sub: 'Onboarded Q2 · flagged overnight', color: '#D89B4A' },
  { icon: <CalendarClock size={14}/>, tag: 'EUR-LEX · REGULATION', title: 'EU Battery Regulation QR-label milestone', sub: 'Effective in 18 months · phase-in', color: '#D89B4A' },
  { icon: <TrendingDown size={14}/>, tag: 'USTR · TARIFF', title: 'Section 301 rate change on HS 8507.60', sub: 'Applies to China-sourced subcomponent', color: '#D89B4A' },
];

const actions = [
  { tag: 'SANCTIONS', status: 'FLAGGED', title: 'Supplier match sent to compliance queue', sub: 'Deep-link to OFAC SDN entry attached', color: '#4ade80' },
  { tag: 'COMPLIANCE', status: 'TRACKED', title: 'QR-label milestone added to calendar', sub: 'EUR-Lex citation · effective 2028-01-01', color: '#60a5fa' },
  { tag: 'TARIFF', status: 'COSTED', title: 'Landed-cost model recalculated', sub: 'USTR notice cited · +4.2% on HS 8507.60', color: '#a78bfa' },
];

const steps = [
  { icon: <FileSpreadsheet size={22} />, step: '01', title: 'Build Your Trade Profile', desc: 'Products, HS codes, markets, suppliers, and shipping lanes. Your profile is the filter — nothing gets surfaced that does not apply to you.' },
  { icon: <Users size={22} />, step: '02', title: 'Sweep the Primary Sources', desc: 'A leader agent routes six domain specialists — sanctions, export control, product regulation, customs, trade agreements, geopolitical — each scoped to a whitelist of authoritative domains via You.com.' },
  { icon: <Link2 size={22} />, step: '03', title: 'Auditable Findings', desc: 'Every event lands with severity, jurisdiction, effective dates, and a deep-link citation to the primary source. Acknowledge, dismiss, or schedule the next sweep.' },
];

export default function LandingPage() {
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const handleScroll = () => setScrolled(window.scrollY > 50);
    window.addEventListener('scroll', handleScroll);
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  return (
    <div className={styles.landingWrapper}>

      {/* ── Navigation ── */}
      <nav className={`${styles.nav} ${scrolled ? styles.navScrolled : ''}`}>
        <div className={styles.navContainer}>
          <div className={styles.brand}>
            <div className={styles.logoMark}>GTS</div>
            <span className={styles.brandText}>Global Trade Sentinel</span>
          </div>
          <div className={styles.navLinks}>
            <a href="#how-it-works">How It Works</a>
            <a href="#platform">Specialists</a>
            <a href="#channels">Channels</a>
            <a href="#stack">Built On</a>
          </div>
          <div className={styles.navActions}>
            <Link href="/login" className={styles.loginBtn}>Sign in</Link>
            <Link href="/login" className={styles.ctaBtn}>
              Run a Sweep <ArrowRight size={14} />
            </Link>
          </div>
        </div>
      </nav>

      {/* ── Hero Section ── */}
      <header className={styles.hero}>
        <div className={styles.heroVideoWrapper}>
          <video autoPlay loop muted playsInline className={styles.heroVideoBg}>
            <source src="/demo.mp4" type="video/mp4" />
          </video>
          <div className={styles.heroVideoOverlay} />
          {/* Corner mask — softly blends the Veo watermark into the
              surrounding warm-amber vignette. Reads as intentional
              cinematic corner darkening, not a censored patch. */}
          <div className={styles.heroWatermarkMask} />
        </div>

        <div className={styles.heroContent}>
          <div className={styles.heroCard}>
            <div className={styles.badge}>
              <span className={styles.badgePulse} />
              Built on Agno · Retrieval by You.com
            </div>
            <h1 className={styles.heroTitle}>
              Regulation, <span className={styles.heroGradient}>the day it publishes.</span>
            </h1>
            <p className={styles.heroSub}>
              Six specialist agents sweep primary sources for the <strong>rules that hit your shipments</strong> — every finding cited to the source.
            </p>
            <div className={styles.heroBtns}>
              <Link href="/chat" className={styles.primaryBtn}>
                Run a Sweep <ArrowRight size={16} />
              </Link>
              <Link href="#how-it-works" className={styles.secondaryBtn}>
                See How It Works
              </Link>
            </div>
          </div>
        </div>
      </header>

      {/* ── Primary-source strip ── */}
      <section className={styles.sourceStrip}>
        <div className={styles.sourceStripInner}>
          <p className={styles.sourceStripLabel}>Sweeping primary sources including</p>
          <div className={styles.sourceStripLogos}>
            <span>Federal Register</span><span className={styles.dot}>·</span>
            <span>EUR-Lex</span><span className={styles.dot}>·</span>
            <span>OFAC</span><span className={styles.dot}>·</span>
            <span>BIS</span><span className={styles.dot}>·</span>
            <span>USTR</span><span className={styles.dot}>·</span>
            <span>TARIC</span><span className={styles.dot}>·</span>
            <span>WTO</span><span className={styles.dot}>·</span>
            <span>ECHA</span>
          </div>
        </div>
      </section>

      {/* ── Signal → Brain → Action Diagram ── */}
      <section id="how-it-works" className={styles.diagramSection}>
        <div className={styles.sectionHeader}>
          <div className={styles.sectionTag}>The Sweep Loop</div>
          <h2>From primary source to auditable action.</h2>
          <p>Governments publish regulation continuously and on unsynchronised timelines. Sentinel sits between that noise and your compliance queue.</p>
        </div>

        <div className={styles.diagramWrapper}>
          {/* Left: Signals In */}
          <div className={styles.diagramCol}>
            <div className={styles.diagramColLabel}>PRIMARY SOURCES</div>
            <div className={styles.signalCards}>
              {signals.map((s, i) => (
                <div key={i} className={styles.signalCard}>
                  <div className={styles.signalTop}>
                    <span className={styles.signalIcon} style={{ color: s.color }}>{s.icon}</span>
                    <span className={styles.signalTag}>{s.tag}</span>
                  </div>
                  <div className={styles.signalTitle}>{s.title}</div>
                  <div className={styles.signalSub}>{s.sub}</div>
                </div>
              ))}
            </div>
          </div>

          {/* Center: Brain */}
          <div className={styles.diagramCenter}>
            <div className={styles.brainLines}>
              {signals.map((_, i) => (
                <div key={i} className={`${styles.brainLine} ${styles['brainLineL' + i]}`} />
              ))}
            </div>
            <div className={styles.brainNode}>
              <div className={styles.brainOrb}>
                <BrainCircuit size={32} />
              </div>
              <span className={styles.brainLabel}>Sentinel Team</span>
              <span className={styles.brainSublabel}>Agno Team · Leader + 6</span>
            </div>
            <div className={styles.brainLines}>
              {actions.map((_, i) => (
                <div key={i} className={`${styles.brainLine} ${styles['brainLineR' + i]}`} />
              ))}
            </div>
          </div>

          {/* Right: Actions Out */}
          <div className={styles.diagramCol}>
            <div className={styles.diagramColLabel}>DASHBOARD EVENTS</div>
            <div className={styles.signalCards}>
              {actions.map((a, i) => (
                <div key={i} className={`${styles.signalCard} ${styles.actionCard}`}>
                  <div className={styles.signalTop}>
                    <span className={styles.signalTag}>{a.tag}</span>
                    <span className={styles.actionStatus} style={{ color: a.color }}>{a.status}</span>
                  </div>
                  <div className={styles.signalTitle}>{a.title}</div>
                  <div className={styles.signalSub}>{a.sub}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ── How It Works Steps ── */}
      <section id="platform" className={styles.howSection}>
        <div className={styles.sectionHeader}>
          <div className={styles.sectionTag}>How It Works</div>
          <h2>Three steps to auditable trade compliance.</h2>
          <p>Your profile is the filter. Six specialists do the work. Every finding is backed by a deep-link citation.</p>
        </div>
        <div className={styles.stepsGrid}>
          {steps.map((s) => (
            <div key={s.step} className={styles.stepCard}>
              <div className={styles.stepNumber}>{s.step}</div>
              <div className={styles.stepIcon}>{s.icon}</div>
              <h3>{s.title}</h3>
              <p>{s.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ── Channels: Teams + Slack ── */}
      <section id="channels" className={styles.channels}>
        <div className={styles.sectionHeader}>
          <div className={styles.sectionTag}>Where You Already Work</div>
          <h2>Ask Sentinel from Teams or Slack.</h2>
          <p>Your compliance team lives in group chat. Sentinel joins as a bot — ask a question, get a citation-backed answer without leaving the channel you were already in.</p>
        </div>

        <div className={styles.channelGrid}>
          {/* Teams card */}
          <div className={styles.channelCard}>
            <div className={styles.channelHeader}>
              <div className={styles.channelBrand}>
                <div className={styles.channelIcon} data-brand="teams"><MessageSquare size={18} /></div>
                <div>
                  <div className={styles.channelName}>Microsoft Teams</div>
                  <div className={styles.channelStatus}>Native bot · SSO tenant-scoped</div>
                </div>
              </div>
              <span className={styles.liveBadge}><span className={styles.liveDot} /> Live</span>
            </div>

            <div className={styles.chatMock}>
              <div className={styles.chatMsg}>
                <div className={styles.chatAvatar} data-role="user">MK</div>
                <div className={styles.chatBubble}>
                  <div className={styles.chatMeta}>Compliance Ops · just now</div>
                  <div className={styles.chatText}>@Sentinel any Belarus sanction updates this week?</div>
                </div>
              </div>
              <div className={styles.chatMsg}>
                <div className={styles.chatAvatar} data-role="bot">S</div>
                <div className={styles.chatBubble}>
                  <div className={styles.chatMeta}>Sentinel · agent reply</div>
                  <div className={styles.chatText}>Yes — OFAC added <strong>3 SDN entries</strong> on 2026-07-29. One matches a Q2 onboarded supplier.</div>
                  <div className={styles.chatCitation}>↗ SDN entry · treasury.gov/ofac</div>
                </div>
              </div>
            </div>
          </div>

          {/* Slack card */}
          <div className={styles.channelCard}>
            <div className={styles.channelHeader}>
              <div className={styles.channelBrand}>
                <div className={styles.channelIcon} data-brand="slack"><Hash size={18} /></div>
                <div>
                  <div className={styles.channelName}>Slack</div>
                  <div className={styles.channelStatus}>Bot user · workspace-scoped</div>
                </div>
              </div>
              <span className={styles.liveBadge}><span className={styles.liveDot} /> Live</span>
            </div>

            <div className={styles.chatMock}>
              <div className={styles.chatMsg}>
                <div className={styles.chatAvatar} data-role="user">AR</div>
                <div className={styles.chatBubble}>
                  <div className={styles.chatMeta}>#trade-compliance · just now</div>
                  <div className={styles.chatText}>show me CBAM updates from last 7 days</div>
                </div>
              </div>
              <div className={styles.chatMsg}>
                <div className={styles.chatAvatar} data-role="bot">S</div>
                <div className={styles.chatBubble}>
                  <div className={styles.chatMeta}>Sentinel · citation-backed</div>
                  <div className={styles.chatText}><strong>2 findings</strong> from EUR-Lex. New default-values guidance for embedded emissions in electricity imports.</div>
                  <div className={styles.chatCitation}>↗ Notice C(2026)4821 · eur-lex.europa.eu</div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── Features Grid ── */}
      <section id="stack" className={styles.features}>
        <div className={styles.sectionHeader}>
          <div className={styles.sectionTag}>Built On</div>
          <h2>Agno for the agents. You.com for the ground truth.</h2>
          <p>Sentinel is deliberately thin on orchestration scaffolding. The agent framework and the retrieval layer are best-of-breed, so the platform stays focused on trade-compliance business logic.</p>
        </div>

        <div className={styles.bentoGrid}>
          <div className={`${styles.bentoCard} ${styles.col2}`}>
            <div className={styles.bentoIcon}><Users /></div>
            <h3>Agno — framework and runtime for multi-agent systems</h3>
            <p>The sweep is an Agno Team: a leader agent routing six domain specialists. AgentOS provides the runtime — runs, sessions, traces, and the SchedulePoller that drives Auto-Run. Structured outputs land as typed Pydantic models, so the leader&apos;s self-review pass reads a known shape and dedupe stays stable.</p>
            <ul className={styles.featureList}>
              <li><CheckCircle2 size={14} /> Teams: leader + 6 specialists, parallel member execution</li>
              <li><CheckCircle2 size={14} /> Typed outputs: RegulatoryEventModel, SweepReportModel</li>
              <li><CheckCircle2 size={14} /> AgentOS runtime · runs · sessions · traces · Auto-Run</li>
            </ul>
          </div>

          <div className={styles.bentoCard}>
            <div className={styles.bentoIcon}><Link2 /></div>
            <h3>You.com — real-time web data for grounded answers</h3>
            <p>Every specialist reaches ground truth through the You.com Research API. Domain-scoped queries against a whitelist of authoritative sources, country filters, and freshness windows keep coverage jurisdictionally correct — and every finding lands with a deep-link citation.</p>
          </div>

          <div className={styles.bentoCard}>
            <div className={styles.bentoIcon}><AlertTriangle /></div>
            <h3>Slow-Miss Radar</h3>
            <p>Phase-in schedules are tracked years in advance. Sentinel remembers the label change, the documentation update, and the milestone your team closed the file on six months ago.</p>
          </div>

          <div className={styles.bentoCard}>
            <div className={styles.bentoIcon}><Clock /></div>
            <h3>Fast-Miss Alerting</h3>
            <p>Sanctions and entity-list additions land the same day the primary source publishes them — not on the week your weekly screening database refreshes.</p>
          </div>

          <div className={`${styles.bentoCard} ${styles.col2}`}>
            <div className={styles.bentoIcon}><Shield /></div>
            <h3>Every finding, auditable</h3>
            <p>Grounding rules in every specialist prompt require a deep-link citation from You.com's returned URLs — landing pages rejected. Compliance officers click through to the exact notice, list entry, or ruling behind the finding.</p>
            <div className={styles.securityTags}>
              <span>Deep-Link Citations</span>
              <span>Primary-Source Only</span>
              <span>Typed Outputs</span>
              <span>Auto-Run Scheduling</span>
            </div>
          </div>

          <div className={styles.bentoCard}>
            <div className={styles.bentoIcon}><BarChart2 /></div>
            <h3>The Six Specialists</h3>
            <p>Sanctions screening. Export control. Product regulatory compliance. Customs &amp; tariffs. Trade agreements. Geopolitical risk. Each scoped to its own corpus of primary sources.</p>
          </div>

          <div className={styles.bentoCard}>
            <div className={styles.bentoIcon}><Database /></div>
            <h3>Your Profile Is the Filter</h3>
            <p>Products, HS codes, markets, suppliers, and lanes. Findings speak to what you actually ship — not to the industry in the abstract. Low noise floor by construction.</p>
          </div>
        </div>
      </section>

      {/* ── CTA Footer ── */}
      <footer className={styles.footer}>
        <div className={styles.footerCta}>
          <div className={styles.footerGlow} />
          <div className={styles.sectionTag} style={{ margin: '0 auto 24px' }}>Get Started</div>
          <h2>Close the discovery lag.</h2>
          <p>Onboard a profile, run your first sweep, and see the specific rules that hit your shipments — every one of them backed by a primary source.</p>
          <Link href="/chat" className={styles.primaryBtn}>
            Run Your First Sweep <ArrowRight size={16} />
          </Link>
        </div>
        <div className={styles.footerBottom}>
          <div className={styles.brand}>
            <div className={styles.logoMark} style={{ width: 26, height: 26, fontSize: 10 }}>GTS</div>
            <span className={styles.brandText}>Global Trade Sentinel</span>
          </div>
          <div className={styles.footerLinks}>
            <a href="#how-it-works">How It Works</a>
            <a href="#platform">Specialists</a>
            <a href="#stack">Built On</a>
          </div>
          <div className={styles.copyright}>© 2026 Global Trade Sentinel · Built on Agno · Retrieval by You.com</div>
        </div>
      </footer>

    </div>
  );
}
