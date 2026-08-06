"""Ask Sentinel chat — routes through the `ask_sentinel_agent` Agno agent.

Web chat, Microsoft Teams, and Slack now hit the SAME agent (see
`agentic_system/os/agent_os.py` for the Teams/Slack bindings). That
means the three-tier tool inventory — `search_findings` → You.com
enrichment → `consult_<specialist>` (HITL-gated) — behaves identically
regardless of surface.

HITL contract for the web surface:
    Specialist tools carry `requires_confirmation=True`. When Ask
    Sentinel decides to call one, Agno pauses the run. We serialise
    the paused state as an APPROVAL marker at the head of the
    assistant reply:

        [[APPROVAL:{json}]]
        <human-readable rationale>

    The frontend detects the marker, renders an Approve/Reject card,
    and hits `POST /api/v1/chat/{session_id}/approvals` — which calls
    `agent.acontinue_run(...)` with `confirmed=True|False` and persists
    the resulting reply.
"""
import json
import uuid
from typing import Any, Optional

from sqlalchemy.orm import Session

from agentic_system.agents.ask_sentinel_agent.agent import ask_sentinel_agent
from core.models import ChatMessage, ChatSession


# Marker the frontend looks for. Kept simple + prefixed so it can never
# collide with normal markdown output. Keep this in sync with
# frontend/src/components/ChatMessage.tsx (or the approval-card component).
APPROVAL_MARKER_PREFIX = "[[APPROVAL:"
APPROVAL_MARKER_SUFFIX = "]]"


def _extract_text(run_output) -> str:
    """Pull the assistant-visible text out of an Agno RunOutput."""
    content = getattr(run_output, "content", None)
    if content is None:
        return ""
    if hasattr(content, "model_dump_json"):
        return content.model_dump_json(indent=2)
    return str(content)


def _pending_tool(run_output) -> Optional[Any]:
    """First ToolExecution on the run that's blocking on confirmation."""
    for t in getattr(run_output, "tools", None) or []:
        if getattr(t, "requires_confirmation", False) and not getattr(t, "confirmed", None):
            return t
    return None


def _humanise_specialist(tool_name: str) -> str:
    return tool_name.replace("consult_", "").replace("_", " ").strip() or tool_name


def _db_lookup_summary(run_output) -> Optional[str]:
    """If the agent called `search_findings` this turn, return a
    one-line summary of what came back. Lets the approval card show
    the user that the DB was consulted first — otherwise the pause
    looks like the agent jumped straight to a paid specialist call.
    """
    tools = getattr(run_output, "tools", None) or []
    for t in tools:
        if getattr(t, "tool_name", None) != "search_findings":
            continue
        result = getattr(t, "result", None)
        # search_findings returns a JSON list. If we can parse it, count
        # rows; otherwise fall back to raw length hints.
        try:
            parsed = json.loads(result) if isinstance(result, str) else result
            if isinstance(parsed, list):
                return f"Checked stored findings — **{len(parsed)} match{'es' if len(parsed) != 1 else ''}**."
            if isinstance(parsed, dict) and "results" in parsed:
                n = len(parsed["results"])
                return f"Checked stored findings — **{n} match{'es' if n != 1 else ''}**."
        except (TypeError, ValueError):
            pass
        return "Checked stored findings — none matched."
    return None


def _build_approval_message(run_output, pending_tool) -> str:
    """Return `[[APPROVAL:{json}]] <text>` for the frontend to parse."""
    tool_args = getattr(pending_tool, "tool_args", None) or {}
    query = tool_args.get("query") if isinstance(tool_args, dict) else str(tool_args)
    tool_name = getattr(pending_tool, "tool_name", "specialist")
    specialist_label = _humanise_specialist(tool_name)

    payload = {
        "run_id": getattr(run_output, "run_id", None),
        "tool_call_id": getattr(pending_tool, "tool_call_id", None),
        "tool_name": tool_name,
        "specialist": specialist_label,
        "query": query,
    }
    marker = f"{APPROVAL_MARKER_PREFIX}{json.dumps(payload, ensure_ascii=False)}{APPROVAL_MARKER_SUFFIX}"

    db_line = _db_lookup_summary(run_output)
    lines = []
    if db_line:
        lines.append(db_line)
    lines.append(
        f"To answer this I need to run a fresh **{specialist_label}** research call. "
        f"It hits primary sources (You.com) and takes 10–60 seconds."
    )
    body = "\n\n".join(lines)
    return f"{marker}\n{body}"


async def generate_reply(
    db: Session,
    session_id: uuid.UUID,
    user_message_content: str,
) -> ChatMessage:
    """Route the user's turn through Ask Sentinel and persist the reply.

    `session_id=str(session_id)` — Agno stores conversation history
    keyed by this string, so successive turns from the same chat row
    see the previous transcript automatically. This is the same
    session_id the approvals endpoint will resume the paused run under.
    """
    run_output = await ask_sentinel_agent.arun(
        input=user_message_content,
        session_id=str(session_id),
    )

    if getattr(run_output, "is_paused", False):
        pending = _pending_tool(run_output)
        if pending is not None:
            ai_content = _build_approval_message(run_output, pending)
        else:
            ai_content = _extract_text(run_output) or "(paused, no pending tool)"
    else:
        ai_content = _extract_text(run_output) or "(no reply)"

    ai_message = ChatMessage(
        session_id=session_id,
        role="assistant",
        content=ai_content,
    )
    db.add(ai_message)

    session = db.query(ChatSession).filter(ChatSession.id == session_id).first()
    if session:
        session.model_used = "ask-sentinel"

    db.commit()
    db.refresh(ai_message)
    return ai_message


async def resume_reply(
    db: Session,
    session_id: uuid.UUID,
    run_id: str,
    tool_call_id: str,
    confirmed: bool,
) -> ChatMessage:
    """Approve or reject a paused specialist call, then persist the final reply.

    Called by `POST /api/v1/chat/{session_id}/approvals`. Rebuilds the
    minimum `updated_tools` payload Agno needs to continue the run —
    the agent takes it from there (either fires the specialist and
    formats the answer, or skips it and answers text-only).
    """
    from agno.models.response import ToolExecution

    updated = ToolExecution(
        tool_call_id=tool_call_id,
        confirmed=confirmed,
    )

    run_output = await ask_sentinel_agent.acontinue_run(
        run_id=run_id,
        updated_tools=[updated],
        session_id=str(session_id),
    )

    ai_content = _extract_text(run_output) or (
        "OK, skipping the specialist call. Ask me something else, or say "
        "'search the DB for X' and I'll try again."
        if not confirmed
        else "(no reply)"
    )

    ai_message = ChatMessage(
        session_id=session_id,
        role="assistant",
        content=ai_content,
    )
    db.add(ai_message)
    db.commit()
    db.refresh(ai_message)
    return ai_message
