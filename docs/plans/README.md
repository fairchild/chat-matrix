# Plans and handoffs

These are working documents, not documentation. Each one was written to hand a
piece of this repository to a coding-agent session — the plan it worked from,
and afterwards the handoff recording what the work actually cost. They are kept
because the reasoning in them is the part that doesn't survive in a diff: why a
seam went where it did, which lane found which bug, what the reviewer caught
that the implementer didn't.

Read them as history. They are written in the present tense of a session that
has since ended, so:

- **Paths and branches are the machines they ran on.** A "ground truth" section
  naming something like `~/orca/workspaces/…` or a branch called `demo` is
  describing a worktree on the author's laptop, not this checkout.
- **Operational warnings were local.** Instructions about which processes not to
  restart, or which files another session owned, applied to a tree several
  agents were sharing at the time.
- **Counts and versions are as-of.** Where one says conformance is 18/18 or
  names a dependency version, that was true when it was written.

Nothing here is a contract. The documents that are: `protocol/CONTRACT.md` for
the wire protocol, `docs/architecture.md` for the design,
`docs/publishing.md` for the deployment sequence, and each stack's own README
for how that stack works and what building it cost.
