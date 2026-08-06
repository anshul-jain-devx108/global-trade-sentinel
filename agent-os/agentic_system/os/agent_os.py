"""AgentOS assembly.

Exposes a `build_agent_os(base_app)` factory instead of a module-level
singleton so `main.py` can:

  1. Create its own FastAPI app,
  2. Attach CORS + `/gts/*` routers,
  3. THEN hand the app to AgentOS via `base_app=...`.

This is the recommended AgentOS integration pattern
(https://docs.agno.com/agent-os/custom-fastapi/overview) — AgentOS
adds its ~86 built-in routes to the supplied app in place, so we end
up with one FastAPI instance carrying both surfaces.

`agno_schedule_db` is exposed here as a convenience — main.py + the
schedule router both need to point the ScheduleManager at the SAME DB
the SchedulePoller reads from.
"""
import logging
import os
from typing import TYPE_CHECKING

from agno.os.app import AgentOS
from agno.os.interfaces.slack import Slack

import agentic_system.config.config as CFG
from agentic_system.agents import (
    ask_sentinel_agent,
    customs_tariff_agent,
    export_control_agent,
    geopolitical_risk_agent,
    regulatory_compliance_agent,
    sanctions_screening_agent,
    trade_agreement_agent,
)
from agentic_system.teams import sweep_team
from core.database import db
from msteams import MicrosoftTeams

if TYPE_CHECKING:
    from fastapi import FastAPI

# The Agno framework poller reads schedules from this DB. main.py's
# ScheduleManager MUST write to the same instance, hence the re-export.
agno_schedule_db = db

# Teams + Slack both bind to the router agent; sweep_team is cron-only.
teams_interface = MicrosoftTeams(agent=ask_sentinel_agent, prefix="/msteams")

# Slack shares the SAME router agent as Teams — one prompt, one DB-first
# policy, one specialist tool set. Agno's Slack interface handles inbound
# signature verification, event dispatch, and HITL Block Kit cards natively
# (no vendoring — unlike msteams/, which is PR #9307 not yet merged).
#
# Loaded lazily: Agno's SlackTools raises `ValueError: SLACK_TOKEN is not
# set` at get_router() time if the env var is missing. That would block
# boot during Slack App portal setup (scopes/events need a running service
# to verify the URL, but the bot token only exists AFTER install-to-
# workspace). Gate on env — service boots fine without Slack, and a
# `.env` refresh + restart activates it later.
_INTERFACES: list = [teams_interface]
if os.getenv("SLACK_TOKEN") or os.getenv("SLACK_BOT_TOKEN"):
    _INTERFACES.append(Slack(agent=ask_sentinel_agent, prefix="/slack"))
else:
    logging.getLogger("gts.boot").info(
        "Slack interface skipped — SLACK_TOKEN not set. Add it to .env "
        "and restart to enable the /slack/* routes."
    )


def build_agent_os(base_app: "FastAPI") -> AgentOS:
    """Attach the AgentOS surface to the given FastAPI app.

    `base_app` is mutated in place — AgentOS adds its ~86 built-in
    routes to it. The returned `AgentOS` instance is what main.py hands
    to `agent_os.serve(...)`; nothing else needs to touch it.
    """
    return AgentOS(
        name=CFG.AGENT_OS_NAME,
        db=db,
        agents=[
            ask_sentinel_agent,
            sanctions_screening_agent,
            export_control_agent,
            regulatory_compliance_agent,
            customs_tariff_agent,
            trade_agreement_agent,
            geopolitical_risk_agent,
        ],
        teams=[sweep_team],
        workflows=[],
        interfaces=_INTERFACES,
        auto_provision_dbs=True,
        scheduler=True,
        scheduler_base_url=CFG.SCHEDULER_BASE_URL,
        scheduler_poll_interval=CFG.SCHEDULER_POLL_INTERVAL_SECONDS,
        internal_service_token=CFG.INTERNAL_SERVICE_TOKEN,
        base_app=base_app,
        on_route_conflict="preserve_agentos",
    )
