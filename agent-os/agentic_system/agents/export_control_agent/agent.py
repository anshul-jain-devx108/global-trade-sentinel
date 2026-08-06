from agno.agent import Agent
from agentic_system.config import AGENT_DEFAULTS, get_shared_model
from agentic_system.tools.tools import dynamic_research, export_control_research
from .prompt import get_instruction


export_control_agent = Agent(
    id = "export-control",
    name = "Export Control Agent",
    role = (
        "Classifies dual-use and defence items under EAR (ECCN), ITAR "
        "(USML), EU dual-use Regulation 2021/821 and the Wassenaar list. "
        "Answers: 'do I need a licence to ship X from country A to "
        "country B, and which one?' Covers deemed exports, re-exports, "
        "end-use / end-user restrictions. NOT for sanctions party "
        "screening — that goes to sanctions-screening."
    ),
    description = (
        "Consumes <products> (esp. the eccn attribute) + <export_countries> + "
        "<trade_exposure><end_use_category>. Cross-checks each <product> against "
        "controlled-technology thresholds; end-use=government or military triggers "
        "EAR §744.11 review. Skip if no dual-use-adjacent product signal."
    ),
    model=get_shared_model(),
    tools=[export_control_research, dynamic_research],
    instructions= get_instruction(),
    **AGENT_DEFAULTS,
)
