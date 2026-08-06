'use client';

import { Coins } from 'lucide-react';
import AnalyticsTab from '../agents/trade-sentinel/analytics';
import styles from '../agents/trade-sentinel/ts-agent.module.css';

/**
 * Usage & Cost — standalone sidebar route.
 *
 * Operational view (token spend, sweep counts, model breakdown, cost estimate)
 * — different persona and cadence from the compliance-officer's daily findings
 * dashboard. Moved out of the trade-sentinel tabs so the dashboard stays
 * single-purpose.
 */
export default function UsagePage() {
  return (
    <div className={styles.page}>
      <div className={styles.topBar}>
        <div className={styles.agentHeader}>
          <div className={styles.agentIconBox} style={{ background: 'rgba(216,155,74,0.12)', border: '1px solid rgba(216,155,74,0.35)' }}>
            <Coins size={22} color="#D89B4A" />
          </div>
          <div className={styles.agentTitleBlock}>
            <h1 className={styles.agentName}>Usage &amp; Cost</h1>
            <div className={styles.agentSubRow}>
              <span>Token spend, sweep counts, and model breakdown across every run.</span>
            </div>
          </div>
        </div>
      </div>
      <div className={styles.body}>
        <AnalyticsTab />
      </div>
    </div>
  );
}
