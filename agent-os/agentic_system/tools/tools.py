"""Research tools exposed to Agno agents.

Two tiers of tool are shipped from here:

  1. `dynamic_research` — the raw You.com Research wrapper. Accepts per-call
     freshness / country / include_domains / exclude_domains overrides. Used
     as the FALLBACK tool on every specialist so an agent can widen its
     search when a narrow domain-restricted call returns nothing.

  2. Six per-specialist wrappers built by `make_specialist_research(...)` —
     each is pre-scoped to that specialist's authoritative-domain shortlist
     (from `CFG.SPECIALIST_DOMAINS`) and default freshness window (from
     `CFG.SPECIALIST_FRESHNESS`). Agents call these FIRST so their research
     corpus is pre-filtered to primary sources.

The factory produces genuine named functions (not lambdas) because Agno's
tool discovery uses `__name__`. Each wrapper has its own `__name__`,
`__doc__`, and signature so it registers as a distinct tool.

Country codes: You.com's API validates against ISO 3166-1 alpha-2 (two-letter
codes like DE, NL, US). Any non-two-letter value (e.g. the region name
"EU") returns 422. `_sanitize_country()` normalises common mistakes and
drops values the API will reject — keeping the search running at global
scope rather than crashing the whole call.
"""
from typing import Optional, List

import agentic_system.config.config as CFG
from .youcom.research import YouResearchTools
from core.logging_config import get_logger

log = get_logger("agentic.tools")


def _sanitize_country(country: Optional[str]) -> Optional[str]:
    """Return a country code from the You.com-supported whitelist, or None.

    We deliberately use a hard whitelist (`CFG.YOUCOM_SUPPORTED_COUNTRIES`)
    not a permissive alpha-2 shape check, because the API rejects
    unsupported codes even when they are valid ISO 3166-1 (e.g. `AE`, `IE`,
    `IL`). Falling back to None keeps the search running at global scope
    instead of exploding a whole specialist's tool loop.
    """
    if not country:
        return None
    val = country.strip().upper()
    if not val:
        return None
    if val in CFG.YOUCOM_SUPPORTED_COUNTRIES:
        return val
    log.warning(
        "Dropping country=%r — not in You.com supported list; running at global scope",
        country,
    )
    return None


# ─── Base tool — the raw research call ────────────────────────────────

def dynamic_research(
    input: str,
    freshness: Optional[str] = None,
    country: Optional[str] = None,
    include_domains: Optional[List[str]] = None,
    exclude_domains: Optional[List[str]] = None,
) -> str:
    """
    Search the web using You.com Research API. Fallback tool — use when a
    specialist wrapper returned nothing after a retry, or when the query
    intentionally needs to reach beyond the specialist's domain shortlist.

    Args:
        input (str): The search query or research question.
        freshness (Optional[str]): Freshness filter ("day", "week", "month", "year").
        country (Optional[str]): Country code for geographical focus (e.g. "IN", "US").
        include_domains (Optional[List[str]]): Restrict sources to these domains.
        exclude_domains (Optional[List[str]]): Exclude sources from these domains.
    """
    # Sanitise at the base tool too — an agent that calls dynamic_research
    # directly (fallback path, or cron job) should get the same guard as
    # the specialist wrapper. Sanitising here is idempotent when the
    # wrapper already cleaned the value.
    country = _sanitize_country(country)

    tool = YouResearchTools(
        format="markdown",
        research_effort=CFG.YOUCOM_RESEARCH_EFFORT,
        timeout=CFG.YOUCOM_RESEARCH_TIMEOUT_SECONDS,
        freshness=freshness,
        country=country,
        include_domains=include_domains,
        exclude_domains=exclude_domains,
    )
    return tool.you_research(input=input)


# ─── Specialist wrapper factory ───────────────────────────────────────

def make_specialist_research(
    *,
    name: str,
    docstring: str,
    default_domains: List[str],
    default_freshness: Optional[str] = None,
    default_country: Optional[str] = None,
):
    """Build a named research function pre-scoped to a specialist's
    authoritative domains + freshness window.

    The returned function is a real named function (not a lambda) so Agno's
    tool registry can discover it via `__name__`. Agents call it with just
    a `query` string; they may override `country` per call when the query
    is geographically narrow.

    The wrapper's built-in domain list is authoritative: the caller cannot
    dilute it by passing arbitrary include_domains. This is deliberate — we
    do NOT want a specialist wandering into unvetted domains. If the search
    is empty, the specialist should fall back to `dynamic_research` (also
    exposed on the agent) rather than fight this wrapper.
    """
    def _wrapper(input: str, country: Optional[str] = None, freshness: Optional[str] = None) -> str:
        # Sanitize BEFORE the fallback — a bad `country="EU"` from the LLM
        # should surface as "no country filter", not as "fall back to
        # default_country". Falling back would just move the problem.
        safe_country = _sanitize_country(country) or _sanitize_country(default_country)
        safe_freshness = freshness or default_freshness
        return dynamic_research(
            input=input,
            freshness=safe_freshness,
            country=safe_country,
            include_domains=default_domains,
        )

    _wrapper.__name__ = name
    _wrapper.__qualname__ = name
    _wrapper.__doc__ = docstring
    return _wrapper


# ─── Six specialist tools ─────────────────────────────────────────────
# Domains + freshness come from config so ops/compliance can rotate
# authoritative sources without touching this file.

sanctions_research = make_specialist_research(
    name="sanctions_research",
    docstring=(
        "Search for sanctions and entity-list designations. Restricted to "
        "OFAC, BIS, EU sanctions, UN, and sanctionsmap.eu. "
        "Args: input (query string), country (optional ISO code), freshness (optional)."
    ),
    default_domains=CFG.SPECIALIST_DOMAINS["sanctions"],
    default_freshness=CFG.SPECIALIST_FRESHNESS["sanctions"],
)

export_control_research = make_specialist_research(
    name="export_control_research",
    docstring=(
        "Search for export-control rules (EAR, ITAR, EU Dual-Use, Wassenaar). "
        "Restricted to BIS, GPO/eCFR, Wassenaar, EU trade portal. "
        "Args: input (query), country (optional ISO code), freshness (optional)."
    ),
    default_domains=CFG.SPECIALIST_DOMAINS["export_control"],
    default_freshness=CFG.SPECIALIST_FRESHNESS["export_control"],
)

regulatory_compliance_research = make_specialist_research(
    name="regulatory_compliance_research",
    docstring=(
        "Search for product-safety, environmental, and market-access regulations "
        "(RoHS, REACH, WEEE, EU Batteries Reg, CE, CPSC, FDA, EPA). "
        "Restricted to EUR-Lex, ECHA, Federal Register, CPSC, gov.uk. "
        "Args: input (query), country (optional ISO code), freshness (optional)."
    ),
    default_domains=CFG.SPECIALIST_DOMAINS["regulatory"],
    default_freshness=CFG.SPECIALIST_FRESHNESS["regulatory"],
)

customs_tariff_research = make_specialist_research(
    name="customs_tariff_research",
    docstring=(
        "Search for customs duties, Section 301, AD/CVD, CBAM, TARIC changes. "
        "Restricted to USTR, CBP, EU taxation-customs, USITC HTS, WTO. "
        "Args: input (query), country (optional ISO code), freshness (optional)."
    ),
    default_domains=CFG.SPECIALIST_DOMAINS["customs_tariff"],
    default_freshness=CFG.SPECIALIST_FRESHNESS["customs_tariff"],
)

trade_agreement_research = make_specialist_research(
    name="trade_agreement_research",
    docstring=(
        "Search for FTAs, preferential-tariff schemes, GSP, and rules of origin. "
        "Restricted to WTO, India Ministry of Commerce, EU trade portal, "
        "state.gov, USTR. "
        "Args: input (query), country (optional ISO code), freshness (optional)."
    ),
    default_domains=CFG.SPECIALIST_DOMAINS["trade_agreement"],
    default_freshness=CFG.SPECIALIST_FRESHNESS["trade_agreement"],
)

geopolitical_research = make_specialist_research(
    name="geopolitical_research",
    docstring=(
        "Search for geopolitical / supply-chain disruption news (route "
        "disruptions, port strikes, embargoes, forced-labor bans, "
        "conflict-mineral risks). Restricted to Reuters, ReliefWeb, "
        "maritime-executive, Bloomberg, FT. "
        "Args: input (query), country (optional ISO code), freshness (optional)."
    ),
    default_domains=CFG.SPECIALIST_DOMAINS["geopolitical"],
    default_freshness=CFG.SPECIALIST_FRESHNESS["geopolitical"],
)
