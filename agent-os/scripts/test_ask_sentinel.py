"""Direct Ask Sentinel harness — bypasses Teams/Slack/frontend entirely.

Run this from `d:/Netra/agent-os/` with:

    .venv/Scripts/python scripts/test_ask_sentinel.py

    # or a one-off query without editing:
    .venv/Scripts/python scripts/test_ask_sentinel.py "any CBAM updates this week?"

What you see
------------
For every turn:
  1. The user message (what you sent)
  2. Every tool call the agent made (name + args) — search_findings /
     you_search / you_contents / consult_<specialist>
  3. Every tool response (truncated to 500 chars for readability)
  4. The final assistant reply

This is the same routing / prompting logic Slack + Teams hit — no
network layer, no cookie, no CORS. If the agent behaves badly here,
the bug is in the agent (prompt or tools), not the interface.
"""
import asyncio
import json
import os
import sys
from pathlib import Path

# ---- Environment ----
# Load `.env` sitting at agent-os/.env so YDC_API_KEY, Azure creds etc. resolve.
HERE = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(HERE))

from dotenv import load_dotenv
load_dotenv(HERE / ".env")

# Configure logging BEFORE importing agno so the same layer levels apply.
from core.logging_config import configure_logging
configure_logging()

# ---- Agent import ----
from agentic_system.agents.ask_sentinel_agent.agent import ask_sentinel_agent


# ---- Pretty-print helpers ----

BOLD, DIM, YELLOW, GREEN, CYAN, RED, RESET = (
    "\033[1m", "\033[2m", "\033[33m", "\033[32m", "\033[36m", "\033[31m", "\033[0m",
)


def _short(s, limit=500):
    if s is None:
        return ""
    s = str(s)
    return s if len(s) <= limit else s[:limit] + f" …[{len(s) - limit} more chars]"


def _pp_tool_call(tc):
    """One-line tool call summary — name + short args."""
    try:
        name = getattr(tc, "tool_name", None) or getattr(tc, "name", None) or "unknown"
        args = getattr(tc, "tool_args", None) or getattr(tc, "arguments", None) or {}
        if isinstance(args, str):
            try:
                args = json.loads(args)
            except Exception:
                pass
        args_short = json.dumps(args, ensure_ascii=False)[:280] if isinstance(args, dict) else str(args)[:280]
        return f"{CYAN}→ tool {BOLD}{name}{RESET}{CYAN}({args_short}){RESET}"
    except Exception as e:
        return f"{CYAN}→ tool <unreadable: {e}>{RESET}"


def _pp_tool_result(tc):
    result = getattr(tc, "result", None) or getattr(tc, "content", None) or getattr(tc, "output", None)
    return f"{DIM}   ← {_short(result, 500)}{RESET}"


def _pp_messages(messages):
    """Print any tool-call / tool-result messages in order."""
    if not messages:
        return
    for m in messages:
        role = getattr(m, "role", None)
        tool_calls = getattr(m, "tool_calls", None) or []
        tool_name = getattr(m, "tool_name", None)
        content = getattr(m, "content", None)

        if role == "assistant" and tool_calls:
            for tc in tool_calls:
                print(_pp_tool_call(tc))
        elif role == "tool":
            print(f"{DIM}   ← [{tool_name}] {_short(content, 500)}{RESET}")


async def turn(user_message: str):
    """Send one message to Ask Sentinel, print everything we can observe."""
    print()
    print(f"{BOLD}{YELLOW}━━━━ USER ━━━━{RESET}")
    print(user_message)
    print()

    # arun() is Agno 2.x's async entry point. It returns a RunOutput with
    # .content (final text), .messages (full chat transcript), and
    # .tools (aggregated tool calls across the run).
    run_output = await ask_sentinel_agent.arun(user_message)

    _pp_messages(getattr(run_output, "messages", None) or [])

    # Some Agno versions expose .tools on the RunOutput too.
    for tc in getattr(run_output, "tools", None) or []:
        # Only print if we didn't already see it inside messages.
        pass

    print()
    print(f"{BOLD}{GREEN}━━━━ SENTINEL ━━━━{RESET}")
    print(run_output.content or f"{RED}(empty response){RESET}")
    print()


async def repl():
    """Interactive loop — type queries one after another to test enrichment
    (Turn 1: DB hit → Turn 2: 'read that citation' → Turn 3: 'anything newer?').
    """
    print(f"{BOLD}Ask Sentinel harness{RESET} — type your questions, blank line to exit.")
    print(f"{DIM}(same routing Slack + Teams hits; watches tool calls in real time){RESET}")
    print()

    while True:
        try:
            msg = input(f"{BOLD}you >{RESET} ").strip()
        except (EOFError, KeyboardInterrupt):
            print()
            break
        if not msg:
            break
        await turn(msg)


async def main():
    args = sys.argv[1:]
    if args:
        # One-shot mode — run the single query and exit.
        await turn(" ".join(args))
    else:
        await repl()


if __name__ == "__main__":
    asyncio.run(main())
