#!/usr/bin/env bash
# Starts the reference server (server/, built) over HTTP with the fixtures and
# runs the whole suite against it, including the R1 restart check. CI runs this.
set -euo pipefail
cd "$(dirname "$0")/.."
HTTP_PORT=${HTTP_PORT:-8090}
PAGE_PORT=${PAGE_PORT:-8091}
URL="http://127.0.0.1:$HTTP_PORT/mcp"
WORK=$(mktemp -d)
CONFIG=conformance/fixtures/config.json
PID=

start() {
  node server/dist/src/main.js --db "$WORK/tasks.db" --http-port "$HTTP_PORT" \
    --tokens conformance/fixtures/tokens.json --approvers conformance/fixtures/approvers.json \
    --page-port "$PAGE_PORT" --approve-cap-hours 1 --ask-cap-hours 2 2>>"$WORK/server.log" &
  PID=$!
  for _ in $(seq 100); do
    curl -s -o /dev/null "http://127.0.0.1:$HTTP_PORT/" && return 0
    sleep 0.1
  done
  echo "server did not start"; cat "$WORK/server.log"; return 1
}
stop() { kill "$PID" 2>/dev/null || true; wait "$PID" 2>/dev/null || true; }
trap 'stop; cp "$WORK/server.log" conformance/server.log 2>/dev/null || true' EXIT

start
node conformance/dist/cli.js --url "$URL" --config "$CONFIG" --persist-out "$WORK/persist.json"
node conformance/dist/cli.js --url "$URL" --config "$CONFIG"
stop
start
node conformance/dist/cli.js --url "$URL" --config "$CONFIG" --persist-in "$WORK/persist.json"
