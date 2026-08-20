#!/usr/bin/env bash
# Drive every flow against every frontend, then build the side-by-side gallery.
# Assumes scripts/run.sh is already up — the probes talk to the running matrix
# rather than starting their own, so what they photograph is what you'd see.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$HERE/stacks.sh"

# --production aims the run at the deployed matrix instead of this machine. The
# URLs come from hosted.sh's production_url(), the same function publish.sh
# deploys against, so nothing here can drift from what was actually shipped.
# Ports can only ever address localhost, which is why this is a base-URL list
# (PROBE_BASES) rather than another offset — see probes/frontends.ts.
if [ "${1:-}" = "--production" ]; then
  shift
  source "$HERE/hosted.sh"
  bases="{\"index\":\"$(index_url production)\""
  for name in "${HOSTED_CELLS[@]}"; do bases+=",\"$name\":\"$(cell_url production "$name")\""; done
  export PROBE_BASES="$bases}"
  export PROBE_BACKEND="${PROBE_BACKEND:-$(backend_url production)}"
  printf '  \033[2mdeployed matrix → %s\033[0m\n' "$(index_url production)"
fi

# PROBE_PORT_OFFSET=1000 aims the whole run at the hosted preview (preview.sh):
# cells at port+offset, and only the subset in hosted.sh, since a cell with no
# wrangler.jsonc was never built. probes/frontends.ts reads the same two lists,
# so the preflight and the tests agree about what is meant to be up.
offset="${PROBE_PORT_OFFSET:-0}"
hosted=""
# Both the preview and the deployment serve the subset, and for the same reason:
# a cell with no wrangler.jsonc was never built, so there is nothing to drive.
if [ "$offset" -ne 0 ] || [ -n "${PROBE_BASES:-}" ]; then
  source "$HERE/hosted.sh"
  hosted=" ${HOSTED_CELLS[*]} "
fi

# The backend every cell is aimed at, resolved once here because this is the file
# that already knows which one that is: whatever the caller chose, else the
# preview's backend under an offset, else the first entry in stacks.sh. Exporting
# it always means the cells are driven with an explicit ?backend= — the same
# thing the hub now sends — rather than each falling back to its build-time
# default, and it gives the artifacts a backend to be keyed by.
if [ -z "${PROBE_BACKEND:-}" ]; then
  if [ "$offset" -ne 0 ]; then
    PROBE_BACKEND="$PREVIEW_BACKEND"
  else
    PROBE_BACKEND="http://localhost:$(port_of "${BACKENDS[0]}")"
  fi
fi
export PROBE_BACKEND

# /health names the backend; that name is the top level of artifacts/, so a run
# against a second backend lands beside the first instead of on top of it. If
# /health can't be reached, probes/frontends.ts slugs the URL instead.
health="$(curl -sf --max-time 5 "$PROBE_BACKEND/health" || true)"
health_field() { printf '%s' "$health" | python3 -c "import json,sys;print(json.load(sys.stdin).get('$1',''))" 2>/dev/null || true; }
PROBE_BACKEND_NAME="$(health_field backend)"
export PROBE_BACKEND_NAME

cd "$ROOT/probes"

# Fail early and legibly rather than 15 tests deep into a connection refused.
missing=0
# The URL a cell will actually be driven at: an explicit base if this run has
# one, else this machine at port+offset. probes/frontends.ts resolves it the
# same way from the same two variables, so the preflight and the tests can't
# disagree about what is meant to be up.
probe_url() { # probe_url <name> <port>
  local given
  given="$(printf '%s' "${PROBE_BASES:-{\}}" | python3 -c "import json,sys;print(json.load(sys.stdin).get(sys.argv[1],''))" "$1" 2>/dev/null || true)"
  [ -n "$given" ] && printf '%s' "$given" || printf 'http://localhost:%s' "$(( $2 + offset ))"
}

for entry in "${FRONTENDS[@]}"; do
  name="$(name_of "$entry")"; url="$(probe_url "$name" "$(port_of "$entry")")"
  [ -z "$hosted" ] || [[ "$hosted" == *" $name "* ]] || continue
  if ! curl -sf -o /dev/null "$url"; then
    printf '  \033[31m✗\033[0m frontend %s is not up at %s\n' "$name" "$url"; missing=1
  fi
done
# The hub is driven too (probes/hub.spec.ts), and it moves by the same offset —
# run.sh serves it on :3000, preview.sh on :4000 — so it belongs in the same
# preflight rather than failing five tests deep with a connection refused.
hub="$(probe_url index "$(sed -n 's/^INDEX_PORT="${INDEX_PORT:-\([0-9]*\)}"/\1/p' "$HERE/run.sh")")"
if ! curl -sf -o /dev/null "$hub"; then
  printf '  \033[31m✗\033[0m the hub is not up at %s\n' "$hub"; missing=1
fi

if [ "$missing" -eq 1 ]; then
  # Say what would fix *this* run: three ways to be pointed somewhere, three
  # different things missing at the other end.
  if [ -n "${PROBE_BASES:-}" ]; then
    printf '\nnothing answers at those URLs — the deployed matrix is what ./scripts/publish.sh puts there\n'
  elif [ "$offset" -ne 0 ]; then
    printf '\nstart the preview first: ./scripts/preview.sh\n'
  else
    printf '\nstart the matrix first: ./scripts/run.sh\n'
  fi
  exit 1
fi

# The gallery is a side-by-side of frontends rendering the same work, which holds
# only while the model answers the same way twice. The model is switchable at the
# hub, so say when this run's backend has been moved off scripted — and only
# about this one, since with PROBE_BACKEND exported it is the only backend the
# run talks to. Warning about a local pi on luna would be describing a process
# these captures never went near.
model="$(health_field model)"
[ -z "$model" ] || [ "$model" = "scripted" ] ||
  printf '  \033[33m⚠\033[0m backend %s is on %s — captures across cells stop being comparable\n' \
    "${PROBE_BACKEND_NAME:-$PROBE_BACKEND}" "$model"

printf '  \033[2mbackend %s → %s\033[0m\n' "${PROBE_BACKEND_NAME:-unnamed}" "$PROBE_BACKEND"

status=0
bunx playwright test "$@" || status=$?

# The gallery is the deliverable, so build it even when a flow failed — a broken
# cell is exactly the thing you want to look at.
bun run gallery.ts || true

printf '\n  \033[1mgallery → \033[4mfile://%s/artifacts/index.html\033[0m\n' "$ROOT/probes"
exit "$status"
