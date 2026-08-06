# Microsoft Teams Integration — Plan

Owner: engineering
Status: **Phase 1 approved, Phase 2/3 parked pending user demand**
Last updated: 2026-07-31

This doc captures the plan agreed on 2026-07-31 for bringing GTS into Microsoft
Teams. Two workstreams, staged to avoid over-building before we have real
usage signal:

- **Phase 1 — Outbound sweep alerts** (single Incoming Webhook, one channel).
  Ship immediately.
- **Phase 2 — "Ask Sentinel" in Teams as a bot** (bidirectional chat, personal
  + channel + group scope). Park until users ask.
- **Phase 3 — Interactive cards** (Acknowledge / trigger sweep from Teams).
  Only after Phase 2 has real users.

Everything below is Teams-only. Slack integration is deliberately out of
scope for now — the trade-off analysis (webhook vs SlackTools bot vs full
Agno Slack interface) is captured in the same session log if we revisit.

---

## Phase 1 — Outbound sweep alerts (SHIP NOW)

### Goal

After every sweep that produced **at least one new finding**, push a
summarized card into a designated Teams channel so the compliance team gets a
signal without opening the GTS web app.

### Non-goals (Phase 1)

- Multiple channels / multi-tenant fan-out
- Per-user notification preferences
- Failure alerts (sweep errors)
- Any inbound direction — Teams cannot talk back to GTS in Phase 1
- Threading / acknowledgements / interactive buttons

### Integration mechanism — Incoming Webhook (push-only)

```
GTS backend (agent-os)                        Microsoft Teams
─────────────────────                        ────────────────

run_sweep_and_persist() done                  Channel "#gts-alerts"
      │                                              ▲
      │ POST https://outlook.office.com/...          │
      │ Content-Type: application/json               │
      │ Body: MessageCard JSON                       │
      └─────────────────────────────────────────────►│
                    (async httpx, 10s timeout)       │
                                              Teams renders card
                                              inside the channel
```

- **Auth model:** the webhook URL itself is the shared secret. No OAuth, no
  Azure AD app, no bot registration. Whoever holds the URL can post to that
  channel. Rotate by deleting + recreating the connector.
- **Cross-tenant:** works. Each webhook URL is standalone HTTPS — GTS can
  push to a partner org's Teams channel if they hand over their URL.

### One-time setup (Teams admin)

1. Teams channel → `⋯` → **Manage channel** → **Connectors** (or
   **Workflows** — either works).
2. **Incoming Webhook** → Configure → name "GTS Sweep", upload GTS icon
   (optional).
3. **Create** → copy the generated URL.
4. Paste into `agent-os/.env`:
   ```env
   TEAMS_WEBHOOK_URL=https://outlook.office.com/webhook/...
   ```
5. Restart `agent-os`.

Blank or unset → alerting silently disabled. Dev machines stay quiet unless
they explicitly opt in.

### Code changes (5 files, ~120 lines)

#### 1. `agent-os/agentic_system/config/config.py`

Add two constants:

```python
TEAMS_WEBHOOK_URL = os.getenv("TEAMS_WEBHOOK_URL")
FRONTEND_URL = os.getenv("FRONTEND_URL", "http://localhost:3000")
```

`FRONTEND_URL` is currently hardcoded in `api/routers/auth.py:33`. Centralise
here so the alert card's "Open dashboard" button and the SSO redirect share
the same source of truth.

#### 2. `agent-os/services/teams_notifier.py` — NEW (~80 lines)

- `build_sweep_card(summary, events)` → returns MessageCard JSON dict.
  - Header: "🔔 GTS Sweep — N new findings"
  - Facts: added / updated / duplicates counts + UTC timestamp
  - Top 3 events sorted by severity (`CRITICAL → WARNING → INFO`):
    title, jurisdiction, severity badge
  - `potentialAction`: "Open dashboard" → `{FRONTEND_URL}/dashboard`
- `async def send_sweep_alert(summary)`:
  - Return silently if `TEAMS_WEBHOOK_URL` unset
  - `httpx.AsyncClient(timeout=10.0)` POST
  - Non-2xx → log warning at `sentinel.notify`, **never raise**
  - Timeout → same

Uses **MessageCard schema** (legacy but universal — works with every Incoming
Webhook). Adaptive Cards are newer but require the Workflows connector
flavour of webhook, higher setup friction. Revisit in Phase 3 when
interactivity actually needs Adaptive Cards.

#### 3. `agent-os/sweep_service.py` — 3 lines at end of `run_sweep_and_persist`

Insert **before** `return summary` (line 181):

```python
if summary.get("added", 0) > 0:
    try:
        await send_sweep_alert(summary)
    except Exception:  # noqa: BLE001
        log.warning("Teams alert failed", exc_info=True)
```

Notes:
- Best-effort: DB commit happens **before** the alert. If Teams is down, the
  finding is still in Postgres.
- Inline `await` (not `create_task`) so failed alerts show up in the sweep
  task's own log context. The 10s timeout caps worst-case delay.
- `added > 0` filter is what the user asked for — silent on
  duplicates-only sweeps.

#### 4. `agent-os/.env.example` — new section

```env
# ═════════════════════════════════════════════════════════════
# Notifications
# ═════════════════════════════════════════════════════════════
# Microsoft Teams Incoming Webhook. When set, GTS pushes a summary
# card after every sweep that produced at least one new finding.
# Setup: Teams channel → Connectors → Incoming Webhook.
# TEAMS_WEBHOOK_URL=

# Base URL of the frontend — used to build deep-link buttons in
# outbound notifications (e.g. "Open in dashboard" in Teams cards).
# FRONTEND_URL=http://localhost:3000
```

#### 5. `agent-os/api/routers/auth.py:33` — de-duplicate

Replace hardcoded `os.environ.get("FRONTEND_URL", ...)` with
`from agentic_system.config import config as CFG` → `CFG.FRONTEND_URL`.
No behaviour change.

### Failure matrix

| Scenario | GTS behaviour |
|---|---|
| `TEAMS_WEBHOOK_URL` unset | Skip silently |
| Teams API 4xx/5xx | Log warning, sweep summary intact |
| Network timeout (>10s) | Same |
| Webhook URL expired/deleted | 404 logged, sweep unaffected |
| Sweep itself errored | `added=0` guard already prevents alert |

**Invariant:** alert delivery failure never breaks sweep persistence or the
`/api/v1/gts/sweep/{task_id}` response contract.

### Manual test plan

1. `.env` populated with a real webhook → sweep with new findings → card
   appears in channel with correct counts.
2. `.env` populated but URL points at an invalid host → sweep completes
   normally, `sentinel.notify` logs a warning.
3. `.env` empty → sweep completes, no HTTP traffic, no log line.
4. Sweep produces `added=0, updated=5` → no card, no HTTP traffic.
5. Sweep produces `added=1, CRITICAL` → card themeColor red, event shows
   at top.

### Effort

~2 hours end-to-end.

---

## Phase 1.5 — Multi-channel fan-out (upgrade path)

Only if user demand grows beyond one channel.

### Tier A: Multi-webhook via `.env` (minimal change)

Change `TEAMS_WEBHOOK_URL` (string) to `TEAMS_WEBHOOK_URLS` (comma-separated
labelled list):

```env
TEAMS_WEBHOOK_URLS=compliance:https://.../abc,exec:https://.../xyz
```

`send_sweep_alert` iterates, applies simple routing rules:
- CRITICAL → all labels
- WARNING/INFO → labels tagged as "verbose"

**Suitable for** 2–10 channels, admin-managed. Beyond that, `.env` bloat.

### Tier B: DB-backed registry (self-service)

New table `notification_channel`:

```
notification_channel
├── id (uuid)
├── tenant_id           -- multi-tenant scope
├── name                -- "Compliance team - Mumbai"
├── kind                -- "teams_webhook" (future: "slack_webhook", "email")
├── webhook_url         -- encrypted at rest (SECRET_KEY-derived)
├── filter              -- JSON: {"severity":["CRITICAL","WARNING"], "jurisdictions":["US","EU"]}
├── created_by          -- FK users.id
├── enabled             -- bool
└── created_at
```

Frontend: Settings → Notifications → CRUD UI, gated on admin/owner role
inside the user's tenant.

- Webhook URLs never returned in full via API — masked (`...webhook.office.com/.../***`).
- On create: ping test with a "GTS connected" throwaway card to validate the
  URL before persisting.
- `send_sweep_alert` becomes `send_sweep_alerts(tenant_id, summary)` — loads
  enabled rows, filters, fans out.

**Effort:** ~1 day (backend router + migration + settings page).

**Migration from Tier A:** Move URLs from `.env` into DB rows. Same POST
logic downstream. No frontend break — Phase 1's single-webhook consumers
just see one row.

---

## Phase 2 — "Ask Sentinel" in Teams (PARKED)

Only start when we have direct user signal: "I live in Teams, opening the
GTS tab is friction."

### Architecture

```
Teams client                          Azure Bot Service                 GTS backend
────────────                          ─────────────────                 ───────────
User: "@GTS sanctions on Iran?"       
       │                              
       └──event──────────────────────►│
                                       │ Signs request with JWT
                                       │ Includes user's AAD OID +
                                       │   conversation reference
                                       │                                 
                                       └─POST /api/v1/teams/messages────►│
                                                                          │ Bot Framework
                                                                          │   middleware validates
                                                                          │   JWT signature
                                                                          │ Match aadObjectId →
                                                                          │   users.microsoft_oid
                                                                          │   (column already exists)
                                                                          │ Load / create ChatSession
                                                                          │   for this user
                                                                          │ Call generate_reply()
                                                                          │   (same as web chat)
                                                                          │ Persist ChatMessage
                                                                          │
                                       ◄──reply Activity JSON────────────┘
       ◄──rendered card──────────────┘
Bot replies in-thread                  
```

### Why this maps cleanly onto GTS today

- SSO is already Microsoft AAD → every Teams message carries `aadObjectId`
  which matches `users.microsoft_oid` in
  [`core/models.py:35`](../core/models.py#L35).
- Same user's chat history stays coherent across web ↔ Teams — one
  `ChatSession` per user regardless of surface.
- Chat reply logic in [`services/chat_reply.py`](../services/chat_reply.py)
  is Azure OpenAI direct → reusable as-is. Bot layer is a transport, not a
  new brain.

### One-time setup (dev/ops)

1. **Azure Portal → Bot Service** — create `gts-sentinel-bot`.
   - Single-tenant (matches GTS AAD tenant boundary).
   - Auto-generate its own AAD app (separate from SSO app, isolates scopes).
2. **Channels tab → enable Teams** (one click).
3. Copy App ID + client secret → `.env`:
   ```env
   TEAMS_BOT_APP_ID=<app-id>
   TEAMS_BOT_APP_PASSWORD=<client-secret>
   TEAMS_BOT_TENANT_ID=<tenant-id>
   ```
4. **Teams App Manifest** (`teams_manifest/manifest.json` + 2 icons)
   committed to repo. Supports capabilities: `personal`, `team`, `groupChat`.
5. **Bot messaging endpoint** registered on the Bot Service as
   `https://<gts-domain>/api/v1/teams/messages`.
   Local dev requires a public tunnel (Azure Dev Tunnels / ngrok) because
   Azure Bot Service must reach the endpoint.

### Distribution options

- **Sideload** — dev/testing, one user installs the manifest zip.
- **Org catalog** — admin uploads once, all tenant users can install.
- **Public store** — not applicable (GTS is single-tenant).

### Auth breakdown (three layers)

1. **Bot Framework signs every request.**
   Azure Bot Service JWT-signs every activity. GTS uses
   `BotFrameworkAdapter` middleware to validate the signature against
   Microsoft's public keys (auto-fetched). Malformed / spoofed requests
   rejected before hitting our code.
   ⚠️ `/api/v1/teams/messages` is exempt from the JWT-in-cookie check —
   Teams doesn't send our cookie. Bot Framework auth is the gate.
2. **User identity mapping.** Every Activity carries:
   ```json
   {
     "from": {
       "id": "29:1H1SdrN...",
       "aadObjectId": "a8f5f167-4b8e-4c5d-9b2a-...",
       "name": "Anshul Jain"
     }
   }
   ```
   Backend matches `aad_object_id` → `users.microsoft_oid`. Unknown OID →
   reply with sign-in prompt: *"Please sign in to GTS web first — {FRONTEND_URL}/login"*.
3. **Conversation references** for future proactive messaging (send a card
   into the user's DM without them prompting):
   ```
   teams_conversation_ref
   ├── user_id (FK users.id)
   ├── conversation_id
   ├── service_url          -- regional Teams endpoint
   ├── tenant_id
   └── updated_at
   ```
   Saved on first message from each user. Enables Phase 3 alerts to
   individual users via DM with real @mentions.

### Backend changes (Phase 2 scope)

New file: `agent-os/api/routers/teams_bot.py` (~200 lines)
- Botbuilder SDK `CloudAdapter` init.
- `POST /api/v1/teams/messages` — activity parse → adapter → handler.
- `TeamsActivityHandler` subclass:
  - `on_message_activity(turn_context)` → resolve user → call
    `chat_reply.generate_reply()` → persist → return reply.
  - `on_teams_signin_verify_state(turn_context)` — hook for future
    OAuth-inside-Teams flow.
- Reuses `services/chat_reply.py` and `ChatSession` / `ChatMessage` tables
  as-is.

New dependencies:
```toml
"botbuilder-core==4.15.0",
"botbuilder-schema==4.15.0",
```

New config:
```python
TEAMS_BOT_APP_ID = os.getenv("TEAMS_BOT_APP_ID")
TEAMS_BOT_APP_PASSWORD = os.getenv("TEAMS_BOT_APP_PASSWORD")
TEAMS_BOT_TENANT_ID = os.getenv("TEAMS_BOT_TENANT_ID")
```

Repo artefacts:
- `agent-os/teams_manifest/manifest.json`
- `agent-os/teams_manifest/icon-color.png` (192×192)
- `agent-os/teams_manifest/icon-outline.png` (32×32)

### Feature parity: web chat vs Teams chat

| Feature | Web (current) | Teams (Phase 2) |
|---|---|---|
| Free-form questions | ✅ | ✅ |
| Session history persists | ✅ (ChatSession) | ✅ (same table, keyed by user) |
| Markdown responses | ✅ | ✅ (Teams renders MD) |
| Streaming tokens | ✅ (SSE) | ❌ Teams has no token stream |
| Citations / deep-links | ✅ | ✅ (adaptive card sections) |
| Show sweep findings inline | Future | ✅ (adaptive cards) |
| Trigger a sweep from chat | Future | Phase 3 |
| Attach files | ✅ | ⚠️ Needs Graph API |
| DM / group chat / channel | N/A | ✅ all three (scope-aware) |

**Streaming regression** is the main UX cost. Mitigation: send Teams
"typing" indicator immediately + a filler line ("Consulting sanctions
specialist…") between agent hops so 10-30s waits don't feel dead.

### Multi-user / scope semantics

- **Personal (DM):** private, per-user `ChatSession`.
- **Channel:** replies visible to all channel members. **Per-user session
  still** — otherwise privacy leak risk (one user's company profile leaking
  into another's context). Bot must also avoid rendering
  company-confidential fields (suppliers, HS codes) in channel scope;
  restrict to public regulatory info only.
- **Group chat (2–8 users):** add bot, mention to query. Same per-user
  session rule.

### Effort estimate

| Piece | Time |
|---|---|
| Azure Bot Service + AAD app registration | 1–2 hrs (mostly clicking) |
| Manifest + icons + sideload workflow | 1 hr |
| Backend router (Bot Framework SDK) | 1 day |
| User identity mapping | 2 hrs |
| ConversationReference table + migration | 3 hrs |
| Adaptive card rendering (findings) | 1 day |
| Testing across DM / channel / group | 1 day |
| Docs + org rollout guide | 3 hrs |
| **Total** | **~5 dev-days** |

Roughly **20×** the Phase 1 effort for **100×** the capability. Only worth
it once we have real users asking for it.

---

## Phase 3 — Interactive cards (deferred)

Only after Phase 2 has non-trivial usage.

- Adaptive Card buttons: **Acknowledge**, **Dismiss**, **Trigger sweep**,
  **Assign to user**.
- Buttons post `Action.Submit` back to `/api/v1/teams/messages` — same
  endpoint, different activity type (`invoke` / `messageBack`).
- State changes sync to `regulatory_events.status` and audit trail.
- Requires Adaptive Card 1.5+ (fine in Teams).

Effort: +2 dev-days on top of Phase 2.

---

## Migration path summary

```
Phase 1  →  Phase 1.5 Tier A:  Change env var string → CSV list. No DB migration.
Phase 1.5 Tier A → Tier B:      Move URLs from .env into notification_channel rows.
                                 Same POST logic downstream.
Phase 1.5 Tier B → Phase 2:     Bot registration + new /teams/messages endpoint.
                                 Alerts and chat coexist; Phase 3 unifies them
                                 (alerts as DMs via ConversationReference).
Phase 2 → Phase 3:               Same endpoint, add invoke-activity handlers.
```

Every step is additive — no breaking changes at any tier boundary.

---

## Decision log

| Date | Decision | Reason |
|---|---|---|
| 2026-07-31 | Ship Phase 1 with a single webhook | User's ask was "signal mile" for sweep findings — minimal complexity meets the requirement |
| 2026-07-31 | `added > 0` gate for alerts | User explicitly said "only finding milne par" |
| 2026-07-31 | Teams over Slack for outbound | User's stack is Microsoft — SSO already AAD, users already in Teams |
| 2026-07-31 | Park Phase 2 (bot) | Not requested; 5-day lift needs real user pull before we invest |
| 2026-07-31 | MessageCard schema (not Adaptive Card) for Phase 1 | Universal support in Incoming Webhooks; upgrade to Adaptive Cards when Phase 3 needs interactivity |
