from agno.team import Team
from agno.team.mode import TeamMode
from agentic_system.config import get_shared_model,AGENT_DEFAULTS

from agentic_system.agents.sanctions_screening_agent.agent import sanctions_screening_agent
from agentic_system.agents.export_control_agent.agent import export_control_agent
from agentic_system.agents.regulatory_compliance_agent.agent import regulatory_compliance_agent
from agentic_system.agents.customs_tariff_agent.agent import customs_tariff_agent
from agentic_system.agents.trade_agreement_agent.agent import trade_agreement_agent
from agentic_system.agents.geopolitical_risk_agent.agent import geopolitical_risk_agent

from agentic_system.teams.sweep_team.prompt import get_instruction
from .schema import SweepReportModel


debug = AGENT_DEFAULTS.get("debug_mode", False)

sweep_team = Team(
    id = "sweep-leader",
    name = "Global Trade Sweep Team",
    role = (
        "Leads six trade-compliance specialists. Reads the user's "
        "XML-tagged company profile (products, HS codes, countries, "
        "suppliers, trade exposure), delegates each block VERBATIM to "
        "the right specialist, aggregates their findings, runs a "
        "semantic-dedupe + grounding + recency self-review, and emits "
        "a SweepReportModel with up to 10 events plus one agent_reports "
        "row per specialist. Does NOT do primary research — trusts each "
        "specialist's citations verbatim."
    ),
    mode = TeamMode.coordinate,
    model=get_shared_model(),
    members=[
        sanctions_screening_agent,
        export_control_agent,
        regulatory_compliance_agent,
        customs_tariff_agent,
        trade_agreement_agent,
        geopolitical_risk_agent
    ],
    instructions=get_instruction(),
    output_schema=SweepReportModel,
    debug_mode=debug,
    add_datetime_to_context=AGENT_DEFAULTS.get("add_datetime_to_context", True)
)
