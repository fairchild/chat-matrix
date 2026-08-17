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
