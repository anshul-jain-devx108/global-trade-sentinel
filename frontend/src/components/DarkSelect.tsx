'use client';

import { useEffect, useRef, useState, ReactNode } from 'react';
import { ChevronDown, Check } from 'lucide-react';

export type DarkSelectOption = { value: string; label: string; icon?: ReactNode };

/**
 * A dark-themed dropdown that renders its option list as a portal-free
 * absolutely-positioned menu. Native <select> is unreliable across
 * Chromium on Windows — the option popup falls back to the OS theme
 * regardless of `color-scheme` or `option { background }`. This avoids
 * that entirely.
 */
export default function DarkSelect({
  value,
  onChange,
  options,
  placeholder = 'Select…',
  width = 180,
  disabled = false,
  title,
}: {
  value: string;
  onChange: (v: string) => void;
  options: DarkSelectOption[];
  placeholder?: string;
  width?: number | string;
  disabled?: boolean;
  title?: string;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const selected = options.find(o => o.value === value);

  return (
    <div ref={rootRef} style={{ position: 'relative', width, minWidth: width }} title={title}>
      <button
        type="button"
        onClick={() => !disabled && setOpen(o => !o)}
        disabled={disabled}
        style={{
          width: '100%',
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 8,
          background: 'var(--bg-input, #1a1b1e)',
          color: 'var(--text-primary, #F5F2EB)',
          border: '1px solid var(--border-color, rgba(255,255,255,0.15))',
          borderRadius: 8,
          padding: '8px 12px',
          fontSize: 13,
          fontFamily: 'inherit',
          cursor: disabled ? 'not-allowed' : 'pointer',
          opacity: disabled ? 0.6 : 1,
          textAlign: 'left',
        }}
      >
        <span style={{
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          display: 'inline-flex', alignItems: 'center', gap: 6,
        }}>
          {selected?.icon}
          {selected?.label ?? <span style={{ color: 'var(--text-secondary, #A39F93)' }}>{placeholder}</span>}
        </span>
        <ChevronDown size={14} style={{ opacity: 0.7, transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s' }} />
      </button>

      {open && (
        <div
          role="listbox"
          style={{
            position: 'absolute',
            top: 'calc(100% + 4px)',
            left: 0,
            right: 0,
            minWidth: '100%',
            zIndex: 50,
            background: '#17181b',
            border: '1px solid var(--border-color, rgba(255,255,255,0.15))',
            borderRadius: 8,
            padding: 4,
            boxShadow: '0 8px 24px rgba(0,0,0,0.5)',
            maxHeight: 260,
            overflowY: 'auto',
          }}
        >
          {options.map(opt => {
            const active = opt.value === value;
            return (
              <button
                key={opt.value}
                type="button"
                role="option"
                aria-selected={active}
                onClick={() => { onChange(opt.value); setOpen(false); }}
                style={{
                  width: '100%',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  padding: '8px 10px',
                  borderRadius: 6,
                  background: active ? 'rgba(59,130,246,0.14)' : 'transparent',
                  border: 'none',
                  color: 'var(--text-primary, #F5F2EB)',
                  fontSize: 13,
                  fontFamily: 'inherit',
                  cursor: 'pointer',
                  textAlign: 'left',
                }}
                onMouseEnter={e => { if (!active) e.currentTarget.style.background = 'rgba(255,255,255,0.05)'; }}
                onMouseLeave={e => { if (!active) e.currentTarget.style.background = 'transparent'; }}
              >
                {opt.icon}
                <span style={{ flex: 1 }}>{opt.label}</span>
                {active && <Check size={13} color="#3b82f6" />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
