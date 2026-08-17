# chat-stack matrix

A harness for deciding which chat UI and which agent backend you actually like,
by running them against each other instead of reading their READMEs.

Frontends and backends are separate processes that meet at a documented wire
protocol, so any frontend can be pointed at any backend by changing a URL. The
first cell was **assistant-ui × pydantic-ai**; there are four now.

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

Then open **http://localhost:3000** — the index lists every cell and links into it.
Stop with `./scripts/stop.sh`; logs are in
`.run/`.

No API keys required. The default model is a deterministic scripted one — see
below.

## What's here

| Frontend | Backend | Protocol | Topology | Status |
|---|---|---|---|---|
| assistant-ui (`:3001`) | pydantic-ai (`:8001`) | Vercel AI data stream, AI SDK v7 | browser → Python | works |
| CopilotKit (`:3002`) | pydantic-ai (`:8001`) | AG-UI | browser → Next runtime → Python | works |
| AI Elements (`:3003`) | pydantic-ai (`:8001`) | Vercel AI data stream, AI SDK v7 | browser → Python | works |
| shadcn (`:3004`) | pydantic-ai (`:8001`) | Vercel AI data stream, AI SDK v7 | browser → Python | works |

Every cell runs the same agent, so the differences you see are the stack. The
pydantic-ai backend serves both protocols from one agent — that was one line of
difference — which is why neither of the later cells needed backend work.

There are three backends now, and the hub's picker sends the choice to a cell
as `?backend=`:

| Backend | Runtime | Store | Why it's here |
|---|---|---|---|
| pydantic-ai (`:8001`) | Python, uvicorn | SQLite file | the reference implementation |
| cloudflare-agents (`:8002`) | Cloudflare Workers, Agents SDK | one Durable Object per thread | the one that gets published — a single Worker, no server to keep up |
| pi (`:8003`) | Bun, the [pi](https://pi.dev/) coding-agent SDK | pi's own session files | an agent that already owns its model runtime, tool loop and sessions — what does a chat UI cost in front of that? |

All three pass `protocol/conformance.sh`. pi's `/chat` stream is byte-identical
to pydantic-ai's for the probe prompts (ids aside); cloudflare-agents differs
only in the summary's tool-result formatting and a `finishReason` field — the
frontend gets the same work either way. A local clone runs all three;
Cloudflare runs the second, which is the point of it.

pi is also the backend that owns its history: it reads only the latest user
message from a request and lets its session file supply the rest, where the
other two record what the client sent. That is the divergence
`protocol/CONTRACT.md` predicted, and it now says so.

### What's public

The cloudflare-agents backend is deployed:

```
https://chat-stack-backend-cloudflare-agents.irons-in-the-fire8698.workers.dev
```

Conformance passes against it from the edge, and any local cell can drive it —
`http://localhost:3004/?backend=https://chat-stack-backend-cloudflare-agents.irons-in-the-fire8698.workers.dev`
— which is how the shadcn and AI Elements weather flows were run against it.
(CopilotKit's runtime forwards only localhost backends, so that cell stays on
its default when pointed at a hosted one.) The frontends aren't hosted yet: the
three direct cells build fully static and would sit on Workers static assets;
CopilotKit's `/api/copilotkit` needs a Node runtime somewhere.

The topology column is a real difference, not a detail. assistant-ui and
AI Elements talk straight to Python; CopilotKit requires a server-side runtime
in the middle, which is a place to put auth and rate limiting, and also a Node
process that has to be up.

assistant-ui, AI Elements and shadcn pin everything except the UI library — same
protocol, same topology, same backend — so those three are the cleanest read on
the frontend axis the matrix has. They also happen to land at three different
points on tool-call rendering: a disclosure that doesn't name the tool, a
generic card showing JSON, and a hand-written component per tool.

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

Each backend reads the string its own way — pi wants `anthropic/claude-opus-4-5`
and can use a login you've already done with the `pi` CLI — so set it per
backend when they differ; each backend's README has the spelling.

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

The table tells you what to type. [`probes/`](probes/README.md) is the same
prompts driven for real: flows written as plain sentences, run against every
frontend, and captured at the same moments so the four sit side by side.

```sh
./scripts/probe.sh     # or: mise run probe — needs scripts/run.sh already up
```

It opens a gallery of every capture and recording. The first run is also what
established that **no frontend rehydrates a thread on reload**, which the gaps
below now say plainly.

## Adding a stack

1. Build it against `protocol/CONTRACT.md`.
2. `./protocol/conformance.sh http://localhost:PORT` until it's green.
3. Add one line to `scripts/stacks.sh`.
4. Give it an adapter in `probes/frontends.ts` so the flows run against it.
5. Write the ergonomics notes before you forget them.

A backend that passes conformance can be driven by any frontend here. Backends
are picked at the hub and travel to a cell as `?backend=`, so a second backend
needs no frontend changes — add it to `scripts/stacks.sh` and to the `BACKENDS`
list in `index/index.html`, and every cell can already reach it.

## Known gaps

- **A leaked `NODE_ENV=development` breaks production builds**, and this list
  blamed Next 16 for it until someone ran the second control. With that variable
  set in the shell, `next build` dies during prerender with a null React
  internal; the page and hook vary between cells and runs — `useContext` on
  `/_global-error`, `useRef` on `/` — which is the tell that the RSC and SSR
  layers are resolving different React builds rather than any component being
  wrong. Every cell's `build` script now pins `NODE_ENV=production`, and all
  four are clean: every route prerenders static, apart from CopilotKit's
  `/api/copilotkit` runtime, which is dynamic by design. A bare `next build` in
  a shell that leaks the variable still fails, so the pin is load-bearing.
- **History is backend-only, and reload loses it.** `/threads` and `/threads/{id}`
  exist and the store is real, but no frontend reads them: reload starts a fresh
  thread in all four, and no thread list is rendered anywhere. The `resume` flow
  in `probes/` pins the current behaviour so it fails the day a frontend
  rehydrates. (An earlier draft of this line claimed reload resumed the current
  thread — driving it is what showed otherwise.)
- **Human-in-the-loop approval isn't wired.** pydantic-ai supports deferred tool
  approval, and it's the sharpest test of the generative-UI axis, but it's not
  in the reference agent yet.
- **The scripted model is keyword-matched**, so it won't chain tools or reason
  about which to use. That's the cost of determinism; use `DEMO_MODEL` when you
  need real tool selection.
