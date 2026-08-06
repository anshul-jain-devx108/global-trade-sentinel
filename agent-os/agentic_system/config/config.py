"""Centralized configuration for the GTS backend.

Two buckets:

  1. ENV BUCKET — secrets + per-environment infra. Read from `.env` /
     process env. Never commit values. Represented as module-level
     constants named `*_ENV` or plain uppercase names that mirror the
     env var 1:1 (PORT, HOST, DATABASE_URL, …).

  2. POLICY BUCKET — code-adjacent defaults that operators tune per
     deployment via env overrides but ship with sensible defaults
     (timeouts, limits, cron expressions, agent behaviour flags).

Anything structural that doesn't change between deployments (agent id
strings, table names, enum values) lives here too so a rename touches
one file.
"""
import os
from typing import Dict, FrozenSet, List, Optional

from core.logging_config import agno_debug_enabled


# ─── helpers ────────────────────────────────────────────────────────

def _env_bool(name: str, default: bool = False) -> bool:
    raw = os.getenv(name)
    if raw is None:
        return default
    return raw.strip().lower() in {"1", "true", "yes", "on"}


def _env_int(name: str, default: int) -> int:
    raw = os.getenv(name)
    if raw is None or not raw.strip():
        return default
    try:
        return int(raw)
    except ValueError:
        return default


def _env_csv(name: str, default: str) -> List[str]:
    raw = os.getenv(name, default)
    return [p.strip() for p in raw.split(",") if p.strip()]


# ─── Environment profile ────────────────────────────────────────────
ENVIRONMENT = os.getenv("ENVIRONMENT", "DEVELOPMENT").upper()
IS_DEVELOPMENT = ENVIRONMENT == "DEVELOPMENT"

DEBUG_MODE = agno_debug_enabled()


# ─── Network / FastAPI ──────────────────────────────────────────────
HOST = os.getenv("HOST", "0.0.0.0")
PORT = _env_int("PORT", 8000)
RELOAD = _env_bool("RELOAD", IS_DEVELOPMENT)

CORS_ORIGINS = _env_csv(
    "CORS_ORIGINS",
    "http://localhost:5173,http://localhost:3000,https://os.agno.com",
)

APP_TITLE = os.getenv("APP_TITLE", "GTS Service")


# ─── Database ───────────────────────────────────────────────────────
# `DATABASE_URL` takes precedence when set (Azure SQL / Postgres). If
# absent, we fall back to a local SQLite file whose path is `DB_PATH`.
DB_PATH = os.getenv("DB_PATH", "data/gts.db")
DATABASE_URL = os.getenv("DATABASE_URL") or f"sqlite:///./{DB_PATH}"

# Agno framework table names.
AGNO_SESSION_TABLE = os.getenv("AGNO_SESSION_TABLE", "sessions")
AGNO_MEMORY_TABLE = os.getenv("AGNO_MEMORY_TABLE", "memories")


# ─── LLM / model ────────────────────────────────────────────────────
MODEL_ID = os.getenv("MODEL_ID", "gpt-4o-mini")

OPENAI_API_KEY = os.getenv("OPENAI_API_KEY")
AZURE_API_KEY = os.getenv("Azure_API_KEY") or os.getenv("AZURE_API_KEY")
AZURE_ENDPOINT = os.getenv("Azure_ENDPOINT") or os.getenv("AZURE_ENDPOINT")
AZURE_API_VERSION = os.getenv("Azure_API_VERSION") or os.getenv(
    "AZURE_API_VERSION", "2024-10-21"
)

# Off by default — sequential tool execution keeps us under the You.com
# per-key rate limit and makes retries more predictable.
PARALLEL_TOOLS = _env_bool("PARALLEL_TOOLS", False)


# ─── You.com research API ───────────────────────────────────────────
YDC_API_KEY = os.getenv("YDC_API_KEY")

YOUCOM_RESEARCH_EFFORT = os.getenv("YOUCOM_RESEARCH_EFFORT", "exhaustive")
YOUCOM_RESEARCH_TIMEOUT_SECONDS = _env_int("YOUCOM_RESEARCH_TIMEOUT_SECONDS", 500)


# ─── Scheduler / AgentOS ────────────────────────────────────────────
AGENT_OS_NAME = os.getenv("AGENT_OS_NAME", "Trade Sentinel OS")

SCHEDULER_BASE_URL = os.getenv("SCHEDULER_BASE_URL", f"http://127.0.0.1:{PORT}")
SCHEDULER_POLL_INTERVAL_SECONDS = _env_int("SCHEDULER_POLL_INTERVAL_SECONDS", 15)
SCHEDULE_TIMEZONE = os.getenv("SCHEDULE_TIMEZONE", "UTC")

INTERNAL_SERVICE_TOKEN = os.getenv("GTS_INTERNAL_SERVICE_TOKEN", "gts-internal-token")

DEFAULT_SCHEDULE_PRESET = os.getenv("GTS_SCHEDULE", "manual")

SCHEDULE_NAME = "gts-sweep"
CRON_SWEEP_ENDPOINT = "/api/v1/gts/sweep/cron"
CRON_SWEEP_METHOD = "POST"

# Cron expressions per preset. 06:00 in the scheduler timezone.
PRESET_TO_CRON: Dict[str, str] = {
    "daily":   "0 6 * * *",
    "weekly":  "0 6 * * 1",
    "monthly": "0 6 1 * *",
}
CRON_TO_PRESET: Dict[str, str] = {cron: preset for preset, cron in PRESET_TO_CRON.items()}
VALID_SCHEDULE_PRESETS = {"manual", *PRESET_TO_CRON.keys()}


# ─── Events / pagination ────────────────────────────────────────────
EVENTS_LIST_DEFAULT_LIMIT = _env_int("EVENTS_LIST_DEFAULT_LIMIT", 25)
EVENTS_LIST_MAX_LIMIT = _env_int("EVENTS_LIST_MAX_LIMIT", 100)

EVENT_STATUSES = {"NEW", "ACKNOWLEDGED", "DISMISSED"}
ALLOWED_SORT = {"effective_from", "published_at", "detected_at", "severity"}

EVENT_ID_PREFIX = "EVT-"
EVENT_ID_HEX_LEN = 8
TASK_ID_HEX_LEN = 12
DEDUPE_HASH_HEX_LEN = 24


# ─── Specialist agent ids ───────────────────────────────────────────
# Canonical kebab-case ids the frontend consumes. Alias map covers
# alternative ids Agno may emit for the same member.
SPECIALIST_IDS = {
    "sanctions_screening":    "sanctions-screening",
    "export_control":         "export-control",
    "regulatory_compliance":  "regulatory-compliance",
    "customs_tariff":         "customs-tariff",
    "trade_agreement":        "trade-agreement",
    "geopolitical_risk":      "geopolitical-risk",
}


# ─── Per-specialist freshness windows ───────────────────────────────
# Recency window each specialist trusts for its authoritative feeds.
# Regulatory / sanctions / tariff feeds move monthly; geopolitical
# events daily/weekly.
SPECIALIST_FRESHNESS: Dict[str, str] = {
    "sanctions":       os.getenv("SPECIALIST_FRESHNESS_SANCTIONS",       "month"),
    "export_control":  os.getenv("SPECIALIST_FRESHNESS_EXPORT_CONTROL",  "month"),
    "regulatory":      os.getenv("SPECIALIST_FRESHNESS_REGULATORY",      "month"),
    "customs_tariff":  os.getenv("SPECIALIST_FRESHNESS_CUSTOMS_TARIFF",  "month"),
    "trade_agreement": os.getenv("SPECIALIST_FRESHNESS_TRADE_AGREEMENT", "month"),
    "geopolitical":    os.getenv("SPECIALIST_FRESHNESS_GEOPOLITICAL",    "week"),
}


# ─── You.com supported countries ────────────────────────────────────
# The You.com Research API validates its `source_control.country` field
# against this exact closed set of ISO 3166-1 alpha-2 codes. Any other
# value — supranational region (EU, ASEAN), 3-letter code (DEU), full
# name (Germany), or an alpha-2 code not in this set (IE, AE, IL, etc.)
# — results in a 422 that aborts the tool call. Sourced from the
# You.com API docs' country enum picker. Keep in sync if they add codes.
YOUCOM_SUPPORTED_COUNTRIES: FrozenSet[str] = frozenset({
    "AR", "AU", "AT", "BE", "BR", "CA", "CL", "CH", "CN", "DE",
    "DK", "ES", "FI", "FR", "GB", "HK", "ID", "IN", "IT", "JP",
    "KR", "MX", "MY", "NL", "NO", "NZ", "PH", "PL", "PT", "RU",
    "SA", "SE", "TR", "TW", "US", "ZA",
})


# ─── Per-specialist authoritative domain shortlists ─────────────────
# Each specialist's research tool is pre-scoped to these primary
# sources — treated as authoritative for that domain. If ops/compliance
# needs to rotate sources (add a new authoritative feed, retire a
# broken one), edit this dict. No prompt or code changes needed.
#
# Falling back to `dynamic_research` widens the search beyond these
# shortlists when a specialist wrapper returns nothing.
SPECIALIST_DOMAINS: Dict[str, List[str]] = {
    "sanctions": [
        "treasury.gov",
        "ofac.treasury.gov",
        "bis.doc.gov",
        "sanctionsmap.eu",
        "un.org",
    ],
    "export_control": [
        "bis.doc.gov",
        "gpo.gov",
        "ecfr.gov",
        "wassenaar.org",
        "trade.ec.europa.eu",
    ],
    "regulatory": [
        "eur-lex.europa.eu",
        "echa.europa.eu",
        "federalregister.gov",
        "cpsc.gov",
        "gov.uk",
    ],
    "customs_tariff": [
        "ustr.gov",
        "cbp.gov",
        "taxation-customs.ec.europa.eu",
        "hts.usitc.gov",
        "wto.org",
    ],
    "trade_agreement": [
        "wto.org",
        "commerce.gov.in",
        "trade.ec.europa.eu",
        "state.gov",
        "ustr.gov",
    ],
    "geopolitical": [
        "reuters.com",
        "reliefweb.int",
        "maritime-executive.com",
        "bloomberg.com",
        "ft.com",
    ],
}


# ─── Agent defaults ─────────────────────────────────────────────────
AGENT_TOOL_CALL_LIMIT = _env_int("AGENT_TOOL_CALL_LIMIT", 15)
AGENT_ADD_HISTORY_TO_CONTEXT = _env_bool("AGENT_ADD_HISTORY_TO_CONTEXT", False)
AGENT_UPDATE_MEMORY_ON_RUN = _env_bool("AGENT_UPDATE_MEMORY_ON_RUN", False)

# Agent Defaults — spread this into every Agent(...) constructor.
AGENT_DEFAULTS = {
    "add_history_to_context": AGENT_ADD_HISTORY_TO_CONTEXT,
    "update_memory_on_run":   AGENT_UPDATE_MEMORY_ON_RUN,
    "markdown": True,
    "debug_mode": DEBUG_MODE,
    "add_datetime_to_context": True,
    # Cap each specialist to N research calls per run — prevents fan-out
    # into 5-7 parallel You.com hits that were causing 429 rate limits.
    "tool_call_limit": AGENT_TOOL_CALL_LIMIT,
}
