# GTS Backend Architecture

## Layout

```
agent-os/
├── main.py                     # ~75 lines: env, tracing, app, CORS, register_routers, uvicorn
├── agentic_system/             # Agno agents / teams / tools / models / config
│   ├── agents/                 # 6 specialist agents + onboarding copilot
│   ├── teams/sweep_team/       # Team leader that fans out to specialists
│   ├── tools/tools.py          # You.com research wrappers per specialist
│   ├── os/agent_os.py          # AgentOS assembly + scheduler wiring
│   ├── models.py               # get_shared_model() — OpenAI or Azure
│   └── config/config.py        # Single source of truth for env + policy defaults
├── api/
│   ├── __init__.py             # register_routers(app, ...) + route inventory docstring
│   ├── deps.py                 # get_db (single canonical version)
│   ├── auth_deps.py            # get_current_user (JWT-in-cookie guard)
│   ├── schemas.py              # All Pydantic in/out models
│   ├── specialists.py          # SPECIALIST_AGENTS registry
│   ├── state.py                # ScheduleState — reconciles at boot, no globals
│   └── routers/                # feature-scoped router factories (auth, chat, sweep, ...)
├── services/                   # Framework-agnostic business logic
│   ├── chat_reply.py           # Ask Sentinel Azure OpenAI direct call
│   ├── profile_repo.py         # get_active_profile — single choke point for profile queries
│   ├── profile_serializer.py   # ORM ↔ Pydantic + rewrite_products
│   ├── profile_xml.py          # XML prompt-context rendering
│   ├── specialist_state.py     # Server-side enable/disable state for specialists
│   └── sweep_prompt.py         # CRON_SWEEP_QUERY + build_sweep_prompt
├── core/
│   ├── database.py             # SessionLocal, Agno DB wiring
│   ├── models.py               # SQLAlchemy ORM (RegulatoryEvent, CompanyProfile, User, ChatSession, ...)
│   └── logging_config.py       # Sentinel logging with per-layer flags
├── sweep_service.py            # Background sweep runner + task tracker
└── docs/                       # This directory
```

## Dependency direction

```
main.py
   └─→ api/__init__.py
          ├─→ api/routers/*
          │      ├─→ services/*
          │      └─→ api/{deps,schemas,state,specialists}.py
          └─→ api/state.py
              └─→ core/*
services/* ─→ core/* (never imports from api/)
```

**Rule:** `services/*` never imports from `api/*`. Anything that needs to
be shared with a background job (e.g. `services/profile_xml.py`) MUST NOT
depend on FastAPI or Pydantic-except-schemas. This is what lets
`sweep_service.py` call these helpers without pulling in HTTP concerns.

## Request lifecycle (manual sweep)

1. `POST /gts/sweep {query, use_profile}` hits `api/routers/sweep.py`.
2. Router checks `ScheduleState.is_manual()` — 409 if cron is active.
3. `services/sweep_prompt.build_sweep_prompt(db, ...)` composes the prompt:
   - `services/profile_repo.get_active_profile(db)` reads the profile
   - `services/profile_serializer.profile_to_out(...)` converts to Pydantic
   - `services/profile_xml.profile_to_context(...)` renders the XML block
4. Router calls `sweep_service.task_manager.start(...)` which fires the
   sweep team in the background and returns a `task_id`.
5. Client polls `GET /gts/sweep/{task_id}` until `status == "done"`.
6. In the background: `run_sweep_and_persist` runs the team, dedupes,
   and writes rows to `regulatory_events`.

## Request lifecycle (scheduled sweep)

1. AgentOS `SchedulePoller` polls `agno_schedules` every 15s.
2. When a row is due, `ScheduleExecutor` calls `POST /gts/sweep/cron`.
3. Same `build_sweep_prompt` + `run_sweep_and_persist` path — synchronously.
4. Result: `agno_schedule_runs` gets a row with status + summary.

## Why the split exists

Before the refactor, `main.py` was ~710 lines mixing six concerns:
FastAPI wiring, ORM helpers, Pydantic schemas, XML rendering, cron state,
and six route groups. Any change to one feature scrolled through five
others. The `get_db` helper was even duplicated verbatim in two files.

After: `main.py` is a 75-line entrypoint. Each router file is 24–115
lines with one concern. Cross-router state (schedule preset, sweep team)
is passed via factory arguments, not module globals.

## Adding a new route

1. Decide which router file it belongs in (or add a new one).
2. Add the Pydantic request/response models to `api/schemas.py`.
3. If the handler needs shared logic that a background job might also
   use, put it in `services/` — not the router.
4. Register the router in `api/__init__.py:register_routers` if new.

## Adding a new agent

1. Create `agentic_system/agents/<name>_agent/` with `agent.py` +
   `prompt.py`.
2. Export it from `agentic_system/agents/__init__.py`.
3. Add the id to `agentic_system/config/config.py:SPECIALIST_IDS`.
4. Add to `api/specialists.py:SPECIALIST_AGENTS`.
5. Add to `agentic_system/os/agent_os.py:agents=[...]`.
