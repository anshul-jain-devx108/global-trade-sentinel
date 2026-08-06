"""Company profile CRUD + onboarding-copilot endpoints."""
import json
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from agentic_system.agents.onboarding_copilot.agent import onboarding_copilot
from agentic_system.agents.onboarding_copilot.prompt import (
    get_enrichment_prompt,
    get_questions_prompt,
)
from api.auth_deps import get_current_user
from api.deps import get_db
from api.schemas import (
    CompanyProfileIn,
    CompanyProfileOut,
    EnrichRequest,
    QuestionsRequest,
)
from core.models import CompanyProfile, User
from services.profile_repo import get_active_profile
from services.profile_serializer import (
    apply_profile_in,
    profile_to_out,
    rewrite_products,
)


def get_profile_router() -> APIRouter:
    router = APIRouter(prefix="/api/v1/gts", tags=["profile"])

    @router.get("/profile", response_model=Optional[CompanyProfileOut])
    def get_profile(
        current_user: User = Depends(get_current_user),
        db: Session = Depends(get_db),
    ):
        profile = get_active_profile(db)
        return profile_to_out(profile) if profile else None

    @router.post("/profile", response_model=CompanyProfileOut)
    def upsert_profile(
        payload: CompanyProfileIn,
        current_user: User = Depends(get_current_user),
        db: Session = Depends(get_db),
    ):
        """Create or replace the active profile. Products are fully rewritten each save."""
        existing = get_active_profile(db)
        if existing is None:
            existing = CompanyProfile()
            db.add(existing)

        apply_profile_in(existing, payload)
        rewrite_products(db, existing, payload.products)

        db.commit()
        db.refresh(existing)
        return profile_to_out(existing)

    @router.post("/profile/questions")
    async def profile_questions(
        req: QuestionsRequest,
        current_user: User = Depends(get_current_user),
    ):
        """Call the onboarding copilot to produce clarifying questions."""
        payload_str = req.profile.model_dump_json(indent=2)
        run = await onboarding_copilot.arun(get_questions_prompt(payload_str))
        raw = getattr(run, "content", None) or getattr(run, "output", "") or ""
        text = str(raw).strip()
        # Strip ```json fences the model may add despite instructions.
        if text.startswith("```"):
            text = text.strip("`")
            if text.lower().startswith("json"):
                text = text[4:].strip()
        try:
            questions = json.loads(text)
        except json.JSONDecodeError:
            raise HTTPException(status_code=502, detail=f"Copilot returned non-JSON: {text[:200]}")
        return {"questions": questions}

    @router.post("/profile/enrich")
    async def profile_enrich(
        req: EnrichRequest,
        current_user: User = Depends(get_current_user),
        db: Session = Depends(get_db),
    ):
        """Synthesise an enriched-context paragraph from Q&A answers and persist it on the profile.

        Passes the FULL profile payload (products, countries, trade_exposure, etc.)
        alongside the Q&A so the copilot can suppress facts already visible in
        structured tags — the enriched paragraph should add new information, not
        parrot back what specialists already see.
        """
        answers_str = "\n".join(f"Q: {a.question}\nA: {a.answer}" for a in req.answers)
        prompt = get_enrichment_prompt(
            profile_payload=req.profile.model_dump_json(indent=2),
            answers=answers_str,
        )
        run = await onboarding_copilot.arun(prompt)
        enriched = str(getattr(run, "content", None) or getattr(run, "output", "") or "").strip()

        # Persist alongside the profile so future sweeps automatically include it.
        profile = get_active_profile(db)
        if profile is None:
            profile = CompanyProfile()
            db.add(profile)
            apply_profile_in(profile, req.profile)
            rewrite_products(db, profile, req.profile.products)
        profile.additional_context = enriched
        db.commit()
        db.refresh(profile)

        return {"enriched_context": enriched, "profile": profile_to_out(profile)}

    return router
