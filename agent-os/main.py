"""GTS (Global Trade Sentinel) — service entrypoint.

Order of operations follows the AgentOS "bring your own FastAPI" pattern
(https://docs.agno.com/agent-os/custom-fastapi/overview):

  1. Build our own FastAPI app (title, CORS)
  2. Attach every `/gts/*` router
  3. Hand the app to AgentOS as `base_app=...` — AgentOS mounts its
     ~86 built-in routes onto the SAME app in place
  4. Serve via `agent_os.serve(...)`

See `api/__init__.py` for the full HTTP route inventory.

Start with:  uv run python main.py   (from d:/Netra/agent-os/)
"""
import logging
import os
import sys

from dotenv import load_dotenv

# Load .env sitting next to this file
_HERE = os.path.dirname(os.path.abspath(__file__))
load_dotenv(os.path.join(_HERE, ".env"))

# Make sibling packages importable when run as a script
if _HERE not in sys.path:
    sys.path.insert(0, _HERE)

# Configure logging before anything else imports and starts logging on
# module load (agno, sqlalchemy, agent_os). See core/logging_config.py for
# the per-layer flags (SENTINEL_DEBUG, AGNO_DEBUG, SQL_DEBUG, ...).
from core.logging_config import configure_logging  # noqa: E402
configure_logging()

import agentic_system.config.config as CFG  # noqa: E402
from fastapi import FastAPI, Request  # noqa: E402
from fastapi.middleware.cors import CORSMiddleware  # noqa: E402
from fastapi.responses import JSONResponse  # noqa: E402

from agentic_system.os import agno_schedule_db, build_agent_os  # noqa: E402
from agentic_system.teams import sweep_team  # noqa: E402
from api import ScheduleState, register_routers  # noqa: E402
from api.auth_deps import decode_access_token  # noqa: E402
from core.agno_patches import apply_patches as _apply_agno_patches  # noqa: E402
from core.database import db as _agno_session_db  # noqa: E402

# Monkey-patch known Agno framework bugs (jsonb double-encoding crash on
# /metrics/refresh, etc.). Each patch documents its own upstream issue in
# core/agno_patches.py — remove them once Agno ships fixes.
_apply_agno_patches()


# ─── 1. Base FastAPI app ─────────────────────────────────────────────
# redirect_slashes=False so routes match exactly as declared — avoids
# 307 loops when a route registers as /path/ and the client hits /path.
app = FastAPI(title=CFG.APP_TITLE, redirect_slashes=False)


# ─── 1a. Global auth gate ────────────────────────────────────────────
# Every custom /api/v1/* router already checks the JWT cookie via
# Depends(get_current_user). This middleware is defence-in-depth for
# the ~86 AgentOS built-in routes (/agents, /teams, /schedules,
# /sessions, /traces, /memories, /approvals, /databases, …) which the
# framework mounts unauthenticated. Without this, anyone reachable at
# the port can run agents, mutate schedules, or read cross-tenant
# state. Custom routes still enforce tenant isolation on top; this
# layer only verifies the JWT is present and valid.
#
# Registered BEFORE CORSMiddleware so CORS ends up outermost — that
# way a rejected 401 still carries Access-Control-Allow-Origin headers
# and the browser can actually read the status.
_UNAUTH_PATHS = frozenset({
    "/",
    "/health",
    "/api/v1/gts/health",
    "/api/v1/gts/sweep/cron",   # intentionally unauth — internal SchedulePoller only
    "/api/v1/auth/logout",
    "/favicon.ico",
    "/docs", "/redoc", "/openapi.json",
})
_UNAUTH_PREFIXES = (
    "/api/v1/auth/microsoft/",
    # MicrosoftTeams interface authenticates its own inbound requests via
    # the Bot Framework JWT (see msteams/security.py). Our JWT cookie
    # middleware must NOT re-check it — the caller is Microsoft, not a
    # browser session.
    "/msteams/",
    # Same story for Slack — the Agno Slack interface verifies each
    # inbound with the X-Slack-Signature HMAC (SLACK_SIGNING_SECRET). Our
    # cookie middleware must not intercept.
    "/slack/",
)


@app.middleware("http")
async def require_auth(request: Request, call_next):
    # CORS preflight is handled by CORSMiddleware — must not 401 it.
    if request.method == "OPTIONS":
        return await call_next(request)

    path = request.url.path
    if path in _UNAUTH_PATHS or any(path.startswith(p) for p in _UNAUTH_PREFIXES):
        return await call_next(request)

    # Internal service token — used by our own routes when they need to
    # call a framework endpoint on behalf of a user (see schedule.py's
    # self-call to POST /schedules/{id}/trigger). Constant-time compare
    # to avoid timing side-channels leaking the token.
    import hmac
    internal_token = request.headers.get("X-Internal-Service-Token", "")
    if internal_token and hmac.compare_digest(internal_token, CFG.INTERNAL_SERVICE_TOKEN):
        return await call_next(request)

    token = request.cookies.get("access_token")
    if not token:
        auth_header = request.headers.get("Authorization", "")
        if auth_header.startswith("Bearer "):
            token = auth_header.split(" ", 1)[1]

    if not token or not decode_access_token(token):
        return JSONResponse({"detail": "Not authenticated"}, status_code=401)

    return await call_next(request)


# CORS is registered AFTER the auth middleware so it wraps everything
# — including 401 responses returned by require_auth above.
app.add_middleware(
    CORSMiddleware,
    allow_origins=CFG.CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ─── 2. Optional tracing ─────────────────────────────────────────────
# Enable BEFORE AgentOS builds so agent creation is wrapped by the
# instrumentor. Powers the /traces endpoint.
try:
    from agno.tracing import setup_tracing  # noqa: E402
    setup_tracing(db=_agno_session_db)
except Exception as _trace_err:  # noqa: BLE001
    logging.getLogger("gts.tracing").warning(
        "Tracing disabled (%s). Install opentelemetry-api, opentelemetry-sdk, "
        "openinference-instrumentation-agno to enable /traces.", _trace_err,
    )


# ─── 3. Attach /gts/* routers ────────────────────────────────────────
schedule_state = ScheduleState(agno_schedule_db)

register_routers(
    app,
    sweep_team=sweep_team,
    agno_schedule_db=agno_schedule_db,
    schedule_state=schedule_state,
)


# ─── 4. Wrap with AgentOS ────────────────────────────────────────────
# AgentOS mutates `app` in place, adding its ~86 built-in routes
# (/agents, /teams, /schedules, /traces, /sessions, /health, ...).
agent_os = build_agent_os(base_app=app)
app = agent_os.get_app()   # returns the same `app` — kept for the ASGI import path


if __name__ == "__main__":
    # `reload_excludes` cuts noise from files that never change the running
    # server (logs, sqlite DB, __pycache__, venv, migrations, tests, data
    # dirs). Every needless reload forces the ScheduleState → Postgres
    # reconcile which then trips connection-pool errors.
    agent_os.serve(
        app="main:app",
        host=CFG.HOST,
        port=CFG.PORT,
        reload=CFG.RELOAD,
        reload_excludes=[
            "*.log", "*.log.*", "*.db", "*.db-*", "*.sqlite*",
            "**/__pycache__/**", "**/.venv/**", "**/node_modules/**",
            "**/data/**", "**/logs/**", "**/tests/**",
        ],
    )
