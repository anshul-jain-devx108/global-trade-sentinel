"""Sweep orchestration + persistence + task tracking for the GTS service.

- `run_sweep_and_persist` runs the sweep team, upserts events by dedupe hash,
  and returns a summary (added / duplicates / agent_reports).
- `TaskManager` runs sweeps in the background so a user closing their browser
  tab or refreshing does not kill the run. Every task has a `status` string
  plus a `result` payload the frontend can fetch by task_id.
- Cron ("Agno SchedulePoller" or any external scheduler) can call
  `run_sweep_and_persist` directly with no HTTP round-trip.
"""
from __future__ import annotations

import asyncio
import hashlib
import logging
import os
import uuid
from datetime import date, datetime, timezone
from typing import Any, Dict, List, Optional

from sqlalchemy.orm import Session

import agentic_system.config.config as CFG
from core.database import SessionLocal
from core.models import (
    AffectedEntity,
    Citation,
    RegulatoryEvent,
)

log = logging.getLogger("gts.sweep")


# ─── Helpers ──────────────────────────────────────────────────────────────

def _dedupe_hash(event_type: str, jurisdiction: str, title: str, effective_from: Optional[date]) -> str:
    """Stable hash used to prevent duplicate rows across re-sweeps.

    Key: (type, jurisdiction, normalised-title, effective_from). Matches the
    frontend expectation that the same regulatory event surfaces only once.
    """
    normalised = "|".join([
        (event_type or "").strip().upper(),
        (jurisdiction or "").strip().lower(),
        " ".join((title or "").split()).lower(),
        effective_from.isoformat() if isinstance(effective_from, date) else str(effective_from or ""),
    ])
    return hashlib.sha256(normalised.encode()).hexdigest()[:CFG.DEDUPE_HASH_HEX_LEN]


def _parse_date(raw: Optional[str]) -> Optional[date]:
    if not raw:
        return None
    try:
        return date.fromisoformat(raw)
    except (ValueError, TypeError):
        return None


def _new_event_id() -> str:
    # Human-friendly ID (e.g. EVT-8CHARS) — used in URLs and logs.
    return CFG.EVENT_ID_PREFIX + uuid.uuid4().hex[:CFG.EVENT_ID_HEX_LEN].upper()


# ─── Persistence ──────────────────────────────────────────────────────────

def persist_sweep_report(db: Session, report: Dict[str, Any]) -> Dict[str, Any]:
    """Take a SweepReportModel dict → upsert events → return summary."""
    events = report.get("events") or []
    added = 0
    duplicates = 0
    updated = 0

    for ev in events:
        digest = _dedupe_hash(
            ev.get("event_type"),
            ev.get("jurisdiction"),
            ev.get("title"),
            _parse_date(ev.get("effective_from")),
        )
        existing = db.query(RegulatoryEvent).filter(RegulatoryEvent.dedupe_hash == digest).first()
        if existing is not None:
            duplicates += 1
            # Refresh mutable fields (description/impact/citations may change
            # over time). Skip status — user-driven lifecycle.
            existing.description = ev.get("description") or existing.description
            existing.impact      = ev.get("impact")      or existing.impact
            existing.severity    = ev.get("severity")    or existing.severity
            existing.published_at   = _parse_date(ev.get("published_at"))   or existing.published_at
            existing.effective_from = _parse_date(ev.get("effective_from")) or existing.effective_from
            existing.effective_until = _parse_date(ev.get("effective_until")) or existing.effective_until
            updated += 1
            continue

        row = RegulatoryEvent(
            id=_new_event_id(),
            event_type=ev.get("event_type") or "REGULATORY",
            severity=ev.get("severity") or "INFO",
            title=ev.get("title") or "(untitled)",
            jurisdiction=ev.get("jurisdiction") or "",
            published_at=_parse_date(ev.get("published_at")),
            effective_from=_parse_date(ev.get("effective_from")),
            effective_until=_parse_date(ev.get("effective_until")),
            detected_at=datetime.now(timezone.utc),
            description=ev.get("description") or "",
            impact=ev.get("impact") or "",
            status="NEW",
            dedupe_hash=digest,
        )
        for name in ev.get("affected_entities") or []:
            row.affected_entities.append(AffectedEntity(name=str(name)))
        for cit in ev.get("citations") or []:
            row.citations.append(Citation(title=cit.get("title") or "", url=cit.get("url") or ""))
        db.add(row)
        added += 1

    db.commit()
    return {
        "added": added,
        "duplicates": duplicates,
        "updated": updated,
        "agent_reports": report.get("agent_reports") or [],
    }


def event_to_dict(row: RegulatoryEvent) -> Dict[str, Any]:
    return {
        "id": row.id,
        "event_type": row.event_type,
        "severity": row.severity,
        "title": row.title,
        "jurisdiction": row.jurisdiction,
        "published_at":    row.published_at.isoformat()    if row.published_at    else None,
        "effective_from":  row.effective_from.isoformat()  if row.effective_from  else None,
        "effective_until": row.effective_until.isoformat() if row.effective_until else None,
        "detected_at": row.detected_at.isoformat() if row.detected_at else None,
        "description": row.description,
        "impact": row.impact,
        "status": row.status,
        "affected_entities": [e.name for e in row.affected_entities],
        "citations": [{"title": c.title, "url": c.url} for c in row.citations],
    }


# ─── Sweep runner (called by HTTP and by cron) ────────────────────────────

async def run_sweep_and_persist(
    *,
    sweep_team,
    prompt: str,
    db_factory=SessionLocal,
    run_id: Optional[str] = None,
) -> Dict[str, Any]:
    """Execute the sweep team on the given prompt and persist the results.

    Callers open/close their own DB session via `db_factory` so this function
    is safe to invoke from cron jobs, tests, or HTTP handlers.

    If `run_id` is provided it is passed to Agno so the caller can cancel the
    run via `sweep_team.acancel_run(run_id)` — otherwise Agno generates its own.
    """
    run = await sweep_team.arun(prompt, run_id=run_id) if run_id else await sweep_team.arun(prompt)
    content = getattr(run, "content", None) or getattr(run, "output", None)
    if content is None:
        return {"added": 0, "duplicates": 0, "updated": 0, "agent_reports": [], "error": "empty response"}

    if hasattr(content, "model_dump"):
        report = content.model_dump()
    elif isinstance(content, dict):
        report = content
    else:
        # LLM returned a plain string — no structured events to persist.
        return {"added": 0, "duplicates": 0, "updated": 0, "agent_reports": [], "raw": str(content)}

    db: Session = db_factory()
    try:
        summary = persist_sweep_report(db, report)
    finally:
        db.close()
    summary["events"] = report.get("events") or []

    # Fire Teams notifications after commit so the user only pings for
    # findings that actually landed in the DB. Silent no-op when no
    # Teams channel is configured / no owners have a conversation ref yet.
    if summary.get("added", 0) > 0:
        try:
            await _notify_teams(summary)
        except Exception as e:  # noqa: BLE001
            log.warning("Teams notification failed (non-fatal): %s", e)

    return summary


# ─── Teams delivery ──────────────────────────────────────────────────────
# Two channels, either or both may be configured:
#   1. TEAMS_WEBHOOK_URL — a channel-level Incoming Webhook. Card lands in
#      one shared channel. No per-user identity needed. Cheapest path.
#   2. MicrosoftTeams interface — proactive DMs to any user who has
#      previously chatted with the bot. Requires MICROSOFT_APP_* env vars
#      + at least one prior inbound message from the target user.

def _format_findings_lines(events: List[Dict[str, Any]], limit: int = 5) -> List[str]:
    lines: List[str] = []
    for ev in events[:limit]:
        title = ev.get("title") or "(untitled)"
        juris = ev.get("jurisdiction") or ""
        sev = ev.get("severity") or "INFO"
        lines.append(f"- **{title}** — {juris} ({sev})")
    if len(events) > limit:
        lines.append(f"- …and {len(events) - limit} more (open Global Trade Sentinel for details)")
    return lines


async def _post_incoming_webhook(webhook_url: str, added: int, events: List[Dict[str, Any]]) -> None:
    import httpx

    card = {
        "@type": "MessageCard",
        "@context": "https://schema.org/extensions",
        "summary": f"GTS sweep: {added} new findings",
        "themeColor": "0F62FE",
        "title": f"{added} new regulatory finding{'s' if added != 1 else ''}",
        "text": "\n\n".join(_format_findings_lines(events)) or "(details in Global Trade Sentinel)",
    }
    async with httpx.AsyncClient(timeout=10.0) as client:
        resp = await client.post(webhook_url, json=card)
        resp.raise_for_status()


async def _notify_teams(summary: Dict[str, Any]) -> None:
    added = summary["added"]
    events = summary.get("events") or []

    webhook_url = os.getenv("TEAMS_WEBHOOK_URL")
    if webhook_url:
        try:
            await _post_incoming_webhook(webhook_url, added, events)
            log.info("Posted Teams webhook card: %d findings", added)
        except Exception as e:  # noqa: BLE001
            log.warning("Teams webhook post failed: %s", e)

    # Proactive DMs to profile owner(s) via the MicrosoftTeams interface.
    # Only fires when MICROSOFT_APP_* env vars are configured AND the user
    # has previously exchanged a message with the bot (so their
    # ConversationReference is on the session row).
    if not os.getenv("MICROSOFT_APP_ID") or not os.getenv("MICROSOFT_APP_PASSWORD"):
        return
    try:
        from agentic_system.os import teams_interface  # local import avoids startup cycle
    except Exception:
        return

    heading = f"**Global Trade Sentinel — {added} new finding{'s' if added != 1 else ''}**"
    body = "\n".join(_format_findings_lines(events))
    text = f"{heading}\n\n{body}" if body else heading

    for user_id in _collect_notify_user_ids():
        try:
            await teams_interface.send_alert(user_id, text)
        except Exception as e:  # noqa: BLE001
            log.warning("send_alert failed for user=%s: %s", user_id, e)


def _collect_notify_user_ids() -> List[str]:
    """Distinct microsoft_oid values from the users table.

    Kept intentionally small — until we introduce per-user finding
    routing, every authenticated GTS user gets the sweep summary if
    they've said hi to the bot.
    """
    from core.models import User  # local import — avoids cycles at module load

    db: Session = SessionLocal()
    try:
        rows = db.query(User.microsoft_oid).filter(User.microsoft_oid.isnot(None)).all()
        return [oid for (oid,) in rows if oid]
    finally:
        db.close()


# ─── Background task tracking ─────────────────────────────────────────────
# In-memory task registry. Fine for a single-process GTS service. For
# multi-worker deployments swap this out for a Redis-backed store.

class SweepTask:
    __slots__ = (
        "id", "status", "started_at", "finished_at", "result", "error", "prompt",
        "run_id", "asyncio_task",
    )

    def __init__(self, task_id: str, prompt: str, run_id: str):
        self.id = task_id
        self.status = "running"       # running | done | error | cancelled
        self.started_at = datetime.now(timezone.utc)
        self.finished_at: Optional[datetime] = None
        self.result: Optional[Dict[str, Any]] = None
        self.error: Optional[str] = None
        self.prompt = prompt
        # Agno-side run identifier. Kept alongside our own task_id so the
        # cancel endpoint can call team.acancel_run(run_id) in addition to
        # cancelling the wrapping asyncio task.
        self.run_id = run_id
        self.asyncio_task: Optional[asyncio.Task] = None

    def to_dict(self) -> Dict[str, Any]:
        return {
            "id": self.id,
            "run_id": self.run_id,
            "status": self.status,
            "started_at": self.started_at.isoformat(),
            "finished_at": self.finished_at.isoformat() if self.finished_at else None,
            "result": self.result,
            "error": self.error,
        }


class SweepTaskManager:
    def __init__(self) -> None:
        self._tasks: Dict[str, SweepTask] = {}
        self._lock = asyncio.Lock()

    async def start(self, *, sweep_team, prompt: str) -> SweepTask:
        task_id = uuid.uuid4().hex[:CFG.TASK_ID_HEX_LEN]
        run_id = uuid.uuid4().hex
        task = SweepTask(task_id, prompt, run_id=run_id)
        async with self._lock:
            self._tasks[task_id] = task

        async def _runner() -> None:
            try:
                summary = await run_sweep_and_persist(
                    sweep_team=sweep_team, prompt=prompt, run_id=run_id,
                )
                task.result = summary
                task.status = "error" if summary.get("error") else "done"
                task.error = summary.get("error")
            except asyncio.CancelledError:
                task.status = "cancelled"
                task.error = "Sweep cancelled by user"
                raise
            except Exception as e:  # noqa: BLE001
                log.exception("Sweep task %s failed", task_id)
                task.status = "error"
                task.error = str(e)
            finally:
                task.finished_at = datetime.now(timezone.utc)

        # Fire and forget — the client will poll /gts/sweep/{task_id}
        task.asyncio_task = asyncio.create_task(_runner())
        return task

    def get(self, task_id: str) -> Optional[SweepTask]:
        return self._tasks.get(task_id)

    def latest(self) -> Optional[SweepTask]:
        if not self._tasks:
            return None
        return max(self._tasks.values(), key=lambda t: t.started_at)

    async def cancel(self, task_id: str, *, sweep_team) -> Optional[SweepTask]:
        """Cancel a running sweep.

        Belt-and-braces: we tell Agno to stop the underlying team run
        (`team.acancel_run(run_id)`) AND cancel the wrapping asyncio task
        so the coroutine unwinds even if Agno's cancellation is slow.
        """
        task = self._tasks.get(task_id)
        if task is None or task.status != "running":
            return task
        try:
            await sweep_team.acancel_run(run_id=task.run_id)
        except Exception:  # noqa: BLE001
            # Agno raises if the run isn't yet registered. Fall through to
            # the asyncio-level cancel — the coroutine handle is the source
            # of truth for our own task tracker.
            log.debug("acancel_run raised for %s; falling back to asyncio cancel", task.run_id)
        if task.asyncio_task and not task.asyncio_task.done():
            task.asyncio_task.cancel()
        return task


task_manager = SweepTaskManager()
