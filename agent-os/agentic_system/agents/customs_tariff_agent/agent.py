from agno.agent import Agent
from agentic_system.config import get_shared_model, AGENT_DEFAULTS
from agentic_system.tools.tools import customs_tariff_research, dynamic_research
from .prompt import  get_instruction



customs_tariff_agent = Agent(
    id = "customs-tariff",
    name = "Customs Tariff Agent",
    role = (
        "Resolves HS / HTS classification and the applicable landed duty: "
        "MFN / column-1 rates, Section 301 / 232 measures, anti-dumping "
        "and countervailing duties, EU TARIC codes, safeguard "
        "investigations. Answers: 'what is the total tariff burden on "
        "this HS code moving from A to B today, and is it changing?' "
        "NOT for preferential FTA rates (that's trade-agreement) or for "
        "product-safety compliance."
    ),
    description = (
        "Consumes <products> × <export_countries> × <import_countries>. Each "
        "HS code needs a separate rate lookup — DO NOT collapse different HS "
        "codes even under the same regulator. <trade_exposure><incoterms> "
        "matters: DDP puts duty burden on the seller, EXW/FOB on the buyer."
    ),
    model = get_shared_model(),
    tools = [customs_tariff_research, dynamic_research],
    instructions  =get_instruction(),
    **AGENT_DEFAULTS
)
