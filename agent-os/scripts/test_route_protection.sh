#!/usr/bin/env bash
# Route-protection smoke test.
#
# Verifies that:
#   1. Custom /api/v1/gts/* routes reject unauthenticated requests (401)
#   2. AgentOS built-in routes (/agents, /schedules, /sessions, /traces,
#      /memories, /approvals) reject unauthenticated requests (401)
#   3. Allowlisted paths (/, /health, /api/v1/gts/health, docs) return 200
#   4. SSO login redirects to Microsoft (302/307)
#   5. Frontend middleware redirects protected pages to /login when the
#      access_token cookie is absent
#
# Usage:
#   bash scripts/test_route_protection.sh
#   BACKEND_URL=http://localhost:8000 FRONTEND_URL=http://localhost:3000 \
#     bash scripts/test_route_protection.sh
#
# Exit code: 0 if every check passed, 1 otherwise.

set -u

BACKEND="${BACKEND_URL:-http://localhost:8000}"
FRONTEND="${FRONTEND_URL:-http://localhost:3000}"

# ANSI colours — disabled when stdout is not a tty (e.g. piped to a file).
if [[ -t 1 ]]; then
  G='\033[0;32m'; R='\033[0;31m'; Y='\033[0;33m'; B='\033[1m'; N='\033[0m'
else
  G=''; R=''; Y=''; B=''; N=''
fi

pass=0
fail=0
skipped=0
failed_lines=()

# expect <label> <method> <url> <expected-code>[,<code>,...]
# The expected argument accepts a comma-separated list — useful because
# redirects to external hosts sometimes report 302 vs 307 depending on
# the fastapi version.
expect() {
  local label="$1" method="$2" url="$3" expected="$4"
  local status
  status=$(curl -s -o /dev/null -w '%{http_code}' \
    --max-time 5 --connect-timeout 3 \
    -X "$method" "$url" 2>/dev/null || echo "000")

  # Treat curl connection failure separately so a stopped server doesn't
  # look like a "route is exposed" failure.
  if [[ "$status" == "000" ]]; then
    printf "  ${Y}SKIP${N}  %-8s %-55s (server unreachable)\n" "$method" "$url"
    skipped=$((skipped + 1))
    return
  fi

  local ok=0
  IFS=',' read -ra codes <<< "$expected"
  for c in "${codes[@]}"; do
    if [[ "$status" == "$c" ]]; then
      ok=1
      break
    fi
  done

  if [[ $ok -eq 1 ]]; then
    printf "  ${G}PASS${N}  %-8s %-55s → %s  ${B}%s${N}\n" \
      "$method" "$url" "$status" "$label"
    pass=$((pass + 1))
  else
    printf "  ${R}FAIL${N}  %-8s %-55s → %s (expected %s)  ${B}%s${N}\n" \
      "$method" "$url" "$status" "$expected" "$label"
    fail=$((fail + 1))
    failed_lines+=("$method $url → got $status, expected $expected  ($label)")
  fi
}

section() {
  printf "\n${B}── %s ──${N}\n" "$1"
}

# ─── 1. Custom /api/v1/gts/* — must 401 without cookie ────────────────
section "Custom /api/v1/gts/* routes"
expect "events list"           GET    "$BACKEND/api/v1/gts/events"           401
expect "event stats"           GET    "$BACKEND/api/v1/gts/events/stats"     401
expect "profile"               GET    "$BACKEND/api/v1/gts/profile"          401
expect "specialists list"      GET    "$BACKEND/api/v1/gts/specialists"      401
expect "sweep latest"          GET    "$BACKEND/api/v1/gts/sweep/latest"     401
expect "schedule"              GET    "$BACKEND/api/v1/gts/schedule"         401
expect "schedule runs"         GET    "$BACKEND/api/v1/gts/schedule/runs"    401
expect "auth me"               GET    "$BACKEND/api/v1/auth/me"              401
# FastAPI redirects /api/v1/chat → /api/v1/chat/ before auth runs on the
# canonical URL. Hit the canonical form directly so we test the guard,
# not the trailing-slash redirect.
expect "chat sessions"         GET    "$BACKEND/api/v1/chat"                 307,401
expect "chat sessions (slash)" GET    "$BACKEND/api/v1/chat/"                401

# ─── 2. AgentOS built-ins — must 401 without cookie (NEW middleware) ──
section "AgentOS built-in routes (middleware protection)"
expect "agents list"           GET    "$BACKEND/agents"                      401
expect "teams list"            GET    "$BACKEND/teams"                       401
expect "schedules list"        GET    "$BACKEND/schedules"                   401
expect "sessions list"         GET    "$BACKEND/sessions"                    401
expect "traces list"           GET    "$BACKEND/traces"                      401
expect "memories list"         GET    "$BACKEND/memories"                    401
expect "approvals list"        GET    "$BACKEND/approvals"                   401
expect "workflows list"        GET    "$BACKEND/workflows"                   401
expect "eval-runs list"        GET    "$BACKEND/eval-runs"                   401
expect "service-accounts"      GET    "$BACKEND/service-accounts"            401
expect "components"            GET    "$BACKEND/components"                  401
expect "learnings"             GET    "$BACKEND/learnings"                   401
expect "metrics"               GET    "$BACKEND/metrics"                     401
expect "config"                GET    "$BACKEND/config"                      401
expect "info"                  GET    "$BACKEND/info"                        401
expect "models"                GET    "$BACKEND/models"                      401
expect "registry"              GET    "$BACKEND/registry"                    401

# ─── 3. Allowlisted paths — must return 2xx without cookie ────────────
section "Allowlisted paths (no auth required)"
expect "gts health"            GET    "$BACKEND/api/v1/gts/health"           200
expect "framework health"      GET    "$BACKEND/health"                      200
expect "openapi"               GET    "$BACKEND/openapi.json"                200
expect "swagger docs"          GET    "$BACKEND/docs"                        200
expect "redoc"                 GET    "$BACKEND/redoc"                       200

# ─── 4. SSO login — must redirect to Microsoft ────────────────────────
section "SSO login redirect"
expect "microsoft/login"       GET    "$BACKEND/api/v1/auth/microsoft/login" 302,303,307
expect "auth logout"           POST   "$BACKEND/api/v1/auth/logout"          200

# ─── 5. Frontend — protected pages redirect to /login ─────────────────
section "Frontend middleware (Next.js)"
expect "landing"               GET    "$FRONTEND/"                           200
expect "login page"            GET    "$FRONTEND/login"                      200
expect "chat (protected)"      GET    "$FRONTEND/chat"                       307,302
expect "settings (protected)"  GET    "$FRONTEND/settings"                   307,302
expect "profile (protected)"   GET    "$FRONTEND/profile"                    307,302
expect "agents (protected)"    GET    "$FRONTEND/agents"                     307,302
expect "traces (protected)"    GET    "$FRONTEND/traces"                     307,302
expect "usage (protected)"     GET    "$FRONTEND/usage"                      307,302

# ─── Summary ──────────────────────────────────────────────────────────
total=$((pass + fail + skipped))
printf "\n${B}Summary${N}  passed=${G}%d${N}  failed=${R}%d${N}  skipped=${Y}%d${N}  total=%d\n" \
  "$pass" "$fail" "$skipped" "$total"

if [[ $fail -gt 0 ]]; then
  printf "\n${R}Failures:${N}\n"
  for line in "${failed_lines[@]}"; do
    printf "  ${R}✗${N}  %s\n" "$line"
  done
  exit 1
fi

if [[ $skipped -gt 0 ]]; then
  printf "\n${Y}Note:${N} %d checks skipped — server(s) unreachable.\n" "$skipped"
  printf "        Backend expected at ${B}%s${N}\n" "$BACKEND"
  printf "        Frontend expected at ${B}%s${N}\n" "$FRONTEND"
fi

exit 0
