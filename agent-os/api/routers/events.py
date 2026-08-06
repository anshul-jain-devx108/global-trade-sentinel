"""Persisted regulatory-event endpoints — list / stats / status update."""
from datetime import date
from typing import Optional

import agentic_system.config.config as CFG
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import or_
from sqlalchemy.orm import Session

from api.auth_deps import get_current_user
from api.deps import get_db
from api.schemas import StatusUpdate
from core.models import RegulatoryEvent, User
from sweep_service import event_to_dict


def _parse_date(d: Optional[str]) -> Optional[date]:
    if not d:
        return None
    try:
        return date.fromisoformat(d)
    except ValueError:
        return None


def get_events_router() -> APIRouter:
    router = APIRouter(prefix="/api/v1/gts", tags=["events"])

    @router.get("/events")
    def list_events(
        current_user: User = Depends(get_current_user),
        db: Session = Depends(get_db),
        severity: Optional[str] = None,
        type: Optional[str] = Query(default=None, alias="type"),
        status: Optional[str] = None,           # "NEW,ACKNOWLEDGED" | "ALL" | single
        date_from: Optional[str] = None,        # ISO date, filters effective_from
        date_to: Optional[str] = None,
        sort_by: str = "effective_from",
        sort_dir: str = "desc",
        limit: int = CFG.EVENTS_LIST_DEFAULT_LIMIT,
        offset: int = 0,
    ):
        q = db.query(RegulatoryEvent)

        if severity and severity != "ALL":
            q = q.filter(RegulatoryEvent.severity == severity)
        if type and type != "ALL":
            q = q.filter(RegulatoryEvent.event_type == type)
        if status and status != "ALL":
            wanted = {s.strip() for s in status.split(",") if s.strip()}
            wanted = wanted & CFG.EVENT_STATUSES
            if wanted:
                q = q.filter(RegulatoryEvent.status.in_(list(wanted)))

        df, dt = _parse_date(date_from), _parse_date(date_to)
        if df:
            q = q.filter(or_(RegulatoryEvent.effective_from >= df, RegulatoryEvent.effective_from.is_(None)))
        if dt:
            q = q.filter(or_(RegulatoryEvent.effective_from <= dt, RegulatoryEvent.effective_from.is_(None)))

        total = q.count()

        if sort_by not in CFG.ALLOWED_SORT:
            sort_by = "effective_from"
        col = getattr(RegulatoryEvent, sort_by)
        q = q.order_by(col.desc() if sort_dir == "desc" else col.asc())

        limit = max(1, min(limit, CFG.EVENTS_LIST_MAX_LIMIT))
        rows = q.offset(max(0, offset)).limit(limit).all()

        return {
            "items": [event_to_dict(r) for r in rows],
            "total": total,
            "limit": limit,
            "offset": offset,
        }

    @router.get("/events/stats")
    def event_stats(
        current_user: User = Depends(get_current_user),
        db: Session = Depends(get_db),
    ):
        """Unfiltered KPI aggregates for the dashboard cards."""
        critical = db.query(RegulatoryEvent).filter(
            RegulatoryEvent.severity == "CRITICAL",
            RegulatoryEvent.status != "DISMISSED",
        ).count()
        warning = db.query(RegulatoryEvent).filter(
            RegulatoryEvent.severity == "WARNING",
            RegulatoryEvent.status != "DISMISSED",
        ).count()
        info = db.query(RegulatoryEvent).filter(
            RegulatoryEvent.severity == "INFO",
            RegulatoryEvent.status != "DISMISSED",
        ).count()

        # SQLite doesn't easily give us a DISTINCT count across a relationship —
        # small dataset, so just enumerate.
        entities = set()
        for row in db.query(RegulatoryEvent).filter(RegulatoryEvent.status != "DISMISSED").all():
            for e in row.affected_entities:
                entities.add(e.name)

        return {
            "critical": critical,
            "warning": warning,
            "info": info,
            "total_entities": len(entities),
        }

    @router.patch("/events/{event_id}/status")
    def update_event_status(
        event_id: str,
        payload: StatusUpdate,
        current_user: User = Depends(get_current_user),
        db: Session = Depends(get_db),
    ):
        if payload.status not in CFG.EVENT_STATUSES:
            raise HTTPException(
                status_code=400,
                detail=f"Invalid status. Must be one of {sorted(CFG.EVENT_STATUSES)}.",
            )
        row = db.query(RegulatoryEvent).filter(RegulatoryEvent.id == event_id).first()
        if row is None:
            raise HTTPException(status_code=404, detail="Event not found")
        row.status = payload.status
        db.commit()
        db.refresh(row)
        return event_to_dict(row)

    return router
