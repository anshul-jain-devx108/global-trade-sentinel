"""GTS + auth + chat HTTP API surface.

All routes are mounted at `/api/v1/*`.

Route inventory:

    Auth (Microsoft SSO + cookie-based session)
    GET    /api/v1/auth/microsoft/login
    GET    /api/v1/auth/microsoft/callback
    GET    /api/v1/auth/me
    PUT    /api/v1/auth/me
    POST   /api/v1/auth/logout

    Chat (session CRUD + Ask Sentinel generate + HITL approvals)
    GET/POST /api/v1/chat/
    GET/POST /api/v1/chat/{session_id}/messages
    POST   /api/v1/chat/{session_id}/generate
    DELETE /api/v1/chat/{session_id}

    Sweep (background — poll for status)
    POST   /api/v1/gts/sweep                → start a sweep, returns {task_id}
    POST   /api/v1/gts/sweep/cron           → internal, called by the schedule poller
    GET    /api/v1/gts/sweep/latest         → last known task
    GET    /api/v1/gts/sweep/{task_id}      → task status + summary once finished
    POST   /api/v1/gts/sweep/{task_id}/cancel

    Direct single-agent run
    POST   /api/v1/gts/agent/{agent_id}/run

    Events (persisted findings)
    GET    /api/v1/gts/events
    GET    /api/v1/gts/events/stats
    PATCH  /api/v1/gts/events/{id}/status

    Company profile + onboarding copilot
    GET/POST /api/v1/gts/profile
    POST   /api/v1/gts/profile/questions
    POST   /api/v1/gts/profile/enrich

    Scheduling (Agno SchedulePoller)
    GET/PUT /api/v1/gts/schedule
    POST   /api/v1/gts/schedule/enable
    POST   /api/v1/gts/schedule/disable
    POST   /api/v1/gts/schedule/trigger
    GET    /api/v1/gts/schedule/runs

    Health / discovery
    GET    /api/v1/gts/health              (unauthenticated)
    GET    /api/v1/gts/specialists
    PATCH  /api/v1/gts/specialists/{id}/enabled

Every route (custom /api/v1/* and AgentOS built-ins at the root) is
JWT-guarded by the middleware in main.py — see api/auth_deps.py.
"""
from fastapi import FastAPI

from api.routers.agents import get_agents_router
from api.routers.auth import get_auth_router
from api.routers.chat import get_chat_router
from api.routers.events import get_events_router
from api.routers.health import get_health_router
from api.routers.profile import get_profile_router
from api.routers.schedule import get_schedule_router
from api.routers.sweep import get_sweep_router
from api.state import ScheduleState


def register_routers(
    app: FastAPI,
    *,
    sweep_team,
    agno_schedule_db,
    schedule_state: ScheduleState,
) -> None:
    """Attach every application router to the given FastAPI app."""
    app.include_router(get_auth_router())
    app.include_router(get_chat_router())
    app.include_router(get_health_router())
    app.include_router(get_sweep_router(sweep_team=sweep_team, schedule_state=schedule_state))
    app.include_router(get_agents_router())
    app.include_router(get_profile_router())
    app.include_router(get_events_router())
    app.include_router(get_schedule_router(
        agno_schedule_db=agno_schedule_db,
        schedule_state=schedule_state,
    ))


__all__ = ["register_routers", "ScheduleState"]
