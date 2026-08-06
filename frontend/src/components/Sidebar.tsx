'use client';

import { useState, useEffect, useRef } from 'react';
import useSWR, { useSWRConfig } from 'swr';
import styles from './Sidebar.module.css';
import { Clock, PanelLeftClose, PanelLeftOpen, Bot, Settings, LogOut, Trash2, ShieldCheck, Sparkles, Building2, Activity, Coins, Mail } from 'lucide-react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { AUTH_API, CHAT_API } from '@/lib/api';

interface SidebarProps {
  isOpen: boolean;
  onToggle: () => void;
}

type User = { full_name: string; email: string; role: string };
type Chat = { id: string; title: string };

export default function Sidebar({ isOpen, onToggle }: SidebarProps) {
  const pathname = usePathname();
  const router = useRouter();
  const searchParamsHook = useSearchParams();
  const { mutate } = useSWRConfig();
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const userMenuRef = useRef<HTMLDivElement | null>(null);

  // SWR replaces the per-mount fetch+useState pattern. The cache is
  // module-level so switching between /chat, /traces, /usage etc. renders
  // this data INSTANTLY from cache; a background revalidation refreshes it.
  // Retry policy is set globally in AppShell's SWRConfig — transient
  // "Failed to fetch" while the backend is still coming up will retry 3x
  // with exponential backoff instead of throwing to console.
  const { data: user, error: userErr } = useSWR<User | null>(`${AUTH_API}/me`);
  // Fetcher returns `null` on 401 (unauthenticated). Fall back to an empty
  // array so `.map` doesn't crash before login completes.
  const { data: rawChats } = useSWR<Chat[] | null>(`${CHAT_API}`);
  const recentChats: Chat[] = rawChats ?? [];

  // Unauth on a protected page → hop to /login (same as before).
  useEffect(() => {
    if (user === null && !userErr) return; // still loading
    if (user === null && userErr) {
      if (pathname !== '/' && pathname !== '/login') router.push('/login');
    }
  }, [user, userErr, pathname, router]);

  // Close the user menu when navigating or clicking outside its container.
  useEffect(() => { setUserMenuOpen(false); }, [pathname]);
  useEffect(() => {
    if (!userMenuOpen) return;
    const onDocClick = (e: MouseEvent) => {
      if (userMenuRef.current && !userMenuRef.current.contains(e.target as Node)) {
        setUserMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [userMenuOpen]);

  const handleLogout = () => {
    fetch(`${AUTH_API}/logout?t=${Date.now()}`, {
      method: 'POST',
      credentials: 'include',
      cache: 'no-store'
    })
      .then(() => {
        // Wipe the whole SWR cache so a subsequent login can't see the
        // previous user's cached data.
        mutate(() => true, undefined, { revalidate: false });
        router.push('/');
      })
      .catch((err) => {
        console.error("Logout error:", err);
        router.push('/');
      });
  };

  const handleDeleteChat = async (e: React.MouseEvent, id: string) => {
    e.preventDefault();
    e.stopPropagation();
    try {
      const res = await fetch(`${CHAT_API}/${id}`, {
        method: 'DELETE',
        credentials: 'include'
      });
      if (res.ok) {
        // Optimistically drop the row from the shared cache. Any other
        // component subscribed to the same key updates in the same tick.
        mutate(
          `${CHAT_API}`,
          (current: Chat[] | undefined | null) => (current ?? []).filter(c => c.id !== id),
          { revalidate: false }
        );
        if (searchParamsHook?.get('session') === id) {
          router.push('/chat');
        }
      }
    } catch (err) {
      console.error("Failed to delete chat", err);
    }
  };

  const isSentinelActive =
    pathname === '/agents/trade-sentinel' || pathname?.startsWith('/agents/trade-sentinel');

  return (
    <aside className={`${styles.sidebar} ${isOpen ? styles.open : styles.closed}`}>

      {/* ── Top: Brand + Toggle ── */}
      <div className={styles.topRow}>
        {isOpen && (
          <Link href="/" className={styles.brandSection}>
            <div className={styles.logoMark}>GTS</div>
            <div className={styles.brandInfo}>
              <span className={styles.brandName}>Global Trade Sentinel</span>
              <span className={styles.brandStack}>Agno · You.com</span>
            </div>
          </Link>
        )}
        <button
          className={styles.toggleBtn}
          onClick={onToggle}
          title={isOpen ? 'Collapse sidebar' : 'Expand sidebar'}
        >
          {isOpen ? <PanelLeftClose size={18} /> : <PanelLeftOpen size={18} />}
        </button>
      </div>

      {/* ── Nav (hidden when collapsed) ── */}
      {isOpen && (
        <>
          <nav className={styles.navList}>
            <Link
              href="/agents/trade-sentinel"
              className={`${styles.navItem} ${isSentinelActive ? styles.navActive : ''}`}
            >
              <ShieldCheck size={17} /><span>Dashboard</span>
            </Link>
            <Link
              href="/chat"
              className={`${styles.navItem} ${pathname === '/chat' ? styles.navActive : ''}`}
            >
              <Sparkles size={17} /><span>Ask Sentinel</span>
            </Link>
            <Link
              href="/agents"
              className={`${styles.navItem} ${pathname === '/agents' ? styles.navActive : ''}`}
            >
              <Bot size={17} /><span>Agents</span>
            </Link>
            <Link
              href="/profile"
              className={`${styles.navItem} ${pathname === '/profile' ? styles.navActive : ''}`}
            >
              <Building2 size={17} /><span>Company Profile</span>
            </Link>
            <Link
              href="/traces"
              className={`${styles.navItem} ${pathname === '/traces' ? styles.navActive : ''}`}
            >
              <Activity size={17} /><span>Traces</span>
            </Link>
            <Link
              href="/usage"
              className={`${styles.navItem} ${pathname === '/usage' ? styles.navActive : ''}`}
            >
              <Coins size={17} /><span>Usage &amp; Cost</span>
            </Link>
          </nav>

          <div className={styles.recentSection}>
            <div className={styles.sectionHeader}>
              <Clock size={13} /><span>Recent queries</span>
            </div>
            <ul className={styles.recentList}>
              {recentChats.map(chat => (
                <li key={chat.id} className={styles.recentItem}>
                  <Link href={`/chat?session=${chat.id}`} className={styles.recentLink}>
                    <span className={styles.recentTitle}>{chat.title}</span>
                    <button
                      className={styles.deleteChatBtn}
                      onClick={(e) => handleDeleteChat(e, chat.id)}
                      title="Delete chat"
                    >
                      <Trash2 size={14} />
                    </button>
                  </Link>
                </li>
              ))}
              {recentChats.length === 0 && (
                <li className={styles.recentItem} style={{color: '#666', fontSize: '12px', paddingLeft: '24px'}}>No recent queries</li>
              )}
            </ul>
          </div>

          <div ref={userMenuRef} className={styles.userSection} style={{ cursor: 'pointer', position: 'relative' }}>
            <button
              onClick={() => setUserMenuOpen(v => !v)}
              style={{
                display: 'flex', alignItems: 'center', gap: 10, width: '100%',
                background: 'transparent', border: 'none', padding: 0, cursor: 'pointer',
                color: 'inherit', textAlign: 'left',
              }}
              aria-expanded={userMenuOpen}
              title={userMenuOpen ? 'Close account menu' : 'Open account menu'}
            >
              <div className={styles.userAvatar}>
                {user?.full_name ? user.full_name.charAt(0).toUpperCase() : '?'}
              </div>
              <div className={styles.userInfo}>
                <span className={styles.userName}>{user?.full_name || 'Loading...'}</span>
                <span className={styles.userPlan}>{user?.role || 'Guest'}</span>
              </div>
            </button>

            {userMenuOpen && (
              <div
                role="menu"
                style={{
                  position: 'absolute', bottom: 'calc(100% + 6px)', left: 12, right: 12,
                  background: '#1a1b1e', border: '1px solid var(--border-color)',
                  borderRadius: 12, padding: 8, boxShadow: '0 10px 30px rgba(0,0,0,0.45)',
                  zIndex: 100,
                }}
              >
                {/* Identity block — richer than the avatar row can show */}
                <div style={{ padding: '10px 12px 12px', borderBottom: '1px solid var(--border-color)', marginBottom: 6 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)', lineHeight: 1.3 }}>
                    {user?.full_name || 'Loading…'}
                  </div>
                  {user?.email && (
                    <div style={{ fontSize: 11.5, color: 'var(--text-secondary)', marginTop: 3, display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                      <Mail size={11} /> {user.email}
                    </div>
                  )}
                  {user?.role && (
                    <div style={{ marginTop: 6 }}>
                      <span style={{
                        fontSize: 10, fontWeight: 700, letterSpacing: 0.5, textTransform: 'uppercase',
                        color: '#D89B4A', background: 'rgba(216,155,74,0.1)',
                        border: '1px solid rgba(216,155,74,0.25)',
                        padding: '2px 8px', borderRadius: 100,
                      }}>{user.role}</span>
                    </div>
                  )}
                </div>

                <Link
                  href="/settings"
                  onClick={() => setUserMenuOpen(false)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 10,
                    padding: '8px 12px', fontSize: 13, borderRadius: 8,
                    color: 'var(--text-primary)', textDecoration: 'none',
                  }}
                  onMouseEnter={e => (e.currentTarget.style.background = 'rgba(255,255,255,0.05)')}
                  onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                >
                  <Settings size={14} /> Settings
                </Link>

                <button
                  onClick={() => { setUserMenuOpen(false); handleLogout(); }}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 10, width: '100%',
                    padding: '8px 12px', fontSize: 13, borderRadius: 8,
                    background: 'transparent', border: 'none',
                    color: '#fecaca', cursor: 'pointer', textAlign: 'left',
                  }}
                  onMouseEnter={e => (e.currentTarget.style.background = 'rgba(239,68,68,0.1)')}
                  onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                >
                  <LogOut size={14} /> Sign out
                </button>
              </div>
            )}
          </div>
        </>
      )}

      {/* ── Collapsed: icon-only nav ── */}
      {!isOpen && (
        <div className={styles.collapsedNav}>
          <Link href="/agents/trade-sentinel" className={`${styles.collapsedNavItem} ${isSentinelActive ? styles.navActive : ''}`} title="Dashboard"><ShieldCheck size={18} /></Link>
          <Link href="/chat" className={`${styles.collapsedNavItem} ${pathname === '/chat' ? styles.navActive : ''}`} title="Ask Sentinel"><Sparkles size={18} /></Link>
          <Link href="/agents" className={`${styles.collapsedNavItem} ${pathname === '/agents' ? styles.navActive : ''}`} title="Agents"><Bot size={18} /></Link>
          <Link href="/profile" className={`${styles.collapsedNavItem} ${pathname === '/profile' ? styles.navActive : ''}`} title="Company Profile"><Building2 size={18} /></Link>
          <Link href="/traces" className={`${styles.collapsedNavItem} ${pathname === '/traces' ? styles.navActive : ''}`} title="Traces"><Activity size={18} /></Link>
          <Link href="/usage" className={`${styles.collapsedNavItem} ${pathname === '/usage' ? styles.navActive : ''}`} title="Usage & Cost"><Coins size={18} /></Link>
        </div>
      )}
    </aside>
  );
}
