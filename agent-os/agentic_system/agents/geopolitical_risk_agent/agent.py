from agno.agent import Agent
from agentic_system.config import get_shared_model,AGENT_DEFAULTS
from agentic_system.tools.tools import geopolitical_research, dynamic_research
from .prompt import get_instruction

geopolitical_risk_agent = Agent(
    id = "geopolitical-risk",
    name = "Geopolitical Risk Agent",
    role = (
        "Monitors physical + policy trade disruptions: shipping-lane "
        "closures (Suez, Panama, Bab-el-Mandeb, Hormuz, Malacca), port "
        "strikes, war-risk zone expansions, coup / regime-change impacts "
        "on trade, sudden new-country embargoes announced by executive "
        "order. Answers: 'is my Asia-Europe lane at risk this week, and "
        "should I reroute or hedge?' NOT for existing legal sanctions "
        "regimes (those go to sanctions-screening)."
    ),
    description = (
        "Consumes <import_countries> + <export_countries> + <top_suppliers>. "
        "Prioritises the last 30-60 days of trade-route incidents — port "
        "strikes, war-risk zone widenings, canal transit-time changes. Skip "
        "if both <import_countries> and <export_countries> are empty."
    ),
    model = get_shared_model(),
    tools = [geopolitical_research, dynamic_research],
    instructions = get_instruction(),
    **AGENT_DEFAULTS
)
