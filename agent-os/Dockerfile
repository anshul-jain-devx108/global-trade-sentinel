# syntax=docker/dockerfile:1.7
#
# GTS backend — production image for Azure Container Apps.
#
# Two-stage build:
#   1. builder — installs deps into /opt/venv (isolated from system Python)
#   2. runtime — slim image, non-root user, only what's needed to run
#
# Build:      docker build -t gts-backend:latest .
# Run local:  docker run -p 8000:8000 --env-file .env gts-backend:latest

# ─── Stage 1: builder ────────────────────────────────────────────────
FROM python:3.12-slim AS builder

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

# System build deps — needed for wheels that don't ship binaries (rare, but
# psycopg2 / pymssql fall in this bucket if we swap DB later).
RUN apt-get update && apt-get install -y --no-install-recommends \
        build-essential \
        curl \
    && rm -rf /var/lib/apt/lists/*

# uv is the same tool the dev workflow uses (`uv sync` locally). Installing
# via uv here means the container gets the exact versions from `uv.lock`,
# not a hand-maintained requirements.txt that can drift.
RUN pip install --no-cache-dir uv

WORKDIR /build
RUN python -m venv /opt/venv
ENV PATH="/opt/venv/bin:$PATH"

# Install deps first (cache layer). pyproject.toml + uv.lock pin everything.
COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-install-project --python /opt/venv/bin/python


# ─── Stage 2: runtime ────────────────────────────────────────────────
FROM python:3.12-slim AS runtime

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PATH="/opt/venv/bin:$PATH" \
    HOST=0.0.0.0 \
    PORT=8000 \
    RELOAD=0 \
    ENVIRONMENT=PRODUCTION \
    LOG_FILE=- \
    LOG_FORMAT=json

# Copy the virtual env from the builder — no compilers / build tools in
# the final image. Keeps the image ~200 MB instead of ~800 MB.
COPY --from=builder /opt/venv /opt/venv

WORKDIR /app

# App source. `.dockerignore` filters out .venv, .env, data/, temp/, __pycache__.
COPY . /app

# Runtime writable dirs. `data/` is used only if DATABASE_URL is unset
# (SQLite fallback) — in Azure we'll set DATABASE_URL to Postgres, so
# this stays empty. `logs/` is a fallback if LOG_FILE ever gets pointed
# at a file instead of stdout.
RUN mkdir -p /app/data /app/logs

# Non-root user — ACA doesn't require it but it's a defence-in-depth
# defaulting away from running Python as root.
RUN useradd --create-home --shell /bin/bash gts \
    && chown -R gts:gts /app
USER gts

EXPOSE 8000

# Health check — hits the router that the app registers itself, so if
# it fails the container is genuinely unhealthy (not just slow to boot).
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
    CMD python -c "import urllib.request,sys; \
        sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:8000/api/v1/gts/health', timeout=3).status==200 else 1)"

# We don't call `agent_os.serve(reload=True, app='main:app')` here because
# reload would spawn a watcher process — pointless in prod. Uvicorn direct
# gives predictable single-process behaviour, which matches the in-memory
# SweepTaskManager assumption (single replica).
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "1"]
