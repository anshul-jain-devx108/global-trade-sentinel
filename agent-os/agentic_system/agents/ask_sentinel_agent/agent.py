"""Ask Sentinel — the router agent bound to Teams, Slack, and web chat.

Compliance officers talk to *this* agent across all three surfaces. Its
tool inventory is in two tiers:

1. **`search_findings`** — free, fast, no confirmation. Queries the DB of
   already-researched regulatory events. This is what the router should
   reach for FIRST on any compliance question.

2. **Six `consult_<specialist>` wrappers** — every one gated with
   `requires_confirmation=True`. Firing one triggers a paused-run event
   that the MicrosoftTeams webhook turns into an Adaptive Card with
   Approve / Reject buttons. Only fires after the DB lookup came up dry
   or the user explicitly asked for fresh research.

The specialists themselves are still registered on AgentOS separately
(for scheduled sweeps + the /agents/<id>/runs endpoint) — this file only
consumes them through the approval-gated wrappers.
"""
from agno.agent import Agent

from agentic_system.config import AGENT_DEFAULTS, get_shared_model
from agentic_system.tools.findings_lookup import search_findings
from agentic_system.tools.youcom import YouContentsTools, YouTools

from core.database import db

from .prompt import get_instruction
from .specialist_tools import SPECIALIST_TOOLS


# You.com "assist" tier — cheap tools Sentinel uses to enrich a DB-hit answer
# when the user follows up ("what does that citation actually say?", "any
# newer coverage of this?"). These are NOT primary research — that's what the
# `consult_<specialist>` team is for. See prompt.py for the routing rules.
#
# - YouTools.you_search    → light web search, 5 results, snippet only
# - YouContentsTools.you_contents → fetch full readable content of a URL
_you_search = YouTools(
    num_results=5,
    text_length_limit=800,
    format="json",
)
_you_contents = YouContentsTools(
    formats=["markdown", "metadata"],
    text_length_limit=3000,
    format="json",
)

_ASK_SENTINEL_DEFAULTS = {
    **AGENT_DEFAULTS,
    # Ask Sentinel is a conversational router — follow-ups like "read
    # that citation", "anything newer?", "elaborate on point 2" only
    # make sense with the previous turns in context. Specialists +
    # sweep-leader stay history-off (each run is independent research).
    "add_history_to_context": True,
    "num_history_runs": 6,
}

ask_sentinel_agent = Agent(
    id="ask-sentinel",
    name="Ask Sentinel",
    # `role` is Agno-injected into the system prompt as `<your_role>...</your_role>`.
    # For a standalone agent (no team parent) this is the tightest identity slot.
    # `description` is NOT set — on a standalone agent it dumps as raw text at
    # the top of the prompt without a tag, producing duplication. The full
    # three-tier behavior lives in prompt.py alone.
    role=(
        "Trade-compliance concierge in Teams, Slack, and the web app. "
        "Answers DB-first from the pre-researched findings table; enriches "
        "with You.com when the user follows up on a citation; escalates to "
        "one of six domain specialists (HITL-gated) only when the DB is empty."
    ),
    model=get_shared_model(has_tools=False),
    tools=[
        search_findings,
        _you_search,
        _you_contents,
        *SPECIALIST_TOOLS,
    ],
    instructions=get_instruction(),
    db=db,
    **_ASK_SENTINEL_DEFAULTS,
)
