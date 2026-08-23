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
# This talks to Railway's HTTP API directly rather than through the `railway`
# CLI. The CLI's variable/service subcommands have changed shape more than once
# and a script that shells out to them breaks silently when they do; the API
# calls below are the exact sequence this connector is known to deploy with.
#
# Source is uploaded straight from this folder, so no code-host connection and
# no repository access is involved at any point.
#
# Idempotent: safe to re-run. Never prints a secret value.

set -euo pipefail

API="https://backboard.railway.com/graphql/v2"
SERVICE_NAME="${SERVICE_NAME:-replyflow-connector}"
MOUNT_PATH="/data"
PORT="8080"
CONTROL_PLANE_URL="${CONTROL_PLANE_URL:-https://cloud-reactive-hosting-backend.rork.app}"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(basename "$HERE")"

step() { printf '\n\033[1;36m==> %s\033[0m\n' "$1"; }
note() { printf '    %s\n' "$1"; }
fail() { printf '\n\033[1;31mFAILED: %s\033[0m\n' "$1" >&2; exit 1; }

command -v curl >/dev/null || fail "curl not found."
command -v jq   >/dev/null || fail "jq not found. Install it, then re-run."
command -v tar  >/dev/null || fail "tar not found."
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

# One GraphQL call. Arguments: <query> <variables-json>. Fails loudly on an
# `errors` array, which the API returns with HTTP 200.
gql() {
  local out
  out="$(jq -nc --arg q "$1" --argjson v "$2" '{query:$q,variables:$v}' \
    | curl -s -m 45 -X POST "$API" \
        -H "Project-Access-Token: ${RAILWAY_TOKEN}" \
        -H 'Content-Type: application/json' \
        --data-binary @-)"
  if jq -e '.errors' >/dev/null 2>&1 <<<"$out"; then
    fail "Railway rejected a request: $(jq -r '.errors[0].message // "unknown"' <<<"$out")"
  fi
  printf '%s' "$out"
}

step "Checking project access"
SCOPE="$(gql 'query { projectToken { projectId environmentId project { name } } }' '{}')"
PROJECT_ID="$(jq -r '.data.projectToken.projectId' <<<"$SCOPE")"
ENVIRONMENT_ID="$(jq -r '.data.projectToken.environmentId' <<<"$SCOPE")"
[ "$PROJECT_ID" != "null" ] || fail "That token is not a project token. Create one under Project Settings -> Tokens."
note "Project: $(jq -r '.data.projectToken.project.name' <<<"$SCOPE")"

step "Locating the service"
SERVICES="$(gql 'query($id:String!){ project(id:$id){ services{ edges{ node{ id name } } } } }' \
  "$(jq -nc --arg id "$PROJECT_ID" '{id:$id}')")"
SERVICE_ID="$(jq -r --arg n "$SERVICE_NAME" \
  '[.data.project.services.edges[].node] | (map(select(.name == $n)) + .) | .[0].id // empty' <<<"$SERVICES")"
if [ -z "$SERVICE_ID" ]; then
  note "No service in this project yet — creating \"$SERVICE_NAME\"."
  CREATED="$(gql 'mutation($input:ServiceCreateInput!){ serviceCreate(input:$input){ id } }' \
    "$(jq -nc --arg p "$PROJECT_ID" --arg n "$SERVICE_NAME" '{input:{projectId:$p,name:$n}}')")"
  SERVICE_ID="$(jq -r '.data.serviceCreate.id' <<<"$CREATED")"
  [ -n "$SERVICE_ID" ] && [ "$SERVICE_ID" != "null" ] || fail "Could not create a service."
fi
note "Service: $SERVICE_ID"

# The tarball keeps the connector/ prefix, so the build folder has to point at it.
# Without this the platform's language detector inspects the archive root, finds
# only a directory, and refuses to build at all.
step "Setting the build folder to \"$ROOT_DIR\" and the health check to /health"
gql 'mutation($serviceId:String!,$environmentId:String,$input:ServiceInstanceUpdateInput!){ serviceInstanceUpdate(serviceId:$serviceId, environmentId:$environmentId, input:$input) }' \
  "$(jq -nc --arg s "$SERVICE_ID" --arg e "$ENVIRONMENT_ID" --arg r "$ROOT_DIR" \
     '{serviceId:$s,environmentId:$e,input:{rootDirectory:$r,healthcheckPath:"/health"}}')" >/dev/null
note "ok"

step "Writing service variables (values are never echoed)"
gql 'mutation($input:VariableCollectionUpsertInput!){ variableCollectionUpsert(input:$input) }' \
  "$(jq -nc \
      --arg p "$PROJECT_ID" --arg e "$ENVIRONMENT_ID" --arg s "$SERVICE_ID" \
      --arg apiId "$TELEGRAM_API_ID" --arg apiHash "$TELEGRAM_API_HASH" \
      --arg sessionKey "$SESSION_ENCRYPTION_KEY" --arg shared "$CONNECTOR_SHARED_SECRET" \
      --arg control "$CONTROL_PLANE_URL" --arg mount "$MOUNT_PATH" \
      '{input:{projectId:$p,environmentId:$e,serviceId:$s,skipDeploys:true,replace:false,variables:{
         TELEGRAM_API_ID:$apiId, TELEGRAM_API_HASH:$apiHash,
         SESSION_ENCRYPTION_KEY:$sessionKey, CONNECTOR_SHARED_SECRET:$shared,
         CONTROL_PLANE_URL:$control, SESSION_PATH:$mount }}}')" >/dev/null
for name in TELEGRAM_API_ID TELEGRAM_API_HASH SESSION_ENCRYPTION_KEY CONNECTOR_SHARED_SECRET CONTROL_PLANE_URL SESSION_PATH; do
  note "set $name"
done

step "Ensuring the persistent disk exists at $MOUNT_PATH"
MOUNTS="$(gql 'query($id:String!){ environment(id:$id){ volumeInstances{ edges{ node{ mountPath serviceId } } } } }' \
  "$(jq -nc --arg id "$ENVIRONMENT_ID" '{id:$id}')")"
if jq -e --arg m "$MOUNT_PATH" --arg s "$SERVICE_ID" \
     '[.data.environment.volumeInstances.edges[].node] | any(.mountPath == $m and .serviceId == $s)' \
     >/dev/null <<<"$MOUNTS"; then
  note "volume already mounted at $MOUNT_PATH"
else
  gql 'mutation($input:VolumeCreateInput!){ volumeCreate(input:$input){ id } }' \
    "$(jq -nc --arg p "$PROJECT_ID" --arg e "$ENVIRONMENT_ID" --arg s "$SERVICE_ID" --arg m "$MOUNT_PATH" \
       '{input:{projectId:$p,environmentId:$e,serviceId:$s,mountPath:$m}}')" >/dev/null
  note "created volume at $MOUNT_PATH"
fi

step "Ensuring a public domain on port $PORT"
DOMAINS="$(gql 'query($p:String!,$e:String!,$s:String!){ domains(projectId:$p, environmentId:$e, serviceId:$s){ serviceDomains{ domain targetPort } } }' \
  "$(jq -nc --arg p "$PROJECT_ID" --arg e "$ENVIRONMENT_ID" --arg s "$SERVICE_ID" '{p:$p,e:$e,s:$s}')")"
DOMAIN="$(jq -r '.data.domains.serviceDomains[0].domain // empty' <<<"$DOMAINS")"
if [ -z "$DOMAIN" ]; then
  CREATED_DOMAIN="$(gql 'mutation($input:ServiceDomainCreateInput!){ serviceDomainCreate(input:$input){ domain } }' \
    "$(jq -nc --arg e "$ENVIRONMENT_ID" --arg s "$SERVICE_ID" --argjson port "$PORT" \
       '{input:{environmentId:$e,serviceId:$s,targetPort:$port}}')")"
  DOMAIN="$(jq -r '.data.serviceDomainCreate.domain' <<<"$CREATED_DOMAIN")"
fi
[ -n "$DOMAIN" ] && [ "$DOMAIN" != "null" ] || fail "No public domain could be attached."
BASE="https://${DOMAIN#https://}"
note "$BASE"

step "Uploading source and building"
TARBALL="$(mktemp -t connector-XXXXXX.tar.gz)"
trap 'rm -f "$TARBALL"' EXIT
# storage/ holds live Telegram sessions and vendor/ is rebuilt inside the image;
# neither belongs in an upload.
tar -czf "$TARBALL" -C "$(dirname "$HERE")" \
  --exclude="${ROOT_DIR}/storage/*" --exclude="${ROOT_DIR}/vendor" "$ROOT_DIR"
note "bundled $(wc -c <"$TARBALL" | tr -d ' ') bytes"

UP="$(curl -s -m 300 -X POST \
  "https://backboard.railway.com/project/${PROJECT_ID}/environment/${ENVIRONMENT_ID}/up?serviceId=${SERVICE_ID}" \
  -H "Project-Access-Token: ${RAILWAY_TOKEN}" \
  -H 'Content-Type: multipart/form-data' \
  --data-binary @"$TARBALL")"
DEPLOYMENT_ID="$(jq -r '.deploymentId // empty' <<<"$UP")"
[ -n "$DEPLOYMENT_ID" ] || fail "Upload rejected: $(printf '%s' "$UP" | head -c 400)"
note "deployment $DEPLOYMENT_ID"

step "Waiting for the build"
STATUS=""
for attempt in $(seq 1 60); do
  STATUS="$(gql 'query($id:String!){ deployment(id:$id){ status } }' \
    "$(jq -nc --arg id "$DEPLOYMENT_ID" '{id:$id}')" | jq -r '.data.deployment.status')"
  case "$STATUS" in
    SUCCESS) note "build succeeded"; break ;;
    FAILED|CRASHED|REMOVED)
      printf '\nBuild log:\n'
      gql 'query($id:String!){ buildLogs(deploymentId:$id, limit:80){ message } }' \
        "$(jq -nc --arg id "$DEPLOYMENT_ID" '{id:$id}')" | jq -r '.data.buildLogs[].message'
      fail "Build ended as $STATUS."
      ;;
    *) note "attempt $attempt/60 -> $STATUS"; sleep 10 ;;
  esac
done
[ "$STATUS" = "SUCCESS" ] || fail "Build did not finish in time."

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
[ "$healthy" -eq 1 ] || fail "Service never became healthy."

step "Readiness report"
curl -s -m 15 "$BASE/selfcheck" >/tmp/rw-selfcheck.json || true
jq -r '.summary, (.checks[] | "  [\(.status)] \(.name) — \(.detail)")' /tmp/rw-selfcheck.json 2>/dev/null \
  || cat /tmp/rw-selfcheck.json

printf '\n\033[1;32mDone.\033[0m Set CONNECTOR_BASE_URL=%s on the engine, then press "Test service" in the console.\n' "$BASE"
printf 'Then delete the project token: Railway -> Project Settings -> Tokens.\n'
