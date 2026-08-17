# Backend: pi-rpc

The reference agent on [pi](https://pi.dev/) again, but this time pi is a
**separate process**: each thread gets its own `pi --mode rpc` child, spoken to
over stdin/stdout JSONL, and this server is a thin HTTP face in front of it.
Serves the Vercel AI data stream protocol and AG-UI. See `protocol/CONTRACT.md`
for what it has to implement and why.

`backends/pi` links pi as a library — `createAgentSession` in the server's own
process. This cell exists to answer the other question about an agent that
ships as a program: what does it cost to drive it from *outside*, the way you
would from Python or Go or a shell, where the process boundary is the
integration point and pi's own CLI is the runtime? Same agent, same three tools,
same scripted model; the difference is which side of the pipe they live on.

```sh
bun install
bun run dev            # :8004 — or PORT=… bun run src/main.ts
```

| Env | Default | |
|---|---|---|
| `DEMO_MODEL` | `scripted` | pi's `provider/model[:thinking]`, e.g. `anthropic/claude-opus-4-5:high` |
| `DEMO_SESSIONS` | `data/sessions` | where the pi children write their session files |
| `DEMO_IDLE_SECONDS` | `60` | how long an idle child stays warm before it is shut down |
| `DEMO_MAX_CHILDREN` | `4` | resident children before the oldest idle one is evicted (each idles at ~200 MB) |

A real `DEMO_MODEL` is resolved by the child through pi's own model catalogue
and credentials — the same `~/.pi/agent/auth.json` the `pi` CLI uses — so a
provider you have logged into with pi needs no key here. The server checks the
spelling at boot by asking a throwaway child what `--model` resolved to, so a
typo fails on start rather than on the first message.

## Layout

| File | |
|---|---|
| `src/extension.ts` | what the child loads (`-e`): the scripted provider and the three tools, via `pi.registerProvider` / `pi.registerTool` |
| `src/tools.ts`, `src/scripted.ts`, `src/pyrepr.ts` | the reference agent — runs *inside the child*; the same code as `backends/pi`'s |
| `src/pi.ts` | `PiChild`: spawn `pi --mode rpc`, JSONL in and out, request/response correlation; `Pool`: one child per thread, idle eviction |
| `src/protocol.ts` | what a wire protocol provides, and the loop that streams one turn from a child |
| `src/vercel.ts`, `src/agui.ts` | the two protocols: pi wire events out, pi messages rehydrated in |
| `src/store.ts` | threads as pi session files, read back with pi's `SessionManager` |
| `src/main.ts` | the HTTP surface, on `Bun.serve` |

The server never runs a model or a tool. Everything the child does is
configured on its command line (`childArgs` in `pi.ts`): the extension, the
model, `--no-builtin-tools` and the five `--no-*` discovery flags, the system
prompt, and `--session-dir … --session-id <thread>` so the session file *is*
the thread.

## Why this style

pi offers three ways in: the SDK in-process (`backends/pi`), a JSON event
stream (`pi --mode json "prompt"` — one-shot, events on stdout, exit), and RPC
(`pi --mode rpc` — long-lived, commands on stdin, events and responses on
stdout). There is also an experimental fourth — `@earendil-works/pi-client`
speaks a CBOR protocol to "remote pi sessions" — but nothing in the installed
0.84.2 CLI serves it (its modes are interactive, print, json, rpc), so it isn't
a way to run pi today.

Both out-of-process modes were prototyped before choosing. On the questions
that decide it for this matrix:

**Can it still do the scripted work, byte for byte?** Yes, both. pi loads
extensions with `-e path.ts`, an extension can `pi.registerProvider()` a full
pi-ai `Provider` and `pi.registerTool()` custom tools, and `--model
scripted/scripted` then resolves from that provider like any other. So the same
`scripted.ts` that `backends/pi` registers with `ModelRuntime` becomes the body
of an extension, and the child's model is exactly as deterministic as the
in-process one. The out-of-process pi does *not* choose its own model — the
child is told, and it never sees the developer's default provider or `AGENTS.md`
because the discovery flags are off. Verified: `/chat` and `/ag-ui` from this
cell are byte-identical to `backends/pi`'s for the probe prompts (ids aside).

**How do tool calls, results and text surface?** Identically in both modes:
`JsonAgentSessionEvent`, which is the SDK's `AgentSessionEvent` with the
cumulative `partial` snapshot stripped from `message_update`. That one omission
is the whole difference from the in-process adapters, and it is not nothing —
see the contract section below. RPC additionally interleaves `response` lines
that have to be demuxed from events by `id`; JSON mode has only events, plus a
`session` header line.

**How do sessions map to threads?** Both take `--session-dir DIR --session-id
ID` and open the session with that id, creating it if missing, so a thread id
maps to a file with no translation. What differs is what a *running* process
can do about it: an RPC child holds one session at a time, `new_session` picks
its own id, and `switch_session` wants an existing file path — so a new thread
means a new spawn in either mode. RPC's advantage is only that the *second*
turn of a thread doesn't.

**Process lifecycle.** JSON mode is one process per request: spawn, stream,
exit — no pool, no eviction, `SIGTERM` to abort. RPC is one process per thread,
kept warm and evicted when idle; abort is a command and the child stays. The
JSON shape is honestly simpler — no pool, no idle timers, no readiness
handshake, no demuxing responses from events. Three things tipped it to RPC:

1. *Latency.* A `pi` child takes ~300 ms to be ready under bun (~550 ms under
   node). JSON mode pays that on every turn, and this matrix has a latency axis;
   RPC pays it once per thread — a warm follow-up starts streaming in ~1 ms.
2. *Abort.* Verified by cutting an `analyze` turn at 1.5 s: RPC's `abort`
   settles the run and pi records the tool result as an error and the assistant
   message as `stopReason: "error"`, same as in-process; JSON mode's `SIGTERM`
   leaves the file open mid-turn — an assistant tool call with no result — because
   print mode disposes the session without awaiting the abort. A frontend that
   rehydrates would see a hanging tool call.
3. *Images.* RPC's `prompt` takes `images` inline as base64; JSON mode takes
   them only as `@file` arguments, so the attachment flow in the ai-elements
   cell would need temp files.

Everything else RPC can do that JSON can't — steer, follow-up, model switching,
extension dialogs — the contract doesn't use. What JSON mode has over RPC is a
process that can't leak: nothing to evict, nothing warm to lose. That is real,
and it is what `DEMO_IDLE_SECONDS` / `DEMO_MAX_CHILDREN` are paying for.

**What the frontend gets that differs from `backends/pi`.** The same bytes, one
timing difference (below), and a first turn ~300 ms slower per thread. That the
streams are byte-identical is the interesting result: pi's wire format carries
everything the SDK's event stream carries except `partial`.

## How it maps to the contract

Same six routes, same three tools. `/health` adds `children` — how many pi
processes are resident — because that is the number worth watching in this
cell.

`/chat` is byte-identical to `backends/pi`'s for the four probe prompts and the
multi-tool one; against pydantic-ai it differs only by pydantic-ai's
`message-metadata` chunk and, on multi-tool prompts, by emitting
`tool-input-available` as each call closes rather than together after the
model's turn — the same ordering `backends/pi` has. `/ag-ui` is identical to
`backends/pi` and identical to pydantic-ai modulo JSON key order (`timestamp`
first vs last). Conformance is 18/18.

**Arguments don't stream across the process boundary.** pi's wire events omit
`partial`, and `toolcall_start` names neither the tool nor the call id — those
were only in the snapshot. So the adapters hold a call's `tool-input-start` and
`tool-input-delta`s until `toolcall_end` supplies the id, then emit start,
deltas, available in one burst. Same chunks, same order; the UI's "arguments
arriving" moment collapses to an instant. Invisible with the scripted model
(two deltas 35 ms apart), visible with a real one writing a long argument.
`backends/pi` streams them live because it reads the id off `partial`.

**History is session-authoritative**, as in `backends/pi` and as `CONTRACT.md`
allows: the request's latest user message becomes the child's `prompt`, and
prior turns come from the session file the child opened by id. Rehydration is
`SessionManager.open(file).buildSessionContext()` rendered into either
protocol — the one place the server links pi as a library. Reading the file
rather than asking the child (`get_messages`) means `/threads/{id}` works
whether or not that thread's child is alive.

**Persistence is pi's**, and it happens in the child: incremental, one entry as
it lands, file created on the first assistant message. An aborted turn leaves
the user message, the assistant's tool call, an error tool result and an empty
assistant message marked `stopReason: "error"`; the rehydration paths skip the
empty one.

**One turn at a time per thread**, enforced here (409) before pi would refuse
it: a child holds one session and rejects a `prompt` while streaming unless
told to steer or queue.

**Deleting a thread kills its child first**, then removes the file — a live
child would otherwise keep appending to a path that no longer exists.

## Ergonomics notes

The axis this backend is being judged on, recorded while it was fresh.

**The extension is a better seam than the SDK for "your agent, pi's runtime".**
Everything `backends/pi` had to wire through `createAgentSession` — the
provider, the tools, the discovery flags, the system prompt — became one file
loaded with `-e` plus seven CLI flags. `pi.registerProvider(createProvider(...))`
accepted the scripted provider unchanged, `pi.registerTool` accepted the
`defineTool` objects unchanged, and jiti resolved the extension's imports from
this project's `node_modules` without being told. The move from in-process to
out-of-process cost nothing on the agent side.

**The wire loses one thing, and it's the thing a chat UI wants most.** pi
strips `partial` from `message_update` to keep the stream linear in size — a
sound choice for a log — but it takes the tool call's id and name with it until
`toolcall_end`. The in-process adapters were a `switch`; these are a `switch`
plus a per-call buffer. If pi put `id` and `name` on `toolcall_start` (they are
known: the scripted provider sets them before the first delta), an
out-of-process client could stream arguments too. Worth an upstream note.

**RPC is a session, not a server.** One process, one session, one turn at a
time, and no way to *create* a session by id from inside — `new_session`
generates one, `switch_session` opens a path. That fixed the topology as one
child per thread; the pool is the consequence, not the design. It also fixed
the readiness handshake: there is no "ready" event, so the first command's
`response` is the signal (here `set_auto_compaction`, which had to be sent
anyway because the child otherwise reads the developer's `settings.json`).

**200 MB per idle child.** Measured on the resident RSS after startup. That is
the whole model catalogue and every provider SDK, loaded for a scripted model
that calls none of them — the same "heavier than a proxy needs" install cost
`backends/pi` noted, now paid per thread instead of per server. Idle eviction
is load-bearing, and `DEMO_MAX_CHILDREN=4` is a laptop number.

**Stdin is the lifecycle.** Closing the child's stdin is pi's shutdown; the
parent dying closes it; `scripts/stop.sh` kills the process group anyway. So no
orphan pi processes were seen at any point, including after `kill -9` of the
server — the pipe does the work. `SIGTERM` after a second is a fallback; in
testing an evicted child was gone well inside that second.

**pi ships an `RpcClient`, and it wasn't the right fit.** It spawns `node` by
name (this server runs under bun and would rather the child did too), sleeps a
fixed 100 ms on start, and mirrors the child's stderr to the parent's. `PiChild`
is ~100 lines and does the same three things — spawn, JSONL both ways, `id`
correlation — against pi's exported `rpc-entry`. The docs' warning that Node's
`readline` isn't JSONL-safe (it splits on U+2028) is the one line from that
corner of pi worth keeping in mind.

**Print mode reads stdin.** The first `pi --mode json` prototype hung for two
minutes: not a TTY, so pi waited for piped input that never ended. `</dev/null`
fixed it; RPC mode doesn't read piped stdin because stdin *is* the protocol.
Small, and exactly the kind of thing that only surfaces out of process.

**Settings leak, model doesn't.** The child reads `~/.pi/agent/settings.json`
and warns on stderr about `enabledModels` patterns it can't match. Nothing in
there changed behaviour here, but a `PI_CODING_AGENT_DIR` pointed at a private
directory is the isolation knob if it ever does — at the cost of the shared
`auth.json` that makes real models keyless.

**Line count.** ~1310 lines against `backends/pi`'s ~1090. The difference is
`pi.ts` — the child client and the pool, ~230 lines — less the session and
model bootstrap that `createAgentSession` needed and the CLI now does. The
adapters gained under ten lines each for the tool-call buffer and lost nothing;
the agent files are copies.
