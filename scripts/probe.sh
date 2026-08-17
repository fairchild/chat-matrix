#!/usr/bin/env bash
# Drive every flow against every frontend, then build the side-by-side gallery.
# Assumes scripts/run.sh is already up — the probes talk to the running matrix
# rather than starting their own, so what they photograph is what you'd see.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$HERE/stacks.sh"

# PROBE_PORT_OFFSET=1000 aims the whole run at the hosted preview (preview.sh):
# cells at port+offset, and only the subset in hosted.sh, since a cell with no
# wrangler.jsonc was never built. probes/frontends.ts reads the same two lists,
# so the preflight and the tests agree about what is meant to be up.
offset="${PROBE_PORT_OFFSET:-0}"
hosted=""
if [ "$offset" -ne 0 ]; then
  source "$HERE/hosted.sh"
  hosted=" ${HOSTED_CELLS[*]} "
fi

cd "$ROOT/probes"

# Fail early and legibly rather than 15 tests deep into a connection refused.
missing=0
for entry in "${FRONTENDS[@]}"; do
  name="$(name_of "$entry")"; port="$(( $(port_of "$entry") + offset ))"
  [ -z "$hosted" ] || [[ "$hosted" == *" $name "* ]] || continue
  if ! curl -sf -o /dev/null "http://localhost:$port"; then
    printf '  \033[31m✗\033[0m frontend %s is not up on :%s\n' "$name" "$port"; missing=1
  fi
done
if [ "$missing" -eq 1 ]; then
  [ "$offset" -eq 0 ] && printf '\nstart the matrix first: ./scripts/run.sh\n' ||
    printf '\nstart the preview first: ./scripts/preview.sh\n'
  exit 1
fi

# The gallery is a side-by-side of four frontends rendering the same work, which
# holds only while every backend answers the same way. The model is switchable
# at the hub, so say when one has been moved off scripted. A preview run reads
# only the backend baked into the exports — warning about a local pi on luna
# would be describing a process this run never talks to.
checks=()
if [ "$offset" -ne 0 ]; then
  checks=("$HOSTED_BACKEND|${PROBE_BACKEND:-$PREVIEW_BACKEND}")
else
  for entry in "${BACKENDS[@]}"; do
    checks+=("$(name_of "$entry")|http://localhost:$(port_of "$entry")")
  done
fi
for check in "${checks[@]}"; do
  name="${check%%|*}"; url="${check#*|}"
  model="$(curl -sf "$url/health" | python3 -c 'import json,sys;print(json.load(sys.stdin).get("model",""))' 2>/dev/null || true)"
  [ -z "$model" ] || [ "$model" = "scripted" ] ||
    printf '  \033[33m⚠\033[0m backend %s is on %s — captures across cells stop being comparable\n' "$name" "$model"
done

bunx playwright test "$@"
status=$?

# The gallery is the deliverable, so build it even when a flow failed — a broken
# cell is exactly the thing you want to look at.
bun run gallery.ts || true

printf '\n  \033[1mgallery → \033[4mfile://%s/artifacts/index.html\033[0m\n' "$ROOT/probes"
exit "$status"
