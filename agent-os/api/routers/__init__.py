"""Feature-scoped FastAPI routers.

Each module exposes a `get_<feature>_router(...)` factory returning an
`APIRouter`. GTS routers use `prefix="/api/v1/gts"`, auth uses
`/api/v1/auth`, chat uses `/api/v1/chat`. Cross-router dependencies
(schedule state, sweep team, etc.) are passed as factory arguments — no
globals.
"""
