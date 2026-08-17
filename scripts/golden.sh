#!/usr/bin/env bash
# Diff every backend's streams against the fixtures captured from the reference.
# The fixtures are the reference's own work, so `--update` only ever reads :8001
# unless you name another URL yourself.
#
#   ./scripts/golden.sh              check every backend in stacks.sh
#   ./scripts/golden.sh --update     recapture the fixtures from :8001
set -euo pipefail
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/stacks.sh"

if [ "${1:-}" = "--update" ]; then
  shift
  exec bun "$ROOT/protocol/golden.ts" --update "${@:-http://localhost:8001}"
fi

urls=()
for entry in "${BACKENDS[@]}"; do urls+=("http://localhost:$(port_of "$entry")"); done
exec bun "$ROOT/protocol/golden.ts" "$@" "${urls[@]}"
