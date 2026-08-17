#!/usr/bin/env bash
# Serve the hosted subset locally, exactly as it would deploy: static exports
# and the CopilotKit runtime hop under wrangler dev (workerd), URLs baked for
# localhost. Cells land at :PORT+1000, the index at :4000. Logs and pids in
# .run/, so scripts/stop.sh stops these too.
#
#   ./scripts/preview.sh              build, then serve
#   ./scripts/preview.sh --no-build   serve what's already built
#   ./scripts/preview.sh --stop       stop only the preview (the matrix stays up)
#   PREVIEW_BACKEND=https://…         point the cells at a deployed backend
set -euo pipefail
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/hosted.sh"

[ "${1:-}" = "--stop" ] && exec "$ROOT/scripts/stop.sh" hosted
[ "${1:-}" = "--no-build" ] || build_all preview

mkdir -p "$RUN_DIR"

serve() { # serve <name> <port> <dir> [wrangler dev args…]
  local name="$1" port="$2" dir="$3"; shift 3
  local pidfile="$RUN_DIR/hosted-$name.pid"
  if [ -f "$pidfile" ] && kill -0 "$(cat "$pidfile")" 2>/dev/null; then
    printf '  hosted %s already running (pid %s)\n' "$name" "$(cat "$pidfile")"; return
  fi
  # Explicit inspector ports: five wrangler devs starting at once otherwise
  # race for 9229+ and one of them dies with "address already in use".
  (cd "$dir" && exec bunx wrangler dev --port "$port" --inspector-port "$((port + 20000))" "$@") </dev/null >"$RUN_DIR/hosted-$name.log" 2>&1 &
  echo $! >"$pidfile"
  printf '  hosted %s → http://localhost:%s (pid %s)\n' "$name" "$port" "$!"
}

printf '\033[1mserving the hosted subset\033[0m\n'
for name in "${HOSTED_CELLS[@]}"; do
  if [ "$name" = copilotkit ]; then
    serve "$name" "$(preview_port "$name")" "$ROOT/frontends/$name" --var "BACKEND_URL:$PREVIEW_BACKEND"
  else
    serve "$name" "$(preview_port "$name")" "$ROOT/frontends/$name"
  fi
done
serve index "$PREVIEW_INDEX_PORT" "$ROOT/index"

printf '\n\033[1mwaiting for health\033[0m\n'
status=0
for name in "${HOSTED_CELLS[@]}"; do
  if wait_for_http "http://localhost:$(preview_port "$name")" 90; then
    printf '  \033[32m✓\033[0m %s → \033[4mhttp://localhost:%s\033[0m\n' "$name" "$(preview_port "$name")"
  else
    printf '  \033[31m✗\033[0m %s — see %s\n' "$name" "$RUN_DIR/hosted-$name.log"; status=1
  fi
done
if wait_for_http "http://localhost:$PREVIEW_INDEX_PORT" 60; then
  printf '\n  backend: %s\n' "$PREVIEW_BACKEND"
  printf '  \033[1mstart here → \033[4mhttp://localhost:%s\033[0m\n' "$PREVIEW_INDEX_PORT"
else
  printf '  \033[31m✗\033[0m index — see %s\n' "$RUN_DIR/hosted-index.log"; status=1
fi
exit "$status"
