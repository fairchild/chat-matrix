# probes

The flows every frontend has to survive, written in something close to English,
run against every cell of the matrix, and photographed at the same moments so the
results sit side by side.

The root README names four axes and one probe prompt each. Reading those prompts
tells you what to type; it doesn't tell you what the UI did with them. This is
that part — the same prompts driven for real, captured at the moment each one
gets interesting.

```sh
./scripts/run.sh      # the matrix has to be up; probes photograph it, they don't start it
./scripts/probe.sh    # or: mise run probe
```

Then open `probes/artifacts/index.html`. Screenshots, recordings and an HTML
report all land under `artifacts/`, which is gitignored.

`./scripts/probe.sh` passes its arguments straight through to Playwright, so
`--grep analyze`, `--headed` and `--ui` all work.

## How a flow stays honest across four UIs

A flow is a list of sentences:

```yaml
- flow: weather
  axis: Streaming & tool-call UX
  steps:
    - open the chat
    - ask "What's the weather in Tokyo?"
    - wait for the tool call
    - capture tool-call
    - wait for the reply
    - expect the reply to mention "crisp and sunny"
```

None of those sentences name a selector, a component or a framework, which is
what lets one flow run against four unrelated UIs. Every sentence resolves
through an adapter in `frontends.ts`, and that file is the only place any stack's
DOM is described. `flow.ts` holds the whole grammar — one regex per sentence the
flows are allowed to say, and an unknown sentence fails with the list of known
ones rather than being skipped.

The split is the useful part. When a flow fails, it's the stack; when a sentence
can't be expressed, it's the adapter.

## Adding a stack

Add the cell to `scripts/stacks.sh` as usual, then give it an adapter block in
`frontends.ts`. Nothing else changes — the flows, the screenshots and the gallery
are generated from the pair of those two files. A cell that appears in
`stacks.sh` with no adapter fails one loud test rather than quietly testing
nothing, which is how the fourth cell announced itself while this was being
written.

The fourth cell cost one adapter block of about ten lines. That number is the
claim this directory is really making.

## Adding a flow

Add it to `flows.yaml`. If it needs a sentence the grammar doesn't have, add the
rule to `flow.ts` — but only when every cell can honour it. A sentence only one
frontend can answer has stopped describing an axis and started describing a
stack. When a cell needs the same sentence resolved differently, that belongs in
its adapter, the way `toolNamed` does.

## Adding a backend — the open follow-up

A backend needs no adapter and no flow change: adapters are per-frontend, and the
flows drive whichever backend a cell resolves. That much is verified — the whole
matrix was re-run green against `c61c351`, which made the backend switchable, with
no edit here.

Driving a *chosen* backend is `PROBE_BACKEND`:

```sh
PROBE_BACKEND=http://localhost:8002 ./scripts/probe.sh --grep "weather|notes"
```

It carries the hub's `?backend=` through the `open the chat` step, and nothing
else changes. The per-cell wiring differs (the three direct cells read the param
in the browser; CopilotKit forwards the choice server-side as a header), and
both mechanisms were exercised: the command above ran 8/8 green against
`backends/cloudflare-agents/` on 2026-08-16, with the Worker's log showing six
`/chat` and two `/ag-ui` requests. Screenshots overwrite the default set — the
gallery shows whichever backend ran last, and says so nowhere yet.

## Probing the hosted preview

`PROBE_PORT_OFFSET=1000` aims the same flows at the hosted subset instead of the
local matrix — `scripts/preview.sh` serves each cell's static export at its port
plus 1000 — which is how the production artifacts get driven before they deploy:

```sh
./scripts/preview.sh                       # build + serve the subset on :4000–:4004
PROBE_PORT_OFFSET=1000 ./scripts/probe.sh
```

An offset run drives only `HOSTED_CELLS` from `scripts/hosted.sh`, because that
is the list `preview.sh` and `publish.sh` build from — Cloudflare serves four
static exports, and `jinja` is a Python process rather than an export, so there
is nothing at `:4005` to photograph. It reports as skipped rather than failing,
which is the distinction worth keeping: a cell with no adapter is a gap in
`frontends.ts` and still fails loudly, while a cell outside the subset is a
decision someone made in `hosted.sh`. The preflight in `probe.sh` reads the same
two lists, so it can't ask for a cell the tests won't run. Verified 2026-08-17:
20 flows across the four hosted cells against the preview at `:4001–:4004`, one
skip row for jinja, no `:3005` in the run — 19 green, and the one red
(`assistant-ui · notes`) was the flow asserting the tool name before expanding
the collapsed group that held it; fixed by reordering (this commit).

The scripted model makes the work identical across backends, so the gallery
becomes a rendering diff: same flows, same moments, one variable changed. A
`pi`-backed backend was in progress as of the same date.

The assertion to watch is `resume`'s `expect 0 user messages`. It pins the
current behaviour, and a backend that owns its own sessions — as a `pi`-backed one
might — is the likeliest thing to finally break it. That failure is the good
outcome; read it as the feature landing, not the harness rotting.

## What it found on the first run

**Nothing resumes on reload.** Send a message, reload, and all four come back
empty — a fresh thread, not the one you were in. The backend is persisting
correctly and `/threads/{id}` serves the history; no frontend asks for it. The
root README describes this as "reload resumes the current thread rather than
letting you pick one", which is a more generous reading than the UI supports.
The `resume` flow asserts the current behaviour (`expect 0 user messages`) so it
fails the day someone fixes it.

Worth knowing if you write your own check: every frontend renders the probe
prompts as suggestion buttons, so a substring search for the prompt text finds it
on a blank page and reports resume working. Count message elements.

**The stacks disagree about what a tool call is.** Same backend, same scripted
model, same bytes on the wire:

| | what the tool call looks like | default state |
|---|---|---|
| assistant-ui | "1 tool call" | collapsed — the tool's name isn't on screen until you expand it |
| CopilotKit | name + `inProgress`/`complete` pill | collapsed |
| AI Elements | name, status, arguments streaming in live | open, because `page.tsx` passes `defaultOpen` |
| shadcn | a component per tool: a weather card, note cards, "Analyzing …" | no disclosure to open |

shadcn is the odd one out, and it's the only cell where the tool's *name* never
appears on screen — the weather card reads "Tokyo · crisp and sunny". Its
adapter overrides `toolNamed` to match the `data-tool` attribute instead of
visible text, which is the one place a flow sentence resolves through something
the eye can't see.

That attribute is worth a footnote: it isn't something shadcn/ui provides. The
tool cards are hand-written components in that cell's `components/parts/`, and
their author tagged the roots so these flows could address them. On the axis of
what a library actually gives you to hold on to, shadcn/ui sits with
assistant-ui — `data-slot` on every primitive.

The `analyze` flow is where the difference is sharpest, because the tool sleeps
~3s and the in-flight screenshot catches all four mid-gap.

## Known noise

CopilotKit's dev build occasionally paints a product-announcement toast over the
header, so the odd `copilotkit` screenshot has a banner in it. It arrives from
the network and isn't reliably in the DOM to dismiss, so nothing here tries.

The badge's stored-thread count climbs every run, which means consecutive runs of
the same flow are never quite pixel-identical. These captures are for looking at,
not for diffing.
