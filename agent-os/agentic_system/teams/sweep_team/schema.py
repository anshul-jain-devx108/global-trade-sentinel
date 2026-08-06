from pydantic import BaseModel, Field
from typing import List, Optional

class CitationModel(BaseModel):
    title: str
    url: str

class RegulatoryEventModel(BaseModel):
    event_type: str = Field(..., description="One of: TARIFF, SANCTION, REGULATORY, EXPORT_CONTROL, GEO_RISK, TRADE_AGREEMENT")
    severity: str = Field(..., description="One of: CRITICAL, WARNING, INFO")
    title: str
    jurisdiction: str = Field(..., description="Regulator or country, e.g. 'United States — OFAC' or 'European Union'")

    # Explicit date semantics. All three are optional but at least ONE must be
    # provided (leader instructions enforce this). Use YYYY-MM-DD.
    published_at:    Optional[str] = Field(None, description="Date the regulation/sanction was ANNOUNCED (YYYY-MM-DD). E.g. Federal Register publication date.")
    effective_from:  Optional[str] = Field(None, description="Date the rule TAKES FORCE (YYYY-MM-DD). Often different from published_at.")
    effective_until: Optional[str] = Field(None, description="Expiry date if the measure is temporary (YYYY-MM-DD). Null for open-ended rules.")

    description: str
    impact:      str
    affected_entities: List[str] = Field(default_factory=list)
    citations:         List[CitationModel] = Field(default_factory=list)

class AgentReportModel(BaseModel):
    """Per-specialist status telemetry — populated by the team leader in the
    self-review pass. This is diagnostic metadata for the UI, NOT part of the
    events list. Additive to the schema — old consumers that ignore unknown
    fields keep working."""
    agent_id: str = Field(..., description="Stable specialist id, e.g. 'sanctions-screening' or 'sanctions_screening_agent'.")
    findings_count: int = Field(0, description="Number of events this specialist emitted BEFORE leader-side dedupe.")
    status: str = Field(..., description="One of: success | no_data | rate_limited | error. success => found and emitted events. no_data => searched honestly and found nothing. rate_limited => hit tool_call_limit before completing. error => the specialist raised.")
    note: Optional[str] = Field(None, description="Free-text detail — e.g. 'CATL, BYD, LG, Panasonic, Umicore all clean' or '429 on first call, retried with narrower filter'.")


class SweepReportModel(BaseModel):
    events: List[RegulatoryEventModel]
    # Defaults to empty list so old sweeps that predate this field parse cleanly.
    # Team leader is instructed to always populate one entry per member.
    agent_reports: List[AgentReportModel] = Field(default_factory=list)