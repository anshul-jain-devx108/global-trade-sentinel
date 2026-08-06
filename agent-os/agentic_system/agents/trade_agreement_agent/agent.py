from agno.agent import Agent
from agentic_system.config import get_shared_model, AGENT_DEFAULTS
from agentic_system.tools.tools import trade_agreement_research, dynamic_research
from .prompt import get_instruction
trade_agreement_agent = Agent(
    id = "trade-agreement",
    name = "Trade Agreement Agent",
    role = (
        "Preferential-trade specialist: FTAs, EPAs, GSP schemes, USMCA, "
        "CPTPP, EU-UK TCA, ASEAN agreements. Determines rules of origin, "
        "regional value content, tariff-preference eligibility, and "
        "certificate-of-origin requirements. Answers: 'does my product "
        "qualify for a preferential rate under agreement X, and what "
        "documentation do I need?' NOT for MFN duty rates or anti-dumping "
        "(those go to customs-tariff)."
    ),
    description = (
        "Consumes country pairs from <export_countries> × <import_countries> "
        "along with <products> for HS-code-specific rules of origin. Skip if "
        "<export_countries> is empty. Prefer newly-in-force / recently-amended "
        "agreements — a preference that's been steady for years isn't news."
    ),
    model=get_shared_model(),
    tools=[trade_agreement_research, dynamic_research],
    instructions=get_instruction(),
    **AGENT_DEFAULTS
)
