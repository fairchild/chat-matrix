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
# Space-separated, and a subset of the line above.
#
# Checked before anything is built or deployed, because the alternative is worse
# than a typo: build_all builds cells in order and publish.sh deploys the backend
# first, so a name that only fails when its directory is missing fails *after* a
# remote write. Duplicates would build and deploy the same cell twice. And a
# value that is present but names nothing — `DEMO_CELLS=" "` — used to read as
# "publish everything", which is the opposite of what anyone typing it means;
# it is now an error, and an empty array is never expanded, because `"${a[@]}"`
# on one aborts under `set -u` in bash 3.2, which is what `/bin/bash` is here.
#
# Applied through a function so that sourcing this file twice in one process —
# probe.sh does — lands on the same list both times: the literal above is
# reassigned first, then re-validated against the same DEMO_CELLS.
_apply_demo_cells() {
  local given=() seen=" " name
  read -r -a given <<< "${DEMO_CELLS}"
  if [ "${#given[@]}" -eq 0 ]; then
    printf 'hosted.sh: DEMO_CELLS is set but names no cell. Unset it to publish the whole subset (%s).\n' \
      "${HOSTED_CELLS[*]}" >&2
    exit 1
  fi
  for name in "${given[@]}"; do
    case " ${HOSTED_CELLS[*]} " in
      *" $name "*) ;;
      *) printf 'hosted.sh: DEMO_CELLS names %s, which is not one of the hosted cells (%s).\n' \
           "$name" "${HOSTED_CELLS[*]}" >&2; exit 1 ;;
    esac
    case "$seen" in
      *" $name "*) printf 'hosted.sh: DEMO_CELLS names %s twice — each cell builds and deploys once.\n' \
                     "$name" >&2; exit 1 ;;
    esac
    seen="$seen$name "
  done
  HOSTED_CELLS=("${given[@]}")
}
[ -z "${DEMO_CELLS+x}" ] || _apply_demo_cells

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
  printf '%s' "$(build_signature "$1")" >"$BUILD_STAMP"
}

# ---- what the artifacts were built for ------------------------------------
#
# Every URL in a build is baked in, so `out/` and `index/dist/` are only
# meaningful together with the four things that shaped them. `--no-build` skips
# the build and not the deploy, which makes that pairing something a caller can
# get wrong in the one direction that costs the most: build the demo, then retry
# the deploy without the prefix, and `wrangler deploy --name chat-stack-…`
# publishes demo-linked assets over the live matrix. Nothing in wrangler would
# notice — the assets are valid, the names are real, and the hub would simply
# point every square at the other deployment.
#
# So the build records what it was for and a build-skipping deploy has to match
# it. The stamp lives in index/dist/ because that is the build output it
# describes, and build_index rewrites the directory on every run.
BUILD_STAMP="$ROOT/index/dist/.build"

build_signature() { # build_signature <mode>
  printf 'mode=%s prefix=%s subdomain=%s backend=%s cells=%s' \
    "$1" "$WORKER_PREFIX" "$WORKERS_SUBDOMAIN" "$(backend_url "$1")" "${HOSTED_CELLS[*]}"
}

require_built_for() { # require_built_for <mode> — for a deploy or serve that skipped the build
  local want have
  want="$(build_signature "$1")"
  if [ ! -f "$BUILD_STAMP" ]; then
    printf '\033[31mnothing built.\033[0m %s has no build stamp — drop --no-build and build first.\n' \
      "$BUILD_STAMP" >&2
    exit 1
  fi
  have="$(cat "$BUILD_STAMP")"
  if [ "$want" != "$have" ]; then
    printf '\033[31mthe built artifacts are for a different deployment.\033[0m\n' >&2
    printf '  built:    %s\n  asked for: %s\n' "$have" "$want" >&2
    printf 'Every URL is baked in at build time, so deploying these would publish one deployment'\''s pages under another'\''s names. Drop --no-build, or re-export the variables the build used.\n' >&2
    exit 1
  fi
}
