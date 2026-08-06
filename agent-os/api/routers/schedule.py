"""Cron schedule endpoints — wires the UI preset to a real `agno_schedules` row.

The SchedulePoller (started by AgentOS) reads that table and fires the
sweep-team endpoint when a schedule is due.
"""
import os

import agentic_system.config.config as CFG
import httpx
from agno.scheduler import ScheduleManager
from fastapi import APIRouter, Depends, HTTPException

from api.auth_deps import get_current_user
from api.schemas import ScheduleUpdate
from api.state import ScheduleState
from core.models import User


# The AgentOS built-in POST /schedules/{id}/trigger route needs a live poller
# reference — easier to reach it via an intra-process HTTP call than to reach
# into AgentOS internals from here. main.py binds AgentOS onto the same base
# app, so we just re-issue the request against ourselves.
_SELF_BASE_URL = os.environ.get("SELF_BASE_URL", CFG.SCHEDULER_BASE_URL).rstrip("/")


def _find_gts_schedule(manager: ScheduleManager):
    """Return the persisted GTS schedule row, or None when preset is manual."""
    for s in manager.list():
        if s.name == CFG.SCHEDULE_NAME:
            return s
    return None


def _delete_existing_schedule(manager: ScheduleManager) -> None:
    """Remove any prior gts-sweep row so preset switches don't stack."""
    for s in manager.list():
        if s.name == CFG.SCHEDULE_NAME:
            manager.delete(s.id)


def get_schedule_router(*, agno_schedule_db, schedule_state: ScheduleState) -> APIRouter:
    router = APIRouter(prefix="/api/v1/gts", tags=["schedule"])

    @router.get("/schedule")
    def get_schedule(current_user: User = Depends(get_current_user)):
        preset = schedule_state.get()
        manager = ScheduleManager(db=agno_schedule_db)
        row = _find_gts_schedule(manager)
        # `next_run_at` is a unix timestamp int (see agno.scheduler.Schedule),
        # not a datetime — surface it verbatim and let the UI format it.
        return {
            "preset": preset,
            "schedule_id": getattr(row, "id", None),
            "enabled": bool(getattr(row, "enabled", False)) if row else False,
            "next_run_at": getattr(row, "next_run_at", None) if row else None,
            "cron_expr": getattr(row, "cron_expr", None) if row else None,
        }

    @router.put("/schedule")
    def set_schedule(
        payload: ScheduleUpdate,
        current_user: User = Depends(get_current_user),
    ):
        if payload.preset not in CFG.VALID_SCHEDULE_PRESETS:
            raise HTTPException(
                status_code=400,
                detail=f"Invalid preset. One of {sorted(CFG.VALID_SCHEDULE_PRESETS)}.",
            )

        manager = ScheduleManager(db=agno_schedule_db)
        _delete_existing_schedule(manager)

        if payload.preset != "manual":
            manager.create(
                name=CFG.SCHEDULE_NAME,
                cron=CFG.PRESET_TO_CRON[payload.preset],
                # Our own endpoint (not the generic /teams/.../runs) so scheduled
                # sweeps inject the company profile AND persist to regulatory_events.
                endpoint=CFG.CRON_SWEEP_ENDPOINT,
                method=CFG.CRON_SWEEP_METHOD,
                payload={},
                timezone=CFG.SCHEDULE_TIMEZONE,
                if_exists="update",
            )

        schedule_state.set(payload.preset)
        return {"preset": payload.preset}

    @router.post("/schedule/enable")
    def enable_schedule(current_user: User = Depends(get_current_user)):
        """Resume the paused GTS schedule without changing its cron preset."""
        manager = ScheduleManager(db=agno_schedule_db)
        row = _find_gts_schedule(manager)
        if row is None:
            raise HTTPException(status_code=404, detail="No schedule set. Choose a preset first.")
        result = manager.enable(row.id)
        return {"enabled": bool(getattr(result, "enabled", True))}

    @router.post("/schedule/disable")
    def disable_schedule(current_user: User = Depends(get_current_user)):
        """Pause the GTS schedule without deleting it — user can re-enable later."""
        manager = ScheduleManager(db=agno_schedule_db)
        row = _find_gts_schedule(manager)
        if row is None:
            raise HTTPException(status_code=404, detail="No schedule to disable.")
        result = manager.disable(row.id)
        return {"enabled": bool(getattr(result, "enabled", False))}

    @router.post("/schedule/trigger")
    async def trigger_schedule(current_user: User = Depends(get_current_user)):
        """Force the GTS schedule to run now, without waiting for the cron tick.

        Delegates to AgentOS's built-in `POST /schedules/{id}/trigger` so the
        poller's in-process trigger method is used (it needs a running executor).
        """
        manager = ScheduleManager(db=agno_schedule_db)
        row = _find_gts_schedule(manager)
        if row is None:
            raise HTTPException(status_code=404, detail="No schedule set. Choose a preset first.")
        async with httpx.AsyncClient(timeout=10.0) as client:
            r = await client.post(
                f"{_SELF_BASE_URL}/schedules/{row.id}/trigger",
                headers={"X-Internal-Service-Token": CFG.INTERNAL_SERVICE_TOKEN},
            )
        if r.status_code >= 400:
            raise HTTPException(status_code=r.status_code, detail=r.text)
        return {"triggered": True, "schedule_id": row.id}

    @router.get("/schedule/runs")
    def schedule_runs(
        current_user: User = Depends(get_current_user),
        limit: int = 20,
        page: int = 1,
    ):
        """Return past execution history for the GTS schedule.

        ScheduleRun timestamps are unix ints — the UI converts to local time.
        """
        manager = ScheduleManager(db=agno_schedule_db)
        row = _find_gts_schedule(manager)
        if row is None:
            return {"runs": [], "schedule_id": None}
        runs = manager.get_runs(row.id, limit=limit, page=page)
        return {
            "schedule_id": row.id,
            "runs": [
                {
                    "id": getattr(r, "id", None),
                    "status": getattr(r, "status", None),
                    "triggered_at": getattr(r, "triggered_at", None),
                    "completed_at": getattr(r, "completed_at", None),
                    "error": getattr(r, "error", None),
                }
                for r in runs
            ],
        }

    return router
