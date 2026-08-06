"""Registry of the six trade-compliance specialist agents.

Keyed by the canonical kebab-case id the frontend consumes. Any router
that needs to look up an Agno agent by API id imports from here.
"""
from typing import Dict

import agentic_system.config.config as CFG
from agentic_system.agents import (
    customs_tariff_agent,
    export_control_agent,
    geopolitical_risk_agent,
    regulatory_compliance_agent,
    sanctions_screening_agent,
    trade_agreement_agent,
)


SPECIALIST_AGENTS: Dict[str, object] = {
    CFG.SPECIALIST_IDS["sanctions_screening"]:    sanctions_screening_agent,
    CFG.SPECIALIST_IDS["export_control"]:         export_control_agent,
    CFG.SPECIALIST_IDS["regulatory_compliance"]:  regulatory_compliance_agent,
    CFG.SPECIALIST_IDS["customs_tariff"]:         customs_tariff_agent,
    CFG.SPECIALIST_IDS["trade_agreement"]:        trade_agreement_agent,
    CFG.SPECIALIST_IDS["geopolitical_risk"]:      geopolitical_risk_agent,
}
