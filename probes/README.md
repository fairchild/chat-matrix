# probes

The flows every frontend has to survive, written in something close to English,
run against every cell of the matrix, and photographed at the same moments so the
results sit side by side.

The root README names four axes with a probe prompt each. Reading those prompts
tells you what to type; it doesn't tell you what the UI did with them. This is
that part — the same prompts driven for real, captured at the moment each one
gets interesting.

```sh
./scripts/run.sh      # the matrix has to be up; probes photograph it, they don't start it
./scripts/probe.sh    # or: mise run probe
```

Then open `probes/artifacts/index.html`. Screenshots and recordings land under
`artifacts/<backend>/<flow>/`, manifests under `artifacts/manifest/`, and
Playwright's own HTML report under `artifacts/report/` — all gitignored. The
backend comes first in the path so a second run against a different backend sits
beside the first; see "Adding a backend" below.

`./scripts/probe.sh` passes its arguments straight through to Playwright, so
`--grep analyze`, `--headed` and `--ui` all work.

## How a flow stays honest across six UIs

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
what lets one flow run against six unrelated UIs — every cell in
`scripts/stacks.sh`, the monolith included. Every sentence resolves
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

That fourth cell cost one adapter block of about ten lines. That number is the
claim this directory is really making, and the cells added since have been the
test of it.

## Adding a flow

Add it to `flows.yaml`. If it needs a sentence the grammar doesn't have, add the
rule to `flow.ts` — but only when every cell can honour it. A sentence only one
frontend can answer has stopped describing an axis and started describing a
stack. When a cell needs the same sentence resolved differently, that belongs in
its adapter, the way `toolNamed` does.

## Adding a backend

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
`/chat` and two `/ag-ui` requests.

`probe.sh` resolves the effective backend once — `PROBE_BACKEND` if you set one,
the preview's backend under an offset, else the first entry in `stacks.sh` — and
exports it, so every run drives the cells with an explicit `?backend=` rather
than letting each fall back to its build-time default. It then reads that
backend's `/health` for the name it calls itself and exports it as
`PROBE_BACKEND_NAME`, which is what the artifacts are keyed by:

```
artifacts/
  cloudflare-agents/weather/tool-call--shadcn.png
  cloudflare-agents/weather/video/shadcn.webm
  pi/weather/tool-call--shadcn.png
  manifest/cloudflare-agents--weather--shadcn.json
  index.html
```

So runs accumulate instead of overwriting, and each moment in the gallery gets
one band per backend, captioned with its name — which is what makes the page a
cross-backend rendering diff rather than a picture of whichever run finished
last. Running `bunx playwright test` directly skips that resolution and the key
degrades in steps: with `PROBE_BACKEND` set it's a slug of the URL
(`localhost-8002`), and with nothing set at all it's `cell-default`, since each
cell is then talking to whatever backend it was built against and there is no
honest name for that.

`jinja` sits outside that grid. It runs its own agent in the process that serves
the page and ignores `?backend=`, so it declares `ownAgent` in `frontends.ts`:
its captures go under `jinja/`, its manifests read `"backend": "jinja"`, and the
gallery shows it once per moment under a band that says it doesn't vary by
backend. Filing those shots under the backend a run targeted would name a
variable that never reached the page.

## Probing the hosted preview

`PROBE_PORT_OFFSET=1000` aims the same flows at the hosted subset instead of the
local matrix — `scripts/preview.sh` serves each cell's static export at its port
plus 1000 — which is how the production artifacts get driven before they deploy:

```sh
./scripts/preview.sh                       # build + serve the subset: hub :4000, each cell at its port + 1000
PROBE_PORT_OFFSET=1000 ./scripts/probe.sh
```

A preview run keys its artifacts under `<backend>-preview` rather than
`<backend>` — `cloudflare-agents-preview`, not `cloudflare-agents` — even
though it drives the same backend a local run would. The backend is identical;
what changed is which build is serving the frontends, `preview.sh`'s static
exports instead of `run.sh`'s dev servers, and that's the build that would
actually publish. Landing on the same key as a local run against that backend
would silently replace one set of captures with the other, and the gallery
would have no way to say which build a band came from — so the two runs get
separate bands, with the preview band sorting directly after its base
backend's.

An offset run drives only `HOSTED_CELLS` from `scripts/hosted.sh`, because that
is the list `preview.sh` and `publish.sh` build from — Cloudflare serves the
grid cells as static exports, and `jinja` is a Python process rather than an
export, so there is nothing at `:4005` to photograph. It reports as skipped
rather than failing,
which is the distinction worth keeping: a cell with no adapter is a gap in
`frontends.ts` and still fails loudly, while a cell outside the subset is a
decision someone made in `hosted.sh`. The preflight in `probe.sh` reads the same
two lists, so it can't ask for a cell the tests won't run. Verified 2026-08-17:
20 flows across the four hosted cells against the preview at `:4001–:4004`, one
skip row for jinja, no `:3005` in the run — 19 green, and the one red
(`assistant-ui · notes`) was the flow asserting the tool name before expanding
the collapsed group that held it; fixed by reordering the two steps (`c00aebe`,
the `notes` flow in `flows.yaml`).

The scripted model makes the work identical across backends, so the gallery
becomes a rendering diff: same flows, same moments, one variable changed.
Verified 2026-08-18, now that the key holds the backend: 25/25 green against
`cloudflare-agents` on `:8002`, then 25/25 against `pi` on `:8003`, and both
sets of captures are in the same gallery — three bands per moment, since `jinja`
comes along outside the grid.

The assertion to watch is `resume`'s `expect the history to resume as the cell
declares`. This section used to predict that a `pi` backend would be the thing
to break it — a backend that owns its own sessions putting history back a cell
never asked for. What broke it first was a frontend. `frontends/jinja` renders
from its own store, so a reload resumes, and a flow asserting one outcome for
every cell could only read that as a failure. The fix was to stop asserting one
number for everyone: each adapter declares `resumes` in `frontends.ts`, and the
flow holds the cell to its own declaration in both directions — a cell that
declares it has to put the thread back, and a cell that declares nothing has to
come back empty. The pi prediction is still open and now has somewhere to land:
a cell that starts rehydrating against a session-authoritative backend goes red
until someone writes the new behaviour down. That failure is the good outcome;
read it as the feature landing, not the harness rotting.

## Probing what's actually deployed

Every URL above is a port on this machine, which is the one thing a published
matrix isn't. `--production` swaps the port arithmetic for a base URL per cell,
read from `scripts/hosted.sh`'s `production_url()` — the same function
`publish.sh` deploys against, so the run can't drift from what was shipped:

```sh
./scripts/probe.sh --production            # drive the deployed cells and hub
```

The mechanism underneath is `PROBE_BASES`, a JSON map of cell name to base URL
(plus `index` for the hub), and it's worth knowing about because it's also how
you'd drive a matrix hosted anywhere else:

```sh
PROBE_BASES='{"index":"https://…","assistant-ui":"https://…"}' ./scripts/probe.sh
```

Artifacts key under `<backend>-deployed`, for the reason a preview run keys
under `-preview`: it's a third build of the same cells, and the gallery has to
be able to say which one a band came from. The hosted subset filter applies too
— a cell with no `wrangler.jsonc` was never deployed, so there's nothing at the
other end to drive.

Note what this still can't tell you: the deployed backend publishes neither its
bulk thread list nor its model switch (`backends/cloudflare-agents/README.md`),
so a conformance run against it skips the thread-list assertion and prints why.
The flows themselves don't touch either route, so they run identically.

## What it found on the first run

**No cell on the grid resumes on reload.** Send a message, reload, and it comes
back empty — a fresh thread, not the one you were in. The backend is persisting
correctly and `/threads/{id}` serves the history; none of them asks for it. That
was four cells on the first run and is five now, and it is the finding that
turned a generous line in the root README into the plain one in its Known gaps.

The monolith changed the picture. `jinja` arrived later and does resume: the
thread lives in the process that renders the page, so a reload re-renders it.
That is why the flow no longer asserts a single number for everyone — each
adapter declares `resumes` in `frontends.ts`, and the assertion holds the cell
to its own declaration either way.

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
| Folio | see [`frontends/folio/README.md`](../frontends/folio/README.md) | — |
| jinja | a card per tool — `templates/partials/tool_<name>.html`, with a JSON card as the fallback — under a header carrying the tool's name and state | no disclosure to open; the whole thing is server-rendered |

shadcn was the odd one out among the first four, and it is the only cell there
where the tool's *name* never
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
~3s and the in-flight screenshot catches every cell mid-gap.

## Known noise

CopilotKit's dev build occasionally paints a product-announcement toast over the
header, so the odd `copilotkit` screenshot has a banner in it. It arrives from
the network and isn't reliably in the DOM to dismiss, so nothing here tries.

The badge's stored-thread count climbs every run, which means consecutive runs of
the same flow are never quite pixel-identical. These captures are for looking at,
not for diffing.
