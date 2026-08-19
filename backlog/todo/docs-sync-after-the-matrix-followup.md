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
