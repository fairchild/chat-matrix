#!/usr/bin/env bash
# The hosted subset of the matrix, as data, and how to build it. Sourced by
# preview.sh and publish.sh; not run directly.
#
# A local clone runs everything; Cloudflare runs this subset: the four cells as
# Workers (three static exports, CopilotKit's export plus its runtime hop), the
# index, and the cloudflare-agents backend. Two modes build the same artifacts
# with different URLs baked in:
#   preview     everything on localhost — cells at :PORT+1000, index at :4000,
#               backend at PREVIEW_BACKEND (default: the local :8002)
#   production  https://chat-stack-<name>.<WORKERS_SUBDOMAIN>.workers.dev
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/stacks.sh"

HOSTED_CELLS=(assistant-ui copilotkit ai-elements shadcn)   # each has a wrangler.jsonc
HOSTED_BACKEND="cloudflare-agents"
PREVIEW_OFFSET=1000
PREVIEW_INDEX_PORT=4000
WORKERS_SUBDOMAIN="${WORKERS_SUBDOMAIN:-irons-in-the-fire8698}"   # `bunx wrangler whoami`
PREVIEW_BACKEND="${PREVIEW_BACKEND:-http://localhost:8002}"

worker_name() { printf 'chat-stack-%s' "$1"; }
production_url() { printf 'https://%s.%s.workers.dev' "$(worker_name "$1")" "$WORKERS_SUBDOMAIN"; }

cell_port() { # cell_port <name> — from stacks.sh
  local entry
  for entry in "${FRONTENDS[@]}"; do
    [ "$(name_of "$entry")" = "$1" ] && { port_of "$entry"; return; }
  done
  echo "hosted.sh: $1 is not in scripts/stacks.sh" >&2; return 1
}
preview_port() { printf '%s' "$(( $(cell_port "$1") + PREVIEW_OFFSET ))"; }

cell_url()    { [ "$1" = preview ] && printf 'http://localhost:%s' "$(preview_port "$2")" || production_url "$2"; }
index_url()   { [ "$1" = preview ] && printf 'http://localhost:%s' "$PREVIEW_INDEX_PORT" || production_url index; }
backend_url() { [ "$1" = preview ] && printf '%s' "$PREVIEW_BACKEND" || production_url "backend-$HOSTED_BACKEND"; }

build_cell() { # build_cell <mode> <name> — a static export with the mode's URLs baked in
  local mode="$1" name="$2"
  printf '\033[1m→ build %s (%s)\033[0m\n' "$name" "$mode"
  (cd "$ROOT/frontends/$name" && rm -rf out && \
    STATIC_EXPORT=1 \
    NEXT_PUBLIC_BACKEND_URL="$(backend_url "$mode")" \
    NEXT_PUBLIC_INDEX_URL="$(index_url "$mode")" \
    bun run --silent build >/dev/null)
}

build_index() { # build_index <mode> — index.html with HOSTED filled in, to index/dist/
  local mode="$1"
  printf '\033[1m→ build index (%s)\033[0m\n' "$mode"
  local cells="{" name sep=""
  for name in "${HOSTED_CELLS[@]}"; do
    cells+="$sep\"$name\":\"$(cell_url "$mode" "$name")\""; sep=","
  done
  cells+="}"
  local hosted="{\"backends\":[{\"name\":\"$HOSTED_BACKEND\",\"url\":\"$(backend_url "$mode")\"}],\"cells\":$cells}"
  mkdir -p "$ROOT/index/dist"
  HOSTED="$hosted" python3 - "$ROOT/index/index.html" "$ROOT/index/dist/index.html" <<'PY'
import os, sys
src, dst = sys.argv[1], sys.argv[2]
html = open(src).read()
marker = "const HOSTED = null;"
assert marker in html, "index.html has no HOSTED marker"
open(dst, "w").write(html.replace(marker, f"const HOSTED = {os.environ['HOSTED']};"))
PY
}

build_all() { # build_all <mode>
  local name
  for name in "${HOSTED_CELLS[@]}"; do build_cell "$1" "$name"; done
  build_index "$1"
}
