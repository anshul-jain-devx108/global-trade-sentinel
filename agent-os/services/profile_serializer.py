"""ORM ↔ Pydantic conversion for CompanyProfile.

Kept separate from XML rendering so a caller that only needs the JSON
shape doesn't pull in the prompt-context builder.
"""
import json
from typing import List, Optional

from core.models import CompanyProfile, Product
from api.schemas import CompanyProfileIn, CompanyProfileOut, ProductIn


def split_csv_list(raw: Optional[str]) -> List[str]:
    """Parse a column that historically held either JSON or a CSV string."""
    if not raw:
        return []
    try:
        parsed = json.loads(raw)
        if isinstance(parsed, list):
            return [str(x) for x in parsed]
    except (json.JSONDecodeError, TypeError):
        pass
    return [p.strip() for p in raw.split(",") if p.strip()]


def profile_to_out(p: CompanyProfile) -> CompanyProfileOut:
    return CompanyProfileOut(
        id=p.id,
        company_name=p.company_name,
        industry=p.industry,
        business_type=p.business_type,
        business_overview=p.business_overview,
        export_countries=split_csv_list(p.export_countries),
        import_countries=split_csv_list(p.import_countries),
        monitor_countries=split_csv_list(p.monitor_countries),
        certifications=split_csv_list(p.certifications),
        monitoring_preferences=split_csv_list(p.monitoring_preferences),
        top_suppliers=split_csv_list(p.top_suppliers),
        additional_context=p.additional_context,
        incoterms=split_csv_list(getattr(p, "incoterms", None)),
        volume_tier=getattr(p, "volume_tier", None),
        end_use_category=getattr(p, "end_use_category", None),
        products=[
            ProductIn(
                name=pr.name,
                description=pr.description,
                hs_code=pr.hs_code,
                eccn=getattr(pr, "eccn", None),
            )
            for pr in p.products
        ],
    )


def apply_profile_in(target: CompanyProfile, payload: CompanyProfileIn) -> None:
    """Copy scalar fields from the API payload onto an ORM instance.

    List columns are JSON-encoded so the DB layer stays schema-agnostic.
    Product rows are NOT touched here — callers rewrite them explicitly.
    """
    target.company_name = payload.company_name
    target.industry = payload.industry
    target.business_type = payload.business_type
    target.business_overview = payload.business_overview
    target.export_countries = json.dumps(payload.export_countries or [])
    target.import_countries = json.dumps(payload.import_countries or [])
    target.monitor_countries = json.dumps(payload.monitor_countries or [])
    target.certifications = json.dumps(payload.certifications or [])
    target.monitoring_preferences = json.dumps(payload.monitoring_preferences or [])
    target.top_suppliers = json.dumps(payload.top_suppliers or [])
    target.additional_context = payload.additional_context
    target.incoterms = json.dumps(payload.incoterms or [])
    target.volume_tier = payload.volume_tier
    target.end_use_category = payload.end_use_category


def rewrite_products(db, profile: CompanyProfile, products: List[ProductIn]) -> None:
    """Fully rewrite a profile's products — simpler than diffing rows."""
    for old in list(profile.products):
        db.delete(old)
    for pr in products:
        db.add(Product(
            profile=profile,
            name=pr.name,
            description=pr.description,
            hs_code=pr.hs_code,
            eccn=pr.eccn,
        ))
