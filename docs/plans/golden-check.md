# Plan: the golden check — hold every backend to the reference's work

*Written 2026-08-17 for a workflow of agents to execute, from
`docs/plans/golden-check.handoff.md`. Every contract in §3 is fixed on purpose
so parallel lanes build against the same thing; change a contract here first,
then in code.*

## 1. What this is for

The comparison rests on one premise: two frontends given the same prompt receive
byte-identical work, so what differs on screen is the stack. Today that premise
is held up by four hand-kept copies of the scripted model and the three tools —
`backends/pydantic-ai` (Python, the reference), `backends/cloudflare-agents/src/scripted.ts`,
`backends/pi/src` and `backends/pi-rpc/src` — and by nothing else.
`protocol/conformance.sh` asserts the events a frontend depends on *exist*; it
never asserts two backends *agree*. Agreement has been checked three times, by
hand, by one session diffing captured streams; the drift it found is *recorded*
in READMEs rather than *fixed*, which is the tell that the check is missing.

This check captures each backend's streams for a fixed set of prompts, reduces
them to a canonical form that erases only what is allowed to differ, and diffs
them against fixtures captured from the reference. It replaces the hand diffs.
It is one script, a directory of text, and one small file of exceptions.

What the scout run against the live matrix found (2026-08-17, structural diff
after erasing ids/timestamps and sorting keys), which is what the design has to
handle:

| Backend | `/chat` | `/ag-ui` |
|---|---|---|
| pi, pi-rpc | identical, except pydantic-ai's `message-metadata` chunk (a timestamp); on the multi-tool prompt, `tool-input-available` is emitted per call instead of after every call's deltas | identical |
| cloudflare-agents | the summary prints tool results as JSON (`{"city":"Tokyo",…}`) where the reference prints Python's repr (`Weather(city='Tokyo', …)`); `finish` carries `finishReason`; the `message-metadata` chunk | the summary difference only |

pi-rpc's "burst" delivery of tool arguments (its README) is a *timing*
difference only: it holds the deltas until `toolcall_end` supplies the id and
then replays them in order, so a captured body has the same chunks in the same
order as the in-process cell. A body-level check cannot see timing and does not
try to.

Rehydration (`GET /threads/{id}`) diverges materially between all four (message
counts 6/4/6/6; pydantic-ai serialises every optional as `null`; cloudflare
merges a turn's steps into one message) — it is a different serialisation by
construction, `CONTRACT.md` already documents the two history models, and no
frontend reads it. Out of scope; named in §8 as something the check does not
catch.

## 2. Decisions (locked)

| Decision | Choice | Why |
|---|---|---|
| Where | `protocol/golden.ts` (bun, no deps), fixtures in `protocol/golden/`, `scripts/golden.sh` + `mise run golden` | `protocol/` is the contract and its enforcement; bun + a small script is the repo's habit; the wrapper mirrors `probe.sh` and reads the matrix from `stacks.sh` |
| Reference | `backends/pydantic-ai` (`:8001`) | it is the reference; fixtures are captured from it by an explicit `--update` |
| Prompts | `weather` = `What's the weather in Tokyo?`, `notes` = `Search notes for streaming protocols.`, `analyze` = `Analyze assistant-ui as a chat frontend.` (the hub's PROBES verbatim, straight apostrophe), `follow-up` = weather then notes on one thread (the fixture is turn two), `multi-tool` = `What's the weather in Tokyo, and search notes for streaming?` | the three probes plus the two places a copy of the scripted model can drift without any probe noticing: history parsing and multi-call ordering |
| Protocols | `/chat` (Vercel data stream, SDK v7) and `/ag-ui` (SSE) | both are what frontends consume; conformance covers both |
| Compared | the response **body** only, as a sequence of parsed SSE `data:` frames | headers are conformance's concern; the body is the work |
| Canonical form | §3.2 — erase id values by consistent renaming, erase timestamp values, drop `message-metadata`, sort keys; **keep** event order, delta boundaries, content, tool names, argument JSON, tool results, finish state | erase what is allowed to differ and nothing else; delta boundaries are kept because every backend agrees on them today and a backend that stopped streaming would be giving the frontend different work |
| Exceptions | `protocol/golden/exceptions.json`, per backend, per (protocol, event, field), each with a `why`; the check prints every exception it applies | one small visible place; field-precise so it cannot hide broad drift; a new *kind* of exception (ordering, extra event) is a design moment, not a config edit |
| Drift found → fix, not except | cloudflare-agents' summary formatting: **fix** (`scripted.ts` + a `pyrepr.ts` copy); pi/pi-rpc multi-tool ordering: **fix** (hold `tool-input-available` until the assistant message ends); cloudflare-agents' `finishReason`: **except** | the summary is a bug against the premise; the ordering is an adapter choice and the reference defines the work; `finishReason` is stamped by the AI SDK unconditionally (`sendFinish:false` drops the whole chunk) — stripping it would mean post-processing the SDK's stream to remove information no cell reads |
| `message-metadata` | the reference's timestamp stamp — that exact frame shape — is dropped by the canonical form; any other metadata is compared | its entire payload is a pydantic-ai timestamp; the reference is the only emitter, so a per-backend exception would be three copies of the same reason; matching the shape exactly (rather than the type) keeps a backend from smuggling content through it |
| Not doing | rehydration fixtures; timing/pacing; HTTP headers; re-keying `probes/artifacts/` by backend | scope (§8 says what the check does not catch) |

## 3. Contracts

### 3.1 Files

```
protocol/
  golden.ts                    the check (§3.3); `bun protocol/golden.ts [--update] [url…]`
  golden/
    README.md                  six lines: what these are, how to regenerate, don't hand-edit
    exceptions.json            §3.4
    weather.chat.ndjson        canonical /chat stream from the reference (§3.2)
    weather.ag-ui.ndjson
    notes.chat.ndjson          notes.ag-ui.ndjson
    analyze.chat.ndjson        analyze.ag-ui.ndjson
    follow-up.chat.ndjson      follow-up.ag-ui.ndjson      (turn two of two)
    multi-tool.chat.ndjson     multi-tool.ag-ui.ndjson
  golden.test.ts               the normaliser's adversary (§4): mutations it must catch, mutations it must ignore
scripts/golden.sh              sources stacks.sh, runs golden.ts over BACKENDS; --update forwards
.mise.toml                     [tasks.golden]
docs/recordings/golden-check.gif   the recorded run (§6); README points at it
```

Edited, each once, as late as possible, after re-reading the file on disk:
`README.md` (What's here paragraph on drift; Adding a stack step; the recording),
`protocol/CONTRACT.md` (a "Golden" section after "Conformance"),
`backends/{pi,pi-rpc,cloudflare-agents}/README.md` (the sentences that describe
the drift as it was), `docs/architecture.md` if a sentence there is now false.

### 3.2 The canonical form

Input: a response body. Output: one line per frame, NDJSON, `\n`-terminated.

1. Split on blank lines; keep frames beginning `data:`; strip the prefix and
   surrounding whitespace. Any other frame (`event:`, comments) is dropped.
2. `[DONE]` is kept as the literal line `[DONE]`.
3. Parse each frame as JSON. A frame that does not parse is kept as
   `!unparsed <raw>` — a difference, never a crash.
4. Drop the frame that is exactly pydantic-ai's timestamp stamp —
   `{"type":"message-metadata","messageMetadata":{"pydantic_ai":{"timestamp":…}}}`
   and nothing else. Any other `message-metadata` is content and is compared.
5. **Ids** — for keys `id`, `toolCallId`, `messageId`, `parentMessageId`,
   `threadId`, `runId` **at the frame's top level**: replace the value with `#n`,
   where `n` is the 1-based order of first appearance of that value *in this
   stream*. Consistent renaming keeps pairing (a delta that names the wrong call
   still shows) and cross-references, and erases the values. Note
   `call_get_weather_0` is therefore not checked as a value; a backend that named
   its calls differently but paired them correctly passes. An `id` inside a
   tool's output is that tool's content and is compared as-is.
6. **Timestamps** — the key `timestamp` at the frame's top level: value → `~`.
7. Serialise each frame with keys sorted, `JSON.stringify` (no spaces),
   non-ASCII unescaped.
8. Nothing else. Delta boundaries, event order, `finish`/`RUN_FINISHED`
   payloads, tool outputs (as parsed JSON), and every other field are compared
   as-is.

The `follow-up` flow's turn two carries the history a client would send: for
`/chat`, the assistant `UIMessage` rebuilt from turn one's stream the way
`useChat` builds it (`tool-<name>` parts with `toolCallId`, `state`, `input`,
`output`; a `text` part with `state:"done"`); for `/ag-ui`, the assistant
message with `toolCalls`, one `tool` message per result, and the assistant text
message, as CopilotKit sends them. The reconstruction lives in `golden.ts`
(~40 lines) and is stated in its header comment as an approximation of the
clients.

### 3.3 `golden.ts` — CLI, behaviour, output

```
bun protocol/golden.ts                       # check http://localhost:8001 (like conformance.sh)
bun protocol/golden.ts URL [URL…]            # check each backend
bun protocol/golden.ts --update [URL]        # regenerate protocol/golden/*.ndjson from URL (default :8001)
```

- Backend name comes from `GET /health` `.backend`; it selects the exceptions.
  `--update` warns (does not refuse) if the name is not `pydantic-ai`.
- Thread ids: `golden-<pid or random>-<flow>`; every thread created is `DELETE`d
  at the end (as conformance does), including the follow-up's and the AG-UI ones.
- Flows run concurrently within a backend; backends run concurrently; output is
  printed per backend as each completes, fixtures in the order of §3.1.
- Per fixture: capture → canonical → apply that backend's exceptions to the
  actual → compare to the fixture text. Equal → `✓`. Different → `✗` and a unified
  diff (`diff -u` via `Bun.spawn`, or a minimal LCS if diff is unavailable) with
  `--- golden/<file>` / `+++ <backend>`; the diff is the whole message.
- Every exception applied is printed on the fixture's line:
  `✓ weather     /chat    ⚠ finish.finishReason excepted`.
- Trailer per backend: `N identical, M differ, K exceptions applied`; final exit
  code is non-zero if any fixture differs on any backend or any backend is
  unreachable. Unreachable → one red line, keep going with the others.
- Output uses the same glyphs and colours as `conformance.sh` (`✓` green,
  `✗` red, bold headings) so the two read as one family.
- No dependencies. `bun` only. Under 250 lines including the header comment.

### 3.4 `exceptions.json`

```json
{
  "cloudflare-agents": [
    {
      "protocol": "chat",
      "event": "finish",
      "field": "finishReason",
      "why": "The AI SDK stamps finishReason on the finish chunk unconditionally (sendFinish:false drops the whole chunk); the reference's adapter sends none. No cell reads it; stripping it would mean post-processing the SDK's stream to remove information."
    }
  ]
}
```

Semantics: before comparing, for frames of the given `type` on the given
protocol, delete `field` from the **actual** stream of that backend. Nothing
else is expressible; if drift needs another shape, that is a change to this
plan and to `golden.ts`, and the plan says why.

### 3.5 The two fixes

**cloudflare-agents summary** — `backends/cloudflare-agents/src/scripted.ts`
renders tool results in `summary()` with `JSON.stringify`. Replace with a
per-tool render identical to `backends/pi/src/scripted.ts`'s `RENDER` table,
backed by a verbatim copy of `backends/pi/src/pyrepr.ts` at
`backends/cloudflare-agents/src/pyrepr.ts` (the third copy; the repo's habit is
per-backend copies, and pi/pi-rpc already hold two identical ones). Unknown tool
→ `JSON.stringify`. The bytes to match are in `protocol/golden/*.chat.ndjson`
(text-delta lines after `returned: `). `wrangler dev` hot-reloads.

**pi and pi-rpc multi-tool ordering** — `backends/pi/src/vercel.ts` and
`backends/pi-rpc/src/vercel.ts` emit `tool-input-available` at `toolcall_end`.
Hold those chunks and flush them, in order, on the assistant `message_end`
(pi's session events run `message_start(assistant)`, `message_update`…,
`message_end(assistant)`, then tool execution), so the sequence becomes
`start₀ Δ₀ Δ₀ start₁ Δ₁ Δ₁ available₀ available₁ output₀ output₁`, which is the
reference's. Single-call turns are unchanged on the wire. Also flush on an
assistant `message_end` with `stopReason:"error"` (before the error chunk) so
nothing is left held. `/ag-ui` (`agui.ts`) already matches and is not touched.
Neither pi backend hot-reloads (`bun run src/main.ts`, no `--watch`): restart
**only that backend** with the recipe in §7.

Each fix updates the sentence in that backend's README that described the drift.

## 4. Verification — what "done" means

Run these before calling any lane done; report the output, not a summary.

```sh
bun protocol/golden.ts --update                        # from :8001; git diff protocol/golden/ shows exactly what changed
./scripts/golden.sh                                    # all four; green, or red with the drift printed
bun protocol/golden.ts http://localhost:8002           # one backend, conformance's ergonomics
bun test protocol/golden.test.ts                       # the adversary: green
diff backends/pi/src/pyrepr.ts backends/cloudflare-agents/src/pyrepr.ts   # empty
./protocol/conformance.sh http://localhost:8002        # still 18/18 after the fix; same for :8003 :8004
```

The adversary (`golden.test.ts`, bun test, ≤ 80 lines) takes a captured
reference body from `protocol/golden/` (or a fixture string) and asserts, for
the canonical form: **must catch** — a tool output paired to the other call; a
dropped `text-delta`; one changed byte in the summary; two adjacent events
swapped; a `finish` gaining a field; a delta split in two. **Must ignore** —
different id values with the same pairing; different timestamps; different key
order; a `message-metadata` chunk present or absent; the fixture's own text
round-tripped. It also asserts an exception drops only the named field on the
named event, and nothing on other events.

Then **look at the recording** (§6) as an image sequence — a passing exit code is
not evidence the run reads clearly.

## 5. Work breakdown for the workflow

Lanes inside phase A run in parallel against §3 and never edit each other's
files. Model choices follow the house rule: Opus by default, Sonnet when the
task is simple and fully specified.

| Phase | Lane / model | Does | Done when |
|---|---|---|---|
| **A1** the check | Opus | `protocol/golden.ts` per §3.2–3.4, `protocol/golden/README.md`, `exceptions.json` with the cloudflare entry, `scripts/golden.sh`, the mise task; runs `--update` against `:8001` and checks the fixtures in | §4 lines 1–3 run; fixtures exist; `:8003`/`:8004` show exactly the multi-tool ordering diff and nothing else, `:8002` shows exactly the summary diff and nothing else |
| **A2** cloudflare fix | Sonnet | §3.5 first fix | the summary text-deltas match the reference bytes for weather, notes, follow-up, multi-tool (verify with a raw curl diff on the `returned:` lines against `:8001`); `tsc --noEmit` clean; conformance 18/18 |
| **A3** pi ordering fix | Sonnet | §3.5 second fix in both pi backends | multi-tool `/chat` from `:8003` and `:8004` has the reference's order (verify with a raw curl, ids stripped, against `:8001`); weather unchanged; conformance 18/18 on both |
| **B1** adversary | Opus, fresh context | `protocol/golden.test.ts` per §4; reads only this plan and `golden.ts`; reports any mutation the normaliser lets through or any allowed difference it flags | `bun test` green; a findings list |
| **B2** docs | Sonnet | README.md (§3.1 edits: the drift paragraph rewritten to say what the check now holds, the Adding-a-stack step, what it replaces, the recording link); CONTRACT.md "Golden" section; the three backend READMEs' drift sentences; architecture.md only if a sentence is now false | prose in the repo's register; every claim matches the actual check output |
| **C** verify + record | the coordinator (Fable) | run §4 in full against the live matrix; read the fixtures; read the diffs; record with `vhs` (§6); commit | all green (or an exception, printed); recording plays; commit on `demo`, own files only |

Sequencing: A1 ‖ A2 ‖ A3 → B1 ‖ B2 → C. Five agents plus the coordinator; the
coordinator verifies every lane's claim by running the check itself.

## 6. The recording

`vhs` tape at `docs/recordings/golden-check.tape`, output
`docs/recordings/golden-check.gif` (and `.mp4` if the gif exceeds ~4 MB — then
the README links both). It shows, start to finish, against the live matrix:
`./scripts/golden.sh` running all four backends to green with the one exception
printed; then, so the viewer sees what red looks like, one intentional
mutation (a one-byte edit to a checked-out fixture, or `bun protocol/golden.ts`
against a backend with the fix reverted) — followed by the restore. Terminal
width 110, font 14, minimal typing delay; the whole thing under ~90 s.

## 7. Coordination — this tree is shared

- Another session is building `frontends/jinja` from
  `docs/plans/frontends-jinja.md`; leave `frontends/jinja/`, their plan files, and
  their `stacks.sh` line alone. `next-env.d.ts` churn is nobody's — don't stage it.
- **Never run bare `./scripts/stop.sh`.** `wrangler dev` (cloudflare-agents)
  hot-reloads. The pi backends don't; restart exactly one of them like this,
  from the repo root, `NAME`/`PORT` being `pi`/`8003` or `pi-rpc`/`8004`:

  ```sh
  pid=$(cat .run/backend-$NAME.pid); kill $(pgrep -P "$pid") "$pid"; sleep 1
  (cd backends/$NAME && exec env PORT=$PORT bun run dev) </dev/null >.run/backend-$NAME.log 2>&1 &
  echo $! > .run/backend-$NAME.pid; curl -sf localhost:$PORT/health
  ```

  That is `run.sh`'s own `start` step, for one entry. Nothing else in `.run/`
  is touched.
- Files we touch that others also touch: `README.md`, `.mise.toml`,
  `docs/architecture.md`. Re-read on disk before editing; stage only our hunks.
- Commits, ours only, conventional: `feat(protocol): golden check — hold every
  backend to the reference's streams`, `fix(backend): cloudflare-agents summary
  prints tool results as the reference does`, `fix(backend): pi, pi-rpc emit
  tool-input-available after the model's turn, as the reference does`,
  `docs: …`. Or one commit if the pieces don't separate cleanly; separable is
  better.

## 8. Risks and what the check does not catch

| Risk | Mitigation |
|---|---|
| Flaky captures (a backend hiccups) | thread ids unique per run; unreachable/incomplete streams print as red with the body, never as green |
| The normaliser erases a real difference | the adversary in §4; the canonical form is small enough to read |
| Fixtures rot when the reference changes | `--update` is explicit; the fixture diff is a reviewer's diff |
| pi ordering fix leaves chunks held on abort | flush on any assistant `message_end`; on abort the stream ends anyway |
| The check grows into a project | it is one script under 250 lines, ten text files, one exceptions file, one test; anything beyond that is a plan change |

Not caught, by design: timing and pacing (pi-rpc's burst; `TOKEN_DELAY`);
HTTP headers; rehydration (`/threads/{id}`) — a different serialisation per
backend today; id *values* (pairing is checked); anything a real (`DEMO_MODEL`)
model does — the check only means something under the scripted model.

## 9. Outcome

*Written 2026-08-17 after the run. Verified means I ran it in this session
against the live matrix; inferred is reasoning from code; unknown is unknown.*

**What was built.** `protocol/golden.ts` (249 lines, bun, no dependencies),
ten fixtures in `protocol/golden/` captured from `:8001` by `--update`,
`protocol/golden/exceptions.json` with one entry, `protocol/golden.test.ts`
(the normaliser's adversary), `scripts/golden.sh`, `mise run golden`, a
"Golden" section in `CONTRACT.md`, a step in the README's "Adding a stack",
and `docs/recordings/golden-check.gif` from `golden-check.tape` (48 s, ~570 KB:
all four green; one word edited in cloudflare-agents' scripted model → four
fixtures red with the diff; reverted → green). It replaces the three hand
diffs. Verified: `./scripts/golden.sh` is green on all four
backends — 40 fixtures identical, 5 exceptions applied (cloudflare-agents'
`finish.finishReason` on each `/chat` fixture) — in about 9 s wall clock with
every capture concurrent; `--update` run twice changes nothing;
`conformance.sh` is still 18/18 on all four.

**Drift found and fixed** (all verified live before and after):

- `cloudflare-agents` printed tool results in the summary as JSON where the
  reference prints Python's repr — the drift the reflection named. Fixed in
  `src/scripted.ts` with a per-tool `RENDER` table backed by a verbatim copy of
  pi's `pyrepr.ts` (the third copy).
- `cloudflare-agents` also emitted `tool-input-available` per call on multi-tool
  prompts (the AI SDK turns each `tool-call` part into one as it arrives). The
  scout missed this under the summary noise; the check caught it on its first
  full run. Fixed by emitting every plan's `tool-input-start`/deltas first and
  the `tool-call` parts together after — the reference's order.
- `pi` and `pi-rpc` emitted `tool-input-available` per call on multi-tool
  prompts, at `toolcall_end`. Fixed in both `vercel.ts` adapters by holding the
  chunks until the assistant `message_end` (confirmed from the SDK's compiled
  agent loop that it precedes tool execution). This reverses a stance in
  `backends/pi/README.md`, which called pi's timing "arguably the more useful"
  — still true as an observation, kept as an aside; the adapter no longer acts
  on it. If Michael prefers pi's timing, the change is ~10 lines to revert per
  backend and the check would then need an ordering exception, which the
  exceptions format deliberately cannot express today.

**Drift accepted, explicitly:** `cloudflare-agents` `finish.finishReason` —
the AI SDK writes it unconditionally (`sendFinish:false` drops the whole
chunk); the reference's adapter sends none; no cell reads it. Recorded in
`exceptions.json` with that reason and printed on every run.

**Erased by design:** pydantic-ai's `message-metadata` timestamp stamp — that
exact frame shape, nothing else (its whole payload is a timestamp; the
reference is the only emitter). Ids are renamed by first appearance, at a
frame's top level only, so pairing is checked and values are not.

**What the adversary found** (`protocol/golden.test.ts`, 35 cases, run against
a live capture from `:8001`): the first draft erased `id`/`timestamp` keys at
any depth, so an `id` inside a tool's output was erased on `/chat` but compared
on `/ag-ui` (where it lives inside a JSON string) — closed by erasing at the
frame's top level only; and dropping every `message-metadata` frame would let a
backend carry anything there unseen — closed by dropping only the reference's
exact stamp shape. B1 also proved the suite is not decorative: run against two
deliberately lazy normalisers (one concatenating deltas — the handoff's original
proposal — one blanking ids to `#`), 13 and 12 cases go red.

**Found on the way, not drift:**

- `pi-rpc` returned 500 (or an `error` chunk mid-turn) for some concurrent
  requests: `Pool.acquire()` spawned a child with `busy=false` and awaited its
  first command, so a concurrent fifth `acquire()`'s `makeRoom()` saw it as idle
  and evicted it mid-start (SIGTERM → exit 143, or `stdin.end()` after readiness
  → exit 0 mid-turn). Verified by reproducing 2/6 failures at 6 concurrent
  requests, then 8/8 clean after marking the child busy from spawn until
  hand-over (`backends/pi-rpc/src/pi.ts`, 3 lines) and restarting that backend
  alone.
- `wrangler dev` (cloudflare-agents) died once during the work with an empty
  `ProxyController` error under concurrent check traffic, minutes after a
  successful hot-reload; restarted alone with `run.sh`'s recipe. Cause unknown;
  not reproduced since.
- The pi child inherits `~/.pi/agent/settings.json`; a stale `enabledModels`
  pattern there prints a warning that `pi-rpc` reports as the exit detail. Not
  a cause of anything, but it is what you see first.
- The `follow-up` fixtures are byte-identical to the `notes` ones on every
  backend, so the flow proves a backend accepts client-shaped history and still
  emits the reference's work; a backend that silently discarded history would
  pass. Rehydration (`/threads/{id}`) is where history is actually visible and
  it diverges by construction (see §1).
- A check run killed mid-way leaks its `golden-<pid>-*` threads (cleanup runs
  in `finally`, not on SIGKILL); an interrupted lane left ten on `:8003`, since
  deleted.

**What the check does not catch** (unchanged from §8, now confirmed): timing
and pacing (pi-rpc's burst; `TOKEN_DELAY`); HTTP headers; rehydration; whether
history is read; id values; duplicate JSON keys (last wins); `18` vs `18.0`;
anything a real model does. There is no static typecheck for `golden.ts` (no
bun types installed in `protocol/`; the runtime runs and the test are the gate).
`golden.ts` is 256 lines and the test 79 — a little over the 250 the plan
asked for, after the two closures above.

**Process.** Plan first, then a Workflow: A1 (opus) the check, A2/A3 (sonnet)
the two backend fixes, B1 (opus, fresh) the adversary, B2 (sonnet) docs. A1
was interrupted by the harness twice and retried; its third attempt trimmed
the inherited draft to 249 lines and verified `--update` idempotence by md5.
The two fixes I made myself (cloudflare's ordering; pi-rpc's pool) were each
smaller than a delegation. Every lane's claim was re-run here before this
section was written.
