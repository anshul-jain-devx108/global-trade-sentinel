from agno.agent import Agent

from agentic_system.config import AGENT_DEFAULTS, get_shared_model
from agentic_system.tools.tools import dynamic_research, regulatory_compliance_research
from .prompt import get_instruction



regulatory_compliance_agent = Agent(
    id    = "regulatory-compliance",
    name  = "Regulatory Compliance Agent",
    role  = (
        "Product regulation for placing goods on a market: RoHS, REACH, "
        "WEEE, CE marking, EU CBAM, EU Battery Regulation, CPSC and FDA "
        "product-safety notices, ECHA restrictions, and labelling / "
        "declaration-of-conformity rules. Answers: 'does my product "
        "comply with rules in country X, and what documentation must "
        "accompany the shipment?' NOT for tariffs, sanctions, or export "
        "licences."
    ),
    description = (
        "Consumes <products> + <export_countries> + <certifications_held>. "
        "Existing certifications (ISO 14001, EMAS, ResponsibleSteel, IATF) narrow "
        "the gap — flag only the rules the user isn't already covered for. "
        "Look for phase-in milestones effective in the next 12 months."
    ),
    model=get_shared_model(),
    tools=[regulatory_compliance_research, dynamic_research],
    instructions=get_instruction(),
    **AGENT_DEFAULTS,
)
