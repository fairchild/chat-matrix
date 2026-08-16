#!/usr/bin/env bash
# Install dependencies for every stack in the matrix.
set -euo pipefail
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/stacks.sh"

for entry in "${BACKENDS[@]}"; do
  name="$(name_of "$entry")"
  printf '\033[1m→ backend %s\033[0m\n' "$name"
  (cd "$ROOT/backends/$name" && uv sync)
done

for entry in "${FRONTENDS[@]}"; do
  name="$(name_of "$entry")"
  printf '\033[1m→ frontend %s\033[0m\n' "$name"
  (cd "$ROOT/frontends/$name" && bun install)
  if [ ! -f "$ROOT/frontends/$name/.env.local" ] && [ -f "$ROOT/frontends/$name/.env.example" ]; then
    cp "$ROOT/frontends/$name/.env.example" "$ROOT/frontends/$name/.env.local"
    printf '  wrote .env.local from .env.example\n'
  fi
done

printf '\n\033[1mready.\033[0m  scripts/run.sh to start the matrix\n'
