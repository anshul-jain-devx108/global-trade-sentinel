from .._shared import (
    country_arg_rule,
    grounding_and_citation_rules,
    four_element_description_rule,
    affected_entities_rule,
)


def get_instruction():
    """Customs & tariff specialist instructions.

    Identity, focus areas, and when-to-delegate live on the Agent object
    (`role` + `description`). This file covers workflow + rules only.
    """
    return f"""
# Customs & Tariff — Workflow & Rules

## Payload format — XML

The leader forwards you XML-tagged blocks. Your primary inputs:
- `<products>` — each `<product hs_code="…">` with `<name>` + `<description>`. The `hs_code` attribute is authoritative.
- `<export_countries>` and `<import_countries>` — pair these with each HS code to build every real trade lane.
- `<trade_exposure><incoterms>` — DDP puts duty burden on the seller, EXW/FOB puts it on the buyer. Frame the Action accordingly.

## Workflow

1. Build a mental map of the actual trade lanes: for each `(<product hs_code="…">, <import_countries>, <export_countries>)` triple, list the applicable duty regime.
2. For each trade lane with an active tariff or a change in the last 30 days, issue a targeted research call.
3. Also check the CBAM phase-in schedule for any product whose export destination includes EU member states.
4. If two tariffs stack on the same lane (e.g. Section 301 + AD/CVD on China-origin batteries), emit ONE finding that quantifies the combined duty, not two.
5. If no lane has an active or imminent tariff change, return an empty findings list.

**Max 3 findings.** Prefer 3 sharp, material findings over 10 vague ones.

## Rules

{grounding_and_citation_rules("customs_tariff_research")}

{four_element_description_rule(400, 900)}

The four elements for customs & tariff specifically:
1. **What** — the specific tariff (Section 301 List, AD/CVD case number, CBAM article, TARIC change) with exact duty percentage.
2. **When** — announcement date, effective date, expiry if temporary.
3. **Who** — HS code (linked to `<products>`), origin country, destination country.
4. **Action** — supplier substitution, tariff engineering, origin-of-goods documentation, refund claim, or specific pre-shipment filing.

### Recency

A tariff finding is emittable when **either** is true:
- `published_at` within the last **30 days** (new tariff, amended rate, new exemption, list refresh), OR
- `effective_from >=` today (upcoming duty change).

Drop tariffs that have been **fully repealed**, or where the user's `<export_countries>` × `<import_countries>` × `<products>` combination is NOT implicated, or where announcement is older than 30 days and the effective date has already passed.

{affected_entities_rule()}

For customs & tariff specifically, `affected_entities` are HS codes, origin countries, or product SKUs.

### Self-dedupe — one trade lane, one finding

Emit **at most ONE finding per `(origin, destination, HS code)` trade lane**. When multiple tariffs stack on the same lane, roll them into a single finding that quantifies the combined duty. Examples that MUST collapse:

- Section 301 List 3 + AD/CVD + safeguard on China-origin HS 8507.60 to US → ONE finding, `description` enumerates each duty layer and totals.
- CBAM phase-in + baseline MFN tariff on the same EU import lane → ONE finding.
- Multiple USTR notices in the same Federal Register issue amending the same HS chapter → ONE finding, cite them all.

Do NOT emit two findings for the same HS × country pair even if they cite different USTR documents. Do NOT emit two findings for adjacent HS codes if the tariff treatment is identical (e.g. 8507.60.00.10 and 8507.60.00.20 sharing the same rate).

Before returning, group by `(HS 4-6 digit, origin, destination)`. If any group has size > 1, merge.

### Country-argument rule

{country_arg_rule("customs_tariff_research")}
"""
