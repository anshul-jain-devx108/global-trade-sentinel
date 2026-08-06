"""Build the prompt fed to the sweep team.

Consumed by both the manual sweep endpoint and the cron endpoint —
the two paths only differ in the query text (user-typed vs. default).
"""
from typing import Optional

from sqlalchemy.orm import Session

from services.profile_repo import get_active_profile
from services.profile_serializer import profile_to_out
from services.profile_xml import profile_to_context
from services.specialist_state import specialist_state


# Default query used by scheduled sweeps (no user-typed query available).
CRON_SWEEP_QUERY = (
    "Run a full trade-compliance sweep for the company described in the "
    "authoritative XML context above. Surface every new or changed regulatory "
    "event, sanction, export-control, customs/tariff, trade-agreement, and "
    "geopolitical-risk item relevant to the company's products, countries, and "
    "suppliers."
)


def _excluded_specialists_block() -> Optional[str]:
    """Emit an XML directive listing specialists the leader must not delegate to."""
    disabled = specialist_state.disabled_ids()
    if not disabled:
        return None
    ids_xml = "".join(f"    <specialist>{sid}</specialist>\n" for sid in disabled)
    return (
        "<excluded_specialists>\n"
        "  <!-- The user has disabled these specialists. Do NOT delegate any\n"
        "       task to them. Their scope must be treated as out-of-band for\n"
        "       this sweep. -->\n"
        f"{ids_xml}"
        "</excluded_specialists>"
    )


def build_sweep_prompt(
    *,
    db: Session,
    query: str,
    company: Optional[str] = None,
    use_profile: bool = True,
) -> str:
    """Compose the final prompt: XML profile context (if any) + optional company hint + user query."""
    parts = []
    if use_profile:
        profile = get_active_profile(db)
        if profile is not None:
            parts.append(profile_to_context(profile_to_out(profile)))
    excluded = _excluded_specialists_block()
    if excluded:
        parts.append(excluded)
    if company:
        parts.append(f"Company: {company}")
    parts.append(query.strip())
    return "\n\n".join(p for p in parts if p)
