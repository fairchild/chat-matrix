# ROADMAP

## Intent

The repo exists to answer a question documentation can't: which chat UI and
which agent backend do you actually want to work with. It answers it by running
them against each other on identical work — one reference agent, one scripted
model, four backends, five frontends — and by writing down what each one cost
while the friction was fresh. The matrix is the instrument; the notes are the
finding. What's left is to get both in front of people without either of them
lying.

## Principles

- The comparison only means something while every stack does identical work.
  Anything that can quietly break that (a model picker, a real provider, a
  divergent backend) has to announce itself.
- Notes live in the directory they describe. The site renders them; it never
  holds a second copy.
- A gate that can't fail isn't a gate. Conformance, golden and the probes each
  fail loudly on purpose, and a red that means "the feature landed" is read, not
  silenced.
- Prose is the deliverable, not the packaging. A stale README is a defect with
  the same standing as a stale assertion.
- One vocabulary. A word that names two things costs more than the sweep to fix
  it.

## Current Focus

**Publishing.** Everything else is downstream of the site being real. The
backend is deployed; the four cells and the hub have never been. Two things
stand in the way and both are small: the hosted build drops the pages it links,
and the public surface (`/threads`, `POST /model`, a picker that can't honour
its own choice) is currently a default rather than a decision. Then Michael runs
`./scripts/publish.sh` — that one isn't an agent's to run.

**Making the notes readable.** Nine stack READMEs hold the ergonomics notes and
the site carries none of them. That work is claimed and in flight. Its sibling
is `docs/reflection.md`, the cross-cutting synthesis, which still describes a
repo with one backend and treats `pi` as future work.

Behind those, three known divergences that don't hurt anyone today and would
embarrass us the first time an external client shows up.

## Priorities

1. **publish** — `hosted-pages-ship`, `hosted-exposure-decisions`, then
   `publish-the-cells`. The first two gate the third.
2. **payload** — `surface-ergonomics-notes` (in flight), then the reflection
   half of `docs-sync-after-the-matrix`. The site becomes a resource here or it
   stays a launcher.
3. **prose** — `docs-sync-after-the-matrix` for the mechanical drift,
   `cell-naming` for the one word that now means two things. Cheap, visible,
   and the longer it waits the more prose gets written in the old vocabulary.
4. **honest-axes** — `hub-model-visibility`, `pi-session-id-collision`,
   `echoed-transcript-divergence`. Each is a place where the harness's own
   promise is stronger than what it enforces.

## Non-goals

- A real model as the default. The scripted one is what makes the comparison
  mean anything; a provider is a thing you switch to deliberately, per backend.
- Identity, auth or per-visitor scoping on the hosted demo. If a route can't be
  public without it, the route gets gated, not an account system.
- More frontends or backends before the notes surface. The sixth stack adds
  nothing a reader can see while the first five haven't been read.
- Human-in-the-loop approval. It's the sharpest test of the generative-UI axis
  and it's still not in the reference agent — a real gap, deliberately not now.
