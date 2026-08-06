"""Centralised logging setup for the Trade Sentinel backend.

## Philosophy

DEVELOPMENT default = signal you actually want while building:
    - FastAPI route logs (every request line)
    - Agno per-agent delegation banners
    - Our own sentinel.* at INFO
Chatty low-level stuff (SQL queries, HTTP headers) stays OFF unless you
explicitly ask for it — you shouldn't have to scroll past 200 SELECTs to
find the ONE line that matters.

PRODUCTION default = everything at WARNING except sentinel.*, which
stays at INFO for business events.

## Per-layer flags — override the default in either env

Each flag accepts truthy ("1","true","yes","on") or falsy ("0","false","no","off").
Only truthy values enable a layer; only falsy values disable it. If a flag is
unset, the env default applies.

    SENTINEL_DEBUG   Our own `sentinel.*` -> DEBUG                    (default INFO)
    AGNO_DEBUG       Agno framework + per-agent banners -> DEBUG      (default ON in dev, OFF in prod)
    FASTAPI_DEBUG    uvicorn.access + fastapi -> DEBUG                (default ON in dev, OFF in prod)
    SQL_DEBUG        SQLAlchemy engine (all queries) -> DEBUG         (default OFF)
    HTTP_DEBUG       httpx / httpcore / urllib3 -> DEBUG              (default OFF)

    DEBUG_ALL=1      Force every layer to DEBUG regardless of the individual flag.

## Examples

    # Normal dev — routes + agent delegation visible, SQL/HTTP quiet
    uvicorn main:app --reload

    # Dev but I need SQL too
    SQL_DEBUG=1 uvicorn main:app --reload

    # Dev but silence Agno's banners for a session
    AGNO_DEBUG=0 uvicorn main:app --reload

    # Prod — quiet, only sentinel.* + errors
    ENVIRONMENT=PRODUCTION uvicorn main:app

    # Prod but a bug happened, need everything on for one run
    ENVIRONMENT=PRODUCTION DEBUG_ALL=1 uvicorn main:app

## Fine-grained overrides

    LOG_FORMAT       "text" (default) or "json"
    LOG_FILE         file path (default agent-os/core/logs/sentinel.log); "-" disables file
    LOG_MAX_MB       rotation size, default 10
    LOG_BACKUPS      how many rotated files to keep, default 5

Called from main.py near the top, BEFORE other imports that may log on
load (agno, sqlalchemy, agent_os).
"""
from __future__ import annotations

import json
import logging
import logging.handlers
import os
import sys
from pathlib import Path


# ─── Formatters ──────────────────────────────────────────────────────

_ANSI = {
    "DEBUG":    "\033[38;5;244m",   # dim grey
    "INFO":     "\033[38;5;39m",    # blue
    "WARNING":  "\033[38;5;214m",   # orange
    "ERROR":    "\033[38;5;196m",   # red
    "CRITICAL": "\033[48;5;196m\033[97m",  # white on red
}
_ANSI_RESET = "\033[0m"


class HumanConsoleFormatter(logging.Formatter):
    """Compact, human-readable console formatter.

    Format:
        HH:MM:SS.mmm  LEVEL  logger.name  message
    Coloured when stderr is a TTY.
    """

    def __init__(self, *, use_color: bool):
        super().__init__(fmt="%(asctime)s.%(msecs)03d  %(levelname)-7s  %(name)s  %(message)s",
                         datefmt="%H:%M:%S")
        self._use_color = use_color

    def format(self, record: logging.LogRecord) -> str:
        base = super().format(record)
        if not self._use_color:
            return base
        colour = _ANSI.get(record.levelname, "")
        if not colour:
            return base
        return f"{colour}{base}{_ANSI_RESET}"


class JsonFormatter(logging.Formatter):
    """One-line-per-record JSON, suitable for log aggregation."""

    _STD_KEYS = {
        "name", "msg", "args", "levelname", "levelno", "pathname", "filename",
        "module", "exc_info", "exc_text", "stack_info", "lineno", "funcName",
        "created", "msecs", "relativeCreated", "thread", "threadName",
        "processName", "process", "message", "asctime", "taskName",
    }

    def _skip_extra(self, key: str, value) -> bool:
        return key in self._STD_KEYS or key.startswith("_") or value is None

    def format(self, record: logging.LogRecord) -> str:
        payload = {
            "ts":     self.formatTime(record, "%Y-%m-%dT%H:%M:%S"),
            "level":  record.levelname,
            "logger": record.name,
            "msg":    record.getMessage(),
        }
        if record.exc_info:
            payload["exc"] = self.formatException(record.exc_info)
        for key, value in record.__dict__.items():
            if self._skip_extra(key, value):
                continue
            try:
                json.dumps(value)
                payload[key] = value
            except (TypeError, ValueError):
                payload[key] = repr(value)
        return json.dumps(payload, ensure_ascii=False)


# ─── Config ──────────────────────────────────────────────────────────

_CONFIGURED = False

_TRUTHY = {"1", "true", "yes", "on"}
_FALSY  = {"0", "false", "no", "off"}


def _tri_flag(name: str) -> bool | None:
    """Read a tri-state env flag.

    Returns True  if the env var is set to a truthy string,
            False if it's set to a falsy string,
            None  if it's unset or malformed (caller uses env default).
    """
    raw = os.getenv(name)
    if raw is None:
        return None
    v = raw.strip().lower()
    if v in _TRUTHY:
        return True
    if v in _FALSY:
        return False
    return None


def _resolve(flag_name: str, dev_default: bool, is_dev: bool, master_on: bool) -> bool:
    """Resolve one layer's DEBUG state.

    Precedence (first match wins):
      1. DEBUG_ALL=1              -> DEBUG on
      2. Explicit flag value      -> whatever the operator set
      3. Env default              -> dev_default if is_dev else False
    """
    if master_on:
        return True
    explicit = _tri_flag(flag_name)
    if explicit is not None:
        return explicit
    return dev_default and is_dev


def configure_logging() -> None:
    """Idempotent — call once at process start (main.py, near the top).

    Subsequent calls are no-ops so hot-reload doesn't stack handlers on
    the root logger."""
    global _CONFIGURED
    if _CONFIGURED:
        return

    environment = os.getenv("ENVIRONMENT", "DEVELOPMENT").upper()
    is_dev      = environment == "DEVELOPMENT"
    fmt_kind    = os.getenv("LOG_FORMAT", "text").lower()

    # DEBUG_ALL master switch — flips every layer on regardless of the
    # individual flag. Handy for "one bug, need everything, then off".
    master_on = _tri_flag("DEBUG_ALL") is True

    # Per-layer DEBUG state. `dev_default=True` means this layer is on
    # in dev by default; the operator can still flip it off explicitly.
    # AGNO_DEBUG default-off: the per-agent init banners + function-registration
    # spam (send_message, get_channel_history, ...) drowns out real signal.
    # Flip on with `AGNO_DEBUG=1` when you're actually debugging a run.
    sentinel_debug = _resolve("SENTINEL_DEBUG", dev_default=False, is_dev=is_dev, master_on=master_on)
    agno_debug     = _resolve("AGNO_DEBUG",     dev_default=False, is_dev=is_dev, master_on=master_on)
    fastapi_debug  = _resolve("FASTAPI_DEBUG",  dev_default=True,  is_dev=is_dev, master_on=master_on)
    sql_debug      = _resolve("SQL_DEBUG",      dev_default=False, is_dev=is_dev, master_on=master_on)
    http_debug     = _resolve("HTTP_DEBUG",     dev_default=False, is_dev=is_dev, master_on=master_on)

    # Root at DEBUG so per-logger levels are the real filter.
    root = logging.getLogger()
    root.setLevel(logging.DEBUG)
    for h in list(root.handlers):
        root.removeHandler(h)

    # ── Console handler ──
    console = logging.StreamHandler(sys.stderr)
    console.setLevel(logging.DEBUG)
    if fmt_kind == "json":
        console.setFormatter(JsonFormatter())
    else:
        console.setFormatter(HumanConsoleFormatter(use_color=sys.stderr.isatty()))
    root.addHandler(console)

    # ── Rotating file handler (JSON, always DEBUG) ──
    log_file = os.getenv("LOG_FILE")
    if log_file != "-":
        default_dir = Path(__file__).resolve().parent / "logs"
        path = Path(log_file) if log_file else default_dir / "sentinel.log"
        path.parent.mkdir(parents=True, exist_ok=True)
        max_bytes = int(os.getenv("LOG_MAX_MB", "10")) * 1024 * 1024
        backups   = int(os.getenv("LOG_BACKUPS", "5"))
        fh = logging.handlers.RotatingFileHandler(
            path, maxBytes=max_bytes, backupCount=backups, encoding="utf-8"
        )
        fh.setLevel(logging.DEBUG)
        fh.setFormatter(JsonFormatter())
        root.addHandler(fh)

    _apply_layer_levels(
        sentinel_debug=sentinel_debug,
        agno_debug=agno_debug,
        fastapi_debug=fastapi_debug,
        sql_debug=sql_debug,
        http_debug=http_debug,
    )

    _CONFIGURED = True

    layers = {
        "sentinel": "DEBUG" if sentinel_debug else "INFO",
        "agno":     "DEBUG" if agno_debug     else "WARNING",
        "fastapi":  "INFO"  if fastapi_debug  else "WARNING",
        "sql":      "DEBUG" if sql_debug      else "WARNING",
        "http":     "DEBUG" if http_debug     else "WARNING",
    }
    logging.getLogger("sentinel.boot").info(
        "Logging configured — env=%s format=%s layers=%s file=%s",
        environment, fmt_kind, layers, log_file or "(default)",
    )


def _apply_layer_levels(
    *,
    sentinel_debug: bool,
    agno_debug: bool,
    fastapi_debug: bool,
    sql_debug: bool,
    http_debug: bool,
) -> None:
    """Set each layer's level independently.

    Note the asymmetry for `fastapi`: "on" means INFO (so we see route
    lines), "off" means WARNING (silent). Route logs are already at INFO
    inside uvicorn — pushing them to DEBUG doesn't add anything useful.
    """
    # Our own code
    logging.getLogger("sentinel").setLevel(logging.DEBUG if sentinel_debug else logging.INFO)

    # Agno
    agno_level = logging.DEBUG if agno_debug else logging.WARNING
    for name in ("agno", "agno.utils", "agno.utils.log", "agno.agent", "agno.team", "agno.tools"):
        logging.getLogger(name).setLevel(agno_level)

    # FastAPI stack. uvicorn.error stays INFO always (startup / shutdown lines).
    fastapi_level = logging.INFO if fastapi_debug else logging.WARNING
    for name in ("fastapi", "starlette", "uvicorn", "uvicorn.access"):
        logging.getLogger(name).setLevel(fastapi_level)
    logging.getLogger("uvicorn.error").setLevel(logging.INFO)

    # SQLAlchemy
    sql_level = logging.DEBUG if sql_debug else logging.WARNING
    for name in ("sqlalchemy", "sqlalchemy.engine", "sqlalchemy.pool"):
        logging.getLogger(name).setLevel(sql_level)

    # HTTP client stack. Includes:
    #   - `hpack` (HPACK header codec, chatty when httpcore uses HTTP/2)
    #   - `openai._base_client` (dumps a full request payload at DEBUG on
    #     every LLM call — massive spam if left uncapped)
    #   - `slack_sdk.*` (dumps every Slack HTTP request/response at DEBUG,
    #     including bot boot-time auth.test — floods the terminal on start).
    #     WhatsApp/Teams SDKs don't do this so they don't need capping.
    http_level = logging.DEBUG if http_debug else logging.WARNING
    for name in (
        "httpx", "httpcore", "urllib3",
        "hpack", "hpack.hpack", "hpack.table",
        "openai", "openai._base_client",
        "slack_sdk", "slack_sdk.web", "slack_sdk.web.base_client",
    ):
        logging.getLogger(name).setLevel(http_level)


def get_logger(name: str) -> logging.Logger:
    """Preferred entrypoint for module-level loggers.

    Names starting with `sentinel.` are our own; other names use their
    own package hierarchy and pick up levels set in `_apply_layer_levels`.
    """
    if not name.startswith("sentinel"):
        name = f"sentinel.{name}"
    return logging.getLogger(name)


def agno_debug_enabled() -> bool:
    """Whether AGNO_DEBUG (or DEBUG_ALL) is set, taking dev-default into
    account. `agentic_system/config/config.py` calls this to decide the
    per-agent `debug_mode` value at construction time."""
    if _tri_flag("DEBUG_ALL") is True:
        return True
    explicit = _tri_flag("AGNO_DEBUG")
    if explicit is not None:
        return explicit
    # No explicit flag — follow env default (on in dev, off in prod).
    return os.getenv("ENVIRONMENT", "DEVELOPMENT").upper() == "DEVELOPMENT"
