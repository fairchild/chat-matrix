# The contract

Comparing chat stacks only means something if both sides of the comparison are
doing the same work. This is that "same work": the agent every backend
implements, and the HTTP surface every frontend can rely on.

If a backend passes `protocol/conformance.sh`, any frontend in this repo can be
pointed at it by changing a URL.

## The reference agent

Three tools, one per thing worth looking at. They're deliberately boring —
the interesting variation is supposed to be in the stack, not the agent.

| Tool | Returns | What it's for |
|---|---|---|
| `get_weather(city)` | one small struct | the baseline tool-call render |
| `search_notes(query)` | a list of notes | list results — the natural place for cards or custom components |
| `analyze(topic)` | a string, after ~3s | latency: what does the UI show while nothing is happening? |

`analyze` sleeps on purpose. A tool that returns instantly hides the difference
between a frontend that shows progress and one that shows nothing.

## The model

The default model is `scripted` — a `FunctionModel` that picks tools by keyword
and streams a canned reply. It exists because a real provider makes every run
different, and you can't compare two frontends' rendering when the thing being
rendered changes underneath you. Scripted runs are identical every time, so any
difference you see is the stack.

Set `DEMO_MODEL` when you want to see real behaviour instead. Each backend
spells the model its own framework's way — `anthropic:claude-opus-5` for
pydantic-ai, `anthropic/claude-opus-4-5` for pi — and credentials resolve the
way that framework resolves them (an env var; for pi, also its own login).
Nothing here needs a key.

## HTTP surface

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/health` | backend name, model, tool names, thread count |
| `POST` | `/chat` | Vercel AI data stream protocol (AI SDK v7) |
| `POST` | `/ag-ui` | AG-UI protocol |
| `GET` | `/threads` | thread summaries, newest first |
| `GET` | `/threads/{id}?protocol=…` | stored messages in that protocol's wire format |
| `DELETE` | `/threads/{id}` | delete a thread |

`/health` is what the frontend badge reads. It's there so you can always tell
which cell of the matrix you're looking at — easy to lose track of once there
are several.

## Two protocols, one agent

`/chat` and `/ag-ui` differ by one class:

```python
await VercelAIAdapter.dispatch_request(request, agent=agent, sdk_version=7, …)
await AGUIAdapter.dispatch_request(request, agent=agent, …)
```

That symmetry is why the wire protocol is a separate axis from the backend. It
matters for the generative-UI comparison in particular, which is where the two
diverge most: AG-UI carries state deltas as first-class events, while the AI SDK
route expresses the same idea as typed tool results the client maps to
components.

## State

Threads are stored in each backend's own neutral format — pydantic-ai
`ModelMessage`s, AI SDK `ModelMessage`s, pi session entries — never as a wire
format. Each protocol renders them on the way out, which is why
`GET /threads/{id}` can serve the same thread as either protocol. Adding a third
protocol adds a rendering path, not a migration.

History is **client-authoritative during a turn** and **server-persisted after
it** in the reference backend. The AI SDK sends the full message list with each
request, so the server doesn't replay stored history into the run — it records
the result. On reload the client refetches from `/threads/{id}` and rehydrates.

The `pi` backends (`pi` in-process, `pi-rpc` as a child process) are the other
model, and the contract admits both: they are **session-authoritative**. They
read only the latest user message from a request and let pi's own session file
supply prior turns, because pi already owns a durable record and replaying the
client's copy into it would mean two sources of truth. A frontend can't tell
the difference while its own history and the server's agree, which is always,
today — no frontend rehydrates on reload. The day one does, the two models
diverge exactly there: after a restart with a wiped store, a
client-authoritative backend keeps going from what the client sends, and a
session-authoritative one starts a fresh session behind messages the client
still shows.

Consequences worth knowing, per model:

- **When persistence happens differs.** pydantic-ai's `on_complete` fires when
  the run finishes, so a client that disconnects mid-stream leaves nothing
  behind — easy to hit by piping curl into `head`, which closes the stream early
  and silently skips the write. pi appends each entry as it happens (once the
  first assistant message has landed), so the same disconnect leaves the user
  message and a partial assistant message marked `aborted`.
- **One JSON blob per thread**, not a row per message, in the reference store.
  Fine at demo scale, and it keeps the store honest about being a demo. It's the
  first thing to change if threads get long. pi's store is one append-only file
  per thread, which is the same trade with a different failure mode.

## Conformance

```sh
./protocol/conformance.sh                          # defaults to :8001
./protocol/conformance.sh http://localhost:8002    # the next backend
```

It asserts the streams contain the events a frontend actually depends on —
including `tool-input-start` / `tool-input-delta`, which are what let a UI show
arguments arriving rather than just a spinner — then checks the thread was
persisted and rehydrates in both protocols.

## Golden

```sh
bun protocol/golden.ts                             # defaults to :8001
bun protocol/golden.ts http://localhost:8002       # one backend
bun protocol/golden.ts --update                    # recapture the fixtures from :8001
```

Conformance says the events exist; golden says the backends agree. It captures
each backend's `/chat` and `/ag-ui` streams for five fixed prompts and reduces
them to a canonical form: id values renamed by first appearance so only their
pairing is checked, timestamps erased, pydantic-ai's `message-metadata`
timestamp stamp dropped, keys sorted. Event order, delta boundaries, tool names,
argument JSON, tool results, and finish state are kept and compared as-is.
Fixtures captured from pydantic-ai live in `protocol/golden/`; a backend that
drifts either gets fixed, or gets a per-backend, per-field exception with a
reason in `protocol/golden/exceptions.json` — every exception applied is printed
on the run.
