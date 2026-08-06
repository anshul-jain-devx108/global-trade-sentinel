# `Agent.description` renders as raw un-tagged text at the top of the system prompt, breaking structural parity with `Agent.role`

## Summary

When an `Agent` is used **standalone** (not as a `Team` member), the `description` field is injected into the system prompt as **bare text with no wrapping tag**, while `role` is properly wrapped in `<your_role>…</your_role>`. This creates an inconsistent structural signal to the model and causes the description to appear as an unattributed prelude — often before the model realizes it's an authoritative section.

By contrast, when the same agent is a `Team` member, its description is cleanly rendered under `Description:` inside a `<member>` block — this is exactly what a user expects. The standalone rendering should follow the same discipline.

## Reproduction

```python
from agno.agent import Agent

agent = Agent(
    id="my-agent",
    name="My Agent",
    role="Concise identity + one-line behavior summary.",
    description="Detailed behavioral rules or context I want the model to see.",
    instructions="Turn-level operating instructions.",
    model=...,
)

# Inspect the actual system prompt that goes to the LLM:
# (any means of grabbing the system message will work — DEBUG logs, or
#  agent._messages.get_system_message(...) in Agno 2.x)
```

## Observed output (Agno 2.8.2)

```
Detailed behavioral rules or context I want the model to see.

<your_role>
Concise identity + one-line behavior summary.
</your_role>


Turn-level operating instructions.

<additional_information>
...
</additional_information>
```

Notice `description` sits at the top with **no tag**, **no header**, no visual boundary. It reads to the model like an extension of some earlier system message.

## Expected output

Description should be wrapped in a semantic tag comparable to `<your_role>`, e.g. `<description>…</description>`, so the model receives a consistent structural signal across all three identity fields (`description`, `role`, `instructions`).

```
<description>
Detailed behavioral rules or context I want the model to see.
</description>

<your_role>
Concise identity + one-line behavior summary.
</your_role>

<instructions>
Turn-level operating instructions.
</instructions>
```

## Why this matters

1. **Structural inconsistency across contexts.** Same field, same value — but in a `Team.members[]` context it appears as `Description: …` inside `<member>`, and in standalone context it appears un-tagged at prompt top. Users cannot reason about it uniformly.

2. **Model confusion in practice.** In production, we observed the model treating `description` as a low-priority prelude rather than an authoritative rule — because it lacks the visual weight the other tagged sections have. Rewrapping the same content inside a tag noticeably improved rule-following.

3. **Encourages duplication as a workaround.** Because `description` looks weak, users tend to also restate the same content inside `instructions`, inflating token count and creating maintenance burden. A clear tag would let `description` carry its intended weight and remove the incentive to duplicate.

4. **Compare with `instructions`.** `instructions` already has an opt-in tag mode via `use_instruction_tags=True` (defaults to `False`, wrapping in `<instructions>…</instructions>`). The same treatment should apply to `description` for symmetry.

## Suggested fix

In `agno/agent/_messages.py` (the system-message builder), replace:

```python
if agent.description is not None:
    system_message_content += f"{agent.description}\n\n"
```

with something like:

```python
if agent.description is not None:
    if agent.use_description_tags:  # new flag, default False for back-compat
        system_message_content += f"<description>\n{agent.description}\n</description>\n\n"
    else:
        system_message_content += f"{agent.description}\n\n"
```

Or, more decisively (breaking change gated behind major version): **always wrap**. This matches the treatment of `role` (`<your_role>`) which is unconditionally tagged.

## Alternative — internal-consistency fix

If wrapping is off the table for back-compat reasons, at minimum apply the same `Description:` prefix used inside `<team_members>`, so at least the field has a visual anchor:

```
Description: Detailed behavioral rules or context I want the model to see.

<your_role>
...
```

That is a one-line change and matches what team-rendering already does.

## Environment

- Agno version: **2.8.2**
- Python: 3.13.x
- Context: standalone `Agent` (no `Team` parent), used as a Microsoft Teams / Slack chatbot router with a `role` field + `description` field + `instructions` callable.

## Related

- `use_instruction_tags` (opt-in tag wrapping for `instructions`) sets the precedent for how a description tag could be introduced. Same flag pattern would work.
- Team member rendering path in `agno/team/_messages.py` already prefixes with `Description:` — inconsistency between the two paths is the core observation.

---

## Ready-to-use bits

**PR / issue title options:**
- "Standalone `Agent.description` renders un-tagged, breaking parity with `role`"
- "`Agent.description` missing structural tag — add `use_description_tags` flag"
- "Inconsistent `Agent.description` rendering: tagged in Team, bare text standalone"

**One-line hook for blog / Slack:**
> Found that Agno's `Agent.description` field lands in the system prompt as untagged prose in standalone mode but properly wrapped as `Description:` inside `<member>` when the same agent joins a Team. Filed a PR to bring the two paths to parity.
