'use client';

import { Activity } from 'lucide-react';
import TracesTab from '../agents/trade-sentinel/traces';
import styles from '../agents/trade-sentinel/ts-agent.module.css';

/**
 * Standalone Traces page — sidebar-level entry.
 *
 * The tab lives at `/traces` (not under `/agents/trade-sentinel`) because
 * trace inspection is a distinct workflow — analyst / debug persona — not
 * part of the compliance-officer's daily findings review. The dashboard
 * keeps Overview + Analytics; this page is where you land when a specific
 * run needs investigation ("why did the sanctions agent search for X?").
 */
export default function TracesPage() {
  return (
    <div className={styles.page}>
      <div className={styles.topBar}>
        <div className={styles.agentHeader}>
          <div className={styles.agentIconBox} style={{ background: 'rgba(216,155,74,0.12)', border: '1px solid rgba(216,155,74,0.35)' }}>
            <Activity size={22} color="#D89B4A" />
          </div>
          <div className={styles.agentTitleBlock}>
            <h1 className={styles.agentName}>Traces</h1>
            <div className={styles.agentSubRow}>
              <span>Every LLM call, tool call, and delegation across all sweep runs — for auditing and debug.</span>
            </div>
          </div>
        </div>
      </div>
      <div className={styles.body}>
        <TracesTab />
      </div>
    </div>
  );
}
