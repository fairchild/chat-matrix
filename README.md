# chat-stack matrix

A harness for deciding which chat UI and which agent backend you actually like,
by running them against each other instead of reading their READMEs.

Frontends and backends are separate processes that meet at a documented wire
protocol, so any frontend can be pointed at any backend by changing a URL. The
first cell is **assistant-ui × pydantic-ai**.

```
protocol/        the contract every stack implements, and a conformance check
backends/        one process per agent framework
frontends/       one process per chat UI
scripts/         setup / run / stop
docs/            how it fits together, and how to extend it
```

[`docs/architecture.md`](docs/architecture.md) covers the design: why it's
organised around axes rather than stacks, how a request actually flows, and what
adding a frontend, a protocol, or a backend each costs.
[`docs/reflection.md`](docs/reflection.md) is the opinionated version — what the
comparison actually showed so far, what it can't tell you yet, and what I'd
change.

## Running it

```sh
./scripts/setup.sh     # or: mise run setup
./scripts/run.sh       # or: mise run run
```

Then open **http://localhost:3001**. Stop with `./scripts/stop.sh`; logs are in
`.run/`.

No API keys required. The default model is a deterministic scripted one — see
below.

## What's here

| Frontend | Backend | Protocol | Topology | Status |
|---|---|---|---|---|
| assistant-ui (`:3001`) | pydantic-ai (`:8001`) | Vercel AI data stream, AI SDK v7 | browser → Python | works |
| CopilotKit (`:3002`) | pydantic-ai (`:8001`) | AG-UI | browser → Next runtime → Python | works |
| AI Elements (`:3003`) | pydantic-ai (`:8001`) | Vercel AI data stream, AI SDK v7 | browser → Python | works |

Every cell runs the same agent, so the differences you see are the stack. The
pydantic-ai backend serves both protocols from one agent — that was one line of
difference — which is why neither of the later cells needed backend work.

The topology column is a real difference, not a detail. assistant-ui and
AI Elements talk straight to Python; CopilotKit requires a server-side runtime
in the middle, which is a place to put auth and rate limiting, and also a Node
process that has to be up.

assistant-ui and AI Elements pin everything except the UI library — same
protocol, same topology, same backend — so that pair is the cleanest read on the
frontend axis the matrix has.

## Why a scripted model by default

Real providers make every run different, which is exactly wrong when the
question is "does this UI render tool calls well?". The default `scripted` model
picks tools by keyword and streams a fixed reply, so two frontends given the same
prompt get byte-identical work to render and any difference you see is the stack.

The tools themselves still execute for real — only the model's choices are
scripted.

For real behaviour, set a provider string:

```sh
DEMO_MODEL=anthropic:claude-opus-5 ./scripts/run.sh
```

## What you're comparing

Four axes, one probe each. Every backend implements the same three tools so the
probes work everywhere.

| Axis | How to see it |
|---|---|
| Streaming & tool-call UX | *"What's the weather in Tokyo?"* — fast structured result |
| Generative / custom UI | *"Search notes for streaming protocols."* — a list, the natural place for cards |
| Latency handling | *"Analyze assistant-ui as a chat frontend."* — a deliberate ~3s tool |
| State: history, resume | send a message, reload the page |
| Developer ergonomics | the notes in each stack's README, written while building it |

Each frontend and backend README ends with an **Ergonomics notes** section
recorded during the build, while the friction was still fresh. Those are the
notes to reread when deciding — they age better than a recollection does.

## Adding a stack

1. Build it against `protocol/CONTRACT.md`.
2. `./protocol/conformance.sh http://localhost:PORT` until it's green.
3. Add one line to `scripts/stacks.sh`.
4. Write the ergonomics notes before you forget them.

A backend that passes conformance can be driven by any frontend here; a frontend
only needs the backend's base URL.

## Known gaps

- **`next build` fails in every frontend**, with a null React internal during
  prerender — `useContext` on `/_global-error` in assistant-ui and CopilotKit,
  `useRef` on `/` in AI Elements. Three unrelated UI libraries failing the same
  way makes it a Next 16 issue rather than a difference between them. All three
  run fine under `next dev`, which is all the harness uses.
- **Thread switching is backend-only.** `/threads` and `/threads/{id}` exist and
  the store is real, but no frontend renders a thread list — reload resumes
  the current thread rather than letting you pick one.
- **Human-in-the-loop approval isn't wired.** pydantic-ai supports deferred tool
  approval, and it's the sharpest test of the generative-UI axis, but it's not
  in the reference agent yet.
- **The scripted model is keyword-matched**, so it won't chain tools or reason
  about which to use. That's the cost of determinism; use `DEMO_MODEL` when you
  need real tool selection.
