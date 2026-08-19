---
priority: 5
arc: honest-axes
---

# One echoed transcript, three behaviours

**Check before claiming: a lane was mid-flight on the half of this that got
decided.** As of 2026-08-18 an uncommitted change adds a `history` field to
`/health` declaring `client` or `session` authority, and a `protocol/conformance.sh`
section that holds each backend to its own declaration in both directions — a
`client` backend must follow a client's shorter history, a `session` backend must
keep its own turns. That settles where history lives, which was the open decision
in item 9 of `docs/plans/open-work.md`. Re-read `CONTRACT.md` and
`conformance.sh` first; if they now cover this, close the task rather than
working it.

What that gate does **not** reach is the second divergence, which is about an
*incomplete* tool call in the echoed transcript rather than a missing one. Same
`/chat` body — a two-turn transcript whose tool call has no result — against a
thread the server has never seen:

- **cloudflare-agents** drops the call (`ignoreIncompleteToolCalls: true`) and
  reuses its id
- **pydantic-ai** (and its jinja copy) synthesises "The tool call was
  interrupted before a result was produced.", which trips the scripted model's
  returns-branch, so it summarises the phantom return instead of answering the
  new question
- **pi** ignores the echo entirely

Three behaviours for one input. The golden check cannot see any of it — golden
drives every backend with the same honest-client flow, which is the point of
golden and the reason this needs its own probe.

The React cells always echo the full transcript, so nothing in the matrix hits
this today. It is reachable from a second tab or any client that windows a long
thread.

## What to decide

Whether the contract says anything about an incomplete echoed call, or whether
this is under-specified on purpose. If it's specified, it wants a conformance
case; if it isn't, `CONTRACT.md` should say so, because three silent behaviours
read as a bug in whichever backend a reader tried second.

---
