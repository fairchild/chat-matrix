#!/usr/bin/env bash
# Drive every flow against every frontend, then build the side-by-side gallery.
# Assumes scripts/run.sh is already up — the probes talk to the running matrix
# rather than starting their own, so what they photograph is what you'd see.
set -euo pipefail
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/stacks.sh"

cd "$ROOT/probes"

# Fail early and legibly rather than 15 tests deep into a connection refused.
missing=0
for entry in "${FRONTENDS[@]}"; do
  name="$(name_of "$entry")"; port="$(port_of "$entry")"
  if ! curl -sf -o /dev/null "http://localhost:$port"; then
    printf '  \033[31m✗\033[0m frontend %s is not up on :%s\n' "$name" "$port"; missing=1
  fi
done
if [ "$missing" -eq 1 ]; then
  printf '\nstart the matrix first: ./scripts/run.sh\n'; exit 1
fi

bunx playwright test "$@"
status=$?

# The gallery is the deliverable, so build it even when a flow failed — a broken
# cell is exactly the thing you want to look at.
bun run gallery.ts || true

printf '\n  \033[1mgallery → \033[4mfile://%s/artifacts/index.html\033[0m\n' "$ROOT/probes"
exit "$status"
