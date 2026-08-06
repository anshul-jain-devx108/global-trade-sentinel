"""Sweep endpoints — start / poll / cron.

Manual `/gts/sweep` runs in the background so a client disconnect (tab
close, refresh) does not cancel the run. The cron endpoint mirrors the
manual path so scheduled runs get the same profile-context injection
and persistence.
"""
import agentic_system.config.config as CFG
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from api.auth_deps import get_current_user
from api.deps import get_db
from api.schemas import SweepRequest
from api.state import ScheduleState
from core.models import User
from services.sweep_prompt import CRON_SWEEP_QUERY, build_sweep_prompt
from sweep_service import run_sweep_and_persist, task_manager


def get_sweep_router(*, sweep_team, schedule_state: ScheduleState) -> APIRouter:
    router = APIRouter(prefix="/api/v1/gts", tags=["sweep"])

    @router.post("/sweep")
    async def start_sweep(
        req: SweepRequest,
        current_user: User = Depends(get_current_user),
        db: Session = Depends(get_db),
    ):
        """Start a sweep in the background. Returns a task_id to poll.

        Manual runs are blocked when a cron preset is active — the schedule
        owns the sweep cadence to avoid concurrent runs stepping on each
        other. Switch the schedule to `manual` first to run on demand.
        """
        if not schedule_state.is_manual():
            raise HTTPException(
                status_code=409,
                detail=(
                    f"Manual sweeps are disabled while cron is set to '{schedule_state.get()}'. "
                    "Switch the schedule to 'manual' to run on demand."
                ),
            )
        prompt = build_sweep_prompt(
            db=db,
            query=req.query,
            company=req.company,
            use_profile=req.use_profile,
        )
        task = await task_manager.start(sweep_team=sweep_team, prompt=prompt)
        return task.to_dict()

    @router.post(CFG.CRON_SWEEP_ENDPOINT[len("/api/v1/gts"):])
    async def cron_sweep(db: Session = Depends(get_db)):
        """Internal endpoint the schedule poller calls on each cron tick.

        Intentionally unauthenticated — Agno's SchedulePoller issues a plain
        intra-process HTTP POST with no cookies. Access is limited by the
        loopback address (`SCHEDULER_BASE_URL` defaults to 127.0.0.1).

        Runs synchronously: ScheduleExecutor issues a plain request and
        waits for the response (default 3600s timeout). Injects the
        active profile as XML context and persists results the same way
        the manual path does.
        """
        prompt = build_sweep_prompt(
            db=db,
            query=CRON_SWEEP_QUERY,
            use_profile=True,
        )
        summary = await run_sweep_and_persist(sweep_team=sweep_team, prompt=prompt)
        # Drop the bulky raw events list from the HTTP response; the rows
        # are already persisted. Keep the counts.
        summary.pop("events", None)
        return summary

    @router.get("/sweep/latest")
    async def get_latest_sweep(current_user: User = Depends(get_current_user)):
        task = task_manager.latest()
        if task is None:
            return {"id": None, "status": "idle"}
        return task.to_dict()

    @router.get("/sweep/{task_id}")
    async def get_sweep_task(
        task_id: str,
        current_user: User = Depends(get_current_user),
    ):
        task = task_manager.get(task_id)
        if task is None:
            raise HTTPException(status_code=404, detail="Task not found")
        return task.to_dict()

    @router.post("/sweep/{task_id}/cancel")
    async def cancel_sweep_task(
        task_id: str,
        current_user: User = Depends(get_current_user),
    ):
        """Cancel a running sweep. Idempotent: cancelling a finished task is a no-op."""
        task = await task_manager.cancel(task_id, sweep_team=sweep_team)
        if task is None:
            raise HTTPException(status_code=404, detail="Task not found")
        return task.to_dict()

    return router
