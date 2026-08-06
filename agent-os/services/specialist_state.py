"""Server-side enable/disable state for the sweep team's specialists.

Persisted to a JSON file on disk so restarts don't reset it. Consumed by
the sweep-prompt builder to inject an `<excluded_specialists>` block that
tells the leader agent to skip those members.

Registry lookups always fall back to "enabled" — a specialist not seen
yet is on by default so freshly-registered agents participate.
"""
from __future__ import annotations

import json
import logging
import os
import threading
from pathlib import Path
from typing import Dict, List

from api.specialists import SPECIALIST_AGENTS

log = logging.getLogger("gts.specialist_state")

_DEFAULT_PATH = Path(os.environ.get(
    "GTS_SPECIALIST_STATE_PATH",
    Path(__file__).resolve().parent.parent / "data" / "specialist_state.json",
))


class SpecialistState:
    """Thread-safe in-memory map of specialist_id → enabled bool."""

    def __init__(self, path: Path = _DEFAULT_PATH) -> None:
        self._path = path
        self._lock = threading.Lock()
        self._enabled: Dict[str, bool] = self._load()

    def _load(self) -> Dict[str, bool]:
        try:
            if self._path.exists():
                data = json.loads(self._path.read_text(encoding="utf-8"))
                if isinstance(data, dict):
                    return {str(k): bool(v) for k, v in data.items()}
        except Exception:  # noqa: BLE001
            log.exception("Failed to load specialist_state; starting empty")
        return {}

    def _save(self) -> None:
        try:
            self._path.parent.mkdir(parents=True, exist_ok=True)
            self._path.write_text(json.dumps(self._enabled, indent=2), encoding="utf-8")
        except Exception:  # noqa: BLE001
            log.exception("Failed to persist specialist_state")

    def is_enabled(self, specialist_id: str) -> bool:
        with self._lock:
            return self._enabled.get(specialist_id, True)

    def set(self, specialist_id: str, enabled: bool) -> None:
        if specialist_id not in SPECIALIST_AGENTS:
            raise KeyError(f"Unknown specialist: {specialist_id}")
        with self._lock:
            self._enabled[specialist_id] = bool(enabled)
            self._save()

    def all(self) -> Dict[str, bool]:
        """Return the effective enabled map for every registered specialist."""
        with self._lock:
            return {sid: self._enabled.get(sid, True) for sid in SPECIALIST_AGENTS.keys()}

    def disabled_ids(self) -> List[str]:
        return [sid for sid, on in self.all().items() if not on]


specialist_state = SpecialistState()
