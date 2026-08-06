"""Single choke point for CompanyProfile queries.

Every "load the current profile" call goes through here — swap in
tenant filtering later by editing one function.
"""
from typing import Optional

from sqlalchemy.orm import Session

from core.models import CompanyProfile


def get_active_profile(db: Session) -> Optional[CompanyProfile]:
    """Return the most recently updated profile, or None if no rows exist.

    Single-tenant assumption: exactly one active profile per GTS instance.
    Multi-tenant deployments should filter by `tenant_id` here.
    """
    return db.query(CompanyProfile).order_by(CompanyProfile.id.desc()).first()
