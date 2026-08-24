# Chat-matrix — the folio cell, and the wrap-up

Status: fable-session brief, 2026-08-23 night. Full handoff — this session
owns the arc. Michael's words tonight: chat-matrix "is an instance in time,
it's not a project — wrap it up, let's make sure it's really nice, get it out
there... it's a nice way to evaluate things." This is the portfolio's first
closing-ritual graduation: the wrap-up ends in open source, not an archive
folder.

## Context you must hold

Michael is personally crafting folio — "I want to go into the weeds, because
it's kind of the point. I'm trying to craft a great interface. That's why
there's chat matrix." Chat-matrix is the instrument that evaluates the thing
he's crafting. The two are being prepared for open source together: folio's
release flow just went green twice on hosted Actions (its repo flip is
Michael's own upcoming action), and chat-matrix publishes as a finished
instance-in-time.

Hard boundary: Michael has live sessions working in `~/code/folio`. That
repository is READ-ONLY for you — read its docs, never edit, never build in
it, never touch its worktree. Consume folio only through its published
artifacts (npmjs `@fairchild/folio` 0.4.1, GitHub Packages, or the GitHub
Release tarball — pick the one that installs cleanly while the source repo is
still private, and document the pin and the swap-to-public plan).

Read first: this repo's `backlog/ROADMAP.md` (the intent section is the
charter: "The matrix is the instrument; the notes are the finding"),
`docs/reflection.md` (self-identifies as stale on the backend axis —
reconcile, don't inherit), `docs/architecture.md`, and folio's `README.md` +
`docs/design.md` + `docs/plan.md` (read-only).

## The work, in order

1. **The study, delivered early.** Write "Folio in context" — what Michael is
   actually crafting (the calm, document-first conversation surface), what
   running it inside the matrix against the other frontends on identical work
   can reveal that reading its code cannot, and which specific matrix
   questions matter for the interface he's refining (streaming feel, tool-row
   rendering, scroll/turn-follow behavior, the tool capsule, information
   density). Place it where this repo's principles say notes live — in the
   directory it describes. Report its path as soon as it exists; Michael may
   read it while you continue.
2. **The folio cell.** Add folio as a frontend cell doing identical work to
   the existing cells, per the charter principle — anything that would
   quietly break comparability has to announce itself. Wire it to the
   existing backends through the same protocol; run the conformance, golden,
   and probe gates and read any reds honestly. Done means the folio cell
   renders a real conversation in the matrix beside the others — capture a
   screenshot or short recording as the demonstrated run.
3. **The wrap-up.** Prepare the repo for public eyes: an opensource-precheck
   style audit (secrets, private hostnames, machine-specific paths, private
   consumer names), README as a genuine first-contact document, notes made
   honest (reflection.md's staleness reconciled or annotated), LICENSE
   verified, and the publish path documented as an ordered sequence. HARD
   LIMIT: `./scripts/publish.sh`, any deploy of the hosted pages, and any
   repository visibility change are Michael's own actions — deliver
   everything-but, with the final sequence written so he can run it in five
   minutes.

## Rules

- Work only in your worktree; branch from main; conventional commits with the
  Claude trailer; open a PR on GitHub (gh is authenticated) and leave it
  unmerged.
- `~/code/folio` read-only, as above. `~/code/mfwiki`, `~/code/workspaces`,
  and everything else not named: off-limits.
- Delegate per the fable contract (Opus default, Sonnet mechanical); you hold
  the gate: run this repo's own checks on the final commit and look at the
  rendered matrix, not just exit codes.
- Update the Orca card comment at meaningful checkpoints
  (`orca worktree set --worktree active --comment "..." --json`).
- Report in this terminal, structured: status; study path; cell status with
  gate results; audit findings (facts vs judgment calls for Michael); the
  documented publish sequence; commits + PR; deviations; unknowns.
