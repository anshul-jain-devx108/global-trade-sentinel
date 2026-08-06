from agno.agent import Agent
from agentic_system.config import get_shared_model

# Intentionally NOT registered in AgentOS / agents/__init__.py.
# This agent is used only by the onboarding enrichment service.
# It is a pure-reasoning, stateless agent with no web tools —
# the opposite of a research specialist — so it must not appear
# in the sweep team or the AgentOS agent list.
onboarding_copilot = Agent(
    id="onboarding-copilot",
    name="Onboarding Copilot",
    role="Trade compliance consultant that generates clarifying questions and enriched context. No web tools.",
    model=get_shared_model(has_tools=False),
    tools=[],                      # No research — pure reasoning over the profile payload
    add_history_to_context=False,  # Stateless — each call is independent
    update_memory_on_run=False,
    markdown=False,                # Enrichment service expects plain text, not markdown
    add_datetime_to_context=False,
)
