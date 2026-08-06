"""Direct single-specialist run endpoint (bypasses the sweep team)."""
from fastapi import APIRouter, Depends, HTTPException

from api.auth_deps import get_current_user
from api.schemas import AgentRunRequest
from api.specialists import SPECIALIST_AGENTS
from core.models import User


def get_agents_router() -> APIRouter:
    router = APIRouter(prefix="/api/v1/gts", tags=["agents"])

    @router.post("/agent/{agent_id}/run")
    async def run_agent(
        agent_id: str,
        req: AgentRunRequest,
        current_user: User = Depends(get_current_user),
    ):
        agent = SPECIALIST_AGENTS.get(agent_id)
        if agent is None:
            raise HTTPException(status_code=404, detail=f"Unknown specialist: {agent_id}")
        run = await agent.arun(req.query)
        return {
            "agent_id": agent_id,
            "content": getattr(run, "content", None) or getattr(run, "output", "") or "",
        }

    return router
