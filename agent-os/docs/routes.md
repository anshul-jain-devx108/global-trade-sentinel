# GTS API Routes — Custom vs Built-in

Total exposed routes: **~100** (custom `/api/v1/*` + ~86 AgentOS built-ins).

This doc explains **which custom routes exist and why** — so nobody
deletes them thinking "framework does the same thing".

All custom routes are mounted under `/api/v1/*` since the single-service
merge on 2026-07-31 (`/api/v1/gts/*` for domain routes, `/api/v1/auth/*`
for SSO, `/api/v1/chat/*` for Ask Sentinel). AgentOS built-ins stay
mounted at the root (`/traces`, `/schedules`, `/agents`, …).

---

## Custom `/api/v1/*` routes

| Route | Method | Router file |
|---|---|---|
| `/api/v1/auth/microsoft/login` | GET | `api/routers/auth.py` |
| `/api/v1/auth/microsoft/callback` | GET | `api/routers/auth.py` |
| `/api/v1/auth/me` | GET, PUT | `api/routers/auth.py` |
| `/api/v1/auth/logout` | POST | `api/routers/auth.py` |
| `/api/v1/chat/` | GET, POST | `api/routers/chat.py` |
| `/api/v1/chat/{session_id}/messages` | GET, POST | `api/routers/chat.py` |
| `/api/v1/chat/{session_id}/generate` | POST | `api/routers/chat.py` |
| `/api/v1/chat/{session_id}` | DELETE | `api/routers/chat.py` |
| `/api/v1/gts/health` | GET | `api/routers/health.py` |
| `/api/v1/gts/specialists` | GET | `api/routers/health.py` |
| `/api/v1/gts/specialists/{id}/enabled` | PATCH | `api/routers/health.py` |
| `/api/v1/gts/sweep` | POST | `api/routers/sweep.py` |
| `/api/v1/gts/sweep/cron` | POST | `api/routers/sweep.py` |
| `/api/v1/gts/sweep/latest` | GET | `api/routers/sweep.py` |
| `/api/v1/gts/sweep/{task_id}` | GET | `api/routers/sweep.py` |
| `/api/v1/gts/sweep/{task_id}/cancel` | POST | `api/routers/sweep.py` |
| `/api/v1/gts/agent/{agent_id}/run` | POST | `api/routers/agents.py` |
| `/api/v1/gts/profile` | GET, POST | `api/routers/profile.py` |
| `/api/v1/gts/profile/questions` | POST | `api/routers/profile.py` |
| `/api/v1/gts/profile/enrich` | POST | `api/routers/profile.py` |
| `/api/v1/gts/events` | GET | `api/routers/events.py` |
| `/api/v1/gts/events/stats` | GET | `api/routers/events.py` |
| `/api/v1/gts/events/{event_id}/status` | PATCH | `api/routers/events.py` |
| `/api/v1/gts/schedule` | GET, PUT | `api/routers/schedule.py` |
| `/api/v1/gts/schedule/enable` | POST | `api/routers/schedule.py` |
| `/api/v1/gts/schedule/disable` | POST | `api/routers/schedule.py` |
| `/api/v1/gts/schedule/trigger` | POST | `api/routers/schedule.py` |
| `/api/v1/gts/schedule/runs` | GET | `api/routers/schedule.py` |

Everything under `/api/v1/gts/*` and `/api/v1/chat/*` is guarded by the
JWT-in-cookie check in `api/auth_deps.py:get_current_user`. The single
intentional exception is `/api/v1/gts/sweep/cron`, which stays
unauthenticated so the in-process SchedulePoller can call it via
loopback (see the docstring at `api/routers/sweep.py:53`).

---

## Bucket 1 — MUST be custom (framework has no equivalent)

Framework doesn't know anything about our domain models.

| Custom route | Framework equivalent | Why custom is required |
|---|---|---|
| `GET /api/v1/gts/events` + stats + PATCH | ❌ none | `regulatory_events` is our SQLAlchemy table — Agno has no concept of it |
| `GET/POST /api/v1/gts/profile` | ❌ none | `company_profile` is our domain model |
| `POST /api/v1/gts/profile/questions` + `/enrich` | ❌ none | Business wrapper around the onboarding copilot |
| `/api/v1/auth/*` | ❌ none | Microsoft SSO → JWT cookie, our own tenancy |
| `/api/v1/chat/*` | ❌ none | ChatSession/ChatMessage tables + Ask Sentinel prompt |

**Verdict:** never delete. These ARE the app.

---

## Bucket 2 — Custom is JUSTIFIED (framework route exists but is insufficient)

The framework's built-in route works, but critical behaviour is missing.

### `POST /api/v1/gts/sweep`  vs  `POST /teams/sweep-leader/runs`

The framework route runs the team synchronously with no profile context and no persistence. Our custom route does four things it can't:

1. **Injects the active company profile** as XML context before the run. Without this the specialists all return `no_data` (see `agentic_system/agents/sanctions_screening_agent/prompt.py`).
2. **Runs in the background** and returns a `task_id` so a browser tab-close / refresh / network hiccup doesn't cancel the run.
3. **Blocks with 409** when a cron preset is active — prevents concurrent manual + scheduled sweeps from stepping on each other.
4. **Persists results to `regulatory_events`** with dedupe.

### `POST /api/v1/gts/sweep/cron`  vs  `POST /teams/sweep-leader/runs`

Same reasons as above — the SchedulePoller calls this. Mirrors the manual
`/sweep` path so scheduled runs actually work: loads the active company
profile and injects it as XML context, persists results through
`run_sweep_and_persist`.

### `GET/PUT /api/v1/gts/schedule`  vs  `GET/POST /schedules` (framework CRUD)

The framework surface is raw cron CRUD: `{name, cron_expr, endpoint, method, payload, timezone, if_exists, ...}` — powerful but wrong for our UI.

Our custom route exposes a **preset UX** (`{preset: "daily"}`) and atomically deletes+creates so preset switches don't stack. Frontend doesn't want to know what a cron string is.

**Verdict:** keep. Behaviour is not decorative — removing any of these breaks the product.

---

## Bucket 3 — Custom is DEBATABLE (thin wrappers)

The framework route works. The custom route reshapes the response.

### `GET /api/v1/gts/health`  vs  `GET /health`

- **Framework `/health`**: minimal — status only.
- **Custom `/api/v1/gts/health`**: includes the specialist agent list, useful for monitoring dashboards. Also unauthenticated, safe to expose to uptime probes.

*Verdict: cheap wrapper. Keep or drop.*

### `GET /api/v1/gts/specialists`  vs  `GET /agents`

- **Framework `/agents`**: returns ALL agents including `onboarding_copilot`.
- **Custom `/api/v1/gts/specialists`**: filters to the 6 trade specialists and returns a clean `{id, name, role, enabled}` shape. The `enabled` flag comes from `services/specialist_state` and is what the /agents page toggles.

*Verdict: **keep**. Filtering is not free on the frontend, and the toggle state lives on our side.*

### `POST /api/v1/gts/agent/{agent_id}/run`  vs  `POST /agents/{agent_id}/runs`

- **Framework `/agents/{id}/runs`**: full run object — `session_id`, `run_id`, `tools_called`, `checkpoints`, etc.
- **Custom `/api/v1/gts/agent/{id}/run`**: flat `{agent_id, content}`.

*Verdict: **consider removing**. Frontend loses session tracking + tool-call visibility for free by using the framework endpoint. Only reason to keep is if some frontend code already depends on the flat shape.*

---

## Duplicate surfaces worth being aware of

### Schedules

Two overlapping surfaces:

- `/api/v1/gts/schedule` — preset UI wrapper (ours)
- `/schedules/*` — raw framework CRUD (7 routes)

**Risk:** a caller can `POST /schedules` with `{endpoint: "/api/v1/gts/sweep/cron", method: "POST"}` and bypass our preset guardrails. If the app ever gets exposed beyond localhost, either:

- disable the framework schedule router via an `AgentOS(...)` constructor flag (if supported — check `.venv/Lib/site-packages/agno/os/app.py`), OR
- add a middleware that blocks `/schedules/*` for non-internal origins.

### Health

Two health endpoints:

- `/health` (framework)
- `/api/v1/gts/health` (ours)

Load-balancer probes usually want `/health`; monitoring dashboards use `/api/v1/gts/health` for the specialist list. No conflict.

---

## Built-in AgentOS routes (~86)

Grouped by prefix — everything not under `/api/v1/*`.

| Prefix | Count | Purpose |
|---|---|---|
| `/agents` | 10 | Per-agent runs / checkpoints / resume / cancel / fork |
| `/teams` | 10 | Same lifecycle for teams (`sweep-leader` lives here) |
| `/workflows` | 7 | Workflow runs — dormant, we register none |
| `/schedules` | 7 | Raw cron CRUD — see duplicate-surface note above |
| `/knowledge` | 8 | Knowledge-base CRUD + search — dormant |
| `/sessions` | 5 | Sessions CRUD from the `sessions` table |
| `/components` | 6 | Runtime component config (A/B flags) |
| `/approvals` | 5 | Human-in-the-loop tool approvals |
| `/learnings` | 4 | Per-user learnings CRUD |
| `/traces` | 4 | OpenTelemetry span queries — powered by `setup_tracing(...)` in `main.py` |
| `/memories` | 2 | `memories` table CRUD |
| `/service-accounts` | 2 | Internal service-account tokens |
| `/databases` | 2 | DB migration triggers |
| `/eval-runs` | 2 | Eval-suite runs |
| `/metrics` | 2 | Aggregated metrics |
| `/health`, `/config`, `/info`, `/models`, `/registry`, `/memory_topics`, `/optimize-memories`, `/trace_session_stats`, `/user_memory_stats`, `/` | 1 each | Framework introspection surface |

---

## One-line answer

- **Auth + chat + events + profile** → framework knows nothing, custom mandatory.
- **Sweep + schedule** → framework routes exist but miss profile injection, background tasks, dedupe persistence, preset UX — custom justified.
- **Health / specialists / agent-run** → thin wrappers, safe to trim if we ever want to slim the API surface.
