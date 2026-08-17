# Architecture

## What this is for

This repo exists to answer a question that documentation can't: which chat UI and
which agent backend do you actually want to work with? That question only has a
meaningful answer if the things being compared are doing identical work, and the
whole architecture follows from taking that requirement seriously.

The temptation with a demo like this is to build one app per combination. That
gets you working demos and no comparison — each one drifts, each one is a
slightly different agent, and by the third you're comparing your own
implementation choices rather than the libraries. So instead of stacks, this
repo is organised around **axes**: independent variables you can change one at a
time while everything else is pinned.

## The axes

There are three axes and one control variable.

**Frontend** and **backend** are separate processes that never share a runtime.
The **protocol** between them is a third axis rather than a property of either
end, because a backend can serve several protocols at once — the pydantic-ai
backend already serves two, and that turned out to be one line of difference.

The control variable is the **model**. It defaults to a deterministic scripted
one rather than a provider, so two frontends given the same prompt receive
byte-identical work to render. A real model would make every run different,
which is precisely wrong when the thing under test is rendering. The tools still
execute for real — only the model's choices are scripted — and `DEMO_MODEL`
swaps in a real provider when you want to see genuine tool selection instead.

```mermaid
flowchart LR
  H["index hub<br/>:3000"]
  subgraph F["frontends/"]
    A1["assistant-ui<br/>:3001"]
    A2["CopilotKit<br/>:3002"]
    A2R["CopilotRuntime<br/>/api/copilotkit"]
    A3["AI Elements<br/>:3003"]
    A4["shadcn<br/>:3004"]
  end
  subgraph P["protocol"]
    P1["Vercel AI<br/>data stream v7"]
    P2["AG-UI"]
  end
  subgraph B["backends/"]
    B1["pydantic-ai<br/>:8001"]
    B2["cloudflare-agents<br/>:8002"]
    B3["pi<br/>:8003"]
    B4["pi-rpc<br/>:8004"]
  end

  H -->|"?backend="| A1 & A2 & A3 & A4
  A1 --> P1
  A3 --> P1
  A4 --> P1
  A2 --> A2R
  A2R --> P2
  P1 --> B1
  P2 --> B1
  P1 --> B2
  P2 --> B2
  P1 --> B3
  P2 --> B3
  P1 --> B4
  P2 --> B4

```

Four cells and four backends are live; the hub's picker chooses the backend and
every cell reaches any of them.

The asymmetry in that diagram is worth reading carefully. Three of the four
frontends speak their protocol from the browser, so the arrow goes straight to
Python. CopilotKit requires a **server-side runtime** in its own Next process, so
the browser talks to that and the runtime talks AG-UI onward. Both are legitimate
designs — the hop is a natural home for auth and rate limiting — but it means
"frontend" isn't uniformly a pure client.

That asymmetry resurfaces in backend switching. The hub passes the chosen backend
to a cell as `?backend=`, which the three direct cells read in the browser. In
CopilotKit the hop that talks to the backend runs server-side, so the choice has
to be forwarded: the provider sends it as an `x-demo-backend` header and the
route's per-request agents factory builds the `HttpAgent` for it. Same axis, two
mechanisms, because the topologies genuinely differ.

## How a request actually flows

Taking assistant-ui over the Vercel AI data stream as the representative case —
the same path AI Elements and shadcn use. Nothing sits between the two: the
browser posts directly to the Python process, which is why swapping backends is a
URL change rather than a redeploy.

```mermaid
sequenceDiagram
    participant U as Browser<br/>(assistant-ui)
    participant S as FastAPI<br/>(:8001)
    participant A as Agent<br/>(pydantic-ai)
    participant D as SQLite

    U->>S: POST /chat (AI SDK UIMessage[])
    Note over S: build_run_input → thread id
    S->>A: dispatch_request(sdk_version=7)
    A-->>U: tool-input-start / -delta
    Note over A: tool executes for real
    A-->>U: tool-output-available
    A-->>U: text-delta ×N
    A->>S: on_complete(AgentRunResult)
    S->>D: save(all_messages())
    A-->>U: [DONE]
```

The two places worth understanding are the entry and the exit.

On the way in, the request body carries a chat `id` that becomes the thread key.
`VercelAIAdapter.build_run_input` parses the body before `dispatch_request`
consumes it — safe because Starlette caches the body — which is how the same
request serves both routing and the run.

On the way out, `on_complete` receives an `AgentRunResult`, so persistence is
`store.save(thread_id, result.all_messages())`. This fires on stream completion,
which has a consequence worth internalising: a client that disconnects mid-stream
leaves nothing behind. That is a reasonable default, but it means "the request
was made" and "the turn was recorded" are different events.

## The four seams

Four decisions carry the swappability, and each has a cost.

**A reference agent, not just a protocol.** `protocol/CONTRACT.md` specifies three
tools every backend implements: one fast and structured, one returning a list,
one deliberately slow. A shared wire format alone wouldn't be enough, because two
backends could conform to it while giving frontends completely different work to
render. The cost is that adding a backend means implementing the tools, not just
the endpoints.

**Persistence in a neutral format.** The store holds pydantic-ai `ModelMessage`s,
not either wire format. Each adapter's `dump_messages` renders them on the way
out, which is why `GET /threads/{id}?protocol=ag-ui` works without a second store.
Adding a protocol adds a rendering path rather than a migration. The cost is
coupling the store's schema to pydantic-ai's message model — a backend built on
something else keeps its own store and only has to match the HTTP surface.

**Process per stack, no shared runtime.** Every frontend and backend runs
standalone on its own port. There is no shared library they all import, which
means a stack can't accidentally get an advantage from harness code, and a
broken stack can't take the others down. The cost is duplication: each backend
reimplements the same three tools.

**A conformance script as the gate.** `protocol/conformance.sh` asserts the
events a frontend actually depends on — including `tool-input-start` and
`tool-input-delta`, which are what let a UI show arguments arriving rather than
just a spinner. A backend that passes can be driven by any frontend here. This
replaces "run it and see", which is the failure mode where you discover a
protocol gap three frontends later and can't tell which end broke.

## What each directory owns

`protocol/` is the contract and its enforcement, and it is the only thing both
sides are allowed to depend on.

`backends/<name>/` is one agent framework, standalone, owning its own
dependencies and store. `frontends/<name>/` is one chat UI, a pure client with no
model provider dependency — deleting the scaffold's API route is part of onboarding
a frontend, because a UI that owns a model client can't be compared cleanly
against one that doesn't.

`scripts/` is lifecycle. The matrix itself lives in `scripts/stacks.sh` as two
arrays of `name:port`; nothing else in the repo knows the list, so registering a
stack is one line.

`index/` is the hub on :3000 — harness furniture rather than a cell, which is why
it is started from `run.sh` instead of being registered in `stacks.sh`.

`probes/` is the flows harness: the axes written as plain-sentence steps, run
against every cell and captured at the same moments so the results sit side by
side. It answers the question conformance can't — not "does this stack work" but
"what did this UI actually do with the same input".

`docs/` is this file. Per-stack ergonomics notes deliberately live in each
stack's own README instead, written during the build while the friction is still
fresh — they are the notes you reread when deciding, and they age better than
recollection does.

## Adding to the matrix

Three shapes of addition, in increasing cost.

**A new frontend** is cheapest: point it at an existing backend's URL, delete
whatever provider client its scaffold shipped with, and add a line to
`stacks.sh`. No backend work if it speaks a protocol already served.

**A new protocol** on an existing backend is next. Because `dispatch_request` is
symmetric across adapters, this is close to free on the pydantic-ai backend —
serving AG-UI alongside the AI SDK stream cost one endpoint. Then extend
`conformance.sh` with the events that protocol must emit.

Adding CopilotKit exercised both shapes at once and confirmed the design: the
backend needed **no changes at all**, because `/ag-ui` was already conformant.
The work was entirely in the new frontend, and the one-line registry edit in
`stacks.sh` was genuinely the only place the matrix had to learn about it.

A new frontend also needs a `probes/frontends.ts` adapter so the flows run
against it, and it should read `?backend=` so the hub can point it anywhere.

**A new backend** is the real work: implement the reference agent's three tools,
serve at least one protocol, expose the thread endpoints, and pass conformance.
The `pi` backend was the interesting case, and it landed differently from the
plan: the guess was `pi --mode rpc` — a subprocess and a translated event stream
— but pi's SDK runs in-process under Bun, so it is `createAgentSession` with the
three tools and a scripted `Provider` registered on pi's own `ModelRuntime`. What
stayed true is that pi ships an event stream and no wire format, so the two
protocol adapters (~130 lines each) are this backend's cost, where pydantic-ai
gets them from its library. The events map one-to-one and the adapters are
switch statements — a good sign for pi's event model. The original guess then
landed as its own cell: `pi-rpc` drives `pi --mode rpc` as a child process per
thread, with the same scripted provider and tools loaded into the child as a pi
extension. Its streams are byte-identical to the in-process cell's; the one
thing the process boundary costs is that pi's wire format omits the live
tool-call id, so arguments arrive in a burst rather than streaming. The
research and the rejected alternatives are in `backends/pi-rpc/README.md`.

Whatever the shape, write the ergonomics notes before moving on. That is the
axis with no automated probe, and it is unrecoverable a week later.

## Where this will strain

Being honest about the limits, roughly in the order they'll bite.

Ports are assigned by hand in `stacks.sh`. Fine for a handful of stacks, annoying
at a dozen; the fix is dynamic allocation written back into the run state, and
it isn't worth doing yet.

History is client-authoritative during a turn and server-persisted after it in
two of the four backends, following the AI SDK's default rather than fighting
the transport. The two pi backends are the predicted exception: they own their
sessions, read only the latest user message from a request, and persist
incrementally rather than on completion. The contract now names both models
rather than pretending there is one. It hasn't bitten yet — no frontend
rehydrates on reload, so nobody has seen the two disagree — but the day one
does, this is where the seam is.

Threads are one JSON blob per row. Fine at demo scale and honest about being a
demo, but it's the first thing to change if threads get long.

The sharpest gap is that nothing captures comparisons. Conformance proves a stack
works; it doesn't record that assistant-ui collapses tool calls behind a
disclosure while some other frontend shows them inline. Right now that lives in
prose in each README, which is fine for two stacks and won't be at six. If this
grows, a per-axis scorecard is the thing to add — not more automation.

The point of all this is to make the eventual decision cheap and well-founded:
change one variable, see what actually differs, and have written down why.
