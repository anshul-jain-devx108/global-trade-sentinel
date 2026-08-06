# backend/docs

Design + reference docs for the GTS backend.

| File | What it covers |
|---|---|
| [architecture.md](architecture.md) | Module layout, request flow, why the split exists |
| [routes.md](routes.md) | Full route inventory — custom `/gts/*` vs built-in AgentOS, and why each custom route is not just using the framework's version |
| [configuration.md](configuration.md) | Env vars vs `config.py` — what goes where and why |

Nothing here is generated. Update by hand when the architecture changes.
