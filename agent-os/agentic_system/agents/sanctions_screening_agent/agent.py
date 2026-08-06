from agno.agent import Agent
from agentic_system.config import  AGENT_DEFAULTS, get_shared_model
from agentic_system.tools.tools import dynamic_research, sanctions_research
from .prompt import get_instruction


sanctions_screening_agent = Agent(
    id = "sanctions-screening",
    name = "Sanctions Screening Agent",
    role = (
        "Screens counterparties, banks, vessels, and end-users against "
        "SDN, SSI, BIS Entity List, EU consolidated list, UN Consolidated "
        "Sanctions and UK OFSI. Answers: 'is this party sanctioned right "
        "now, and what triggered the listing?' NOT for tariff rates, "
        "export licences, or product-safety rules — those go to customs, "
        "export-control, or regulatory-compliance respectively."
    ),
    description = (
        "Primary input: <top_suppliers> tag (batch ALL suppliers in ONE call). "
        "Secondary sweep: additions to OFAC / BIS / EU / UN / UK OFSI in the "
        "last 30 days that touch <import_countries> or <monitor_countries>. "
        "Uses ownership 50%-rule + Russia-related restrictions when signalled "
        "by <enriched_context>. Max 3 findings, one per entity."
    ),
    model=get_shared_model(),
    tools=[sanctions_research, dynamic_research],
    instructions= get_instruction(),
    **AGENT_DEFAULTS,
)
