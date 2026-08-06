# Deploying GTS to Azure Container Apps

Step-by-step guide to get `gts_v2` running on Azure. First time takes 15-20 min. Subsequent deploys ~2 min.

## What we're deploying

```
  ┌─────────────────────────────────────────────────────┐
  │                    Azure                            │
  │                                                     │
  │  ┌─────────────┐    ┌──────────────────┐            │
  │  │ Container   │    │ Container App    │            │
  │  │ Registry    │───▶│  gts-backend     │            │
  │  │  (ACR)      │    │  1 replica       │            │
  │  └─────────────┘    │  0.5 vCPU / 1 GB │            │
  │                     │  port 8000       │            │
  │                     └────────┬─────────┘            │
  │                              │                      │
  │                              ▼                      │
  │                     ┌──────────────────┐            │
  │                     │ Postgres         │            │
  │                     │ Flexible Server  │            │
  │                     │  B1ms + 32 GiB   │            │
  │                     └──────────────────┘            │
  │                                                     │
  │           Secrets (YDC_API_KEY, OPENAI_API_KEY,     │
  │           DATABASE_URL) live in the app's           │
  │           built-in secret store.                    │
  └─────────────────────────────────────────────────────┘
```

**Cost snapshot** (East US, small config): ACR $5 + Postgres $16 + ACA ~$12 + logs ~$2 ≈ **$35/mo**.

---

## Prerequisites

1. **Azure account** with an active subscription
2. **Azure CLI** installed → https://learn.microsoft.com/cli/azure/install-azure-cli
3. `az login` — confirms `az account show` returns your sub
4. **API keys** ready:
   - You.com Research (`YDC_API_KEY`)
   - OpenAI (`OPENAI_API_KEY`) OR Azure OpenAI creds

No Docker Desktop needed — `az acr build` builds server-side.

---

## Step 1 — Edit the deploy script

Open [azure-deploy.sh](./azure-deploy.sh) and fill in the top section:

```bash
YDC_API_KEY='sk-...'
OPENAI_API_KEY='sk-...'
FRONTEND_ORIGIN='https://<your-frontend-url>'   # for CORS
PG_PASSWORD='ChangeMe!Str0ngP@ss'               # 12+ chars, mixed
```

Don't commit this file after editing — it's in `.gitignore` for a reason.

---

## Step 2 — Run block-by-block

**Don't** run the whole script as `bash azure-deploy.sh` the first time. Copy each numbered block into your terminal so you see what each step produces:

| Block | What it does | Time |
|---|---|---|
| 0-1 | Resource group + provider registration | 1 min |
| 2 | Create ACR (Basic tier) | 30 sec |
| 3 | Build & push image (server-side) | 2-3 min |
| 4 | Create Postgres Flex Server + DB | 3-5 min |
| 5 | Create Container Apps environment | 2 min |
| 6-7 | Create Container App with secrets | 1-2 min |
| 8 | Print public URL | instant |

If any step fails, fix it and re-run just that block — Azure ops are idempotent (each `az * create` errors on duplicate name; use `--yes` or delete the resource first).

---

## Step 3 — Verify

Once step 8 prints the URL:

```bash
# 1. Health endpoint
curl https://<your-fqdn>/api/v1/gts/health

# 2. Schedule endpoint (should return {"preset":"manual"})
curl https://<your-fqdn>/api/v1/gts/schedule

# 3. Kick off a sweep (background task)
curl -X POST https://<your-fqdn>/api/v1/gts/sweep \
  -H "Content-Type: application/json" \
  -d '{"query":"test sweep","use_profile":false}'

# 4. Tail logs to watch it run
az containerapp logs show -g gts-rg -n gts-backend --follow
```

---

## Step 4 — Point the frontend at production

Edit `frontend/.env.production` (create if missing):

```
VITE_API_URL=https://<your-fqdn>
```

Then build & deploy the frontend to Azure Static Web Apps (or wherever). The dev proxy in `vite.config.js` is only used by `npm run dev`.

---

## Common tasks

**Redeploy after code change** (2 min):

```bash
IMAGE_TAG=v2
az acr build --registry $ACR_NAME --image gts-backend:$IMAGE_TAG --file Dockerfile ..
az containerapp update -g $RG -n gts-backend --image $ACR_LOGIN_SERVER/gts-backend:$IMAGE_TAG
```

**Rotate a secret** (no image rebuild):

```bash
az containerapp secret set -g gts-rg -n gts-backend \
  --secrets openai-api-key=<new-value>
az containerapp revision restart -g gts-rg -n gts-backend --revision <latest>
```

**Scale down to save money** (dev/demo only — while not in use):

```bash
az containerapp update -g gts-rg -n gts-backend --min-replicas 0
# Pinging the URL cold-starts a replica; scheduler stops while at 0.
```

**Tear it all down** (stops the bill):

```bash
az group delete --name gts-rg --yes --no-wait
```

---

## Why single replica?

`gts_v2` keeps two pieces of state **inside the Python process**:

1. `SweepTaskManager` — dict of running/finished sweep tasks ([sweep_service.py:208](../sweep_service.py#L208))
2. Agno's `SchedulePoller` — one loop per replica polling `agno_schedules`

If you scale to 2 replicas:
- A `POST /gts/sweep` returns task_id from replica A, but the client's next `GET /gts/sweep/{id}` might hit replica B → 404
- Both replicas would fire the same cron tick → double sweep runs

The fix is to move both to shared storage (Redis for tasks, Agno's DB-backed schedule claim for cron) but that's a refactor, not a deploy config. For now: **`--min-replicas 1 --max-replicas 1`** is a hard requirement, not a preference.

---

## What if I hit issues?

- **`az acr build` fails at "sending build context"** → check `.dockerignore` isn't excluding `main.py`
- **App boots but `/api/v1/gts/health` 502s** → check `az containerapp logs show`; usually a missing env var (OPENAI_API_KEY empty, DATABASE_URL wrong password)
- **`connection to server failed`** → Postgres firewall. The deploy script opens `0.0.0.0-255.255.255.255` (any Azure IP). Tighten to just ACA's outbound IP once verified.
- **App restarts every few minutes** → healthcheck failing. The Dockerfile healthchecks `/api/v1/gts/health` — if that route errors, ACA kills the replica. Check logs.

Chalega. Aap ka backend live ho jaayega.
