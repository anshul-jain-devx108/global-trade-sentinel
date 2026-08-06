import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import styles from './ChatMessage.module.css';
import { User, Sparkles } from 'lucide-react';
import ApprovalCard, { parseApprovalMarker } from './ApprovalCard';

export interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
}

interface Props {
  message: Message;
  sessionId?: string;
  // True when this assistant turn is NO LONGER the last assistant reply —
  // i.e. a later message has already resolved the pending approval. In
  // that case the buttons are misleading; we drop the card and just show
  // the rationale text.
  approvalResolved?: boolean;
}

export default function ChatMessage({ message, sessionId, approvalResolved }: Props) {
  const isUser = message.role === 'user';

  // Assistant reply may carry an `[[APPROVAL:{...}]]` marker when Ask
  // Sentinel paused for a specialist call (HITL). Render the card
  // instead of the raw marker line; the rationale text renders normally.
  const approval = !isUser && sessionId ? parseApprovalMarker(message.content) : null;
  const bodyText = approval ? approval.rationale : message.content;

  return (
    <div className={`${styles.wrapper} ${isUser ? styles.userWrapper : styles.assistantWrapper}`}>
      {/* Avatar */}
      <div className={`${styles.avatar} ${isUser ? styles.userAvatar : styles.aiAvatar}`}>
        {isUser ? <User size={15} /> : <Sparkles size={15} />}
      </div>

      {/* Bubble */}
      <div className={`${styles.bubble} ${isUser ? styles.userBubble : styles.assistantBubble}`}>
        <div className={styles.content}>
          {isUser ? (
            // User turns are plain text — no markdown parsing so pasted
            // asterisks, backticks, etc. render as typed.
            bodyText.split('\n').map((line, i) =>
              line.trim() === '' ? <br key={i} /> : <p key={i}>{line}</p>
            )
          ) : (
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              components={{
                a: ({ href, children }) => (
                  <a href={href} target="_blank" rel="noopener noreferrer">
                    {children}
                  </a>
                ),
              }}
            >
              {bodyText}
            </ReactMarkdown>
          )}
        </div>
        {approval && sessionId && !approvalResolved && (
          <ApprovalCard sessionId={sessionId} payload={approval.payload} />
        )}
      </div>
    </div>
  );
}
