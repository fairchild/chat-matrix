# chat-stack matrix

A harness for deciding which chat UI and which agent backend you actually like,
by running them against each other instead of reading their READMEs.

Frontends and backends are separate processes that meet at a documented wire
protocol, so any frontend can be pointed at any backend by changing a URL. A
**cell** is one of those frontends — one chat UI, standalone, owning no model
client of its own — and the hub draws the cells against the backends as a grid,
where each square is a pairing you can open. There are six cells: five on the
grid, and one deliberately outside it because it has no backend to point at. The
first pairing built was assistant-ui against pydantic-ai.

The matrix is the instrument; the notes are the finding. Every stack's README
ends with the ergonomics notes recorded while building it, and those are what
you reread when you're deciding — they age better than a recollection does.

## Running it

```sh
./scripts/setup.sh     # or: mise run setup
./scripts/run.sh       # or: mise run run
```

Then open **http://localhost:3000** — the hub is the matrix itself: backends
across, frontends down, and every live square a link into that pairing. Each
backend's column carries its own model picker.
Stop with `./scripts/stop.sh`; logs are in `.run/`, and `DEMO_LOG_LEVEL=info
./scripts/run.sh` makes the Python backends print a line per request, which is
what you want when you're watching a turn happen rather than leaving it up.

No API keys required. The default model is a deterministic scripted one — see
below.

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
change. [`docs/publishing.md`](docs/publishing.md) is the sequence that puts it
on the internet.

The hub serves two pages of its own alongside the grid:
[`index/golden.html`](index/golden.html) explains the byte-for-byte check that
holds the backends together, and [`index/monolith.html`](index/monolith.html)
covers the one cell outside the grid. A third page, the ergonomics notes, is
generated from the stack READMEs at run time rather than committed.

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
| Folio (`:3006`) | Vercel AI data stream, AI SDK v7 | browser → backend | works |
| FastAPI + Jinja (`:3005`) | none — server-rendered HTML, NDJSON DOM patches | browser → the process itself | works |

Every cell runs the same agent, so the differences you see are the stack. The
pydantic-ai backend serves both protocols from one agent — that was one line of
difference — which is why none of the later cells needed backend work.

Every cell also follows the OS colour scheme. assistant-ui, CopilotKit, AI
Elements and shadcn reach that through `next-themes`, which writes `.dark` onto
`<html>` before first paint — the class the shadcn tokens, CopilotKit's own
stylesheet and shiki's dual theme all key off — and `d` overrides it without
leaving the page. The jinja cell and the hub reach it with a
`prefers-color-scheme` block in a hand-written stylesheet and no JavaScript,
which is why they follow the OS and offer nothing to override it with.

**Folio** is the newest and the reason the matrix got built out this far: it's a
conversation surface whose position is that a transcript should read as a
document rather than as a chat log, so the interesting question is what it does
with work that ignores its conventions — three tools chosen to be boring, next
to four surfaces that made different choices about the same bytes.
[`frontends/folio/folio-in-context.md`](frontends/folio/folio-in-context.md) is
the study written before the cell existed and the questions to read its captures
against; [`frontends/folio/README.md`](frontends/folio/README.md) is what it
actually cost. The cell consumes `@fairchild/folio` as a vendored tarball rather
than from a registry, because Folio's own repository is private — the package is
the one its release workflow built, and the swap to a registry pin is one line
when it publishes.

The last row is a different kind of thing, and the `none` under Protocol is the
tell: FastAPI + Jinja runs the reference agent inside the process that renders
the HTML, so there is no wire between the two ends and the hub's `?backend=` is
ignored. It's here because it answers a question the other five can't put — what
a good chat UI costs when nothing in the stack is a chat framework, just
FastAPI, Jinja, your agent and sixty lines of JavaScript. The comparison still
means something, because its agent, tools and scripted model are copies of the
reference backend's held to them by a `diff`, so only the rendering approach
differs. It's also the one cell where reload resumes the thread and a thread
list exists, which is what having the history in the same process gets you. The
numbers and the friction are in
[`frontends/jinja/README.md`](frontends/jinja/README.md).

There are four backends, and the hub's picker sends the choice to a cell as
`?backend=`:

| Backend | Runtime | Store | Why it's here |
|---|---|---|---|
| pydantic-ai (`:8001`) | Python, uvicorn | SQLite file | the reference implementation |
| cloudflare-agents (`:8002`) | Cloudflare Workers, Agents SDK | one Durable Object per thread | the one that gets published — a single Worker, no server to keep up |
| pi (`:8003`) | Bun, the [pi](https://pi.dev/) coding-agent SDK | pi's own session files | an agent that already owns its model runtime, tool loop and sessions — what does a chat UI cost in front of that? |
| pi-rpc (`:8004`) | Bun, driving `pi --mode rpc` as a child process per thread | pi's own session files, written by the child | the same agent from outside the process — the way you'd drive pi from Python or a shell; what does the process boundary cost? |

Five cells on the grid against four backends is twenty squares, and the hub
draws every one of them.

All four backends pass `protocol/conformance.sh` and `protocol/golden.ts`, the
check that holds every backend's `/chat` and `/ag-ui` streams, for five fixed
prompts, to bytes captured from pydantic-ai after erasing only ids and
timestamps. The one recorded exception is cloudflare-agents' `finishReason`
field, which the AI SDK stamps on the finish chunk unconditionally and no cell
reads. What golden can't see is timing: pi-rpc's process boundary means tool
arguments arrive in a burst at `toolcall_end` rather than streaming, since
pi's RPC wire drops partials until the call id is known — same bytes,
different pacing. A local clone runs all four; Cloudflare runs the second,
which is the point of it. [`index/golden.html`](index/golden.html) is the
long version, with a recording.

The two pi backends are also the ones that own their history: they read only
the latest user message from a request and let the session file supply the
rest, where the other two record what the client sent. That is the divergence
`protocol/CONTRACT.md` predicted, and it now says so.

### Hosting a subset

A local clone runs everything. Cloudflare runs a subset: the cloudflare-agents
backend, the five grid cells, and the hub — seven Workers in all, each its own,
all on the free tier. Four cells are pure static exports; CopilotKit is its
static export plus a small Worker for its runtime hop on the same origin
(`frontends/copilotkit/worker/`), because `@copilotkit/runtime` can't run under
OpenNext on Workers — it imports `express` eagerly, and express does code
generation at load, which the runtime forbids. `scripts/hosted.sh` is the
topology as data; two scripts use it:

```sh
./scripts/preview.sh    # or: mise run preview — build with localhost URLs, serve under wrangler dev
./scripts/publish.sh    # or: mise run publish — build with production URLs, deploy
```

Preview is the hosted subset served locally by workerd, exactly as it would
deploy: each cell at its own port plus 1000, hub at `:4000`, pointed at the
local `:8002` backend or, with `PREVIEW_BACKEND=<url>`, at the deployed one.
It's what lets you run the probes against the production artifacts before
anything is public: `PROBE_PORT_OFFSET=1000 ./scripts/probe.sh` drives them.
`./scripts/preview.sh --stop` takes it down without touching the matrix.
`./scripts/probe.sh --production` does the same against what's actually
deployed, reading the URLs from the function `publish.sh` deploys against, so a
run can't drift from what was shipped.

Every published URL is built from `WORKERS_SUBDOMAIN` in `scripts/hosted.sh`,
which defaults to the one these docs name. On a fork it has to be yours — the
subdomain `bunx wrangler whoami` prints — or set `WORKERS_SUBDOMAIN` in the
environment, otherwise `publish.sh` deploys to your account under names the hub
then points somewhere else entirely.

The backend is already deployed:

```
https://chat-stack-backend-cloudflare-agents.irons-in-the-fire8698.workers.dev
```

That Worker is a build from before the model routes and the exposure decisions
below — checked 2026-08-23: `/health` answers `200` with `model: scripted` and
31 threads, `/models` answers `not found`, and `/threads` still serves the bulk
list. The cells and the hub aren't published at all. Both of those are the same
one command, `./scripts/publish.sh`, and
[`docs/publishing.md`](docs/publishing.md) is the ordered sequence around it:
what each command changes, how to check it worked, and what the undo actually
recovers.

What that command publishes is the shape described next, which is the committed
one. A published deployment runs the same code as a local one and publishes less
of it, and the difference is two vars whose default is the closed one, so the
committed config is already the public shape and it's the local run that carries
the unlock (`bun run dev`, in the backend's `package.json`). `GET /threads`
returns an empty list and says why — the list is every visitor's first message —
while `GET /threads/{id}` still serves a thread whose id you hold. `POST /model`
is `403`, and `GET /models` says `locked` so the hub draws the column's model as
a fixed chip instead of a control it couldn't honour. That last one matters
beyond tidiness: the published Worker holds no provider key, and a model whose
binding is absent can't be selected anyway, so the lock is what keeps that true
if a key ever arrives. A conformance run against a published backend skips the
thread-list assertion and prints the backend's reason for it; everything else
still asserts.

The remaining thing to know about the hosted cells is that CopilotKit's runtime
forwards only localhost backends, so `?backend=` can't move that cell off its
configured backend once hosted.

The topology column is a real difference, not a detail. The direct cells talk
straight to the backend; CopilotKit requires a server-side runtime in the
middle, which is a place to put auth and rate limiting, and also a Node process
that has to be up.

assistant-ui, AI Elements, shadcn and Folio pin everything except the UI library
— same protocol, same topology, same backend — so those four are the cleanest
read on the frontend axis the matrix has. The first three already land at three
different points on tool-call rendering: a disclosure that doesn't name the
tool, a generic card showing JSON, and a hand-written component per tool.

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
`ANTHROPIC_API_KEY` and `GOOGLE_API_KEY` (or `GEMINI_API_KEY`) from the
environment — `mise env`
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
DEMO_MODEL=openai/gpt-5.6-luna ./scripts/run.sh   # a shared id, understood by every backend
DEMO_MODEL=auto ./scripts/run.sh                  # OpenAI, else Anthropic, else Google

# Native spellings are per-backend, so they go to one backend, not to run.sh:
cd backends/pydantic-ai && DEMO_MODEL=anthropic:claude-opus-5 uv run uvicorn app.main:app --port 8001
```

Two caveats on `DEMO_MODEL` that the picker doesn't have. A native spelling is
only native to one backend — `anthropic:claude-opus-5` is pydantic-ai's, and pi
exits at boot rather than guess, so putting it in front of `run.sh` takes that
cell down. And the Cloudflare cell can't see it at all: a Worker reads bindings,
not the shell, so its boot default lives in `wrangler.jsonc` or `.dev.vars` and
a `DEMO_MODEL=…` in front of `run.sh` leaves it on `scripted`. The hub's picker
has neither problem, which is most of why it exists.

`./scripts/golden.sh` refuses to run against anything but `scripted`, and
`probe.sh` and `conformance.sh` warn — both compare across cells, which only
means something while every cell is doing identical work.

## What you're comparing

Four axes with a probe each, and a fifth nothing can automate. Every backend
implements the same three tools so the probes work everywhere.

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
cell, and captured at the same moments so they sit side by side.

```sh
./scripts/probe.sh     # or: mise run probe — needs scripts/run.sh already up
```

It opens a gallery of every capture and recording. The first run is also what
established that **no cell on the grid rehydrates a thread on reload**, which
the gaps below now say plainly.

## Adding a stack

1. Build it against `protocol/CONTRACT.md`.
2. `./protocol/conformance.sh http://localhost:PORT` until it's green.
3. `bun protocol/golden.ts http://localhost:PORT` until it's green, or record
   an exception with a reason in `protocol/golden/exceptions.json`.
4. Add one line to `scripts/stacks.sh`.
5. Add it to the matching list in `index/index.html` — `FRONTENDS` or
   `BACKENDS` — so the hub draws its row or column.
6. Give it an adapter in `probes/frontends.ts` so the flows run against it, and
   declare whether it `resumes`.
7. Write the ergonomics notes before you forget them.

A backend that passes conformance can be driven by any frontend here. Backends
are picked at the hub and travel to a cell as `?backend=`, so a second backend
needs no frontend changes at all.

Conformance proves the events a frontend depends on exist; golden proves two
backends agree on the bytes. It replaces three hand diffs done by one session
and recorded in READMEs instead of fixed. `./scripts/golden.sh` (or
`mise run golden`) runs it over every backend in `scripts/stacks.sh`;
`bun protocol/golden.ts --update` recaptures the fixtures from the reference.
A recorded run against the live matrix:
[docs/recordings/golden-check.gif](docs/recordings/golden-check.gif).

## Known gaps

- **A reasoning model breaks the second turn on pydantic-ai, and the scripted
  default hides it.** Picking `openai/gpt-5.6-luna` and asking a follow-up used
  to return a 500. `gpt-5.6` reasons by default, so turn one streams reasoning
  parts; assistant-ui is client-authoritative and sends them back on turn two;
  and pydantic-ai 2.31's inbound `ReasoningUIPart` has no `id` field while every
  UI part sets `extra='forbid'`, so the one echoed `id` fails the whole request.
  The AI SDK's own `ReasoningUIPart` declares `id?: string`, so the client is
  right and the gap is pydantic-ai's — its `DataUIPart` already accepts one.
  `backends/pydantic-ai/app/main.py` strips the field on the way in; delete that
  shim when the field lands upstream. Worth knowing for what it says about the
  harness rather than the bug: this was unreachable until the model became a
  runtime choice, and it only appears on turn *two*, so neither the scripted
  default nor a single-shot probe would ever have found it.
- **A leaked `NODE_ENV=development` breaks production builds**, and this list
  blamed Next 16 for it until someone ran the second control. With that variable
  set in the shell, `next build` dies during prerender with a null React
  internal; the page and hook vary between cells and runs — `useContext` on
  `/_global-error`, `useRef` on `/` — which is the tell that the RSC and SSR
  layers are resolving different React builds rather than any component being
  wrong. Every cell's `build` script now pins `NODE_ENV=production`, and the
  cells are clean: every route prerenders static, apart from CopilotKit's
  `/api/copilotkit` runtime, which is dynamic by design. A bare `next build` in
  a shell that leaks the variable still fails, so the pin is load-bearing.
- **History is backend-only in the cells on the grid, and reload loses it.**
  `/threads` and `/threads/{id}` exist and the store is real, but none of the
  five reads them: reload starts a fresh thread, and no thread list is rendered
  anywhere. [FastAPI + Jinja](frontends/jinja/README.md) is the exception — it
  rehydrates from the store on `GET /t/{id}` and renders a thread list — because
  the history is already in its process. The `resume` flow in `probes/` reads
  each cell's `resumes` declaration from `probes/frontends.ts` and asserts it
  both ways, so jinja is green for putting the thread back and a cell that
  starts rehydrating goes red until someone declares it. (An earlier draft of
  this line claimed reload resumed the current thread — driving it is what
  showed otherwise.)
- **Human-in-the-loop approval isn't wired.** pydantic-ai supports deferred tool
  approval, and it's the sharpest test of the generative-UI axis, but it's not
  in the reference agent yet.
- **The scripted model is keyword-matched**, so it won't chain tools or reason
  about which to use. That's the cost of determinism; pick a real model in the
  backend's row at the hub when you
  need real tool selection.

## License

Apache-2.0 — see [`LICENSE`](LICENSE). Three of the cells carry component
directories copied from other projects, and [`NOTICE`](NOTICE) names each one
with its upstream, that project's license and its copyright notice.
