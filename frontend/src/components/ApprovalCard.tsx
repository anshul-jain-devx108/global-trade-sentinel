'use client';

import { useState } from 'react';
import { Check, X, ShieldAlert, Loader2 } from 'lucide-react';
import styles from './ApprovalCard.module.css';
import { CHAT_API } from '@/lib/api';
import { useSWRConfig } from 'swr';

export interface ApprovalPayload {
  run_id: string;
  tool_call_id: string;
  tool_name: string;
  specialist: string;
  query: string | null;
}

interface Props {
  sessionId: string;
  payload: ApprovalPayload;
}

type Status = 'idle' | 'approving' | 'rejecting' | 'done';

export default function ApprovalCard({ sessionId, payload }: Props) {
  const [status, setStatus] = useState<Status>('idle');
  const [error, setError] = useState<string | null>(null);
  const { mutate } = useSWRConfig();

  const decide = async (confirmed: boolean) => {
    setError(null);
    setStatus(confirmed ? 'approving' : 'rejecting');
    try {
      const res = await fetch(`${CHAT_API}/${sessionId}/approvals`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          run_id: payload.run_id,
          tool_call_id: payload.tool_call_id,
          confirmed,
        }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setStatus('done');
      // Refetch messages so the specialist reply (or the skip-message) shows up.
      await mutate(`${CHAT_API}/${sessionId}/messages`);
    } catch (e) {
      setStatus('idle');
      setError(e instanceof Error ? e.message : 'Failed to submit decision');
    }
  };

  if (status === 'done') {
    return null;
  }

  const disabled = status === 'approving' || status === 'rejecting';

  return (
    <div className={styles.card}>
      <div className={styles.header}>
        <ShieldAlert size={16} className={styles.icon} />
        <span className={styles.title}>Approval required</span>
      </div>
      <div className={styles.metaRow}>
        <span className={styles.metaLabel}>Specialist</span>
        <span className={styles.metaValue}>{payload.specialist}</span>
      </div>
      {payload.query && (
        <div className={styles.metaRow}>
          <span className={styles.metaLabel}>Query</span>
          <span className={styles.metaValue}>{payload.query}</span>
        </div>
      )}
      <div className={styles.actions}>
        <button
          className={`${styles.btn} ${styles.approve}`}
          onClick={() => decide(true)}
          disabled={disabled}
        >
          {status === 'approving' ? <Loader2 size={14} className={styles.spin} /> : <Check size={14} />}
          Approve &amp; run
        </button>
        <button
          className={`${styles.btn} ${styles.reject}`}
          onClick={() => decide(false)}
          disabled={disabled}
        >
          {status === 'rejecting' ? <Loader2 size={14} className={styles.spin} /> : <X size={14} />}
          Skip
        </button>
      </div>
      {error && <p className={styles.error}>{error}</p>}
    </div>
  );
}


// ── Parser helpers ──────────────────────────────────────────
// Kept in this file so ChatMessage.tsx doesn't need to know the marker
// format. See services/chat_reply.py APPROVAL_MARKER_PREFIX/SUFFIX.

const MARKER_RE = /^\[\[APPROVAL:(\{.*?\})\]\]\s*\n?/s;

export interface ParsedApproval {
  payload: ApprovalPayload;
  rationale: string;
}

export function parseApprovalMarker(content: string): ParsedApproval | null {
  const match = content.match(MARKER_RE);
  if (!match) return null;
  try {
    const payload = JSON.parse(match[1]) as ApprovalPayload;
    const rationale = content.slice(match[0].length).trim();
    return { payload, rationale };
  } catch {
    return null;
  }
}
