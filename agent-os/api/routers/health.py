"""Health + specialist discovery endpoints."""
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from api.auth_deps import get_current_user
from api.specialists import SPECIALIST_AGENTS
from core.models import User
from services.specialist_state import specialist_state


class EnabledUpdate(BaseModel):
    enabled: bool


def get_health_router() -> APIRouter:
    router = APIRouter(prefix="/api/v1/gts", tags=["health"])

    @router.get("/health")
    def health():
        """Unauthenticated liveness probe — safe to expose for uptime monitors."""
        return {"status": "ok", "service": "gts", "agents": list(SPECIALIST_AGENTS.keys())}

    @router.get("/specialists")
    def list_specialists(current_user: User = Depends(get_current_user)):
        """Registry + per-specialist enabled state. The frontend renders one
        toggleable card per row; disabled specialists are skipped by the
        sweep-leader on the next run."""
        enabled_map = specialist_state.all()
        return [
            {
                "id": a.id,
                "name": a.name,
                "role": a.role or "",
                "enabled": enabled_map.get(a.id, True),
            }
            for a in SPECIALIST_AGENTS.values()
        ]

    @router.patch("/specialists/{specialist_id}/enabled")
    def set_specialist_enabled(
        specialist_id: str,
        payload: EnabledUpdate,
        current_user: User = Depends(get_current_user),
    ):
        """Enable or disable a specialist for future sweeps. Persists to disk."""
        try:
            specialist_state.set(specialist_id, payload.enabled)
        except KeyError:
            raise HTTPException(status_code=404, detail=f"Unknown specialist: {specialist_id}")
        return {"id": specialist_id, "enabled": payload.enabled}

    return router
