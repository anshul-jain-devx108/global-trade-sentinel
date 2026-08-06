"""DB-first lookup tool for Ask Sentinel.

Compliance officers often ask questions we've *already researched* during a
scheduled sweep — "any Iran sanctions this month?", "what changed in EU
tariffs?", "list our recent CRITICAL findings". Every such answer already
lives in `regulatory_events` with verified deep-link citations. Firing a
fresh You.com research call for those is wasteful (money) and slow
(seconds per specialist).

This tool exposes `search_findings(...)` to the router agent so it can
answer from the DB first and only escalate to a specialist when nothing
matches or the user explicitly asks for fresh research.

Design notes:
- Read-only. Does NOT run arbitrary SQL — safer than SQLTools and enough
  for the compliance-officer persona.
- Returns JSON-serialisable dicts (title, jurisdiction, dates, severity,
  short description snippet, citation URLs). Everything the LLM needs to
  compose a Teams reply. No PII.
- Bounded output — LIMIT capped so the LLM prompt does not blow up on a
  loose query.
"""
from __future__ import annotations

from datetime import date, timedelta
from typing import Any, Dict, List, Optional

import re

from sqlalchemy import and_, or_
from sqlalchemy.orm import Session, joinedload

from agno.tools import tool
from core.database import SessionLocal
from core.models import RegulatoryEvent

_MAX_LIMIT = 20
_DEFAULT_LIMIT = 5
_DESCRIPTION_SNIPPET = 400  # chars — enough for LLM context, avoids prompt bloat

# Words the LLM tends to sprinkle into queries that carry no signal for a
# substring match — dropping them keeps the token list focused on real
# terms like "CBAM", "OFAC", "Section 301", etc.
_QUERY_STOPWORDS = frozenset({
    "a", "an", "and", "any", "are", "as", "at", "be", "by", "for",
    "from", "has", "in", "is", "it", "latest", "list", "me", "new",
    "of", "on", "or", "recent", "show", "status", "the", "this", "to",
    "update", "updates", "us", "want", "with",
})
_MIN_TOKEN_LEN = 3


def _query_tokens(query: str) -> list[str]:
    """Split the user's free-text into non-trivial keyword tokens.

    LLMs love to expand a user's short question into a 10-word sentence
    ("EU Carbon Border Adjustment Mechanism CBAM latest updates
    implementation reporting certificates definitive period"). ILIKE on
    the full phrase never matches — we OR the tokens instead so any of
    them hitting title/description surfaces the row."""
    parts = re.split(r"[^A-Za-z0-9]+", query.lower())
    return [
        p for p in parts
        if len(p) >= _MIN_TOKEN_LEN and p not in _QUERY_STOPWORDS
    ]


def _serialize(event: RegulatoryEvent) -> Dict[str, Any]:
    return {
        "id": event.id,
        "title": event.title,
        "jurisdiction": event.jurisdiction,
        "event_type": event.event_type,
        "severity": event.severity,
        "status": event.status,
        "published_at": event.published_at.isoformat() if event.published_at else None,
        "effective_from": event.effective_from.isoformat() if event.effective_from else None,
        "effective_until": event.effective_until.isoformat() if event.effective_until else None,
        "detected_at": event.detected_at.isoformat() if event.detected_at else None,
        "description": (event.description or "")[:_DESCRIPTION_SNIPPET],
        "citations": [
            {"title": c.title, "url": c.url}
            for c in (event.citations or [])
            if c.url
        ],
    }


@tool(
    name="search_findings",
    description=(
        "Search Global Trade Sentinel's database of previously-researched "
        "regulatory findings. Every result is already verified with a "
        "deep-link citation. Use this FIRST for any compliance question "
        "before considering a specialist. Filters: free-text search "
        "against title/description, jurisdiction (country or region "
        "keyword), event_type (SANCTION / EXPORT_CONTROL / REGULATORY / "
        "CUSTOMS_TARIFF / TRADE_AGREEMENT / GEOPOLITICAL), severity "
        "(CRITICAL / WARNING / INFO), and days_back (only findings "
        "detected in the last N days). Returns up to 20 events with "
        "titles, dates, severity, description snippet, and citations."
    ),
    # DB reads are cheap and idempotent — no user confirmation needed.
    requires_confirmation=False,
    show_result=False,
)
def search_findings(
    query: Optional[str] = None,
    jurisdiction: Optional[str] = None,
    event_type: Optional[str] = None,
    severity: Optional[str] = None,
    days_back: Optional[int] = None,
    limit: int = _DEFAULT_LIMIT,
) -> List[Dict[str, Any]]:
    """Search Global Trade Sentinel's stored regulatory findings.

    Every argument is optional. Empty result list is a valid answer that
    the agent should convey directly ("No matching findings in the last
    30 days") rather than retrying with a broader query.
    """
    limit = max(1, min(limit, _MAX_LIMIT))

    db: Session = SessionLocal()
    try:
        q = (
            db.query(RegulatoryEvent)
            .options(joinedload(RegulatoryEvent.citations))
            .filter(RegulatoryEvent.status != "DISMISSED")
        )

        if query:
            tokens = _query_tokens(query)
            if tokens:
                # Match on ANY token in title / description / impact.
                # This is intentionally permissive — the router agent
                # narrows using jurisdiction / event_type / severity /
                # days_back filters instead of banking on precise text.
                clauses = []
                for tok in tokens:
                    like = f"%{tok}%"
                    clauses.append(RegulatoryEvent.title.ilike(like))
                    clauses.append(RegulatoryEvent.description.ilike(like))
                    clauses.append(RegulatoryEvent.impact.ilike(like))
                q = q.filter(or_(*clauses))
            else:
                # No useful tokens after stopword strip — fall back to
                # the raw phrase so exact acronyms like "CBAM" still hit.
                like = f"%{query.strip()}%"
                q = q.filter(
                    or_(
                        RegulatoryEvent.title.ilike(like),
                        RegulatoryEvent.description.ilike(like),
                        RegulatoryEvent.impact.ilike(like),
                    )
                )

        if jurisdiction:
            q = q.filter(RegulatoryEvent.jurisdiction.ilike(f"%{jurisdiction.strip()}%"))

        if event_type:
            q = q.filter(RegulatoryEvent.event_type.ilike(event_type.strip()))

        if severity:
            q = q.filter(RegulatoryEvent.severity.ilike(severity.strip()))

        if days_back is not None and days_back > 0:
            cutoff = date.today() - timedelta(days=days_back)
            # detected_at is a datetime, effective_from a date — union
            # them so "last 30 days" catches either signal.
            q = q.filter(
                or_(
                    RegulatoryEvent.detected_at >= cutoff,
                    and_(
                        RegulatoryEvent.effective_from.isnot(None),
                        RegulatoryEvent.effective_from >= cutoff,
                    ),
                )
            )

        rows = q.order_by(RegulatoryEvent.detected_at.desc()).limit(limit).all()
        return [_serialize(r) for r in rows]
    finally:
        db.close()
