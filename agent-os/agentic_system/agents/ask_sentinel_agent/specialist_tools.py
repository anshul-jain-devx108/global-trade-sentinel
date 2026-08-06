"""Approval-gated wrappers around the 6 specialist agents.

Ask Sentinel routes user questions through these instead of exposing the
raw specialist agents. Two reasons:

1. **Cost / latency gate.** A specialist run hits You.com Research API
   (paid, 10-60s per call). We DON'T want the router to fire one silently
   whenever the LLM feels curious — the compliance officer should approve
   the spend. Each wrapper is decorated with `requires_confirmation=True`
   so Agno pauses the run and the MicrosoftTeams webhook can send an
   Adaptive Card with Approve/Reject buttons.

2. **DB-first policy.** Combined with `search_findings` in the router's
   tool list, the LLM naturally reaches for the DB first (no
   confirmation) and only escalates to a specialist (confirmation
   required) when the DB has no match or the user asks for fresh
   research.

Each wrapper takes a single `query` string, forwards to the specialist's
`.arun(query)`, and returns the specialist's textual output. The
specialists themselves still enforce their citation / grounding rules —
this layer only decides *whether* to run them.
"""
from __future__ import annotations

from typing import Any

from agno.tools import tool

from agentic_system.agents.customs_tariff_agent.agent import customs_tariff_agent
from agentic_system.agents.export_control_agent.agent import export_control_agent
from agentic_system.agents.geopolitical_risk_agent.agent import geopolitical_risk_agent
from agentic_system.agents.regulatory_compliance_agent.agent import regulatory_compliance_agent
from agentic_system.agents.sanctions_screening_agent.agent import sanctions_screening_agent
from agentic_system.agents.trade_agreement_agent.agent import trade_agreement_agent


def _extract_text(run_output: Any) -> str:
    """Flatten a specialist run response into a plain-text summary the router
    can splice into a Teams reply. Specialists return structured content
    (Pydantic model / dict) most of the time; fall back to `str()` for
    plain-text responses."""
    if run_output is None:
        return "(No response from specialist.)"
    content = getattr(run_output, "content", None) or getattr(run_output, "output", None) or run_output
    if hasattr(content, "model_dump_json"):
        return content.model_dump_json(indent=2)
    if isinstance(content, (dict, list)):
        import json
        return json.dumps(content, indent=2, default=str)
    return str(content)


@tool(
    name="consult_sanctions_screening",
    description=(
        "Run a FRESH sanctions research call — OFAC SDN, BIS Entity List, "
        "EU consolidated sanctions, UN sanctions. Costs money and takes "
        "10-60 seconds. Use only when `search_findings` has no relevant "
        "hit OR the user explicitly asks for the latest research. Pass a "
        "sharpened query with country, entity, or list name."
    ),
    requires_confirmation=True,
)
async def consult_sanctions_screening(query: str) -> str:
    run = await sanctions_screening_agent.arun(query)
    return _extract_text(run)


@tool(
    name="consult_export_control",
    description=(
        "Run a FRESH export-control research call — EAR / ITAR / dual-use "
        "ECCNs, licensing requirements, Wassenaar controls. Costs money "
        "and 10-60 seconds. Use only when `search_findings` has nothing "
        "relevant OR the user asks for the latest."
    ),
    requires_confirmation=True,
)
async def consult_export_control(query: str) -> str:
    run = await export_control_agent.arun(query)
    return _extract_text(run)


@tool(
    name="consult_regulatory_compliance",
    description=(
        "Run a FRESH product-regulation research call — REACH, CPSC, "
        "chemical / labelling / product-safety rules, recalls. Costs "
        "money and 10-60 seconds. Use only after `search_findings` fails "
        "OR the user asks for the latest."
    ),
    requires_confirmation=True,
)
async def consult_regulatory_compliance(query: str) -> str:
    run = await regulatory_compliance_agent.arun(query)
    return _extract_text(run)


@tool(
    name="consult_customs_tariff",
    description=(
        "Run a FRESH customs / tariff research call — HS / HTS classifications, "
        "Section 301, MFN vs preferential rates, duty changes. Costs money and "
        "10-60 seconds. Use only after `search_findings` fails OR the user asks "
        "for the latest."
    ),
    requires_confirmation=True,
)
async def consult_customs_tariff(query: str) -> str:
    run = await customs_tariff_agent.arun(query)
    return _extract_text(run)


@tool(
    name="consult_trade_agreement",
    description=(
        "Run a FRESH trade-agreement research call — FTAs, rules of origin, "
        "preferential rates. Costs money and 10-60 seconds. Use only after "
        "`search_findings` fails OR the user asks for the latest."
    ),
    requires_confirmation=True,
)
async def consult_trade_agreement(query: str) -> str:
    run = await trade_agreement_agent.arun(query)
    return _extract_text(run)


@tool(
    name="consult_geopolitical_risk",
    description=(
        "Run a FRESH geopolitical / logistics-risk research call — shipping "
        "lane disruptions, port strikes, conflict zones, protests. Costs "
        "money and 10-60 seconds. Use only after `search_findings` fails "
        "OR the user asks for the latest."
    ),
    requires_confirmation=True,
)
async def consult_geopolitical_risk(query: str) -> str:
    run = await geopolitical_risk_agent.arun(query)
    return _extract_text(run)


SPECIALIST_TOOLS = [
    consult_sanctions_screening,
    consult_export_control,
    consult_regulatory_compliance,
    consult_customs_tariff,
    consult_trade_agreement,
    consult_geopolitical_risk,
]
