#!/usr/bin/env bash
# Start every backend and frontend, each on its own port. Logs land in .run/.
set -euo pipefail
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/stacks.sh"

INDEX_PORT="${INDEX_PORT:-3000}"

# uvicorn says nothing per request at `warning`, which is right for a matrix you
# leave running and wrong the moment you want to watch a turn happen.
LOG_LEVEL="${DEMO_LOG_LEVEL:-warning}"

mkdir -p "$RUN_DIR"

start() { # start <kind> <name> <port> <dir> <cmd...>
  local kind="$1" name="$2" port="$3" dir="$4"
  shift 4
  local pidfile="$RUN_DIR/$kind-$name.pid"

  if [ -f "$pidfile" ] && kill -0 "$(cat "$pidfile")" 2>/dev/null; then
    printf '  %s %s already running (pid %s)\n' "$kind" "$name" "$(cat "$pidfile")"
    return
  fi

  # `exec` so no bash wrapper lingers, and detach every stream: a child that
  # inherits our stdout keeps the caller's pipe open and `run.sh | tail` hangs.
  (cd "$dir" && exec env PORT="$port" "$@") </dev/null >"$RUN_DIR/$kind-$name.log" 2>&1 &
  echo $! >"$pidfile"
  printf '  %s %s → http://localhost:%s (pid %s)\n' "$kind" "$name" "$port" "$!"
}

printf '\033[1mstarting backends\033[0m\n'
for entry in "${BACKENDS[@]}"; do
  name="$(name_of "$entry")"; port="$(port_of "$entry")"
  if [ -f "$ROOT/backends/$name/package.json" ]; then
    start backend "$name" "$port" "$ROOT/backends/$name" bun run dev
  else
    start backend "$name" "$port" "$ROOT/backends/$name" \
      uv run uvicorn app.main:app --port "$port" --log-level "$LOG_LEVEL"
  fi
done

printf '\033[1mstarting frontends\033[0m\n'
for entry in "${FRONTENDS[@]}"; do
  name="$(name_of "$entry")"; port="$(port_of "$entry")"
  if [ -f "$ROOT/frontends/$name/pyproject.toml" ]; then
    start frontend "$name" "$port" "$ROOT/frontends/$name" \
      uv run uvicorn app.main:app --port "$port" --log-level "$LOG_LEVEL"
  else
    start frontend "$name" "$port" "$ROOT/frontends/$name" bun run dev
  fi
done

# The hub isn't a cell in the matrix, so it lives here rather than in stacks.sh.
# Static, and scoped to index/ so the rest of the repo isn't served over HTTP.
printf '\033[1mstarting index\033[0m\n'
start harness index "$INDEX_PORT" "$ROOT/index" \
  python3 -m http.server "$INDEX_PORT" --bind 127.0.0.1

printf '\n\033[1mwaiting for health\033[0m\n'
status=0
for entry in "${BACKENDS[@]}"; do
  name="$(name_of "$entry")"; port="$(port_of "$entry")"
  if wait_for_http "http://localhost:$port/health" 45; then
    printf '  \033[32m✓\033[0m backend %s\n' "$name"
  else
    printf '  \033[31m✗\033[0m backend %s — see %s\n' "$name" "$RUN_DIR/backend-$name.log"; status=1
  fi
done
for entry in "${FRONTENDS[@]}"; do
  name="$(name_of "$entry")"; port="$(port_of "$entry")"
  if wait_for_http "http://localhost:$port" 60; then
    printf '  \033[32m✓\033[0m frontend %s → \033[4mhttp://localhost:%s\033[0m\n' "$name" "$port"
  else
    printf '  \033[31m✗\033[0m frontend %s — see %s\n' "$name" "$RUN_DIR/frontend-$name.log"; status=1
  fi
done

if wait_for_http "http://localhost:$INDEX_PORT" 20; then
  printf '\n  \033[1mstart here → \033[4mhttp://localhost:%s\033[0m\n' "$INDEX_PORT"
else
  printf '  \033[31m✗\033[0m index — see %s\n' "$RUN_DIR/harness-index.log"; status=1
fi

exit "$status"
