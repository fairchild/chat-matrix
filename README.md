# chat-stack matrix

A harness for deciding which chat UI and which agent backend you actually like,
by running them against each other instead of reading their READMEs.

Frontends and backends are separate processes that meet at a documented wire
protocol, so any frontend can be pointed at any backend by changing a URL. The
first cell was **assistant-ui × pydantic-ai**; there are four in the matrix now,
plus one deliberately outside it.

```
protocol/        the contract every stack implements, a conformance check, and the golden check that holds every backend to the reference's streams
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

Then open **http://localhost:3000** — the hub lists the backends as a radio
group and the cells as cards; pick a backend, then click into a cell and it
opens against that backend.
Stop with `./scripts/stop.sh`; logs are in
`.run/`.

No API keys required. The default model is a deterministic scripted one — see
below.

## What's here

Each cell runs against whichever backend the hub picks, so the backend isn't a
column here — it's the other axis, listed below. The default is pydantic-ai on
`:8001`.

| Frontend | Protocol | Topology | Status |
|---|---|---|---|
| assistant-ui (`:3001`) | Vercel AI data stream, AI SDK v7 | browser → backend | works |
| CopilotKit (`:3002`) | AG-UI | browser → Next runtime → backend | works |
| AI Elements (`:3003`) | Vercel AI data stream, AI SDK v7 | browser → backend | works |
| shadcn (`:3004`) | Vercel AI data stream, AI SDK v7 | browser → backend | works |
| FastAPI + Jinja (`:3005`) | none — server-rendered HTML, NDJSON DOM patches | browser → the process itself | works |

Every cell runs the same agent, so the differences you see are the stack. The
pydantic-ai backend serves both protocols from one agent — that was one line of
difference — which is why neither of the later cells needed backend work.

Every cell also follows the OS colour scheme. The four React cells reach that
through `next-themes`, which writes `.dark` onto `<html>` before first paint —
the class the shadcn tokens, CopilotKit's own stylesheet and shiki's dual theme
all key off — and `d` overrides it without leaving the page. The jinja cell and
the hub reach it with a `prefers-color-scheme` block in a hand-written
stylesheet and no JavaScript, which is why they follow the OS and offer nothing
to override it with.

The last row is a different kind of thing, and the `none` under Protocol is the
tell: FastAPI + Jinja runs the reference agent inside the process that renders
the HTML, so there is no wire between the two ends and the hub's `?backend=` is
ignored. It's here because it answers a question the other four can't put — what
a good chat UI costs when nothing in the stack is a chat framework, just
FastAPI, Jinja, your agent and sixty lines of JavaScript. The comparison still
means something, because its agent, tools and scripted model are copies of the
reference backend's held to them by a `diff`, so only the rendering approach
differs. It's also the one cell where reload resumes the thread and a thread
list exists, which is what having the history in the same process gets you. The
numbers and the friction are in
[`frontends/jinja/README.md`](frontends/jinja/README.md).

There are four backends now, and the hub's picker sends the choice to a cell
as `?backend=`:

| Backend | Runtime | Store | Why it's here |
|---|---|---|---|
| pydantic-ai (`:8001`) | Python, uvicorn | SQLite file | the reference implementation |
| cloudflare-agents (`:8002`) | Cloudflare Workers, Agents SDK | one Durable Object per thread | the one that gets published — a single Worker, no server to keep up |
| pi (`:8003`) | Bun, the [pi](https://pi.dev/) coding-agent SDK | pi's own session files | an agent that already owns its model runtime, tool loop and sessions — what does a chat UI cost in front of that? |
| pi-rpc (`:8004`) | Bun, driving `pi --mode rpc` as a child process per thread | pi's own session files, written by the child | the same agent from outside the process — the way you'd drive pi from Python or a shell; what does the process boundary cost? |

All four pass `protocol/conformance.sh` and `protocol/golden.ts`, the check
that holds every backend's `/chat` and `/ag-ui` streams, for five fixed
prompts, to bytes captured from pydantic-ai after erasing only ids and
timestamps. The one recorded exception is cloudflare-agents' `finishReason`
field, which the AI SDK stamps on the finish chunk unconditionally and no cell
reads. What golden can't see is timing: pi-rpc's process boundary means tool
arguments arrive in a burst at `toolcall_end` rather than streaming, since
pi's RPC wire drops partials until the call id is known — same bytes,
different pacing. A local clone runs all four; Cloudflare runs the second,
which is the point of it.

The two pi backends are also the ones that own their history: they read only
the latest user message from a request and let the session file supply the
rest, where the other two record what the client sent. That is the divergence
`protocol/CONTRACT.md` predicted, and it now says so.

### Hosting a subset

A local clone runs everything. Cloudflare runs a subset: the cloudflare-agents
backend, the four cells, and the hub — each its own Worker, all on the free
tier. Three cells are pure static exports; CopilotKit is its static export plus
a small Worker for its runtime hop on the same origin (`frontends/copilotkit/worker/`),
because `@copilotkit/runtime` can't run under OpenNext on Workers — it imports
`express` eagerly, and express does code generation at load, which the runtime
forbids. `scripts/hosted.sh` is the topology as data; two scripts use it:

```sh
./scripts/preview.sh    # or: mise run preview — build with localhost URLs, serve under wrangler dev
./scripts/publish.sh    # or: mise run publish — build with production URLs, deploy
```

Preview is the hosted subset served locally by workerd, exactly as it would
deploy: cells at `:4001`–`:4004`, hub at `:4000`, pointed at the local `:8002`
backend or, with `PREVIEW_BACKEND=<url>`, at the deployed one. It's what lets
you run the probes against the production artifacts before anything is public:
`PROBE_PORT_OFFSET=1000 ./scripts/probe.sh` ran all twenty flows green against
the preview with the deployed backend behind it. `./scripts/preview.sh --stop`
takes it down without touching the matrix.

The backend is already deployed:

```
https://chat-stack-backend-cloudflare-agents.irons-in-the-fire8698.workers.dev
```

Conformance passes against it from the edge. The cells aren't published yet —
that's `./scripts/publish.sh`, once the preview looks right. Two things to know
about the hosted cells: CopilotKit's runtime forwards only localhost backends,
so `?backend=` can't move that cell off its configured backend once hosted; and
`/threads` on a public backend lists every visitor's thread.

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

For real behaviour, **pick a model in the backend's row at the hub**. Each row
carries its own dropdown, because what a backend can reach differs: the pi
backends can use a login you already did with the `pi` CLI, so they often offer
providers the others can't without a single environment variable being set,
while the Cloudflare Worker has no ambient credentials at all and carries the
OpenAI provider only. The list comes from each backend's `GET /models`, and
entries it can't serve are shown greyed with the reason rather than hidden —
"no key" and "not wired here" are different problems.

Credentials are read wherever that stack normally reads them: `OPENAI_API_KEY`,
`ANTHROPIC_API_KEY` and `GOOGLE_API_KEY` from the environment — `mise env`
territory — plus `pi auth login` for the pi backends, which is why those two
often reach a provider with no variable set at all. The Cloudflare cell is the
exception: a Worker has no ambient environment, so its key is a binding read
from `backends/cloudflare-agents/.dev.vars` (gitignored, written by
`scripts/setup.sh` from `.dev.vars.example`). Nothing here needs a key to run.

The picker changes the running backend, so it applies to every cell pointed at
it — the model stays the control variable, not a per-request field. To set it
at boot instead, `DEMO_MODEL` still works, in either a shared id or the
backend's own spelling, and `auto` takes the first provider you have configured:

```sh
DEMO_MODEL=openai/gpt-5.6-luna ./scripts/run.sh   # a shared id, understood everywhere
DEMO_MODEL=auto ./scripts/run.sh                  # OpenAI, else Anthropic, else Google
DEMO_MODEL=anthropic:claude-opus-5 ./scripts/run.sh   # pydantic-ai's own spelling still works
```

`./scripts/golden.sh` refuses to run against anything but `scripted`, and
`probe.sh` and `conformance.sh` warn — both compare across cells, which only
means something while every cell is doing identical work.

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
3. `bun protocol/golden.ts http://localhost:PORT` until it's green, or record
   an exception with a reason in `protocol/golden/exceptions.json`.
4. Add one line to `scripts/stacks.sh`.
5. Give it an adapter in `probes/frontends.ts` so the flows run against it.
6. Write the ergonomics notes before you forget them.

A backend that passes conformance can be driven by any frontend here. Backends
are picked at the hub and travel to a cell as `?backend=`, so a second backend
needs no frontend changes — add it to `scripts/stacks.sh` and to the `BACKENDS`
list in `index/index.html`, and every cell can already reach it.

Conformance proves the events a frontend depends on exist; golden proves two
backends agree on the bytes. It replaces three hand diffs done by one session
and recorded in READMEs instead of fixed. `./scripts/golden.sh` (or
`mise run golden`) runs it over every backend in `scripts/stacks.sh`;
`bun protocol/golden.ts --update` recaptures the fixtures from the reference.
A recorded run against the live matrix:
[docs/recordings/golden-check.gif](docs/recordings/golden-check.gif).

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
- **History is backend-only in the four matrix cells, and reload loses it.**
  `/threads` and `/threads/{id}` exist and the store is real, but none of the
  four reads them: reload starts a fresh thread, and no thread list is rendered
  anywhere. [FastAPI + Jinja](frontends/jinja/README.md) is the exception — it
  rehydrates from the store on `GET /t/{id}` and renders a thread list — because
  the history is already in its process. The `resume` flow in `probes/` was
  written to pin the old behaviour and fail loudly the day a frontend
  rehydrated, so it now fails for that cell by design; read the red as the
  feature landing. (An earlier draft of this line claimed reload resumed the
  current thread — driving it is what showed otherwise.)
- **Human-in-the-loop approval isn't wired.** pydantic-ai supports deferred tool
  approval, and it's the sharpest test of the generative-UI axis, but it's not
  in the reference agent yet.
- **The scripted model is keyword-matched**, so it won't chain tools or reason
  about which to use. That's the cost of determinism; pick a real model in the
  backend's row at the hub when you
  need real tool selection.
