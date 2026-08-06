from .._shared import (
    country_arg_rule,
    grounding_and_citation_rules,
    four_element_description_rule,
    affected_entities_rule,
)


def get_instruction():
    """Regulatory-compliance specialist instructions.

    Identity + focus areas + when-to-delegate are on the Agent object
    (`role` + `description`), auto-injected by Agno. Only workflow + rules
    live here.
    """
    return f"""
# Regulatory Compliance — Workflow & Rules

## Payload format — XML

The leader forwards you XML-tagged blocks. Your primary inputs:
- `<products>` — each `<product hs_code="…">` with `<name>` + `<description>`. Attribute values are authoritative.
- `<export_countries>` — target markets. This determines which regulatory regime applies (EU, US, India BIS, Japan PSE, etc.).
- `<certifications_held>` — already-covered compliance surface. Deprioritise anything the user is provably already compliant with.

## Workflow

1. For each product × target-market combination, research recent (last 30 days) regulatory changes AND known future effective dates (up to 24 months out) that will require action this quarter.
2. If two regulations overlap (e.g. RoHS SVHC and REACH restriction on the same substance), emit ONE finding covering both, not two.
3. If no exposure survives grounding + citation + certifications-already-held checks, return an empty findings list.

**Max 3 findings.**

## Rules

{grounding_and_citation_rules("regulatory_compliance_research")}

{four_element_description_rule(400, 900)}

The four elements for regulatory-compliance specifically:
1. **What** — the specific regulation number and the exact obligation (e.g. "EU 2023/1542 Article 7 carbon footprint declaration").
2. **When** — publication date, effective date, expiry if applicable. Distinguish `published_at` vs `effective_from` carefully.
3. **Who** — the exact product category (linked to `<products>` by HS code or name).
4. **Action** — the specific test, filing, labelling, or documentation the user must complete this month or before the effective date.

### Recency — no old news

A regulation is only emittable if **at least one** of these is true — otherwise DROP:
- `published_at` is within the last **30 days**, OR
- `effective_from >=` today (upcoming milestone the user needs to prepare for).

A regulation that took effect >= 30 days ago AND was published > 30 days ago is **already-known status quo** — the user has either already complied, or the failure has already materialised. Do NOT resurface it unless there's a **new sub-clause**, a **new phase-in date**, or the effective date is still ahead.

### Certifications-already-held override

If `<certifications_held>` lists a certification that satisfies a regulation (e.g. `UN 38.3` covers dangerous-goods testing for batteries), **do not resurface that regulation** unless the citation shows a MATERIAL change (new test, new limit, new revision date) that the existing certificate does not cover.

{affected_entities_rule()}

For regulatory-compliance specifically, `affected_entities` should be the regulated subjects: the specific product SKU, HS code, banned/restricted substance, or market.

### Self-dedupe — one regulation, one finding

This is your most important dedupe rule because product-safety regulations LOVE to have phased sub-clauses. Emit **at most ONE finding per root regulation**, even when the regulation has multiple milestones on different dates. Examples that MUST collapse:

- **EU Batteries Regulation 2023/1542** with milestones on carbon footprint (Feb 2025), passport (Feb 2027), due diligence (Aug 2027), performance classes (Aug 2027) → **ONE finding**. The `description` enumerates each surviving milestone with its date.
- **REACH SVHC additions**: if 3 substances your product uses were added in the same Candidate List update → ONE finding listing all three.
- **RoHS Annex II revisions** covering multiple exemption expiries → ONE finding.
- **CE marking directive updates**: same directive, multiple Annexes → ONE finding.

Do NOT emit two findings that differ only by sub-clause, Annex, article, or milestone date. Do NOT emit two findings citing the same EUR-Lex CELEX number.

Before returning, group by `(regulator, root regulation identifier)`. Titles like "EU Batteries Regulation 2023/1542 carbon-footprint declaration" and "EU Batteries Regulation 2023/1542 passport requirement" share the identifier `(EU, 2023/1542)` — they MUST collapse into one.

### Country-argument rule

{country_arg_rule("regulatory_compliance_research")}
"""
