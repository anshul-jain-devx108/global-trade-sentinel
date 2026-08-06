"""Cross-router runtime state.

`ScheduleState` is the single source of truth for the active cron preset.
Two routers read/write it (sweep guards manual runs on it, schedule
mutates it), so it lives outside both.

On construction it reconciles against the persisted `agno_schedules`
row — without this, a restart would reset the state to the env default
while a daily/weekly row keeps firing.
"""
import agentic_system.config.config as CFG


class ScheduleState:
    def __init__(self, db) -> None:
        self._db = db
        self._preset = self._reconcile()

    def get(self) -> str:
        return self._preset

    def set(self, preset: str) -> None:
        self._preset = preset

    def is_manual(self) -> bool:
        return self._preset == "manual"

    def _reconcile(self) -> str:
        """Recover the active preset from the persisted schedule row."""
        try:
            from agno.scheduler import ScheduleManager
            manager = ScheduleManager(db=self._db)
            for s in manager.list():
                if s.name == CFG.SCHEDULE_NAME:
                    cron = getattr(s, "cron", None) or getattr(s, "cron_expr", None)
                    return CFG.CRON_TO_PRESET.get(cron, CFG.DEFAULT_SCHEDULE_PRESET)
        except Exception:  # noqa: BLE001
            # DB not ready yet / table missing — fall back to env default.
            pass
        return CFG.DEFAULT_SCHEDULE_PRESET
