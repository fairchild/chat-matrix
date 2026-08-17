#!/usr/bin/env bash
# The matrix, as data. Adding a stack is a line here — nothing else knows the list.
#
#   name:port  — a backend is a uv project (pyproject.toml) or a bun project
#   (package.json with a `dev` script); frontends are bun projects
BACKENDS=(
  "pydantic-ai:8001"
  "cloudflare-agents:8002"
)

FRONTENDS=(
  "assistant-ui:3001"
  "copilotkit:3002"
  "ai-elements:3003"
  "shadcn:3004"
)

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RUN_DIR="$ROOT/.run"

name_of() { printf '%s' "${1%%:*}"; }
port_of() { printf '%s' "${1##*:}"; }

wait_for_http() { # wait_for_http <url> <seconds>
  local url="$1" limit="${2:-45}" i
  for ((i = 0; i < limit * 2; i++)); do
    curl -sf -o /dev/null "$url" && return 0
    sleep 0.5
  done
  return 1
}
