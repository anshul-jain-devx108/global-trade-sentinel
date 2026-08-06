#!/usr/bin/env bash
#
# One-time Azure deploy for GTS backend → Azure Container Apps.
#
# What this creates:
#   1. Resource Group           gts-rg
#   2. Azure Container Registry gtsacr<random>            (Basic tier ~$5/mo)
#   3. Postgres Flexible Server gts-pg                    (B1ms + 32 GiB, ~$16/mo)
#   4. Container Apps env       gts-env                   (managed, per-app billed)
#   5. Container App            gts-backend               (1 replica, always-on)
#
# Approx monthly cost at this scale: ACR $5 + Postgres $16 + ACA compute
# (0.5 vCPU × 730h ~ $12) + Log Analytics (~$2) = ~$35/mo.
#
# Prerequisites:
#   - Azure CLI  →  https://learn.microsoft.com/cli/azure/install-azure-cli
#   - Logged in  →  `az login`
#   - Docker Desktop running (for `az acr build` server-side build, this is
#     optional — but nice for local test)
#
# Run this file BLOCK BY BLOCK — don't `bash deploy.sh` blindly the first
# time. Each `az ...` call is independent; copy-paste the block you want.
#
# ═══════════════════════════════════════════════════════════════════════

set -euo pipefail

# ─── 0. Config — EDIT THESE ─────────────────────────────────────────
RG=gts-rg
LOCATION=eastus
ACR_NAME=gtsacr$RANDOM                # ACR name must be globally unique
PG_NAME=gts-pg-$RANDOM                # Also globally unique
PG_ADMIN=gtsadmin
PG_PASSWORD='ChangeMe!Str0ngP@ss'     # Rotate via portal after first deploy
PG_DB=gts
ACA_ENV=gts-env
ACA_APP=gts-backend
IMAGE_TAG=v1

# Secrets — paste your real keys here ONCE, then delete this file's copy.
YDC_API_KEY='<your-you.com-key>'
OPENAI_API_KEY='<your-openai-key>'
FRONTEND_ORIGIN='https://gts-frontend.example.azurestaticapps.net'


# ─── 1. Resource group + providers ──────────────────────────────────
az group create --name $RG --location $LOCATION

# ContainerApps + Postgres providers must be registered once per subscription.
az provider register --namespace Microsoft.App --wait
az provider register --namespace Microsoft.OperationalInsights --wait
az provider register --namespace Microsoft.DBforPostgreSQL --wait


# ─── 2. Container Registry (ACR) ────────────────────────────────────
az acr create \
    --resource-group $RG \
    --name $ACR_NAME \
    --sku Basic \
    --admin-enabled true

ACR_LOGIN_SERVER=$(az acr show -n $ACR_NAME --query loginServer -o tsv)
echo "ACR login server: $ACR_LOGIN_SERVER"


# ─── 3. Build + push image (server-side, no local Docker required) ──
# Run this from the gts_v2 folder — sends the build context to ACR
# and builds in Azure. ~2-3 min.
az acr build \
    --registry $ACR_NAME \
    --image gts-backend:$IMAGE_TAG \
    --file Dockerfile \
    ..                                 # build context = gts_v2/


# ─── 4. Postgres Flexible Server ────────────────────────────────────
# B1ms = 1 vCPU / 2 GiB / 32 GiB storage. Smallest paid tier.
# For prod, bump to Standard_D2ds_v5 (~$130/mo).
az postgres flexible-server create \
    --resource-group $RG \
    --name $PG_NAME \
    --location $LOCATION \
    --admin-user $PG_ADMIN \
    --admin-password "$PG_PASSWORD" \
    --sku-name Standard_B1ms \
    --tier Burstable \
    --storage-size 32 \
    --version 16 \
    --public-access 0.0.0.0-255.255.255.255 \
    --yes

# Create the database inside the server.
az postgres flexible-server db create \
    --resource-group $RG \
    --server-name $PG_NAME \
    --database-name $PG_DB

DATABASE_URL="postgresql://$PG_ADMIN:$PG_PASSWORD@$PG_NAME.postgres.database.azure.com:5432/$PG_DB?sslmode=require"


# ─── 5. Container Apps environment ──────────────────────────────────
# One env can host multiple apps. Log Analytics comes bundled.
az containerapp env create \
    --resource-group $RG \
    --name $ACA_ENV \
    --location $LOCATION


# ─── 6. Grab ACR creds so ACA can pull the image ────────────────────
ACR_USERNAME=$(az acr credential show -n $ACR_NAME --query username -o tsv)
ACR_PASSWORD=$(az acr credential show -n $ACR_NAME --query passwords[0].value -o tsv)


# ─── 7. Create the Container App ────────────────────────────────────
# --min-replicas 1 and --max-replicas 1 ⇒ pinned single instance.
# This is REQUIRED because gts_v2 keeps SweepTaskManager and the
# SchedulePoller in-process. Multi-replica would break both.
az containerapp create \
    --resource-group $RG \
    --name $ACA_APP \
    --environment $ACA_ENV \
    --image $ACR_LOGIN_SERVER/gts-backend:$IMAGE_TAG \
    --registry-server $ACR_LOGIN_SERVER \
    --registry-username $ACR_USERNAME \
    --registry-password $ACR_PASSWORD \
    --target-port 8000 \
    --ingress external \
    --min-replicas 1 \
    --max-replicas 1 \
    --cpu 0.5 \
    --memory 1.0Gi \
    --secrets \
        ydc-api-key="$YDC_API_KEY" \
        openai-api-key="$OPENAI_API_KEY" \
        database-url="$DATABASE_URL" \
    --env-vars \
        YDC_API_KEY=secretref:ydc-api-key \
        OPENAI_API_KEY=secretref:openai-api-key \
        DATABASE_URL=secretref:database-url \
        HOST=0.0.0.0 \
        PORT=8000 \
        ENVIRONMENT=PRODUCTION \
        LOG_FORMAT=json \
        LOG_FILE=- \
        CORS_ORIGINS=$FRONTEND_ORIGIN \
        SCHEDULER_BASE_URL=http://127.0.0.1:8000 \
        MODEL_ID=gpt-4o-mini \
        YOUCOM_RESEARCH_EFFORT=standard


# ─── 8. Grab the public URL ─────────────────────────────────────────
APP_URL=$(az containerapp show \
    --resource-group $RG \
    --name $ACA_APP \
    --query properties.configuration.ingress.fqdn -o tsv)

echo ""
echo "✔ Deployed. Backend URL: https://$APP_URL"
echo "  Health check:          https://$APP_URL/api/v1/gts/health"
echo "  Update FE:             VITE_API_URL=https://$APP_URL"


# ═══════════════════════════════════════════════════════════════════════
# Redeploy (subsequent releases) — 30 seconds instead of 15 minutes:
# ═══════════════════════════════════════════════════════════════════════
#
#   IMAGE_TAG=v2
#   az acr build --registry $ACR_NAME --image gts-backend:$IMAGE_TAG --file Dockerfile ..
#   az containerapp update -g $RG -n $ACA_APP \
#       --image $ACR_LOGIN_SERVER/gts-backend:$IMAGE_TAG
#
# Rotate a secret without redeploying:
#
#   az containerapp secret set -g $RG -n $ACA_APP --secrets openai-api-key=<new>
#   az containerapp revision restart -g $RG -n $ACA_APP --revision <latest>
#
# Tail logs:
#
#   az containerapp logs show -g $RG -n $ACA_APP --follow
