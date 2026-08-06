"""Shared prompt fragments interpolated into specialist agent instructions.

Single source of truth for things that were previously copy-pasted across all
six specialists. Update once here → every specialist picks it up.

The `country` whitelist itself is defined in
`agentic_system/config/config.py:YOUCOM_SUPPORTED_COUNTRIES`. Prompts
should render from that same source so ops rotating the list touches
one file, not two.

## Design principle — leverage Agno's team_members auto-injection

Agno's Team leader receives an auto-generated `<team_members>` block with
every member's `Role:` and (if set) `Description:` verbatim. So each agent's
static "what I cover / when to use me" text belongs on the Agent object,
NOT in the leader's own prompt.

Keep specialist `instructions` focused on things Agno does not know:
  - the specialist's own research workflow
  - grounding / citation / dedupe rules that are Agno-blind
  - output-shape discipline (max findings, four-element description, etc.)

Everything else (identity, focus areas, when to delegate here) goes in
the agent's `role` + `description` fields — Agno injects those into the
leader's context automatically.
"""
import agentic_system.config.config as CFG


# Space-separated, alphabetically sorted — this is what the prompt reads.
# Kept as a module-level constant so it's computed once at import time.
SUPPORTED_COUNTRY_CODES = " ".join(sorted(CFG.YOUCOM_SUPPORTED_COUNTRIES))


def country_arg_rule(tool_name: str) -> str:
    """Return the standard 'Country-argument rule (do not guess)' paragraph
    for a specialist's rules section, with the specialist's own research tool
    name interpolated.
    """
    return (
        f"The `country` argument on `{tool_name}` / `dynamic_research` is a hard "
        f"whitelist from the You.com API. Supported codes: `{SUPPORTED_COUNTRY_CODES}`. "
        "Anything else — `EU`, `AE`, `IL`, `IE`, 3-letter codes, full country names — "
        "**must not be passed as `country`**. If the target country is outside this "
        "list, leave `country=None` and put the country name inside the `input` query "
        "string instead. Never guess."
    )


def grounding_and_citation_rules(tool_name: str) -> str:
    """Consolidated grounding + citation discipline shared by every
    specialist. Replaces what used to be three overlapping rules
    ("no hallucination", "retry with better context", "deep-link citation").
    """
    return (
        "### Grounding & citations — silence beats fabrication\n\n"
        f"Every field of every finding you emit — `title`, dates, `description`, `impact`, "
        f"`affected_entities`, `citations[]` — must be traceable to a URL that `{tool_name}` "
        "or `dynamic_research` actually returned in this run. Never mimic a plausible-sounding "
        "finding from prior knowledge. Never invent a URL.\n\n"
        "Each citation URL must be a **deep link** to the specific notice, list entry, ruling, "
        "or press release — never a landing page (`https://ofac.treasury.gov/`, "
        "`https://eur-lex.europa.eu/`). Prefer URLs with 2+ path segments. Never repeat a URL "
        "across two findings.\n\n"
        "If your first research call only returned landing pages or shallow results, retry ONCE "
        "with a sharper query (add the exact entity name, regulation number, or date you are "
        "trying to confirm). If the second retry still fails to produce a deep-link source, "
        "**drop the finding entirely**. Silence beats an unverified event."
    )


def four_element_description_rule(char_min: int = 400, char_max: int = 900) -> str:
    """The standard 'description quality' rule that every specialist enforces.

    Args:
        char_min / char_max: characters allowed. Most specialists use
        400-900; the leader's dedupe stage uses 600-900 for umbrella events.
    """
    return (
        f"### Description quality ({char_min}-{char_max} characters, four-element structure)\n\n"
        f"`description` must be {char_min}-{char_max} characters and contain all four elements:\n\n"
        "1. **What** — specific rule / list / tariff / disruption with regulation number or list name.\n"
        "2. **When** — announcement date, effective date, expiry if temporary.\n"
        "3. **Who** — exact regulated third parties (product HS, supplier, port, mineral, entity).\n"
        "4. **Action** — what the user must do this week / this month.\n\n"
        "Reject template phrases like *may impact your business*, *could affect operations*, "
        "*review your compliance*, *consider reviewing*, *it is important to note*. Every claim "
        "in every element must trace back to a URL in `citations[]`. Rewrite using only facts "
        "from that event's sources, or drop the event."
    )


def affected_entities_rule() -> str:
    """The 'don't put user's own company name in affected_entities' rule
    shared by every specialist."""
    return (
        "### `affected_entities` — regulated third parties only\n\n"
        "Never list the user's own company (`<company><name>`) or its aliases in "
        "`affected_entities`. This field is for the **regulated third parties** — the "
        "specific supplier, subsidiary, vessel, HS code, mineral, port, or foreign "
        "jurisdiction the finding actually affects. If you have no such external subject "
        "in your sources, use an empty list rather than filling it with the user's name."
    )
