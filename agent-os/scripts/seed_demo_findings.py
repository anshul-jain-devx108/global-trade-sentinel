"""Seed a variety of demo regulatory events into the local DB.

Use this before a Teams demo so `search_findings` has something to hand
back to the router agent. Covers every event_type and severity so the
demo can show:
  - DB-hit paths (Sentinel answers from stored data, no specialist call)
  - DB-miss paths (Sentinel falls through to a specialist → approval card)
  - Filter combinations (jurisdiction, severity, days_back)

Idempotent — reruns won't create duplicates because
`persist_sweep_report` (which we reuse below) keys off `dedupe_hash`.

Run:
  cd d:/Netra/agent-os
  uv run python scripts/seed_demo_findings.py
"""
from __future__ import annotations

import sys
from datetime import date, timedelta
from pathlib import Path

# Allow "import sweep_service" from the agent-os root when run from
# scripts/ directly.
_HERE = Path(__file__).resolve().parent
_ROOT = _HERE.parent
if str(_ROOT) not in sys.path:
    sys.path.insert(0, str(_ROOT))

from dotenv import load_dotenv
load_dotenv(_ROOT / ".env")

from core.database import SessionLocal  # noqa: E402
from sweep_service import persist_sweep_report  # noqa: E402


def _iso_days_ago(n: int) -> str:
    return (date.today() - timedelta(days=n)).isoformat()


DEMO_EVENTS = [
    # ─── Sanctions ────────────────────────────────────────────────────
    {
        "event_type": "SANCTION",
        "severity": "CRITICAL",
        "title": "OFAC adds Sepehr Energy Jahan Nama Pars to SDN list — Iran oil sanctions expansion",
        "jurisdiction": "United States — OFAC",
        "published_at": _iso_days_ago(5),
        "effective_from": _iso_days_ago(5),
        "description": (
            "OFAC designated Sepehr Energy Jahan Nama Pars (Iran-based) under EO 13902 for facilitating "
            "Iranian petroleum shipments to East Asia. Related vessels IMO 9243817 and IMO 9410572 were "
            "added simultaneously. Action taken 2026-07-28. US persons must block property and interests "
            "immediately; 50 % Rule extends the block to majority-owned subsidiaries. Secondary-sanction "
            "risk applies to non-US financial institutions transacting with the entity."
        ),
        "impact": "Freeze any transactions with named entities within 24 hours. File OFAC Blocked Property Report within 10 business days.",
        "affected_entities": ["Sepehr Energy Jahan Nama Pars", "IMO 9243817", "IMO 9410572"],
        "citations": [
            {"title": "OFAC recent actions — 2026-07-28", "url": "https://ofac.treasury.gov/recent-actions/20260728"},
            {"title": "Press release — Iran oil sanctions expansion", "url": "https://home.treasury.gov/news/press-releases/jy2601"},
        ],
    },
    {
        "event_type": "SANCTION",
        "severity": "WARNING",
        "title": "EU 15th sanctions package: Russia — shadow fleet vessels + circumvention entities",
        "jurisdiction": "European Union — Council",
        "published_at": _iso_days_ago(12),
        "effective_from": _iso_days_ago(10),
        "description": (
            "EU Council adopted Regulation 2026/1245 on 2026-07-21 as its 15th sanctions package against Russia. "
            "74 individuals and 41 entities added to Annex I. 18 vessels tied to Russia's shadow fleet listed by "
            "IMO number. Third-country entities in UAE and Kyrgyzstan sanctioned for dual-use component transhipment. "
            "Enforcement in force from 2026-07-23."
        ),
        "impact": "Screen supplier network for the 41 new entities. Refuse port services to listed vessels within EU waters.",
        "affected_entities": ["Regulation 2026/1245", "Russia shadow fleet"],
        "citations": [
            {"title": "EUR-Lex — Regulation 2026/1245", "url": "https://eur-lex.europa.eu/eli/reg/2026/1245/oj"},
            {"title": "EU Council press release", "url": "https://www.consilium.europa.eu/en/press/press-releases/2026/07/21/russia-15th-package/"},
        ],
    },

    # ─── Export control ───────────────────────────────────────────────
    {
        "event_type": "EXPORT_CONTROL",
        "severity": "CRITICAL",
        "title": "BIS expands FDPR: advanced semiconductors to 24 additional China entities",
        "jurisdiction": "United States — BIS",
        "published_at": _iso_days_ago(3),
        "effective_from": _iso_days_ago(2),
        "description": (
            "BIS published a final rule on 2026-07-30 (91 FR 48210) extending the Foreign Direct Product Rule "
            "to 24 additional Chinese semiconductor entities. Covers HBM3/HBM3e memory, sub-14nm logic, and "
            "advanced lithography components under ECCNs 3A090, 4A090, and 3B090. License applications reviewed "
            "under a presumption of denial. Existing licenses grandfathered until 2026-09-30."
        ),
        "impact": "Halt shipments to the 24 named entities. Reclassify any inventory sitting at forwarders under new ECCNs.",
        "affected_entities": ["ECCN 3A090", "ECCN 4A090", "ECCN 3B090"],
        "citations": [
            {"title": "Federal Register 91 FR 48210", "url": "https://www.federalregister.gov/documents/2026/07/30/2026-16789/expansion-of-fdpr-china"},
            {"title": "BIS entity-list update", "url": "https://www.bis.doc.gov/index.php/policy-guidance/lists-of-parties-of-concern/entity-list/2026-07-30"},
        ],
    },

    # ─── Regulatory / product ─────────────────────────────────────────
    {
        "event_type": "REGULATORY",
        "severity": "WARNING",
        "title": "REACH Annex XVII — PFAS restriction on consumer textiles adopted",
        "jurisdiction": "European Union — ECHA",
        "published_at": _iso_days_ago(8),
        "effective_from": (date.today() + timedelta(days=180)).isoformat(),  # future effective
        "description": (
            "European Commission adopted Regulation (EU) 2026/1298 amending REACH Annex XVII entry 79 to "
            "prohibit PFAS above 25 ppb in consumer textiles placed on the EU market. Effective 180 days "
            "after publication. Covers apparel, home textiles, and technical fabrics. Six-month transitional "
            "sell-through allowed for compliant stock manufactured before the effective date."
        ),
        "impact": "Test supplier fabric batches for PFAS. Reformulate DWR coatings ahead of effective date.",
        "affected_entities": ["REACH Annex XVII entry 79"],
        "citations": [
            {"title": "EUR-Lex — Regulation (EU) 2026/1298", "url": "https://eur-lex.europa.eu/eli/reg/2026/1298/oj"},
            {"title": "ECHA guidance — PFAS in textiles", "url": "https://echa.europa.eu/hot-topics/perfluoroalkyl-chemicals-pfas"},
        ],
    },
    {
        "event_type": "REGULATORY",
        "severity": "INFO",
        "title": "CPSC recall — button-cell battery packaging on children's toys",
        "jurisdiction": "United States — CPSC",
        "published_at": _iso_days_ago(20),
        "effective_from": _iso_days_ago(20),
        "description": (
            "CPSC issued Recall 26-451 on 2026-07-13 for children's toys containing accessible button-cell "
            "batteries in non-compliant packaging, per Reese's Law 16 CFR 1263. Six brands named, ~180,000 "
            "units affected. Retailers must remove SKUs from shelves and post recall notices at point of sale."
        ),
        "impact": "Check inventory against recall SKU list. Post CPSC recall notice at POS.",
        "affected_entities": ["Recall 26-451", "16 CFR 1263"],
        "citations": [
            {"title": "CPSC Recall 26-451", "url": "https://www.cpsc.gov/Recalls/2026/childrens-toys-button-cell-battery-packaging-recall"},
        ],
    },

    # ─── Customs / tariff ─────────────────────────────────────────────
    {
        "event_type": "CUSTOMS_TARIFF",
        "severity": "WARNING",
        "title": "USTR raises Section 301 tariff on Chinese EV batteries to 40 %",
        "jurisdiction": "United States — USTR",
        "published_at": _iso_days_ago(15),
        "effective_from": _iso_days_ago(1),
        "description": (
            "USTR announced Section 301 review outcome on 2026-07-18. Additional duty on HTS 8507.60.0020 "
            "(lithium-ion batteries for EVs) increases from 25 % to 40 % effective 2026-08-01. Exclusion "
            "process opens 2026-08-15 with a 60-day comment window. HTS 8507.60.0010 (non-EV) unchanged."
        ),
        "impact": "Reprice landed cost on affected SKUs. Prepare exclusion filing if margin cannot absorb.",
        "affected_entities": ["HTS 8507.60.0020"],
        "citations": [
            {"title": "USTR Section 301 announcement", "url": "https://ustr.gov/about-us/policy-offices/press-office/press-releases/2026/07/section-301-china-ev-battery-tariff"},
            {"title": "Federal Register notice", "url": "https://www.federalregister.gov/documents/2026/07/18/2026-16112/section-301-tariff-modification"},
        ],
    },
    {
        "event_type": "CUSTOMS_TARIFF",
        "severity": "INFO",
        "title": "CBP issues CSMS 65-000123 clarifying USMCA rules of origin for auto parts",
        "jurisdiction": "United States — CBP",
        "published_at": _iso_days_ago(40),
        "effective_from": _iso_days_ago(40),
        "description": (
            "CBP CSMS 65-000123 clarifies documentation requirements for the Labour Value Content certification "
            "under USMCA Article 4.5 for auto-parts importers. Importers must retain the certification for 5 years. "
            "Retroactive to entries filed after 2026-06-01."
        ),
        "impact": "Update customs broker instructions to file LVC certification with each USMCA claim.",
        "affected_entities": ["USMCA Article 4.5", "CSMS 65-000123"],
        "citations": [
            {"title": "CBP CSMS 65-000123", "url": "https://content.govdelivery.com/bulletins/gd/USDHSCBP-2f8a91c"},
        ],
    },

    # ─── Trade agreement ──────────────────────────────────────────────
    {
        "event_type": "TRADE_AGREEMENT",
        "severity": "INFO",
        "title": "India–EU FTA: chapter on rules of origin closed at 14th negotiating round",
        "jurisdiction": "India — Commerce Ministry",
        "published_at": _iso_days_ago(25),
        "effective_from": _iso_days_ago(25),
        "description": (
            "India Ministry of Commerce announced on 2026-07-08 that Chapter 4 (Rules of Origin) was "
            "provisionally closed at the 14th negotiating round of the India–EU FTA. Substantial-transformation "
            "test agreed for textiles and pharmaceuticals; a 10 % de-minimis threshold accepted for non-originating "
            "materials. Full agreement targeted for signature Q4 2026."
        ),
        "impact": "Model preferential-rate scenarios under the agreed origin rules for EU-bound exports.",
        "affected_entities": ["India–EU FTA"],
        "citations": [
            {"title": "Commerce Ministry — 14th round outcome", "url": "https://commerce.gov.in/press-releases/india-eu-fta-14th-round"},
            {"title": "EU trade DG update", "url": "https://trade.ec.europa.eu/access-to-markets/en/news/india-eu-fta-round-14"},
        ],
    },

    # ─── Geopolitical ─────────────────────────────────────────────────
    {
        "event_type": "GEOPOLITICAL",
        "severity": "CRITICAL",
        "title": "Bab-el-Mandeb: two container ships hit in past 72 hours — insurance premiums spike",
        "jurisdiction": "Global — Maritime",
        "published_at": _iso_days_ago(2),
        "effective_from": _iso_days_ago(2),
        "description": (
            "Two container vessels reported strikes near Bab-el-Mandeb between 2026-07-30 and 2026-07-31 "
            "per UKMTO advisories 026/26 and 027/26. War-risk insurance premiums for Red Sea transits rose "
            "18 % overnight. Maersk and CMA CGM issued rerouting notices for services calling Jeddah. Cape "
            "of Good Hope re-routing adds 10-14 days to Asia–Europe transit."
        ),
        "impact": "Confirm insurance coverage before Red Sea transits. Model 2-week transit-time buffer for Asia–EU lanes.",
        "affected_entities": ["UKMTO advisory 026/26", "UKMTO advisory 027/26"],
        "citations": [
            {"title": "UKMTO advisory 026/26", "url": "https://www.ukmto.org/indian-ocean/ukmto-warnings/2026/07/advisory-026-26"},
            {"title": "Maritime Executive coverage", "url": "https://maritime-executive.com/article/2026-red-sea-tanker-strikes-bab-el-mandeb"},
            {"title": "Reuters — insurance premiums up 18 %", "url": "https://www.reuters.com/business/shipping/red-sea-war-insurance-premiums-jump-2026-08-01/"},
        ],
    },
    {
        "event_type": "GEOPOLITICAL",
        "severity": "WARNING",
        "title": "Port of Hamburg — 48-hour warning strike announced by ver.di union",
        "jurisdiction": "Germany — Port of Hamburg",
        "published_at": _iso_days_ago(1),
        "effective_from": (date.today() + timedelta(days=4)).isoformat(),
        "description": (
            "German trade union ver.di announced a 48-hour warning strike at the Port of Hamburg starting "
            "2026-08-06 06:00 CEST. Container terminals CTA, CTB, and CTT included. HHLA warned of 2-3 day "
            "vessel-schedule slippage even after resumption. Alternative discharge at Bremerhaven possible for "
            "urgent cargoes."
        ),
        "impact": "Divert time-critical containers to Bremerhaven. Notify hinterland trucking of expected 2-3 day delay.",
        "affected_entities": ["Port of Hamburg CTA/CTB/CTT", "ver.di"],
        "citations": [
            {"title": "HHLA statement — Hamburg 48-hour strike", "url": "https://hhla.de/en/press/press-releases/2026/07/verdi-warning-strike"},
            {"title": "Reuters — Germany port strike", "url": "https://www.reuters.com/business/shipping/germany-hamburg-port-strike-2026-08-01/"},
        ],
    },
]


def main() -> None:
    report = {"events": DEMO_EVENTS, "agent_reports": []}
    db = SessionLocal()
    try:
        summary = persist_sweep_report(db, report)
    finally:
        db.close()
    print(f"Seed complete — added={summary['added']} updated={summary['updated']} duplicates={summary['duplicates']}")
    print("\nTry these in Teams:")
    print("  • DB-hit: 'any Iran sanctions this month?'   → search_findings, no approval")
    print("  • DB-hit: 'what changed with China EV tariffs?' → search_findings, no approval")
    print("  • DB-hit: 'red sea shipping updates?'         → search_findings, no approval")
    print("  • DB-hit: 'CRITICAL findings from last week'  → search_findings, severity filter")
    print("  • DB-miss → approval: 'any new North Korea sanctions the last 3 days?'")
    print("  • DB-miss → approval: 'latest on Japan export controls?'")
    print("  • Small talk: 'hi', 'thanks' — no tool call")
    print("  • Off-topic: 'what's the weather' — polite decline")


if __name__ == "__main__":
    main()
