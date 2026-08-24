---
priority: 2
arc: prose
---

# The docs still describe an earlier repo

Several sessions built in parallel and the prose lagged the tree. None of these
are wrong-in-a-detail; they describe a repo that no longer exists, and they are
the first thing a visitor reads. All verified on 2026-08-18.

- **`README.md`, "Running it"** — "the hub lists the backends as a radio group
  and the cells as cards; pick a backend, then click into a cell". The hub is a
  4×4 matrix with a model picker per column. This is the sentence that runs
  right after `run.sh`.
- **`docs/reflection.md`** is a two-backend-era document. "One backend. The
  backend axis is entirely untested" and "If I could only do one more thing, it
  would be the `pi` backend" are still in *What this still can't tell you*.
  There are four backends and pi shipped twice. Nothing in the file covers
  cloudflare-agents, pi, pi-rpc, the golden check, the model picker, hosting, or
  the jinja monolith. The README calls this "the opinionated version — what the
  comparison actually showed", which makes it the most load-bearing stale page
  in the repo.
- **`docs/architecture.md`** contradicts itself: it describes `probes/` as the
  thing that captures comparisons, then eighty lines later says "the sharpest
  gap is that nothing captures comparisons… right now that lives in prose in
  each README". `reflection.md` already marks that item done.
- **`probes/README.md`** is a four-cell document — "across four UIs", "all four
  come back empty", a tool-call table with no jinja row. It quotes a root-README
  line that no longer exists ("reload resumes the current thread rather than
  letting you pick one"), and its open follow-up predicts a pi backend will
  break the `resume` assertion; what actually broke it was the jinja frontend,
  and that has since been resolved with the `resumes` capability in
  `probes/frontends.ts`.
- **Package counts use two scales.** `docs/reflection.md` and
  `frontends/copilotkit/README.md` say 777 vs 259 (installed); ai-elements,
  shadcn and jinja say 1,325 / 477 / 529 / 356 (`bun pm ls --all`). Both are
  defensible; two of them in one repo means a reader comparing cells gets
  incompatible numbers for the same claim. Pick the resolved-package count —
  more cells already use it and it's reproducible with one command — and say
  which command produced it.
- **Nothing links to the two new pages.** `index/golden.html` and
  `index/monolith.html` exist; README, architecture and CONTRACT still reference
  only `docs/recordings/*.gif`.

## Scope note

`reflection.md` is the one that needs judgment rather than an edit — it is
first-person opinion, and bringing it up to date means writing the backend-axis
conclusions that currently exist only scattered across nine stack READMEs. That
overlaps `surface-ergonomics-notes`, which renders those notes onto the site.
Do the mechanical five first; treat reflection as its own sitting, and read
`backends/*/README.md` "Ergonomics notes" before writing a word of it.

## Acceptance

- Each bullet above is either fixed or has a line saying why it stands.
- `rg -n "radio group|as cards"` returns nothing.
- The package-count claim uses one metric and names the command.

---
- 2026-08-24T00:58:09Z advanced to=doing claimer=fairchild@blue branch=workspace/folio-cell
- 2026-08-24T00:58:23Z progress | README "radio group / as cards": already gone before this sitting — `rg -n "radio group|as cards" README.md` returns nothing. The README was rewritten around the first screen instead: what this is, why, how to run it, and "cell" defined at first use as one frontend app (documentation, not a rename — cell-naming stays Michael's).
- 2026-08-24T00:58:23Z progress | docs/reflection.md: reconciled rather than ghostwritten. Dated 2026-08-23 note at the top saying what changed and how; new "On the backend axis" synthesised strictly from backends/*/README.md Ergonomics notes, protocol/CONTRACT.md and protocol/golden/exceptions.json, each claim attributed to where it is recorded; "What this still can't tell you" rewritten (four backends, pi twice, golden to bytes — what is left is no real model, no human-in-the-loop, and the day a cell rehydrates); the "two frontends" preface now says five on the grid plus the monolith and links Folio without concluding anything about it; two harness notes added (the model picker found the reasoning bug; publishing a subset made the public surface a decision).
- 2026-08-24T00:58:23Z progress | docs/architecture.md: the self-contradiction is gone. probes/ captures the rendering; what it does not capture is the judgement, and developer ergonomics is named as the axis with no probe at all. Diagram and text now carry five grid cells (Folio :3006 on the Vercel stream) and twenty squares; ports paragraph updated to ten name:port pairs; index/ now names golden.html and monolith.html.
- 2026-08-24T00:58:39Z progress | probes/README.md: four-cell language replaced with the real count — the flows run against every cell in scripts/stacks.sh, jinja included. The quoted root-README line that no longer exists is gone. The open follow-up that predicted a pi backend would break `resume` now says what actually happened: jinja broke it, and the `resumes` declaration in frontends.ts resolved it; the pi prediction is marked still open. The tool-call table gained a jinja row (verified against templates/partials/part_tool.html — a card per tool with the name in the header, tool_generic.html as the fallback, no disclosure) and a folio row pointing at frontends/folio/README.md rather than inventing what it renders.
- 2026-08-24T00:58:39Z progress | Package counts: one metric now. docs/reflection.md dropped 777/259 (installed) for the `bun pm ls --all` scale the other cells use, naming the command and citing 1,325 against 356 as recorded during those builds. Caveat found while verifying and worth passing on: a re-run today returns higher counts for all four (441 / 1,435 / 562 / 613 by `bun pm ls --all` line count) because the trees have moved since the notes were written, so the reflection says the ratio is the durable part rather than restating a build-time number as current. frontends/copilotkit/README.md still carries 777/259 and is outside this lane's file ownership — one line, still to fix.
- 2026-08-24T00:58:39Z progress | The two pages are linked. README links index/golden.html and index/monolith.html in the first screen and golden.html again beside the golden paragraph; docs/architecture.md names both under index/. protocol/CONTRACT.md turned out never to have referenced docs/recordings/*.gif at all, so that third of the bullet was already moot.
- 2026-08-24T00:58:39Z progress | Also fixed while verifying, beyond the bullets: README said "Conformance passes against it from the edge" of the deployed backend. Checked 2026-08-23 — the live Worker is a build from before three landed changes: /health carries no `history` field, /models answers `not found`, and GET /threads still serves the bulk list with every thread's first user message as its title. README now states that and docs/publishing.md names the redeploy as the step that closes it. Also: README's "Adding a stack" gained the index/index.html step (a cell registered only in stacks.sh gets no row in the hub), and docs/reflection.md's "one line in stacks.sh really was the whole registration" now says it grew to three places.
- 2026-08-24T01:03:03Z progress | Written against the end state, not the tree at commit time. The folio cell exists on disk (package.json, wrangler.jsonc, app/, components/, vendor/) but the cell lane had not yet registered it in scripts/stacks.sh, scripts/hosted.sh, index/index.html or probes/frontends.ts, and frontends/folio/README.md did not exist. Count claims say six frontends, five grid cells, twenty squares, five hosted cells, seven Workers, 35 probe tests (6 cells x 5 flows in probes/flows.yaml, plus 5 in hub.spec.ts — note flows.yaml has five flows, not six). Three links across README.md, docs/reflection.md and probes/README.md point at frontends/folio/README.md and resolve once that lands. Orchestrator to reconcile.
- 2026-08-24T01:03:03Z advanced to=done
