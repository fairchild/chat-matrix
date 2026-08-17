#!/usr/bin/env bash
# Stop everything scripts/run.sh (and scripts/preview.sh) started.
#
#   ./scripts/stop.sh           everything in .run/
#   ./scripts/stop.sh hosted    only the hosted preview (pidfiles hosted-*.pid)
#   ./scripts/stop.sh backend   only backends — any pidfile prefix works
set -uo pipefail
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/stacks.sh"

[ -d "$RUN_DIR" ] || { echo "nothing running"; exit 0; }
prefix="${1:-}"

shopt -s nullglob
found=0
for pidfile in "$RUN_DIR"/${prefix:+$prefix-}*.pid; do
  found=1
  pid="$(cat "$pidfile")"
  label="$(basename "$pidfile" .pid)"
  if kill -0 "$pid" 2>/dev/null; then
    # Dev servers spawn children (uvicorn reloader, next), so kill the group.
    kill -TERM -"$(ps -o pgid= "$pid" | tr -d ' ')" 2>/dev/null || kill -TERM "$pid" 2>/dev/null
    printf '  stopped %s (pid %s)\n' "$label" "$pid"
  else
    printf '  %s already gone\n' "$label"
  fi
  rm -f "$pidfile"
done

[ "$found" -eq 1 ] || echo "nothing running"
