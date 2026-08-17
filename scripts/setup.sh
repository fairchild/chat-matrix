#!/usr/bin/env bash
# Install dependencies for every stack in the matrix.
set -euo pipefail
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/stacks.sh"

for entry in "${BACKENDS[@]}"; do
  name="$(name_of "$entry")"
  printf '\033[1m→ backend %s\033[0m\n' "$name"
  if [ -f "$ROOT/backends/$name/package.json" ]; then
    (cd "$ROOT/backends/$name" && bun install)
    # A Worker reads local secrets from `.dev.vars`, and `wrangler types` reads
    # their names from the same file — so it has to exist before the bindings are
    # generated, or the Env type comes out missing them.
    if [ ! -f "$ROOT/backends/$name/.dev.vars" ] && [ -f "$ROOT/backends/$name/.dev.vars.example" ]; then
      cp "$ROOT/backends/$name/.dev.vars.example" "$ROOT/backends/$name/.dev.vars"
      printf '  wrote .dev.vars from .dev.vars.example — provider keys go there\n'
    fi
    # `types` is wrangler's generated bindings; only the Worker backend has it.
    (cd "$ROOT/backends/$name" && { grep -q '"types"' package.json && bun run types || true; })
  else
    (cd "$ROOT/backends/$name" && uv sync)
  fi
done

for entry in "${FRONTENDS[@]}"; do
  name="$(name_of "$entry")"
  printf '\033[1m→ frontend %s\033[0m\n' "$name"
  if [ -f "$ROOT/frontends/$name/pyproject.toml" ]; then
    (cd "$ROOT/frontends/$name" && uv sync)
  else
    (cd "$ROOT/frontends/$name" && bun install)
    if [ ! -f "$ROOT/frontends/$name/.env.local" ] && [ -f "$ROOT/frontends/$name/.env.example" ]; then
      cp "$ROOT/frontends/$name/.env.example" "$ROOT/frontends/$name/.env.local"
      printf '  wrote .env.local from .env.example\n'
    fi
  fi
done

printf '\033[1m→ index\033[0m\n'
(cd "$ROOT/index" && bun install)   # wrangler, for the hosted preview and publish

printf '\033[1m→ probes\033[0m\n'
(cd "$ROOT/probes" && bun install && bunx playwright install chromium)

printf '\n\033[1mready.\033[0m  scripts/run.sh to start the matrix\n'
