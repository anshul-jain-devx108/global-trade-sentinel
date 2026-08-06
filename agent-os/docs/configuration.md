# Configuration — Env vs `config.py`

## Rule of thumb

- **`.env`** → secrets, per-environment infra (dev vs prod differs), values that must not be committed. Read via `os.getenv`.
- **`config.py`** → policy defaults, structured constants (dicts, sets, enums), agent ids, table names. Checked into git.
- **YAML / dedicated files** → ops-editable policy assets (domain allowlists) — future work.

Everything env-driven has a fallback default in `config.py`, so a
minimal `.env` still boots the app.

---

## Goes in `.env` (secrets + per-env)

| Env var | Purpose |
|---|---|
| `GOOGLE_API_KEY`, `YDC_API_KEY`, `Azure_API_KEY`, `OPENAI_API_KEY` | Secrets — never commit real values |
| `Azure_ENDPOINT` | Tenant resource base URL |
| `GTS_INTERNAL_SERVICE_TOKEN` | Scheduler → HTTP internal auth token |
| `DATABASE_URL` | Full DB URL (Azure SQL / Postgres). Wins over `DB_PATH` if set. |
| `DB_PATH` | SQLite file path when `DATABASE_URL` unset |
| `MODEL_ID` | Model / deployment id |
| `Azure_API_VERSION` | Azure OpenAI API version |
| `YDC_BASE_URL` | Override You.com base URL |
| `CORS_ORIGINS` | Comma-separated allowed frontend origins |
| `HOST`, `PORT`, `RELOAD` | Uvicorn bind config |
| `IS_DEVELOPMENT` / `ENVIRONMENT` | Log-level profile |
| `SCHEDULER_BASE_URL` | URL the scheduler executor calls back into |
| `SCHEDULER_POLL_INTERVAL_SECONDS` | Poll cadence |
| `SCHEDULE_RUN_TIMEOUT` | Per-run HTTP timeout |
| `SCHEDULE_TIMEZONE` | Timezone for cron expressions |
| `GTS_SCHEDULE` | Default preset (`manual`/`daily`/`weekly`/`monthly`) |
| `LOG_FILE`, `LOG_LEVEL` | Sentinel logging output |
| `TENANT_ID` | Multi-tenant deployments |
| `AGENT_OS_NAME` | AgentOS display name |

`.env.example` documents every one with commented defaults.

---

## Goes in `config.py` (policy + structural)

### Agent-facing behaviour (visible to LLM cost / tool budget)

| Constant | Notes |
|---|---|
| `AGENT_DEFAULTS.tool_call_limit` | Cap per specialist per run |
| `add_history_to_context`, `update_memory_on_run` | Cost-affecting toggles |
| `PARALLEL_TOOLS`, `request_params` | OpenAI Chat Completions kwargs |
| `YOUCOM_RESEARCH_EFFORT` | `"exhaustive"` / `"fast"` etc. |
| `YOUCOM_RESEARCH_TIMEOUT_SECONDS` | Per-call HTTP timeout |
| `YOUCOM_TEXT_LENGTH_LIMIT` | Chars kept per source |
| `SPECIALIST_FRESHNESS` | Recency window per specialist (`month` / `week` / …) |
| `MAX_INPUT_LENGTH = 40000` | You.com API contract |

### API / pagination / IDs (structural constants)

| Constant | Notes |
|---|---|
| `EVENTS_LIST_DEFAULT_LIMIT`, `EVENTS_LIST_MAX_LIMIT` | Pagination |
| `SPECIALIST_IDS` | Canonical kebab-case specialist ids |
| `SWEEP_TEAM_ID` | `"sweep-leader"` |
| `SCHEDULE_NAME`, `VALID_SCHEDULE_PRESETS`, `PRESET_TO_CRON` | Schedule constants |
| `EVENT_STATUSES`, `ALLOWED_SORT`, `SEVERITY_RANK` | Enums (until they become proper `enum.Enum`) |
| `EVENT_ID_PREFIX`, hash slice lengths | Identifier shape |
| `AGNO_SESSION_TABLE`, `AGNO_MEMORY_TABLE`, `AGNO_SCHEDULES_TABLE`, `AGNO_SCHEDULE_RUNS_TABLE` | Table names |
| `APP_TITLE` | FastAPI app title |

---

## Ops-editable structural data — lives in `config.py` (typed, one place)

Both moved out of `tools.py` where they were hardcoded, into
`config.py` so ops/compliance can rotate authoritative sources
without touching call-site code. Single source of truth.

| Constant | Purpose |
|---|---|
| `SPECIALIST_DOMAINS: Dict[str, List[str]]` | 30 authoritative domains — 5 per specialist |
| `YOUCOM_SUPPORTED_COUNTRIES: FrozenSet[str]` | 36 ISO-3166 codes the You.com API accepts. `agents/_shared.py:SUPPORTED_COUNTRY_CODES` derives its space-separated prompt string from this — single source, no duplication. |

**If a YAML/JSON split is needed later** (e.g. non-engineer ops team
wants to edit domains without git), migrate these two constants to
`agentic_system/config/specialist_domains.yaml` and load at startup.
No downstream code needs to change — everything consumes via
`CFG.SPECIALIST_DOMAINS` / `CFG.YOUCOM_SUPPORTED_COUNTRIES`.

---

## Prompt fragments (not env, not `config.py`)

These belong with the prompts, parameterised via `.format()`:

| Value | File |
|---|---|
| `CRON_SWEEP_QUERY` | `services/sweep_prompt.py` — already extracted |
| "Max 10 events total" | `sweep_team/prompt.py:153` — should be interpolated from `config.py:MAX_SWEEP_EVENTS` |
| "last 30 days" / "last 60 days" recency | `sweep_team/prompt.py:143-149` — same |
| "2-3 questions, 3 options each" | `onboarding_copilot/prompt.py:16` — same |

---

## What NOT to move

Fine hardcoded:

- SQLAlchemy `__tablename__` (schema definition, not config)
- Regex patterns like `_SUPPLIER_COUNTRY_RE` (data-shape assumption, belongs with the code that consumes it)
- Agent `id` / `name` / `role` inside each `agent.py` (canonical id **strings** are centralised in `SPECIALIST_IDS`, but the full agent definition stays with the agent)
- Dev-only constants in `temp/*.py` (gitignored, never runs in prod)
