# Handoff: the golden check — hold the four backends to the same work

*Written 2026-08-17 by the chat-demo-hosting session for the session that owns
the build. This is a full ownership handoff — nobody is supervising a dispatch,
so no `worker_done` / heartbeat lifecycle applies. Report to Michael in your
own terminal.*

## What you're doing

Build the check that keeps every backend in `backends/` giving every frontend
the same work to render, and wire it in so it runs as a matter of course. Then
prove it: a commit, and a recorded end-to-end run against the live matrix.

Michael's intent, in his words: *"create the real golden check we need"*, and
for done: *"completion is with a commit and demonstrated run with e2e
recording."*

## Why it's needed — what the reflection found

The whole comparison rests on one premise: two frontends given the same prompt
receive byte-identical work, so what differs on screen is the stack. That
premise is held up today by four separate copies of the scripted model and the
three tools — `backends/pydantic-ai` (Python, the reference),
`backends/cloudflare-agents/src/scripted.ts`, `backends/pi/src` and
`backends/pi-rpc/src/extension.ts` — and by nothing else. `protocol/conformance.sh`
asserts that the events a frontend depends on *exist* in a stream; it never
asserts two backends *agree*.

Agreement has been checked three times, all by hand, by one session diffing
captured streams after normalising ids: pi vs pydantic-ai (identical), pi-rpc
vs pi (identical), cloudflare-agents vs pydantic-ai — where real drift turned
up: its summary renders the tool result differently and it adds a
`finishReason` field. That drift is *recorded* in the root README rather than
*fixed*, which is the tell that the check is missing. The fifth backend that
quietly formats `Weather(city='Tokyo', …)` its own way would ship green.

One difference is real and accepted, and the check has to be able to say so:
`pi-rpc` delivers tool arguments in a burst at `toolcall_end` because pi's RPC
wire drops partials, so its `tool-input-delta` chunking differs from the
in-process cell while the content is the same. `backends/pi-rpc/README.md`
explains it.

## Shape — a recommendation, not a contract

Plan first (below); the design is yours. What I'd build, and why:

- **Golden fixtures, captured from the reference.** For each probe prompt
  (`index/index.html` PROBES: weather, notes, analyze — and a follow-up turn on
  a thread that already has one, since history handling is where the backends
  are known to differ) and each protocol (`/chat` Vercel data stream v7,
  `/ag-ui` SSE), a canonical form of pydantic-ai's stream, checked in under
  `protocol/golden/`. Regenerating them is an explicit command; a diff in the
  fixture is a diff a reviewer sees.
- **A canonical form that erases what's allowed to differ and keeps what
  isn't.** Ids (message, tool-call — `call_*`, thread, run), timestamps, and
  chunk boundaries: concatenate deltas per part, so `pi-rpc`'s burst equals the
  streamed version. Keep event *order*, part *content*, tool names, argument
  JSON, tool results, and finish state. Where a backend genuinely adds a field
  (`finishReason`), the choice should be forced: match the reference or record
  the exception explicitly, per backend, in one small visible place — not a
  broad allowlist that hides drift again.
- **Prefer fixing drift to allowlisting it.** `cloudflare-agents`' summary
  formatting is a bug against the premise; fixing `scripted.ts` there is in
  scope and welcome (it's TS, ~150 lines, and `wrangler dev` hot-reloads).
- **Where it lives.** `protocol/` is the contract and its enforcement, and it
  is the only thing both sides may depend on — the check belongs there
  (`protocol/golden.ts` under bun, or an extension of `conformance.sh`, your
  call; bun + a small script is the repo's habit, stdlib-preferred). Wire a
  `mise` task and a `scripts/` entry consistent with `probe.sh`, and add it to
  the "Adding a stack" steps in the root README, next to conformance. Say in
  the README what it replaces (the hand diffs).
- **Stay small.** Michael's rule for verification tooling: it states what it
  replaces or why it's net-new, and if the checking apparatus is becoming its
  own maintenance project, say so and propose less. A golden diff over four
  fixtures should be one script and a directory of text.

Adjacent, and only if it's cheap once you're in there: `probes/artifacts/` is
keyed by flow, not by backend, so a `PROBE_BACKEND=` run over four backends
keeps only the last one's captures — the reflection named that as the reason
the 16-pair pass left no evidence in the repo. Not the deliverable; don't let it
grow the scope.

## Who does what

You are Fable and you own this. Michael asked that the session *"plan out the
process, encouraging workflow use with preference for opus and sonnet when
viable, with the main fable agent orchestrating and driving quality"* — that is
your explicit opt-in for the Workflow tool and for subagents on `opus` /
`sonnet`, and it puts the shape of the work on you:

- **Write the plan before code**, as `docs/plans/golden-check.md` (the
  neighbour `docs/plans/frontends-jinja.md` shows the house style: what it's
  for, fixed contracts, lanes, done criteria). Decide the canonical form and the
  fixture layout there first; they are the contracts parallel lanes build
  against.
- **Fan out where it pays.** Capturing streams from four live backends,
  writing the normaliser, checking each backend's tool/summary source against
  the reference, and the recording are separable lanes — good workflow shape,
  and fine on opus/sonnet. Adversarial verification of the normaliser (does it
  erase a *real* difference? does it let one through?) is worth a skeptic pass.
- **Verify subagent output yourself before calling anything done.** A
  subagent's claim is not evidence — Michael's standing rule. Run the check
  yourself against the live matrix; read the fixtures.

## Ground truth you'll need

- Repo: `~/orca/workspaces/pydantic-chat/demo`, branch `demo`, Orca-managed,
  **shared by several live sessions** (one is building `frontends/jinja` from
  `docs/plans/frontends-jinja.md` right now — leave `frontends/jinja` and their
  untracked plan files alone). Commit only your own paths; `next-env.d.ts`
  churn from dev servers is nobody's — don't stage it.
- The matrix is up: backends `pydantic-ai :8001`, `cloudflare-agents :8002`,
  `pi :8003`, `pi-rpc :8004`; frontends `:3001–:3004`; hub `:3000`. A hosted
  preview may be running on `:4000–:4004`. **Never run bare
  `./scripts/stop.sh`** — it kills every session's processes; the prefixed
  forms (`./scripts/stop.sh hosted`) are safe. Backends hot-reload; if you must
  restart one, restart only that one.
- `protocol/CONTRACT.md` is the contract; `protocol/conformance.sh` the
  existing gate (18 checks; all four pass). Each backend's README has a "How it
  maps to the contract" section. `docs/architecture.md` §"The four seams" and
  the root README §"What's here" describe the drift already known.
- The scripted model's behaviour, canonical: `backends/pydantic-ai` — keyword
  → tool plans, `call_<tool>_<index>` ids, args streamed in two halves, a
  fixed summary, a fixed fallback. Every other copy is meant to match it byte
  for byte.
- Conventions: uv for Python, bun for TS, `mise` tasks; conventional commits
  ending `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`; ergonomics
  notes written while the friction is fresh. Do not publish anything
  (`scripts/publish.sh` is Michael's call).

## Done means

1. The check exists, is documented, and runs green against all four live
   backends — or red with the drift named and either fixed in that backend or
   recorded as an explicit, per-backend exception with a reason.
2. Committed on `demo` (your files only), plan + code + fixtures + docs.
3. **A recorded end-to-end run**: the check executing against the live matrix
   from start to finish, in a form that plays without special tooling. `vhs`
   and `ffmpeg` are installed for terminal recordings; the probes harness
   already records `.webm` per flow through Playwright (`probes/matrix.spec.ts`)
   if a browser-visible surface makes sense. Put the recording somewhere the
   README points at, and say in your final report where it is and what it
   shows.
4. A short "Outcome" section at the end of `docs/plans/golden-check.md`: what
   drift was found, what was fixed, what was accepted and why, and what the
   check does *not* catch.

Then tell Michael, in your own terminal, in plain terms — verified, inferred,
and unknown kept distinct.
