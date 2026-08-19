---
priority: 2
---

# Surface the ergonomics notes on the hosted site

The point of this repo is the comparison, and the comparison lives in prose:
every stack README ends with an **Ergonomics notes** section written during the
build while the friction was fresh. The hosted site carries none of it. A
visitor can open a cell and see that assistant-ui collapses tool calls and
shadcn draws a card, but nothing on the site tells them what that cost, what
surprised us, or which of the two we'd pick — so the site is a launcher when it
could be the resource.

Make the site surface those notes.

## The constraint that shapes this

The notes stay authored as markdown **in the directory they describe** —
`backends/<name>/README.md`, `frontends/<name>/README.md`. They are the thing
you read while working in that stack, and a copy under `index/` would be a
second source that goes stale the first time someone edits the real one. The
site renders them; it doesn't hold them.

That already has a foothold: every one of the nine stack READMEs carries a
`## Ergonomics notes` heading, spelled identically. The extraction contract
exists — it just isn't read by anything.

## Decisions the implementer makes

**Which sections travel.** `## Ergonomics notes` is in all nine and is the
floor. Several READMEs carry more that belongs on a comparison site: `## How it
maps to the contract` (three backends), `## Why this style` (pi-rpc), `## Not
implemented` and `## Inert components` (shadcn, jinja, ai-elements), `## Setup
papercuts` (assistant-ui), the `## Not a <library> problem` corrections. Whole
README is the other end. Recommendation: a named allowlist of headings, in a
fixed display order, so a new section doesn't silently appear on the site and a
missing one is a visible gap rather than a quiet omission.

**Where it hangs off the matrix.** The hub's axes are already the right
taxonomy — backends across, frontends down. A notes link on each column header
and each row header puts a stack's writeup exactly where the reader is already
looking at that stack. The `outside` row (FastAPI + Jinja) needs one too; its
README is the longest and most opinionated of the nine.

**One page per stack, or one page.** Per stack matches the source files and
keeps each page short. A single page makes the cross-stack reading — the thing
the matrix is for — possible without nine tabs. Recommendation: one page per
stack, plus an index page grouped by axis, and let the axis grouping be the
comparison view.

## Mechanism

`index/` is served two ways and both need the generated pages:

- locally, `scripts/run.sh` serves `index/` directly with `python3 -m http.server`
- hosted, `build_index` in `scripts/hosted.sh` writes `index/dist/` and
  `index/wrangler.jsonc` publishes that directory as an assets-only Worker

`build_index` currently writes exactly one file (`index.html`, with the `HOSTED`
marker substituted). Generation has to run in both paths, or the local hub and
the published one disagree about what exists.

Reuse what the tree already has rather than adding a runtime: `build_index`
already shells to inline `python3`, and `uv` is a required tool, so
`uv run --with markdown-it-py` renders without touching any `pyproject.toml`.
`index/` is also a bun project already. Either is fine; a new dependency in a
new language is not.

Generated output should be gitignored, not committed — a committed render is a
second copy of the notes with a different staleness clock, which is the thing
this task exists to avoid.

## Look

`index/golden.html` is the template: same tokens, same `prefers-color-scheme`
block, same `← matrix` crumb, no JavaScript. The generated pages should be
indistinguishable from a hand-written one.

## Watch out for

- **Relative links break when the markdown moves.** The READMEs link each other
  and their own files (`.dev.vars.example`, `frontends/jinja/README.md`).
  Rewrite them to the repo once `REPO` is set in `index/index.html`, or drop
  them to plain text the way the hub's footer already does while `REPO` is
  empty.
- **`build_index` is being changed by the hosting work anyway** — `golden.html`
  and its gif aren't copied into `dist/` either. Same function, so do them
  together or take this one after.
- **`docs/reflection.md` is the cross-cutting synthesis and is three backends
  out of date.** Link it, don't fix it here; it's its own task.

## Acceptance

- Every stack in `scripts/stacks.sh`, plus `frontends/jinja`, has its notes
  reachable from the hub in both the local and hosted builds.
- The markdown files are unchanged — `git diff` over `backends/*/README.md` and
  `frontends/*/README.md` is empty after a build.
- Editing a `## Ergonomics notes` section and rebuilding changes the rendered
  page; nothing else has to be touched.
- A stack with no notes section fails the build loudly rather than rendering an
  empty page.
- `./scripts/preview.sh` serves the pages at `:4000`; the links work from the
  hosted hub, not just the local one.
- Screenshot the rendered result in light and dark before calling it done.

---
