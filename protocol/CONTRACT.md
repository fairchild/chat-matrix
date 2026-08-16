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

Set `DEMO_MODEL` to any pydantic-ai model string (`anthropic:claude-opus-5`,
`openai:gpt-5.2`, …) when you want to see real behaviour instead. Credentials
resolve the normal way for that provider; nothing here needs a key.

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

Threads are stored as pydantic-ai `ModelMessage`s, not as either wire format.
Each adapter's `dump_messages` renders them on the way out, which is why
`GET /threads/{id}` can serve the same thread as either protocol. Adding a third
protocol adds a rendering path, not a migration.

History is **client-authoritative during a turn** and **server-persisted after
it**. The AI SDK sends the full message list with each request, so the server
doesn't replay stored history into the run — it records the result. On reload
the client refetches from `/threads/{id}` and rehydrates. Server-authoritative
history is possible but means fighting the transport, which isn't worth it until
a backend needs it (a `pi`-backed one might, since it owns its own sessions).

Two consequences worth knowing:

- **Persistence happens on stream completion.** `on_complete` fires when the run
  finishes, so a client that disconnects mid-stream leaves nothing behind. This
  is easy to hit by accident: piping curl into `head` closes the stream early and
  silently skips the write.
- **One JSON blob per thread**, not a row per message. Fine at demo scale, and it
  keeps the store honest about being a demo. It's the first thing to change if
  threads get long.

## Conformance

```sh
./protocol/conformance.sh                          # defaults to :8001
./protocol/conformance.sh http://localhost:8002    # the next backend
```

It asserts the streams contain the events a frontend actually depends on —
including `tool-input-start` / `tool-input-delta`, which are what let a UI show
arguments arriving rather than just a spinner — then checks the thread was
persisted and rehydrates in both protocols.
