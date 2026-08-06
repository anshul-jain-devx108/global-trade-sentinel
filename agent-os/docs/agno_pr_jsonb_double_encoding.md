# Postgres session inserts double-encode `session_data` and `runs` into `jsonb` — later crashes `refresh_metrics` with `'str' object has no attribute 'get'`

## Summary

On Agno's Postgres backend (`agno.db.postgres.PostgresDb`), some session rows land with **JSON-serialised strings** written into the `session_data` and `runs` `jsonb` columns instead of top-level objects/arrays. When `POST /metrics/refresh` runs, `calculate_date_metrics` (in `agno/db/postgres/utils.py`) reads those rows back as Python `str` and does `.get(...)` on them — every refresh fails:

```
ERROR    Exception refreshing metrics: 'str' object has no attribute 'get'
```

The row is otherwise valid — the schema is `jsonb`, the payload parses, and other endpoints (`/sessions`, `/agents/*/runs`) don't care because they don't drill into `session_metrics` or iterate `runs[].get("model")`. Only the metrics aggregator trips over it.

## Reproduction / evidence

On a live Postgres store with mixed history (mine had 45 sessions written across two Agno versions):

```sql
SELECT jsonb_typeof(session_data), COUNT(*) FROM ai.sessions GROUP BY 1;
--   object -> 21
--   string -> 24   ← broken

SELECT jsonb_typeof(runs), COUNT(*) FROM ai.sessions GROUP BY 1;
--   array  -> 21
--   string -> 24   ← same broken rows, same pattern

SELECT session_id, left(session_data::text, 120) FROM ai.sessions
 WHERE jsonb_typeof(session_data) = 'string' LIMIT 1;
-- "\"{\\\"session_state\\\": {}, \\\"session_metrics\\\": {\\\"input_tokens\\\": 52818, ...}\""
```

The `session_data` for those 24 rows is a JSON string literal whose *contents* are the JSON object we wanted. Same pattern for `runs` — a JSON string whose contents are the JSON array of run records. Classic **double-encoding** — an extra `json.dumps(...)` slipped into the insert path.

The two columns break together on the same row (n=24 both), which pins the write path as the culprit — not two independent bugs.

## Observed failure (Agno 2.8.2)

`agno/db/postgres/utils.py :: calculate_date_metrics`, line ~324:

```python
session_data = session.get("session_data", {}) or {}
session_metrics = session_data.get("session_metrics", {}) or {}   # AttributeError: 'str' object has no attribute 'get'
```

and line ~315:

```python
runs = session.get("runs", []) or []
metrics[runs_count_key] += len(runs)          # OK on a str (length of the JSON literal) — silent bad count
if runs:
    for run in runs:                          # iterates characters, not run dicts
        if model_id := run.get("model"):      # AttributeError on the first char
```

The outer `try/except` in `calculate_metrics` swallows the exception and aborts the whole refresh — no partial progress, no per-row skip.

## Expected

Postgres `jsonb` columns declared to hold objects/arrays should be written as objects/arrays, and read back as `dict` / `list` via `psycopg2`'s default jsonb decoding. If the insert side ever encodes a string, the read side should defensively coerce or the aggregator should tolerate it.

## Root cause (best guess)

`_serialize_session_data`-style helpers in the insert path pass through an already-serialised JSON string in some code path (mixing "already a string" with "still a dict"), and `session_data` / `runs` end up as JSON strings inside `jsonb`. Two separate insert code paths (initial upsert vs. update-after-run?) probably differ in this detail — hence the exact 21/24 split on the same row set.

## Suggested fix

Two-layer defence:

**1. Fix the write path.** In `agno/db/postgres/postgres.py` insert/upsert helpers, guarantee `session_data` and `runs` are `dict`/`list` (not `str`) before hand-off to `psycopg2` — or use `Jsonb()` adaptors so a string coming in is treated as a JSON scalar (raising early) rather than silently written as a JSON string.

```python
# in upsert_session / update_session before executing the SQL
if isinstance(session_data, str):
    session_data = json.loads(session_data)
if isinstance(runs, str):
    runs = json.loads(runs)
```

**2. Make `calculate_date_metrics` defensive.** In `agno/db/postgres/utils.py :: calculate_date_metrics`, coerce nested fields before `.get()`:

```python
session_data = session.get("session_data") or {}
if isinstance(session_data, str):
    try:
        session_data = json.loads(session_data)
    except json.JSONDecodeError:
        session_data = {}
session_metrics = session_data.get("session_metrics") or {}
if isinstance(session_metrics, str):
    try:
        session_metrics = json.loads(session_metrics)
    except json.JSONDecodeError:
        session_metrics = {}

runs = session.get("runs") or []
if isinstance(runs, str):
    try:
        runs = json.loads(runs)
    except json.JSONDecodeError:
        runs = []
```

Layer (2) alone rescues existing installs with historical bad rows — it should ship regardless.

## User-side one-off migration (what unblocked me)

A short SQL heal reformats every double-encoded row without a schema change. Idempotent — reruns hit zero rows. Reference implementation:

```python
# scripts/heal_session_data.py
COLUMNS = [("session_data", dict), ("runs", list)]

for column, expected in COLUMNS:
    broken = conn.execute(text(f"""
        SELECT session_id, {column}::text AS raw
        FROM ai.sessions
        WHERE jsonb_typeof({column}) = 'string'
    """)).all()
    for row in broken:
        inner = json.loads(row.raw)
        parsed = json.loads(inner) if isinstance(inner, str) else inner
        assert isinstance(parsed, expected)
        conn.execute(
            text(f"UPDATE ai.sessions SET {column} = CAST(:val AS jsonb) WHERE session_id = :sid"),
            {"val": json.dumps(parsed), "sid": row.session_id},
        )
```

Result on my install: `string: 24 → 0` for both columns, and `/metrics/refresh` returns cleanly.

## Impact

- `POST /metrics/refresh` fails silently for anyone whose store contains legacy or double-encoded rows — the Usage/Cost dashboards look stuck on a stale snapshot.
- `agent_runs_count` in the aggregated `agno_metrics` table is under-counted whenever the string-encoded branch is hit before the exception aborts the whole run (partial data lost across the transaction rollback).
- Downstream: cost estimation, model breakdown, active-day rollups all inherit the miss.

## Environment

- Agno version: **2.8.2**
- Python: 3.13.x
- DB: Supabase Postgres (managed) via `agno.db.postgres.PostgresDb`
- Store: `ai` schema, 45 sessions accumulated across sweep-team + Ask Sentinel runs; roughly half are Agno-2.8-shape and roughly half were written earlier under a build that emitted the double-encoded form.

## Related

- Second Agno correctness finding on the same repo alongside `Agent.description` un-tagged rendering (see `agno_pr_description_tag.md`).

---

## Ready-to-use bits

**PR / issue title options:**

- "Postgres backend double-encodes `session_data` / `runs` as JSON strings inside `jsonb`, breaking `refresh_metrics`"
- "`refresh_metrics` crashes with `'str' object has no attribute 'get'` on legacy session rows"
- "Defensive coercion in `calculate_date_metrics` — tolerate string-encoded jsonb payloads"

**One-line hook for blog / Slack:**

> While wiring Agno's metrics dashboard into Global Trade Sentinel, we found that ~half our historical `ai.sessions` rows had `session_data` and `runs` stored as JSON strings inside the `jsonb` column instead of as top-level objects — enough to break `refresh_metrics` outright. Filed a two-line insert fix + a defensive coercion patch on the aggregator, and shared the SQL heal we ran on the live store.
