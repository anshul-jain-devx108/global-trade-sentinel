"""Pydantic request/response schemas for the GTS HTTP API.

All API-boundary types live here so routers stay focused on wiring
and services stay framework-agnostic.
"""
from typing import List, Optional

from pydantic import BaseModel


# ─── Specialist / agent runs ─────────────────────────────────────────

class AgentRunRequest(BaseModel):
    query: str


# ─── Sweep ───────────────────────────────────────────────────────────

class SweepRequest(BaseModel):
    query: str
    company: Optional[str] = None
    # If true and a stored profile exists, GTS will merge it into the sweep prompt.
    use_profile: bool = True


# ─── Company profile ─────────────────────────────────────────────────

class ProductIn(BaseModel):
    name: str
    description: Optional[str] = None
    hs_code: Optional[str] = None
    # Export-control classification (ECCN / USML / EU dual-use / "EAR99" / "unknown").
    # Biggest single unlock for the export-control specialist.
    eccn: Optional[str] = None


class CompanyProfileIn(BaseModel):
    company_name: str
    industry: Optional[str] = None
    business_type: Optional[str] = None
    business_overview: Optional[str] = None
    export_countries: Optional[List[str]] = None
    import_countries: Optional[List[str]] = None
    monitor_countries: Optional[List[str]] = None
    certifications: Optional[List[str]] = None
    monitoring_preferences: Optional[List[str]] = None
    top_suppliers: Optional[List[str]] = None
    additional_context: Optional[str] = None
    # ── Tier-A trade-exposure fields (added 2026-07-31)
    # Incoterms 2020 the company operates under (e.g. ["DDP","FOB"]).
    incoterms: Optional[List[str]] = None
    # Annual volume tier — "<1M" | "1-10M" | "10-100M" | "100M+" | None.
    volume_tier: Optional[str] = None
    # End-use / end-user category — "commercial" | "military" | "government"
    # | "state_owned" | "research" | "consumer" | "mixed" | None.
    end_use_category: Optional[str] = None
    products: List[ProductIn] = []


class CompanyProfileOut(CompanyProfileIn):
    id: int


# ─── Onboarding copilot ──────────────────────────────────────────────

class QuestionsRequest(BaseModel):
    profile: CompanyProfileIn


class QAItem(BaseModel):
    question: str
    answer: str


class EnrichRequest(BaseModel):
    profile: CompanyProfileIn
    answers: List[QAItem]


# ─── Events ──────────────────────────────────────────────────────────

class StatusUpdate(BaseModel):
    status: str


# ─── Schedule ────────────────────────────────────────────────────────

class ScheduleUpdate(BaseModel):
    preset: str  # "manual" | "daily" | "weekly" | "monthly"
