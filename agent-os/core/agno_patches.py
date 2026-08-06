"""Runtime patches over Agno framework code.

Each patch here works around a specific Agno bug we've hit in production.
Every entry documents: (1) what Agno does wrong, (2) what we do about it,
(3) the upstream PR/issue that would let us remove the patch. Load
`apply_patches()` from `main.py` BEFORE any Agno router or agent is
constructed so the wrappers are in place from the first call.

Deleting this file should be safe once every listed upstream fix ships.
"""
import json
import logging
from typing import Any


log = logging.getLogger("gts.agno_patches")


def _coerce_jsonb(value: Any, expected: type) -> Any:
    """Postgres-jsonb column read back as `str` → parse it into the
    expected Python type, tolerating double-encoding. Returns an empty
    instance of `expected` on any failure so calling code stays cheap.
    """
    if isinstance(value, expected):
        return value
    if isinstance(value, str):
        try:
            parsed = json.loads(value)
        except (json.JSONDecodeError, TypeError):
            return expected()
        if isinstance(parsed, str):
            # Double-encoded — one more layer.
            try:
                parsed = json.loads(parsed)
            except (json.JSONDecodeError, TypeError):
                return expected()
        return parsed if isinstance(parsed, expected) else expected()
    return expected()


def _patch_calculate_date_metrics() -> None:
    """Fix: Agno 2.8.2's Postgres metrics aggregator crashes with
    `'str' object has no attribute 'get'` when a session row's
    `session_data` or `runs` field is a JSON string (double-encoded)
    inside the `jsonb` column instead of a dict/list. We've observed
    this on ~half of legacy `ai.sessions` rows, and it can recur every
    time Agno's insert path double-encodes. This wrapper coerces the
    two offending fields on the way in.

    Upstream: `docs/agno_pr_jsonb_double_encoding.md`.
    """
    from agno.db.postgres import utils as u

    original = u.calculate_date_metrics

    def patched(date_to_process, sessions_data):
        # `sessions_data` is a dict keyed by session_type ('agent', 'team',
        # 'workflow'), each value a list of session dicts. Normalise the
        # two fields the aggregator drills into.
        for session_type in ("agent", "team", "workflow"):
            sessions = sessions_data.get(session_type) or []
            for session in sessions:
                if not isinstance(session, dict):
                    continue
                if "session_data" in session:
                    session["session_data"] = _coerce_jsonb(session["session_data"], dict)
                if "runs" in session:
                    session["runs"] = _coerce_jsonb(session["runs"], list)
        return original(date_to_process, sessions_data)

    u.calculate_date_metrics = patched
    log.info("Patched agno.db.postgres.utils.calculate_date_metrics for jsonb double-encoding")


def apply_patches() -> None:
    """Idempotent — safe to call more than once (each _patch_ helper
    reassigns the module attribute in place)."""
    try:
        _patch_calculate_date_metrics()
    except Exception as e:  # noqa: BLE001
        # Never let a broken patch block boot. Metrics refresh would
        # simply keep failing the way it did before, which is what we
        # already had.
        log.warning("Failed to apply calculate_date_metrics patch: %s", e)
