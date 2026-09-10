#!/usr/bin/env bash
# The hosted subset of the matrix, as data, and how to build it. Sourced by
# preview.sh and publish.sh; not run directly.
#
# A local clone runs everything; Cloudflare runs this subset: the five cells as
# Workers (four static exports, CopilotKit's export plus its runtime hop), the
# index, and the cloudflare-agents backend. Two modes build the same artifacts
# with different URLs baked in:
#   preview     everything on localhost — cells at :PORT+1000, index at :4000,
#               backend at PREVIEW_BACKEND (default: the local :8002)
#   production  https://<WORKER_PREFIX>-<name>.<WORKERS_SUBDOMAIN>.workers.dev
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/stacks.sh"

HOSTED_CELLS=(assistant-ui copilotkit ai-elements shadcn folio)   # each has a wrangler.jsonc
# One deployment may publish fewer than that. A cell whose hosted topology
# doesn't work is better absent from the hub, which then draws it as a square
# you can't click, than present as a link that opens a page answering nothing.
# Space-separated, and a subset of the line above. Read into the array rather
# than used directly so that sourcing this file twice in one process — probe.sh
# does — lands on the same list both times.
[ -z "${DEMO_CELLS:-}" ] || read -r -a HOSTED_CELLS <<< "$DEMO_CELLS"
HOSTED_BACKEND="cloudflare-agents"
PREVIEW_OFFSET=1000
PREVIEW_INDEX_PORT=4000
WORKERS_SUBDOMAIN="${WORKERS_SUBDOMAIN:-irons-in-the-fire8698}"   # `bunx wrangler whoami`
PREVIEW_BACKEND="${PREVIEW_BACKEND:-http://localhost:8002}"

# The one knob that moves a whole deployment aside. Every wrangler.jsonc names
# `chat-stack-<x>` and publish.sh passes worker_name as `--name`, so the default
# deploys exactly the committed names and any other prefix deploys a second,
# complete matrix — its own backend, its own Durable Objects, its own hub, under
# names nothing else claims. A shareable demo is a namespace rather than an edit
# to the published one, which is what makes it disposable: `wrangler delete` over
# that prefix takes the demo and leaves the deployment these docs describe.
#
# It has to be set for the build as well as the deploy, not just the deploy: the
# hub's links and the cells' baked-in backend URL both come from production_url,
# so a demo built at the default prefix would deploy under demo names and point
# every square at the other matrix.
WORKER_PREFIX="${WORKER_PREFIX:-chat-stack}"

worker_name() { printf '%s-%s' "$WORKER_PREFIX" "$1"; }
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

  # index.html is the only file build_index used to touch — every other page
  # that lives beside it (golden.html, monolith.html, …) and the gif each one
  # embeds also has to reach dist/, or the published hub 404s on its own links.
  # Gifs are symlinks in the worktree; dereference them, since a Worker's
  # static assets need real files.
  local f
  for f in "$ROOT"/index/*.html; do
    [ "$(basename "$f")" = index.html ] && continue
    cp "$f" "$ROOT/index/dist/"
  done
  for f in "$ROOT"/index/*.gif; do
    [ -e "$f" ] && cp -L "$f" "$ROOT/index/dist/"
  done

  # Ergonomics notes, same generator as the local run — see run.sh. Every
  # stack in the matrix gets a page, not just the hosted subset: the notes are
  # about the stack, not about whether Cloudflare can run it.
  local notes_args=() entry
  for entry in "${BACKENDS[@]}"; do notes_args+=(--backend "$(name_of "$entry")"); done
  for entry in "${FRONTENDS[@]}"; do notes_args+=(--frontend "$(name_of "$entry")"); done
  uv run --with markdown-it-py "$ROOT/index/generate_notes.py" --out "$ROOT/index/dist/notes" "${notes_args[@]}"
}

build_all() { # build_all <mode>
  local name
  for name in "${HOSTED_CELLS[@]}"; do build_cell "$1" "$name"; done
  build_index "$1"
}
