# Handoff: build `frontends/jinja` from the plan

*Written 2026-08-17 by the planning session for the session that owns the build.
This is a full ownership handoff — nobody is supervising a dispatch, so no
`worker_done` / heartbeat lifecycle applies. Report to Michael in your own
terminal.*

## What you're doing

Execute **`docs/plans/frontends-jinja.md`** end to end: a server-rendered
FastAPI + Jinja monolith cell — the pydantic-ai reference agent in-process,
every piece of HTML rendered by Jinja and streamed to the page as NDJSON DOM
patches, ~40 lines of Jinja-served JS, a no-JS fallback, reload that resumes,
a thread list. Read the plan first, whole. §3 is a set of fixed contracts;
change the plan before you change the code.

Michael's intent, in his words: *"explore a very different approach so we can
compare … see if we can produce a good experience, and possibly with less
complexity, by keeping most state and rendering on the server … javascript to
fetch fragments and replace elements … minimal js required and most logic on
the server."* Quality of the UI matters as much as the mechanism — this cell
will be screenshotted next to four React cells.

## Who does what

*(Corrected 2026-08-17 — the first version of this section had the split
backwards.)*

You are Fable, and you are the **orchestrator**: you hold the long arc, plan,
coordinate, and check quality and consistency. You do not do most of the
implementation yourself — that keeps your context lean (aim to stay under
~200k) so your judgment stays sharp for the whole build. Michael asked for "a
workflow of other agents" — that is your explicit opt-in for the Workflow tool
as well as direct `Agent` calls.

Delegation defaults, per task:

- **Opus** by default — every implementation phase in the plan's §5 table
  (A, B1, B2, C, D, E) unless one of the next two applies.
- **Sonnet** when a task is simple and fully specified — B3 client JS, D
  harness edits are the obvious ones.
- **Fable** only when a task needs more nuance and care than Opus reliably
  gives — F independent review is a reasonable candidate; B1 if a first Opus
  pass comes back subtly wrong.

Your own work is: writing each brief precisely against plan §3, deciding
sequencing and parallelism (§5), re-reading shared files yourself before any
delegated edit lands there, and **independently verifying** every result — run
the plan's §4 commands yourself, read the screenshots as images yourself. A
subagent's claim is not evidence. When something comes back wrong, re-dispatch
with what was wrong named, rather than fixing it inline.

## Ground rules that come from the tree, not the plan

- This worktree is shared by other live sessions (terminals titled
  `chat-demo-hosting`, `pi-agent`, `Add out-of-process pi backend…`). Build in
  `frontends/jinja/` first — it's ours and conflict-free. Shared files (plan §6)
  get touched once, late, after re-reading them from disk; message the owning
  session first (`orca orchestration send --to <handle> --subject … --body …`
  or `SendMessage`); stage with `git add -p`; never `git add -A`.
- `probes/flows.yaml` is not ours. The `resume` flow will fail for this cell
  because it rehydrates — by design. Hand that to the flows owner with the two
  candidate encodings in plan §6.
- Verify volatile state before reporting it: ports in `scripts/stacks.sh`
  (3005 was free at planning time), what's running (`.run/`), git status.
- Commits: conventional, our paths only, `Co-Authored-By` trailer as usual.
  Don't push unless asked.
- Memory: `~/.claude/projects/-Users-fairchild-code-pydantic-chat/memory/`
  — read `jinja-monolith-cell-plan.md` and
  `project_shared_worktree_coordination.md`; add what you learn that isn't
  derivable from the code (re-read `MEMORY.md` before appending; others write
  there concurrently).

## Facts already verified for you (2026-08-17, pydantic-ai 2.31.0)

- `VercelAIAdapter(agent=…, run_input=…, sdk_version=7).run_stream(message_history=…, on_complete=…)`
  yields typed `*Chunk` objects in-process; `message_history` is prepended to
  the request's messages, so passing the store's history and a request holding
  only the new user message is the intended shape.
- `run_input` comes from `VercelAIAdapter.build_run_input(json_bytes)` — same
  body shape as `/chat`.
- `/threads/{id}?protocol=vercel-ai` returns one turn as **two** assistant
  `UIMessage`s (tool part, then text part). Merge on rehydration or reload
  doubles the assistant count.
- Nothing upstream folds chunks into UI message parts; the accumulator is
  ours (~60 lines).
- A live weather stream and the rehydration payload are captured in the plan
  session's scratchpad if you want the exact bytes; otherwise `curl` `:8001`
  — the matrix was up at planning time.

## When you're done

Report in your terminal, for a reader catching up fresh: what's built, the §4
outputs (actual, not summarised), the screenshots you looked at, what's not
done and why, and the one recommended next action. Then stop.
