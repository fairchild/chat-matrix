# ROADMAP

## Intent

The repo exists to answer a question documentation can't: which chat UI and
which agent backend do you actually want to work with. It answers it by running
them against each other on identical work — one reference agent, one scripted
model, four backends, six frontends — and by writing down what each one cost
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

**Finishing this as an instance in time, and publishing it.** The comparison has
been made and the notes have been written; what's left is to stop adding to the
instrument and let people read what it produced. That means the repository goes
open source, the hosted subset gets deployed, and every present tense in the
prose is true against the tree at the moment it goes public.
[`docs/publishing.md`](../docs/publishing.md) is the ordered sequence — the
commands, what each one changes, how to check it worked, and what the undo
recovers. Running it is Michael's, not an agent's.

**Folio is the last addition, and it's the reason the instrument exists.** Folio
is the interface this matrix was built to evaluate: a conversation surface whose
position is that a transcript should read as a document rather than a chat log.
The five cells beside it are what makes that reading mean anything — same three
tools, same scripted model, same bytes, surfaces that made different choices
about them. Its notes go in its README like every other stack's;
`frontends/folio/folio-in-context.md` is the study to read its captures against.

Behind those, three known divergences that don't hurt anyone today and would
embarrass us the first time an external client shows up — and `cell-naming`,
the one open decision that gets more expensive rather than less once strangers
are reading.

## Priorities

1. **publish** — `publish-the-cells`, which is now a sequence to run rather than
   work to do. Its two dependencies are closed: the hosted build ships the pages
   it links, and the public surface is bound to vars whose default is the locked
   one.
2. **prose** — `cell-naming`, the one word that names two things. It needs
   Michael, and a public repo is where the cost of leaving it compounds: every
   reader learns the word in whichever sense the docs teach it.
3. **honest-axes** — `hub-model-visibility`, `pi-session-id-collision`,
   `echoed-transcript-divergence`. Each is a place where the harness's own
   promise is stronger than what it enforces.

## Non-goals

- A real model as the default. The scripted one is what makes the comparison
  mean anything; a provider is a thing you switch to deliberately, per backend.
- Identity, auth or per-visitor scoping on the hosted demo. If a route can't be
  public without it, the route gets gated, not an account system.
- More frontends or backends before the notes surface. The notes have surfaced —
  the site renders every stack's, generated from the README that holds them —
  and Folio landed as the sixth frontend for exactly that reason: it is the
  interface the matrix exists to evaluate, so it belongs in the instrument
  rather than beside it. That closes the list rather than reopening it.
- Human-in-the-loop approval. It's the sharpest test of the generative-UI axis
  and it's still not in the reference agent — a real gap, deliberately not now.
