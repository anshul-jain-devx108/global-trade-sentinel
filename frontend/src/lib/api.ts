/**
 * Central API config + SWR fetcher.
 *
 * Every fetch to the backend goes through here so:
 *   1. `localhost:7777` is defined once (env-overridable via NEXT_PUBLIC_API_URL)
 *   2. SWR gets one consistent fetcher with credentials + retry semantics
 *   3. Route shape (AgentOS root vs /api/v1/gts custom) is explicit
 *
 * AgentOS routes (Agno framework built-ins) are mounted at the ROOT:
 *   /traces, /metrics, /sessions, /schedules, /agents, ...
 * Our own custom routes live under /api/v1:
 *   /api/v1/auth/*, /api/v1/chat/*, /api/v1/gts/*
 *
 * See CLAUDE.md: "wire UI to the existing AgentOS route before writing a
 * bespoke /api/v1/gts/* endpoint."
 */

// Must match the domain the SSO callback sets the access_token cookie on.
// Microsoft SSO callback hits http://localhost:7777/..., backend sets cookie
// scoped to "localhost". If the frontend then calls http://127.0.0.1:7777/*,
// the browser treats it as a different domain and refuses to send the cookie
// — every request 401s even though the user just logged in.
//
// If Brave/Chrome HTTPS-Only Mode auto-upgrades http://localhost, clear
// the HSTS entry: brave://net-internals/#hsts → Delete "localhost".
export const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:7777';

/** Custom GTS routes (auth, chat, /api/v1/gts/*) */
export const API_V1 = `${API_BASE}/api/v1`;
export const GTS_API = `${API_V1}/gts`;
export const AUTH_API = `${API_V1}/auth`;
export const CHAT_API = `${API_V1}/chat`;

/** AgentOS built-ins mounted at the root */
export const OS_API = API_BASE;

/**
 * SWR fetcher: cookie-authenticated GET.
 *
 * - 401 → returns null (unauthenticated pages just render their empty state)
 * - 4xx other than 401 → throws with the status so useSWR's onError can react
 * - Network fail → throws (SWR's built-in retry policy takes over)
 *
 * SWR's default retry is 5 attempts with exponential backoff, which covers
 * the "backend boot race" case (Slack auth.test slows the first ~3s of
 * startup so an eager fetch from a just-mounted Sidebar can time out).
 */
export async function fetcher<T = unknown>(url: string): Promise<T | null> {
  const res = await fetch(url, { credentials: 'include' });

  if (res.status === 401) return null;
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    const err = new Error(`${res.status}: ${text}`) as Error & { status: number };
    err.status = res.status;
    throw err;
  }
  return res.json();
}

/**
 * Global SWR options.
 *
 * ⚠️ DEMO-MODE TUNING (revert after video shoot):
 * dedupingInterval is bumped 30s → 5min and revalidateOnFocus is off so a
 * cached response is served for the whole demo without a slow re-fetch.
 * The /traces endpoint hits Supabase over TLS and the first cold query
 * takes 30+ seconds — unacceptable on-camera. Revalidation still happens
 * on manual refresh (mutate()) and on mount if the key isn't cached yet.
 *
 * To restore normal behavior after the demo:
 *   - dedupingInterval: 30_000
 *   - revalidateOnFocus: true
 */
export const SWR_CONFIG = {
  fetcher,
  revalidateOnMount: true,
  revalidateOnFocus: false,    // demo: don't refetch on tab focus
  revalidateIfStale: false,    // demo: cached data is "always fresh enough"
  dedupingInterval: 300_000,   // demo: 5-minute cache TTL
  errorRetryCount: 3,
  errorRetryInterval: 800,
  shouldRetryOnError: (err: Error & { status?: number }) => {
    if (!err.status) return true;
    return err.status >= 500;
  },
} as const;

/**
 * Endpoints to pre-warm at app boot. AppShell fires these in parallel as
 * soon as the sidebar mounts, so by the time the user clicks Traces the
 * network round-trip is already done (or in flight) and the page renders
 * from cache instantly.
 *
 * ⚠️ Remove after the demo — see SWR_CONFIG note above.
 */
export const PREFETCH_KEYS = [
  `${AUTH_API}/me`,
  `${CHAT_API}`,
  `${GTS_API}/specialists`,
  `${GTS_API}/events?limit=50`,
  `${OS_API}/traces?limit=20`,
  `${OS_API}/metrics?limit=30`,
];
