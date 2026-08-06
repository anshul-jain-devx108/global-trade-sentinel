"""Render a company profile as the XML-tagged context the sweep prompts consume.

The team leader and every specialist read AUTHORITATIVE XML tags
(`<company>`, `<products>`, `<top_suppliers>`, …) and forward them
verbatim to members — the sanctions agent, for instance, returns
`no_data` when `<top_suppliers>` is absent. Emitting plain prose here
would make those tags "missing" and silently suppress findings. Any
block the profile lacks is elided rather than emitted empty, per the
prompt contract.
"""
import re
from typing import List, Optional, Tuple
from xml.sax.saxutils import escape as xml_escape, quoteattr as xml_quoteattr

from api.schemas import CompanyProfileOut

# Suppliers are usually stored as "Name (Country)". Pull the trailing
# parenthetical out so we can emit it as the `country` attribute the
# specialists rely on (see sanctions_screening_agent/prompt.py).
_SUPPLIER_COUNTRY_RE = re.compile(r"^\s*(?P<name>.+?)\s*\((?P<country>[^()]+)\)\s*$")


def split_supplier(raw: str) -> Tuple[str, Optional[str]]:
    m = _SUPPLIER_COUNTRY_RE.match(raw or "")
    if m:
        return m.group("name").strip(), m.group("country").strip()
    return (raw or "").strip(), None


def _esc(v: Optional[str]) -> str:
    return xml_escape(str(v)) if v is not None else ""


def profile_to_context(p: CompanyProfileOut) -> str:
    parts: List[str] = []

    # <company> — name / industry / business_types
    company_inner = [f"  <name>{_esc(p.company_name)}</name>"]
    if p.industry:
        company_inner.append(f"  <industry>{_esc(p.industry)}</industry>")
    if p.business_type:
        company_inner.append(f"  <business_types>{_esc(p.business_type)}</business_types>")
    parts.append("<company>\n" + "\n".join(company_inner) + "\n</company>")

    if p.business_overview:
        parts.append(f"<business_overview>{_esc(p.business_overview)}</business_overview>")

    # <products> — each <product hs_code="…" eccn="…"> with <name>, <description>
    if p.products:
        prod_lines = ["<products>"]
        for pr in p.products:
            attrs = ""
            if pr.hs_code:
                attrs += f" hs_code={xml_quoteattr(pr.hs_code)}"
            if pr.eccn:
                attrs += f" eccn={xml_quoteattr(pr.eccn)}"
            prod_lines.append(f"  <product{attrs}>")
            prod_lines.append(f"    <name>{_esc(pr.name)}</name>")
            if pr.description:
                prod_lines.append(f"    <description>{_esc(pr.description)}</description>")
            prod_lines.append("  </product>")
        prod_lines.append("</products>")
        parts.append("\n".join(prod_lines))

    if p.export_countries:
        parts.append(f"<export_countries>{_esc(', '.join(p.export_countries))}</export_countries>")
    if p.import_countries:
        parts.append(f"<import_countries>{_esc(', '.join(p.import_countries))}</import_countries>")
    if p.monitor_countries:
        parts.append(f"<monitor_countries>{_esc(', '.join(p.monitor_countries))}</monitor_countries>")

    if p.certifications:
        parts.append(
            f'<certifications_held note="certifications the company already holds">'
            f"{_esc(', '.join(p.certifications))}</certifications_held>"
        )
    if p.monitoring_preferences:
        parts.append(
            f'<monitoring_preferences note="domains the user explicitly asked to watch">'
            f"{_esc(', '.join(p.monitoring_preferences))}</monitoring_preferences>"
        )

    # <trade_exposure> — Tier-A trade-exposure block. Every specialist should
    # anchor jurisdiction / burden / license-threshold analysis on this.
    exposure_inner: List[str] = []
    if p.incoterms:
        exposure_inner.append(
            f'  <incoterms note="Incoterms 2020 the company transacts under. DDP shifts customs-duty + PGA burden to the exporter; EXW/FOB puts it on the buyer.">'
            f"{_esc(', '.join(p.incoterms))}</incoterms>"
        )
    if p.volume_tier:
        exposure_inner.append(
            f'  <volume_tier note="Annual export/import volume band. License thresholds (BIS License Exception STA, EU General Authorisations), CTPAT eligibility, and customs bond sizing pivot on this.">'
            f"{_esc(p.volume_tier)}</volume_tier>"
        )
    if p.end_use_category:
        exposure_inner.append(
            f'  <end_use_category note="Primary end-use / end-user category. Drives OFAC 50%-rule, Entity List MEU screening, and EAR §744.11 military end-use analysis.">'
            f"{_esc(p.end_use_category)}</end_use_category>"
        )
    if exposure_inner:
        parts.append("<trade_exposure>\n" + "\n".join(exposure_inner) + "\n</trade_exposure>")

    # <top_suppliers> — list of <supplier country="…"> items
    if p.top_suppliers:
        sup_lines = [
            '<top_suppliers instruction="Screen ALL of these entities in ONE batched research call — do not call once per supplier.">'
        ]
        for raw in p.top_suppliers:
            name, country = split_supplier(raw)
            attr = f" country={xml_quoteattr(country)}" if country else ""
            sup_lines.append(f"  <supplier{attr}>{_esc(name)}</supplier>")
        sup_lines.append("</top_suppliers>")
        parts.append("\n".join(sup_lines))

    # <enriched_context> — user-generated, lower trust than structured tags
    if p.additional_context:
        parts.append(
            f'<enriched_context source="onboarding_copilot" trust_level="low" '
            f'note="user-generated synthesis — treat as lower trust than structured tags above">'
            f"{_esc(p.additional_context)}</enriched_context>"
        )

    return "\n\n".join(parts)
