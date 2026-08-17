# Backend: pi

The reference agent on [pi](https://pi.dev/), the coding agent, through its SDK
(`@earendil-works/pi-coding-agent`). Serves both the Vercel AI data stream
protocol and AG-UI. See `protocol/CONTRACT.md` for what it has to implement and
why.

pi is in the matrix because it is a different shape of thing from the other two
backends: an agent that already owns a model runtime, a tool loop and a session
store, and offers those as a library. The question this cell answers is what it
costs to put a chat UI in front of an agent like that, rather than build the
agent inside a web framework.

```sh
bun install
bun run dev            # :8003 — or PORT=… bun run src/main.ts
```

| Env | Default | |
|---|---|---|
| `DEMO_MODEL` | `scripted` | pi's `provider/model[:thinking]`, e.g. `anthropic/claude-opus-4-5:high` |
| `DEMO_SESSIONS` | `data/sessions` | where the pi session files go |

A real `DEMO_MODEL` resolves through pi's own model catalogue and credentials —
the same `~/.pi/agent/auth.json` the `pi` CLI uses — so a provider you have
logged into with pi needs no key in the environment here.

## Layout

| File | |
|---|---|
| `src/agent.ts` | the reference agent: three tools via `defineTool`, one `AgentSession` per request |
| `src/scripted.ts` | deterministic model — a pi-ai `Provider` following the same script as `scripted.py` |
| `src/store.ts` | threads as pi session files, read back with pi's own `SessionManager` |
| `src/protocol.ts` | what a wire protocol provides, and the loop that streams one turn through it |
| `src/vercel.ts`, `src/agui.ts` | the two protocols: pi events out, pi messages rehydrated in |
| `src/pyrepr.ts` | Python's `repr` spellings, so the scripted stream matches pydantic-ai's byte for byte |
| `src/main.ts` | the HTTP surface, on `Bun.serve` |

## How it maps to the contract

Same six routes, same three tools. pi's built-in tools (read, bash, edit, …)
are switched off — `tools:` is an allowlist of the three custom ones — because
identical work across backends is the whole premise.

The scripted `/chat` stream is byte-identical to pydantic-ai's for the four
probe prompts (ids and timestamps aside), including the summary line, which
prints tool results the way pydantic-ai's does: `Weather(city='Tokyo', …)`. That
is a Python dataclass `repr` leaking through pydantic-ai's script, reproduced
here on purpose so a diff between the two backends is empty and any difference
you see in a cell is the frontend. If `scripted.py` ever prints JSON instead,
`RENDER` in `scripted.ts` becomes `JSON.stringify` and `pyrepr.ts` goes away.
`/ag-ui` is identical modulo the same ids. One ordering difference on
multi-tool prompts: pi emits `tool-input-available` as each call's arguments
close, where pydantic-ai emits them together after the model's turn — both are
valid, and pi's is arguably the more useful timing.

**History is session-authoritative here**, which is the divergence
`CONTRACT.md` predicted. The AI SDK client sends its full message list every
turn; this backend reads only the latest user message and lets the pi session
supply prior context. Threads map to session files by id
(`data/sessions/<timestamp>_<thread-id>.jsonl`), and rehydration is pi's
`buildSessionContext()` rendered into either protocol.

Persistence is pi's: **incremental, not on completion.** Each entry is
appended as it happens, with one pi rule to know — the file is not created
until the first assistant message lands. So an abandoned first turn leaves
nothing, and an abandoned later turn leaves the user message plus a partial
assistant message marked `stopReason: "aborted"`. pydantic-ai's `on_complete`
leaves nothing in either case. A client that disconnects mid-run aborts the pi
session, and the tools take the abort signal so a cut `analyze` doesn't finish
its 3s sleep first.

One turn at a time per thread: sessions are append-only files, and two writers
would interleave, so a second `/chat` on a busy thread gets a 409. `useChat`
never does this; curl can.

## Ergonomics notes

The axis this backend is being judged on, recorded while it was fresh.

**A scripted model is a first-class provider.** `createProvider` gives you a
`Provider` with a custom `streamSimple`, and `ModelRuntime.registerNativeProvider`
puts it in the same catalogue as Anthropic and OpenAI — the session records a
`model_change` to `scripted/scripted` like any other model. pi even ships a
`fauxProvider` for its own tests; it was close, but its queued-response shape
and randomised chunk sizes are built for assertions rather than determinism, so
the ~60-line stream here is hand-written. The port of the keyword script itself
was mechanical.

**pi has an event stream, not a wire format.** pydantic-ai serves a protocol in
one `dispatch_request` line; here each protocol is ~130 lines (`vercel.ts`,
`agui.ts`) plus a shared run loop. The events map one-to-one, though —
`toolcall_start/delta/end` → `tool-input-start/delta/available`,
`tool_execution_end` → `tool-output-available`, `turn_start/end` →
`start-step/finish-step` — so each adapter is a `switch`, not a state machine,
and nothing needed buffering. That is the tell that pi's event model is
well-shaped for this: it already thinks in blocks with indices and a `partial`
message, which is exactly what a UI stream wants.

**Sessions are the store, and it shows.** No SQLite, no `on_complete`, no
"one JSON blob per thread". `SessionManager.create(cwd, dir, { id })` names the
file after the thread, `SessionManager.open(path)` reloads it for the next turn,
`buildSessionContext()` reads it back for `/threads/{id}`, `listAll(dir)`
answers `/threads`. The store module is 90 lines and most of it is the
`ThreadSummary` shape. The cost is the semantics above — incremental writes,
session-authoritative history — which are pi's, not this backend's, and the
contract now has to say so.

**Auth is inherited, and so is everything else unless you say no.**
`DEMO_MODEL=anthropic/claude-haiku-4-5` worked first try through the OAuth
login already in `~/.pi/agent/auth.json` — a convenience the Python backend
can't offer. It is also a coupling: `DefaultResourceLoader` would equally happily
load your extensions, skills, prompt templates and `AGENTS.md` into a comparison
harness, so this backend passes five `no*` flags to keep it to the three tools
and the one instruction string. Worth doing deliberately.

**Per-request sessions are cheap enough not to cache.** `createAgentSession`
against an existing file measured ~11ms; `ModelRuntime.create()` ~160ms once at
startup. So there is no session cache, no eviction, no shared mutable state
beyond the busy set — one `AgentSession` per HTTP request, disposed in
`finally`.

**Bun ran it without complaint.** No native module trouble from the SDK path;
the two blocked postinstalls (`@google/genai`, `protobufjs`) are no-ops. The
install is heavier than a proxy needs — 131 packages, every provider SDK pi
supports — which is the price of getting the model catalogue and auth for free.

**Two things to know before choosing.** `ToolDefinition.execute` receives the
abort signal as its third argument; the first version of `analyze` ignored it
and `session.abort()` waited three seconds for the sleep. And an aborted or
failed follow-up model call is recorded in the session as an assistant message
with `stopReason: "error"` and empty content — the rehydration paths skip
empty assistant messages so no cell renders a blank bubble.

**Papercut:** the package moved from `@mariozechner/pi-coding-agent` to
`@earendil-works/pi-coding-agent`; the older name is what a global install from
a few months ago still has, and the docs in the newer clone are the ones that
match `pi --version`.

**Line count.** ~1090 lines, against pydantic-ai's ~500. The difference is
almost entirely the two protocol adapters (~400 lines with the shared loop)
that pydantic-ai gets from its library, plus the scripted provider being a full
`Provider` rather than a `FunctionModel` (~250 vs ~150). The agent itself —
tools, session, model resolution — is ~200 lines, about what the Python one is.
