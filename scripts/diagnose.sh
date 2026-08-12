#!/usr/bin/env bash
# Walks the request path layer by layer and reports the first thing that breaks.
#
#   ./scripts/diagnose.sh                       # auto-discover URLs from gcloud
#   ./scripts/diagnose.sh <frontend> <backend>  # explicit URLs
#   TOKEN=<google_id_token> ./scripts/diagnose.sh   # also test authenticated calls
#
# Get a token: sign in to the app, open devtools console, run
#   JSON.parse(localStorage.getItem('token') ?? '""')
# or copy the Authorization header from a failing request.

set -uo pipefail

REGION="${REGION:-us-central1}"
BACKEND_SERVICE="${BACKEND_SERVICE:-hundred-days-backend}"
FRONTEND_SERVICE="${FRONTEND_SERVICE:-hundred-days-frontend}"

RED=$'\033[31m'; GREEN=$'\033[32m'; YELLOW=$'\033[33m'; BLUE=$'\033[34m'; DIM=$'\033[2m'; OFF=$'\033[0m'

FAILURES=0
pass() { printf '%s  PASS%s  %s\n' "$GREEN" "$OFF" "$1"; }
fail() { printf '%s  FAIL%s  %s\n' "$RED" "$OFF" "$1"; FAILURES=$((FAILURES+1)); }
warn() { printf '%s  WARN%s  %s\n' "$YELLOW" "$OFF" "$1"; }
info() { printf '%s        %s%s\n' "$DIM" "$1" "$OFF"; }
head2() { printf '\n%s== %s ==%s\n' "$BLUE" "$1" "$OFF"; }

FRONTEND_URL="${1:-}"
BACKEND_URL="${2:-}"

if [ -z "$FRONTEND_URL" ] || [ -z "$BACKEND_URL" ]; then
  head2 "Discovering service URLs via gcloud"
  if ! command -v gcloud >/dev/null 2>&1; then
    echo "gcloud not found. Pass URLs explicitly: $0 <frontend-url> <backend-url>" >&2
    exit 2
  fi
  BACKEND_URL="${BACKEND_URL:-$(gcloud run services describe "$BACKEND_SERVICE" --region "$REGION" --format='value(status.url)' 2>/dev/null)}"
  FRONTEND_URL="${FRONTEND_URL:-$(gcloud run services describe "$FRONTEND_SERVICE" --region "$REGION" --format='value(status.url)' 2>/dev/null)}"
  [ -n "$BACKEND_URL" ]  && info "backend  = $BACKEND_URL"  || fail "Could not resolve backend service URL — is it deployed?"
  [ -n "$FRONTEND_URL" ] && info "frontend = $FRONTEND_URL" || fail "Could not resolve frontend service URL — is it deployed?"
fi

# probe <label> <url> <expected_code> [auth_header]
probe() {
  local label="$1" url="$2" expected="$3" auth="${4:-}"
  local out code
  out=$(mktemp)
  if [ -n "$auth" ]; then
    code=$(curl -s -o "$out" -w '%{http_code}' --max-time 30 -H "Authorization: Bearer $auth" "$url" 2>/dev/null || echo 000)
  else
    code=$(curl -s -o "$out" -w '%{http_code}' --max-time 30 "$url" 2>/dev/null || echo 000)
  fi
  if [ "$code" = "$expected" ]; then
    pass "$label ($code)"
  else
    fail "$label — expected $expected, got $code"
    info "$(head -c 400 "$out")"
  fi
  LAST_BODY=$(cat "$out")
  LAST_CODE="$code"
  rm -f "$out"
}

# ---------------------------------------------------------------- layer 1
head2 "Layer 1 — backend container is up"
if [ -n "$BACKEND_URL" ]; then
  probe "backend /health" "$BACKEND_URL/health" 200
  if [ "$LAST_CODE" = "000" ]; then
    info "No HTTP response at all. The revision is likely crash-looping or not listening on \$PORT."
    info "Run: gcloud run services logs read $BACKEND_SERVICE --region $REGION --limit 50"
  fi
fi

# ---------------------------------------------------------------- layer 2
head2 "Layer 2 — env vars actually reached the container"
if [ -n "$BACKEND_URL" ]; then
  probe "backend /health/config" "$BACKEND_URL/health/config" 200
  if [ "$LAST_CODE" = "200" ]; then
    echo "$LAST_BODY" | jq . 2>/dev/null || echo "$LAST_BODY"
    if echo "$LAST_BODY" | jq -e '.mongoIsLocalhostFallback == true' >/dev/null 2>&1; then
      fail "Mongo connection string is the localhost fallback — MONGODB_ATLAS_URI never arrived."
    fi
    if echo "$LAST_BODY" | jq -e '.googleClientIdSet == false' >/dev/null 2>&1; then
      fail "Google client ID missing — every authenticated request will 401."
    fi
  fi
fi

# ---------------------------------------------------------------- layer 3
head2 "Layer 3 — backend can reach MongoDB Atlas"
if [ -n "$BACKEND_URL" ]; then
  probe "backend /health/db" "$BACKEND_URL/health/db" 200
  if [ "$LAST_CODE" != "200" ]; then
    info "Most likely causes, in order:"
    info "  1. Atlas Network Access does not allow 0.0.0.0/0 (Cloud Run egress IPs are dynamic)."
    info "  2. Wrong username/password or the database user lacks read/write."
    info "  3. The URI is missing the database name or has unescaped special chars in the password."
  fi
fi

# ---------------------------------------------------------------- layer 4
head2 "Layer 4 — frontend serves static assets"
if [ -n "$FRONTEND_URL" ]; then
  probe "frontend /" "$FRONTEND_URL/" 200
  probe "frontend /_frontend_health" "$FRONTEND_URL/_frontend_health" 200
  if [ "$LAST_CODE" = "200" ]; then
    echo "$LAST_BODY" | jq . 2>/dev/null || echo "$LAST_BODY"
    proxying_to=$(echo "$LAST_BODY" | jq -r '.proxying_to // empty' 2>/dev/null)
    if [ -n "$proxying_to" ] && [ -n "$BACKEND_URL" ] && [ "$proxying_to" != "$BACKEND_URL" ]; then
      warn "Frontend proxies to '$proxying_to' but the backend is at '$BACKEND_URL'. BACKEND_URL is stale."
    fi
  fi
fi

# ---------------------------------------------------------------- layer 5
head2 "Layer 5 — proxy actually reaches the backend"
if [ -n "$FRONTEND_URL" ]; then
  probe "frontend → backend /health" "$FRONTEND_URL/health" 200
  probe "frontend → backend /health/db" "$FRONTEND_URL/health/db" 200
fi

# ---------------------------------------------------------------- layer 6
head2 "Layer 6 — API surface and auth enforcement"
if [ -n "$FRONTEND_URL" ]; then
  probe "anonymous /api/Challenges/my (expect 401)" "$FRONTEND_URL/api/Challenges/my" 401
  case "$LAST_CODE" in
    404) info "404 means nginx rewrote the path or the Host header did not reach Cloud Run." ;;
    503) info "503 means nginx could not connect. Check BACKEND_URL on the frontend service." ;;
    200) warn "Anonymous request succeeded — [Authorize] is not being enforced." ;;
  esac
fi

if [ -n "${TOKEN:-}" ]; then
  head2 "Layer 7 — authenticated request with your token"
  probe "authenticated /health/auth" "$FRONTEND_URL/health/auth" 200 "$TOKEN"
  echo "$LAST_BODY" | jq '{authenticated, email}' 2>/dev/null || echo "$LAST_BODY"
  probe "authenticated /api/Challenges/my" "$FRONTEND_URL/api/Challenges/my" 200 "$TOKEN"
else
  head2 "Layer 7 — authenticated request (skipped)"
  info "Set TOKEN=<google_id_token> to test authenticated calls."
fi

# ---------------------------------------------------------------- logs
if [ "$FAILURES" -gt 0 ] && command -v gcloud >/dev/null 2>&1; then
  head2 "Recent backend logs"
  gcloud logging read \
    "resource.type=\"cloud_run_revision\" AND resource.labels.service_name=\"$BACKEND_SERVICE\"" \
    --limit=40 --freshness=30m \
    --format='value(timestamp, severity, textPayload, jsonPayload.message)' 2>/dev/null || true

  head2 "Recent frontend logs"
  gcloud logging read \
    "resource.type=\"cloud_run_revision\" AND resource.labels.service_name=\"$FRONTEND_SERVICE\"" \
    --limit=40 --freshness=30m \
    --format='value(timestamp, severity, textPayload, jsonPayload.message)' 2>/dev/null || true
fi

echo
if [ "$FAILURES" -eq 0 ]; then
  printf '%sAll checks passed.%s\n' "$GREEN" "$OFF"
else
  printf '%s%d check(s) failed — the first FAIL above is the layer that is broken.%s\n' "$RED" "$FAILURES" "$OFF"
fi
exit $(( FAILURES > 0 ? 1 : 0 ))
