#!/usr/bin/env bash
# Deploy the hosted subset to Cloudflare: the cloudflare-agents backend, the five
# cells, and the index, with production URLs baked in. Needs `bunx wrangler
# login` once; WORKERS_SUBDOMAIN must match `bunx wrangler whoami`.
#
#   ./scripts/publish.sh              build, then deploy everything
#   ./scripts/publish.sh --no-build   deploy what's already built, if it was
#                                     built for this deployment — see the stamp
#                                     check below
#
# WORKER_PREFIX deploys the same Workers under other names, which is how a
# throwaway matrix gets published beside the real one rather than over it, and
# DEMO_CELLS narrows which cells are in it. Both are read by hosted.sh, so they
# move the build and the deploy together:
#
#   WORKER_PREFIX=chat-matrix-demo DEMO_CELLS="shadcn folio" ./scripts/publish.sh
set -euo pipefail
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/hosted.sh"

# --no-build deploys what is already built, which is only safe if what is already
# built was built for *this* deployment. The stamp check runs before the first
# remote write on purpose: the backend deploys first, so "it failed partway" is
# not something you can undo by noticing.
if [ "${1:-}" = "--no-build" ]; then require_built_for production; else build_all production; fi

# `--name` rather than the name each wrangler.jsonc carries, and it resolves to
# exactly that name at the default prefix — so this is a no-op for the published
# matrix and the whole of what WORKER_PREFIX does at deploy time. The line prints
# the name being deployed rather than a label, because under a prefix that is the
# only place you can see the deploy and the baked-in URLs agree.
deploy() { # deploy <key> <dir> [wrangler deploy args…] — <key> as hosted.sh names it
  local key="$1" dir="$2" name; shift 2
  name="$(worker_name "$key")"
  printf '\033[1m→ deploy %s\033[0m\n' "$name"
  (cd "$dir" && bunx wrangler deploy --name "$name" "$@" 2>&1 | grep -E "workers.dev|Uploaded|Deployed|rror" | sed 's/^/  /')
}

deploy "backend-$HOSTED_BACKEND" "$ROOT/backends/$HOSTED_BACKEND"
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
