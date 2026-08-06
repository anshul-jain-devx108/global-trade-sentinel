"""One-off migration: heal double-encoded `ai.sessions.session_data` rows.

Symptom
-------
`POST /metrics/refresh` (Agno's built-in) crashed with
`'str' object has no attribute 'get'` in
`agno/db/postgres/utils.py :: calculate_date_metrics`, because roughly
half of the `ai.sessions` rows had `session_data` stored as a
JSON-encoded STRING inside the `jsonb` column instead of a top-level
JSON object. `psycopg2` gave those rows back as Python `str`, and
Agno's metrics aggregator did `.get(...)` on them.

Fix
---
For every row where `jsonb_typeof(session_data) = 'string'`, JSON-parse
the inner string and rewrite the column with the resulting object.
Idempotent — reruns are safe; already-object rows are skipped.

Usage
-----
    cd d:/Netra/agent-os
    .venv/Scripts/python scripts/heal_session_data.py [--dry-run]
"""
import json
import os
import sys

from dotenv import load_dotenv
from sqlalchemy import create_engine, text


TABLE = "ai.sessions"
# `session_data` should be a JSON object; `runs` should be a JSON array.
# Agno's insert path double-encodes both on some rows — same JSON.dumps
# bug expressed twice. Heal each column with its expected top-level type.
COLUMNS = [
    ("session_data", dict),
    ("runs", list),
]


def _heal_column(conn, column: str, expected_py_type: type, dry_run: bool) -> None:
    # Sanity check column exists + is jsonb.
    col_type = conn.execute(text("""
        SELECT data_type
        FROM information_schema.columns
        WHERE table_schema = 'ai' AND table_name = 'sessions' AND column_name = :c
    """), {"c": column}).scalar()
    if col_type is None:
        print(f"[skip] {TABLE}.{column} not found — nothing to heal.")
        return
    if col_type != "jsonb":
        print(f"[skip] {TABLE}.{column} is {col_type}, not jsonb — nothing to heal.")
        return

    print(f"\n-- {TABLE}.{column} --")
    dist = conn.execute(text(f"""
        SELECT jsonb_typeof({column}) AS jtype, COUNT(*) AS n
        FROM {TABLE}
        GROUP BY jsonb_typeof({column})
        ORDER BY 2 DESC
    """)).all()
    print("Before:")
    for r in dist:
        print(f"  {r.jtype or '(null)':>10}: {r.n}")

    broken = conn.execute(text(f"""
        SELECT session_id, {column}::text AS raw
        FROM {TABLE}
        WHERE jsonb_typeof({column}) = 'string'
    """)).all()

    if not broken:
        print("Nothing to heal — every row is already the expected type (or null).")
        return

    print(f"Found {len(broken)} rows to heal.")
    healed = failed = 0
    for row in broken:
        # jsonb_typeof='string' means the column holds a JSON string
        # literal ('"...escaped..."'). One json.loads() strips the outer
        # quoting; if the inner is still a string it's a double-encode,
        # so parse again to get the real object/array.
        try:
            inner = json.loads(row.raw)
            parsed = json.loads(inner) if isinstance(inner, str) else inner
            if not isinstance(parsed, expected_py_type):
                print(f"  [warn] {row.session_id}: parsed to {type(parsed).__name__}, "
                      f"expected {expected_py_type.__name__}, skipping")
                failed += 1
                continue
        except (json.JSONDecodeError, TypeError) as e:
            print(f"  [warn] {row.session_id}: parse failed ({e}), skipping")
            failed += 1
            continue

        if dry_run:
            healed += 1
            continue

        conn.execute(text(f"""
            UPDATE {TABLE}
            SET {column} = CAST(:val AS jsonb)
            WHERE session_id = :sid
        """), {"val": json.dumps(parsed), "sid": row.session_id})
        healed += 1

    print(f"Healed: {healed}, failed: {failed} ({'dry-run' if dry_run else 'committed'})")

    after = conn.execute(text(f"""
        SELECT jsonb_typeof({column}) AS jtype, COUNT(*) AS n
        FROM {TABLE}
        GROUP BY jsonb_typeof({column})
        ORDER BY 2 DESC
    """)).all()
    print("After:")
    for r in after:
        print(f"  {r.jtype or '(null)':>10}: {r.n}")


def main(dry_run: bool = False) -> int:
    load_dotenv()
    engine = create_engine(os.environ["DATABASE_URL"])
    with engine.begin() as conn:
        for column, expected in COLUMNS:
            _heal_column(conn, column, expected, dry_run)
    return 0


if __name__ == "__main__":
    dry = "--dry-run" in sys.argv
    sys.exit(main(dry_run=dry))
