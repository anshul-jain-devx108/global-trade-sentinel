'use client';

import { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import { SWRConfig, useSWRConfig } from 'swr';
import Sidebar from '@/components/Sidebar';
import { PREFETCH_KEYS, SWR_CONFIG, fetcher } from '@/lib/api';
import styles from '../app/layout.module.css';

/**
 * Fires the whole prefetch list in parallel as soon as the shell mounts.
 * By the time the user first navigates to Traces (which has a cold-query
 * spike over TLS to Supabase), the response is already sitting in cache.
 *
 * ⚠️ Demo-mode helper — see PREFETCH_KEYS note in lib/api.ts.
 */
function usePrefetchOnBoot() {
  const { mutate, cache } = useSWRConfig();

  useEffect(() => {
    for (const key of PREFETCH_KEYS) {
      // Only trigger if the key isn't already in cache — a hot reload
      // during development shouldn't re-warm every endpoint.
      if (!cache.get(key)) {
        // We call mutate() rather than fetcher() directly so SWR treats
        // the response as canonical cache data. Errors are swallowed —
        // the actual page will surface them if needed.
        mutate(key, fetcher(key).catch(() => null));
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}

function ShellInner({ children }: { children: React.ReactNode }) {
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const pathname = usePathname();

  // Prefetch after the SWRConfig is applied (this component is a child
  // of the provider) — otherwise mutate() reaches the default global
  // cache and the retry/dedupe policy from SWR_CONFIG doesn't apply.
  usePrefetchOnBoot();

  const noSidebar = ['/', '/login'];
  if (noSidebar.includes(pathname)) return <>{children}</>;

  return (
    <div className={styles.appContainer}>
      <Sidebar isOpen={sidebarOpen} onToggle={() => setSidebarOpen(!sidebarOpen)} />
      <div className={styles.mainContent}>{children}</div>
    </div>
  );
}

export default function AppShell({ children }: { children: React.ReactNode }) {
  // Wrap EVERYTHING in SWRConfig — including the marketing/login pages —
  // so any future data hook on those pages picks up the shared cache and
  // retry policy without a duplicate provider.
  return (
    <SWRConfig value={SWR_CONFIG}>
      <ShellInner>{children}</ShellInner>
    </SWRConfig>
  );
}
