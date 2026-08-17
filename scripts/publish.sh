#!/usr/bin/env bash
# Deploy the hosted subset to Cloudflare: the cloudflare-agents backend, the four
# cells, and the index, with production URLs baked in. Needs `bunx wrangler
# login` once; WORKERS_SUBDOMAIN must match `bunx wrangler whoami`.
#
#   ./scripts/publish.sh              build, then deploy everything
#   ./scripts/publish.sh --no-build   deploy what's already built
set -euo pipefail
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/hosted.sh"

[ "${1:-}" = "--no-build" ] || build_all production

deploy() { # deploy <label> <dir> [wrangler deploy args…]
  local label="$1" dir="$2"; shift 2
  printf '\033[1m→ deploy %s\033[0m\n' "$label"
  (cd "$dir" && bunx wrangler deploy "$@" 2>&1 | grep -E "workers.dev|Uploaded|Deployed|rror" | sed 's/^/  /')
}

deploy "backend $HOSTED_BACKEND" "$ROOT/backends/$HOSTED_BACKEND"
for name in "${HOSTED_CELLS[@]}"; do
  if [ "$name" = copilotkit ]; then
    deploy "$name" "$ROOT/frontends/$name" --var "BACKEND_URL:$(backend_url production)"
  else
    deploy "$name" "$ROOT/frontends/$name"
  fi
done
deploy index "$ROOT/index"

printf '\n\033[1mpublished\033[0m\n'
printf '  backend  %s\n' "$(backend_url production)"
for name in "${HOSTED_CELLS[@]}"; do printf '  %-12s %s\n' "$name" "$(cell_url production "$name")"; done
printf '  %-12s \033[4m%s\033[0m\n' index "$(index_url production)"
