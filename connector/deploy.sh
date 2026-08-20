#!/usr/bin/env bash
#
# One-shot deploy of the always-on Telegram connector to Railway.
#
# Usage:
#   export RAILWAY_TOKEN=<project token>     # Railway -> Project Settings -> Tokens
#   export TELEGRAM_API_ID=...
#   export TELEGRAM_API_HASH=...
#   export SESSION_ENCRYPTION_KEY=...
#   export CONNECTOR_SHARED_SECRET=...
#   ./connector/deploy.sh
#
# Idempotent: safe to re-run. Never prints a secret value.

set -euo pipefail

SERVICE="${SERVICE:-}"
MOUNT_PATH="/data"
PORT="8080"
CONTROL_PLANE_URL="${CONTROL_PLANE_URL:-https://cloud-reactive-hosting-backend.rork.app}"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

step() { printf '\n\033[1;36m==> %s\033[0m\n' "$1"; }
note() { printf '    %s\n' "$1"; }
fail() { printf '\n\033[1;31mFAILED: %s\033[0m\n' "$1" >&2; exit 1; }

command -v railway >/dev/null || fail "railway CLI not found. Install: bash <(curl -fsSL railway.com/install.sh) -y"
command -v jq >/dev/null || fail "jq not found. Install it, then re-run."
[ -n "${RAILWAY_TOKEN:-}" ] || fail "RAILWAY_TOKEN is not set. Create a PROJECT token: Railway -> Project Settings -> Tokens."

# Validate every value up front so a typo fails here rather than producing a
# service that looks healthy but can never log in to Telegram.
for required in SESSION_ENCRYPTION_KEY CONNECTOR_SHARED_SECRET TELEGRAM_API_ID TELEGRAM_API_HASH; do
  [ -n "${!required:-}" ] || fail "$required is not set in this shell."
done
[[ "$TELEGRAM_API_ID" =~ ^[0-9]{4,12}$ ]] || fail "TELEGRAM_API_ID must be 4-12 digits."
[[ "$TELEGRAM_API_HASH" =~ ^[a-fA-F0-9]{32}$ ]] || fail "TELEGRAM_API_HASH must be exactly 32 hex characters."
[ "${#SESSION_ENCRYPTION_KEY}" -ge 32 ] || fail "SESSION_ENCRYPTION_KEY must be at least 32 characters."
[ "${#CONNECTOR_SHARED_SECRET}" -ge 24 ] || fail "CONNECTOR_SHARED_SECRET must be at least 24 characters."

cd "$HERE"

step "Checking project access"
railway status --json >/tmp/rw-status.json 2>/tmp/rw-status.err \
  || { cat /tmp/rw-status.err >&2; fail "Token rejected or project unreachable."; }
note "Project: $(jq -r '.name // "?"' /tmp/rw-status.json)"

# Returns the first service name, or empty when the project has none.
detect_service() {
  railway service list --json >/tmp/rw-services.json 2>/dev/null || echo '[]' >/tmp/rw-services.json
  jq -r '[.. | objects | select(has("name")) | .name] | .[0] // empty' /tmp/rw-services.json
}

step "Locating the service"
[ -n "$SERVICE" ] || SERVICE="$(detect_service)"
if [ -z "$SERVICE" ]; then
  note "No service in this project yet — creating one from this folder."
  # Bootstrap only: this build has no variables yet, so it is expected to fail
  # its health check. We just need the service to exist so we can configure it.
  railway up --ci --yes >/dev/null 2>&1 || true
  SERVICE="$(detect_service)"
  [ -n "$SERVICE" ] || fail "Could not create a service. Create one in the Railway UI, then re-run."
fi
note "Service: $SERVICE"

step "Writing service variables (values are never echoed)"
set_var() {
  printf '%s' "$2" | railway variable set "$1" --stdin --service "$SERVICE" --skip-deploys >/dev/null 2>&1 \
    || fail "Could not set $1"
  note "set $1"
}
set_var TELEGRAM_API_ID         "$TELEGRAM_API_ID"
set_var TELEGRAM_API_HASH       "$TELEGRAM_API_HASH"
set_var SESSION_ENCRYPTION_KEY  "$SESSION_ENCRYPTION_KEY"
set_var CONNECTOR_SHARED_SECRET "$CONNECTOR_SHARED_SECRET"
set_var CONTROL_PLANE_URL       "$CONTROL_PLANE_URL"
set_var SESSION_PATH            "$MOUNT_PATH"

step "Ensuring the persistent disk exists at $MOUNT_PATH"
railway volume list --json >/tmp/rw-volumes.json 2>/dev/null || echo '[]' >/tmp/rw-volumes.json
if jq -e --arg m "$MOUNT_PATH" '[.. | objects | .mountPath? // empty] | any(. == $m)' /tmp/rw-volumes.json >/dev/null 2>&1; then
  note "volume already mounted at $MOUNT_PATH"
else
  if railway volume add --service "$SERVICE" --mount-path "$MOUNT_PATH" >/dev/null 2>&1; then
    note "created volume at $MOUNT_PATH"
  else
    note "WARNING: could not create the volume — the Telegram login will not survive a restart."
  fi
fi

step "Uploading and building (streaming build log)"
railway up --ci --service "$SERVICE" || {
  printf '\nBuild failed. Last 80 lines of the build log:\n'
  railway logs --build --service "$SERVICE" --lines 80 2>/dev/null || true
  fail "Deploy did not complete."
}

step "Ensuring a public domain on port $PORT"
railway domain --service "$SERVICE" --port "$PORT" >/dev/null 2>&1 || true
railway domain list --service "$SERVICE" --json >/tmp/rw-domains.json 2>/dev/null || echo '[]' >/tmp/rw-domains.json
DOMAIN="$(jq -r '[.. | objects | .domain? // empty] | map(select(type == "string")) | .[0] // empty' /tmp/rw-domains.json)"
[ -n "$DOMAIN" ] || fail "No public domain is attached. Add one under Settings -> Networking, then re-run."
BASE="https://${DOMAIN#https://}"
note "$BASE"

step "Waiting for the service to answer"
healthy=0
for attempt in $(seq 1 30); do
  code="$(curl -s -m 10 -o /tmp/rw-health.json -w '%{http_code}' "$BASE/health" || echo 000)"
  if [ "$code" = "200" ]; then
    note "/health OK: $(cat /tmp/rw-health.json)"
    healthy=1
    break
  fi
  note "attempt $attempt/30 -> HTTP $code"
  sleep 10
done
if [ "$healthy" -ne 1 ]; then
  printf '\nLast 60 lines of the deployment log:\n'
  railway logs --deployment --service "$SERVICE" --lines 60 2>/dev/null || true
  fail "Service never became healthy."
fi

step "Readiness report"
curl -s -m 15 "$BASE/selfcheck" >/tmp/rw-selfcheck.json || true
jq -r '.summary, (.checks[] | "  [\(.status)] \(.name) — \(.detail)")' /tmp/rw-selfcheck.json 2>/dev/null \
  || cat /tmp/rw-selfcheck.json

printf '\n\033[1;32mDone.\033[0m Set CONNECTOR_BASE_URL=%s on the engine, then press "Test service" in the console.\n' "$BASE"
printf 'Then delete the project token: Railway -> Project Settings -> Tokens.\n'
