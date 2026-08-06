"""Shared FastAPI dependencies.

Single canonical `get_db` — every router imports from here, so DB
session lifecycle lives in one file. Callers that need a session
outside of FastAPI (background tasks, cron) should use
`core.database.SessionLocal` directly.
"""
from typing import Generator

from sqlalchemy.orm import Session

from core.database import SessionLocal


def get_db() -> Generator[Session, None, None]:
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
