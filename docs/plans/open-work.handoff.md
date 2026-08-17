# Handoff: execute the open-work list

You own [`docs/plans/open-work.md`](open-work.md) end to end. Read it in full
first — seven items, each already verified against the running tree on
2026-08-17, with file:line evidence. This brief is how to run it, not what the
work is.

## Shape

You are a **fable workflow session**: you hold the arc and check coherence
across the items; you delegate the implementation through the `Workflow` tool
rather than editing much yourself, and you keep your own context under ~200k so
your judgement stays good. Route each delegated task by difficulty — **Sonnet**
when it is simple and fully specified, **Opus** by default, **Fable** when it
needs nuance.

The items are mostly independent, so a pipeline over them beats one big fan-out
with a barrier. Two carry a real decision rather than a fix; see below.

Suggested routing, which you should override where you disagree:

| # | Item | Kind | Lane |
|---|---|---|---|
| 1 | `flows.yaml:43/44` assertion order | one-line fix, fully specified | Sonnet |
| 2 | `probe.sh` `set -e` skips the gallery | one-line fix, fully specified | Sonnet |
| 3 | `resumes: true` adapter capability | design fork — recommend, then build | Opus |
| 4 | backend in the artifact key | mechanical but wide | Opus |
| 5 | "cell" names two things | naming decision — **Michael's**, see below | Fable to write the proposal |
| 6 | always send `?backend=` | small hardening | Sonnet |
| 7 | publish the cells | **do not deploy — see below** | Opus to prepare |

Item 1 also suggests pinning the four `"latest"` entries in
`frontends/assistant-ui/package.json`. Treat that as part of item 1 and say what
you pinned to.

## What is yours to decide, and what is not

Items 3 and 4 are forks with costs named in the list. Pick one, implement it,
and say in the commit message why the other lost — you don't need Michael for
these.

**Item 5 is his.** The two answers are rename the code to "frontend" and let
"cell" mean a grid square, or keep "cell" for frontends and call the square a
"pair". Write the proposal — which one, why, and the file count each way — and
leave it for him. Do not sweep two dozen files on your own read.

**Item 7 stops before `./scripts/publish.sh`.** Publishing is public and hard to
take back, and two caveats in the list are unresolved: hosted CopilotKit can't
be moved off its configured backend, and `/threads` on a public backend lists
every visitor's threads. Get everything ready, run the preview gate, then ask
Michael in your terminal and wait. Everything else lands first.

## Done

A commit plus a demonstrated run — not a claim, and not a passing type-check
standing in for a rendered result. Verify every delegated result yourself before
accepting it: run the check, look at the output. Concretely:

- items 1 and 2: `./scripts/probe.sh --grep "notes"` green, and a deliberately
  red run still building the gallery (that is the whole point of item 2)
- item 3: `jinja · resume` green for the right reason, the four React cells
  unchanged, and `flows.yaml:85`'s "Currently nothing rehydrates" gone
- item 4: two runs against different backends, both sets of captures surviving
- item 6: the hub links carry `?backend=` for every backend including the first
- anything with UI: an e2e recording, the way `docs/recordings/` already does it

## The tree you're working in

Shared, and messier than usual because several sessions just closed mid-flight.
As of `d0e0a92` there are uncommitted edits belonging to other lanes in
`README.md`, `index/index.html`, `scripts/run.sh`, `docs/reflection.md`,
`protocol/CONTRACT.md` and every `backends/*`, plus untracked recordings in
`docs/recordings/` and `index/`. **Never `git add -A`.** Commit only paths you
touched; where you must edit a file that already carries someone else's hunks,
split the diff and `git apply --cached` your own. Michael has not decided what
happens to that uncommitted work — leave it alone and mention it when you report.

Running right now, and worth reusing rather than restarting: the matrix on
`:3000`–`:3005`, the four backends on `:8001`–`:8004` (`:8004` may be down —
check), and the hosted preview under workerd on `:4000`–`:4004`.
`probes/artifacts/` is gitignored and holds a 24MB local gallery — back it up
before a probe run that would overwrite it, and restore it after, unless the new
gallery is the deliverable.

`probe.sh` now honours `PROBE_PORT_OFFSET=1000` properly (`9ecb68a`): an offset
run drives only `HOSTED_CELLS` from `scripts/hosted.sh` and skips jinja by name.

## Reporting

Report to Michael in this terminal when you're done, or when item 5 or 7 needs
him. Full handoff: you own it from here.
