'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import useSWR, { useSWRConfig } from 'swr';
import styles from './page.module.css';
import { ArrowUp, Globe, Check } from 'lucide-react';
import ChatMessage, { Message } from '@/components/ChatMessage';
import TypingIndicator from '@/components/TypingIndicator';
import { CHAT_API } from '@/lib/api';

const SENTINEL_SUGGESTIONS = [
  'What sanctions or entity-list changes hit my supplier list this week?',
  'Show me phase-in milestones effective in the next 6 months.',
  'Any tariff schedule changes on the HS codes we ship?',
  'Draft a compliance memo for the latest EUR-Lex finding.',
];

// Ask Sentinel doesn't expose a model/agent picker — the backend picks its
// own Agno agent + model for every message. These constants are only kept
// because the existing POST endpoints still require the fields; when the
// backend drops them we can remove these too.
const DEFAULT_MODEL_ID = 'auto';
const DEFAULT_AGENT_ID = 'auto';

import { useSearchParams, useRouter } from 'next/navigation';

export default function Home() {
  const [query, setQuery] = useState('');
  const searchParams = useSearchParams();
  const router = useRouter();
  const sessionId = searchParams.get('session');
  const { mutate: mutateGlobal } = useSWRConfig();

  // Messages for the active session — SWR keyed by session so switching
  // between sessions shows the previously-cached transcript instantly,
  // no empty-flash while the fetch is in flight.
  const messagesKey = sessionId ? `${CHAT_API}/${sessionId}/messages` : null;
  const { data: fetchedMessages = [], mutate: mutateMessages } = useSWR<Message[]>(messagesKey);

  // Local overlay for in-flight optimistic user messages + fresh AI replies
  // that haven't been persisted yet by the backend's cache.
  const [pendingMessages, setPendingMessages] = useState<Message[]>([]);
  const currentMessages: Message[] = [...(fetchedMessages ?? []), ...pendingMessages];

  const [isTyping, setIsTyping] = useState(false);
  const [webSearch, setWebSearch] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Clear the optimistic overlay when the session changes — otherwise
  // an old session's pending message could leak into the new transcript.
  useEffect(() => { setPendingMessages([]); }, [sessionId]);

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [currentMessages, isTyping]);

  // Auto-resize textarea
  const handleInput = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setQuery(e.target.value);
    e.target.style.height = 'auto';
    e.target.style.height = Math.min(e.target.scrollHeight, 160) + 'px';
  };

  const sendMessage = useCallback(async () => {
    const text = query.trim();
    if (!text || isTyping) return;

    setSendError(null);
    let activeSessionId = sessionId;

    // Create session if it doesn't exist. TypeError: Failed to fetch here
    // usually means the backend restarted mid-session or a Windows-specific
    // connection reset — retry once after a short backoff before giving up
    // so a transient blip doesn't dead-end the user's message.
    if (!activeSessionId) {
      const doCreate = async () => {
        const res = await fetch(`${CHAT_API}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ title: text.substring(0, 40), model_used: DEFAULT_MODEL_ID }),
        });
        if (res.status === 401) {
          const err = new Error('Unauthorized') as Error & { status: number };
          err.status = 401;
          throw err;
        }
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      };
      try {
        let data;
        try {
          data = await doCreate();
        } catch (retryErr) {
          // Never retry auth failures — the cookie won't magically appear.
          if ((retryErr as { status?: number }).status === 401) throw retryErr;
          await new Promise(r => setTimeout(r, 600));
          data = await doCreate();
        }
        activeSessionId = data.id;
        mutateGlobal(`${CHAT_API}`);
        router.push(`/chat?session=${activeSessionId}`);
      } catch (err) {
        console.error("Failed to create session", err);
        if ((err as { status?: number }).status === 401) {
          setSendError('You need to sign in first. Head to the homepage and click Sign in with Microsoft.');
        } else {
          setSendError('Could not reach the backend. Check that the GTS service is running on port 7777, then try again.');
        }
        return;
      }
    }

    const userMsg: Message = {
      id: crypto.randomUUID(),
      role: 'user',
      content: text,
      timestamp: new Date(),
    };

    // 1. Optimistic UI update for user message
    setPendingMessages(prev => [...prev, userMsg]);
    setQuery('');
    if (textareaRef.current) textareaRef.current.style.height = 'auto';
    setIsTyping(true);

    // 2. Call backend generate endpoint
    try {
      const res = await fetch(`${CHAT_API}/${activeSessionId}/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          content: text,
          agent_id: DEFAULT_AGENT_ID
        })
      });

      if (res.ok) {
        await res.json();
        // Force-fetch the canonical transcript for THIS session — using
        // `mutateGlobal(key)` (not the closure-captured `mutateMessages`)
        // because when we just created the session, useSWR's key was null
        // at callback-definition time so mutateMessages would be a no-op.
        // Awaiting the mutate ensures the SWR cache has the persisted
        // rows before we drop the optimistic overlay; otherwise the chat
        // flashes empty until the URL change triggers its own fetch.
        await mutateGlobal(`${CHAT_API}/${activeSessionId}/messages`);
        setPendingMessages([]);
      } else {
        const body = await res.text();
        console.error("Failed to generate AI response", body);
        setSendError(`Backend rejected the request (${res.status}). ${body.slice(0, 120)}`);
      }
    } catch (err) {
      console.error("Network error during generation", err);
      setSendError('Network error reaching the backend. Retry once the connection is back.');
    }

    setIsTyping(false);
  }, [query, isTyping, sessionId, router, mutateGlobal, mutateMessages]);

  // Send on Enter (Shift+Enter = new line)
  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  const clearSession = () => {
    router.push('/chat');
  };

  const hasMessages = currentMessages.length > 0;
  const suggestions = SENTINEL_SUGGESTIONS;

  return (
    <div className={styles.pageLayout}>
      <div className={styles.mainContainer}>

        {/* Chat Area */}
        <div className={styles.chatArea}>

          {/* Empty State */}
          {!hasMessages && (
            <div className={styles.emptyState}>
              <h1 className={styles.title}>Ask Sentinel.</h1>
              <p className={styles.subtitle}>Question your regulatory findings, supplier exposure, and phase-in schedules — grounded in the primary sources swept by the six specialists.</p>
              {/* Suggested prompts */}
              <div className={styles.suggestions}>
                {suggestions.map(s => (
                  <button key={s} className={styles.suggestionChip} onClick={() => {
                    setQuery(s);
                    textareaRef.current?.focus();
                  }}>
                    {s}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Messages */}
          {hasMessages && (
            <div className={styles.messages}>
              {currentMessages.map((msg, idx) => {
                // An approval card is only actionable while it's the LAST
                // assistant turn — once a later assistant message exists,
                // the decision has already been made and the buttons would
                // be misleading. Suppress interactivity in that case.
                const hasLaterAssistant = currentMessages
                  .slice(idx + 1)
                  .some(m => m.role === 'assistant');
                return (
                  <ChatMessage
                    key={msg.id}
                    message={msg}
                    sessionId={sessionId ?? undefined}
                    approvalResolved={hasLaterAssistant}
                  />
                );
              })}
              {isTyping && <TypingIndicator />}
              <div ref={messagesEndRef} />
            </div>
          )}
        </div>

        {/* Input Bar */}
        <div className={styles.inputSection}>
          {sendError && (
            <div style={{
              maxWidth: 720, margin: '0 auto 10px', padding: '10px 14px',
              background: 'rgba(239, 68, 68, 0.08)',
              border: '1px solid rgba(239, 68, 68, 0.3)',
              borderRadius: 8, fontSize: 13, color: '#fecaca',
              display: 'flex', gap: 10, alignItems: 'flex-start',
            }}>
              <span style={{ flex: 1 }}>{sendError}</span>
              <button
                onClick={() => setSendError(null)}
                style={{
                  background: 'transparent', border: 'none', color: '#fecaca',
                  cursor: 'pointer', fontSize: 16, lineHeight: 1, padding: 0,
                }}
                title="Dismiss"
              >×</button>
            </div>
          )}
          {hasMessages && (
            <div className={styles.aboveInput}>
              <button className={styles.newQueryBtn} onClick={clearSession}>
                + New query
              </button>
            </div>
          )}
          <div className={styles.inputContainer}>
            <div className={styles.inputBox}>
              {/* Top row: textarea */}
              <textarea
                ref={textareaRef}
                className={styles.textarea}
                placeholder="Ask Sentinel about a finding, supplier, HS code, or jurisdiction…"
                value={query}
                onChange={handleInput}
                onKeyDown={handleKeyDown}
                rows={1}
              />
              {/* Bottom row: tools chip + send */}
              <div className={styles.inputBottom}>
                <div className={styles.toolsRow}>
                  <button
                    id="toggle-web-search"
                    onClick={() => setWebSearch(v => !v)}
                    title="When on, Sentinel supplements grounded findings with live You.com web search"
                    style={{
                      display: 'inline-flex', alignItems: 'center', gap: 6,
                      padding: '6px 12px', fontSize: 12, fontWeight: 500,
                      borderRadius: 100, cursor: 'pointer',
                      background: webSearch ? 'rgba(216,155,74,0.14)' : 'transparent',
                      color: webSearch ? '#D89B4A' : 'var(--text-secondary)',
                      border: webSearch ? '1px solid rgba(216,155,74,0.4)' : '1px solid var(--border-color)',
                    }}
                  >
                    <Globe size={13} /> Web search
                    {webSearch && <Check size={12} />}
                  </button>
                </div>

                {/* Send Button */}
                <button
                  className={`${styles.sendBtn} ${query.trim() ? styles.sendBtnActive : ''}`}
                  onClick={sendMessage}
                  disabled={!query.trim() || isTyping}
                >
                  <ArrowUp size={16} />
                </button>
              </div>
            </div>
          </div>

          <p className={styles.disclaimer}>Sentinel can make mistakes. Every finding on the dashboard carries a deep-link citation — verify against the primary source.</p>
        </div>

      </div>
    </div>
  );
}
