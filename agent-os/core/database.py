from agno.db.postgres import PostgresDb

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

import agentic_system.config.config as CFG  # submodule path, avoids __init__ cycle
from core.models import Base

# ─── Single consolidated DB ───────────────────────────────────────────
# One store holds everything: Agno framework state (sessions, memories,
# schedules, traces, metrics) AND our domain tables (regulatory_events,
# company_profile, …). Namespaces don't collide, so one file/db is
# simpler to manage and back up than the three we used to run.
#
# Deployed backend runs on Supabase Postgres — set DATABASE_URL in .env.

db = PostgresDb(
    db_url=CFG.DATABASE_URL,
    session_table=CFG.AGNO_SESSION_TABLE,
    memory_table=CFG.AGNO_MEMORY_TABLE,
)

# ─── Business data (SQLAlchemy) ───────────────────────────────────────
SQLALCHEMY_DATABASE_URL = CFG.DATABASE_URL

# `check_same_thread=False` is a SQLite-only sqlite3 driver quirk;
# passing it to any other backend errors. Only apply for sqlite URLs.
_connect_args = (
    {"check_same_thread": False} if SQLALCHEMY_DATABASE_URL.startswith("sqlite") else {}
)


_is_postgres = SQLALCHEMY_DATABASE_URL.startswith("postgres")
_engine_kwargs = {
    "connect_args": _connect_args,
    **({"pool_pre_ping": True, "pool_recycle": 300} if _is_postgres else {}),
}
engine = create_engine(SQLALCHEMY_DATABASE_URL, **_engine_kwargs)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


Base.metadata.create_all(bind=engine)


def _add_column_if_missing(table: str, column: str, ddl_type: str) -> None:
    """Idempotent ALTER TABLE ADD COLUMN. `create_all` never mutates existing
    schemas, so this fills the gap for additive migrations. Safe on both
    SQLite and Postgres — both support `ALTER TABLE … ADD COLUMN` and both
    keep it a no-op when the column already exists (we swallow the error)."""
    from sqlalchemy import text
    from sqlalchemy.exc import OperationalError, ProgrammingError

    with engine.begin() as conn:
        try:
            conn.execute(text(f'ALTER TABLE {table} ADD COLUMN {column} {ddl_type}'))
        except (OperationalError, ProgrammingError):
            # Column already present — expected on every startup after the first.
            pass


_add_column_if_missing("company_profile", "incoterms",        "TEXT")
_add_column_if_missing("company_profile", "volume_tier",      "VARCHAR")
_add_column_if_missing("company_profile", "end_use_category", "VARCHAR")
_add_column_if_missing("products",        "eccn",             "VARCHAR")
