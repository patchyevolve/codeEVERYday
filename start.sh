#!/usr/bin/env bash
#
# start.sh — bring up the full local stack: executor, api, worker, web.
#
# Workspace packages (@cpd/core, @cpd/ai, ...) resolve to their dist/ output,
# so they are rebuilt first. Without that step, edits under packages/*/src are
# silently ignored by everything running under tsx — a source of very confusing
# "I changed it but the API still behaves the old way" bugs.
#
# Env:
#   SKIP_BUILD=1   skip the workspace build (faster restarts)
#   SKIP_WEB=1     start only the backend services
set -euo pipefail
cd "$(dirname "$0")"

API_PORT="${API_PORT:-4000}"
WEB_PORT="${WEB_PORT:-5173}"
EXECUTOR_PORT="${EXECUTOR_PORT:-4100}"

log() { printf '[start.sh] %s\n' "$*"; }

# ── build ────────────────────────────────────────────────────────────────────
if [[ "${SKIP_BUILD:-0}" == "1" ]]; then
  log "SKIP_BUILD=1 — not rebuilding workspace packages"
else
  log "building workspace packages (SKIP_BUILD=1 to skip)..."
  if ! npm run build > /tmp/build.log 2>&1; then
    log "build FAILED — last 25 lines of /tmp/build.log:"
    tail -n 25 /tmp/build.log
    exit 1
  fi
  log "build ok"
fi

# ── stop anything already holding our ports ──────────────────────────────────
for port in "${EXECUTOR_PORT}" "${API_PORT}" "${WEB_PORT}"; do
  fuser -k "${port}/tcp" >/dev/null 2>&1 || true
done
sleep 1

# ── start ────────────────────────────────────────────────────────────────────
PIDS=()
cleanup() {
  trap - EXIT INT TERM
  log "stopping..."
  for pid in "${PIDS[@]:-}"; do
    kill "$pid" 2>/dev/null || true
  done
  wait 2>/dev/null || true
}
trap cleanup EXIT INT TERM

start() { # name logfile cmd...
  local name="$1" logfile="$2"; shift 2
  log "starting ${name} -> ${logfile}"
  nohup "$@" > "$logfile" 2>&1 &
  PIDS+=($!)
}

start "executor" /tmp/executor.log node --import tsx apps/executor/src/index.ts
start "api"      /tmp/api.log      node --import tsx apps/api/src/index.ts
start "worker"   /tmp/worker.log   node --import tsx apps/worker/src/index.ts

if [[ "${SKIP_WEB:-0}" != "1" ]]; then
  log "starting web -> /tmp/web.log"
  (cd apps/web && nohup npx vite --host --port "$WEB_PORT" > /tmp/web.log 2>&1) &
  PIDS+=($!)
fi

# ── wait for health ──────────────────────────────────────────────────────────
wait_for() { # name url timeout_seconds
  local name="$1" url="$2" timeout="${3:-60}"
  for _ in $(seq 1 "$timeout"); do
    if curl -fsS -o /dev/null --max-time 2 "$url" 2>/dev/null; then
      log "${name} healthy (${url})"
      return 0
    fi
    sleep 1
  done
  log "${name} did not become healthy within ${timeout}s — giving up"
  return 1
}

wait_for "executor" "http://localhost:${EXECUTOR_PORT}/health" 60
wait_for "api"      "http://localhost:${API_PORT}/ready"       60
if [[ "${SKIP_WEB:-0}" != "1" ]]; then
  wait_for "web" "http://localhost:${WEB_PORT}/" 60 || true
fi

log "stack is up:"
log "  api      http://localhost:${API_PORT}   (health /health, ready /ready)"
log "  executor http://localhost:${EXECUTOR_PORT}"
log "  web      http://localhost:${WEB_PORT}"
log "logs: /tmp/api.log /tmp/executor.log /tmp/worker.log /tmp/web.log"
log "Ctrl-C to stop everything."

# Keep the script alive while the children run, and exit if one of them dies.
wait -n 2>/dev/null || wait
log "a service exited — shutting the rest down"
