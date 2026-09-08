# Notes from building this

Opinions, written down while the work is fresh. These are mine, not conclusions
the repo proves — where something is measured I say so, and where I'm
extrapolating from one build I say that too. Treat the strong claims as
hypotheses you now have a harness to test.

*Updated 2026-08-23. Most of this was written when the repo had one backend and
two frontends; it has four and six now. The largest change is a new section, "On
the backend axis", and it is a synthesis rather than a memory — every claim in
it is traceable to what a backend's own README recorded during its build, to
`protocol/CONTRACT.md`, or to `protocol/golden/exceptions.json`, and it says
which. "What this still can't tell you" was rewritten, because most of what it
listed has since been done. The rest is smaller: the package counts moved onto
one metric, two notes were added about the harness, and the places where a
prediction written here has since been settled now say so inline. Every opinion
that was already here stayed, including the ones the later work has put pressure
on.*

## The short version

If you want a chat UI that looks finished in an afternoon and you don't much
care about the internals, **CopilotKit** gets you there faster. If you expect to
be rewriting the rendering — tool calls, custom components, message layout —
**assistant-ui** puts the code in your repo where you can edit it, and that
matters more the longer the project runs.

The thing I did not expect: they disagree about what a chat frontend *is*.
assistant-ui hands you components and a fallback for everything, then gets out
of the way. CopilotKit hands you a finished product and expects you to extend it
through registration points. Neither is wrong, and the choice is mostly about
which failure mode you'd rather have — a pile of generated code you own, or a
black box you configure.

## On the two frontends

*Written when there were two. There are five on the grid now, plus the monolith
outside it — [AI Elements](../frontends/ai-elements/README.md),
[shadcn](../frontends/shadcn/README.md) and
[Folio](../frontends/folio/README.md) each carry their own ergonomics notes in
their READMEs, and `probes/` can re-derive any rendering claim below on demand.
Folio is the newest and I haven't formed an opinion on it worth writing down;
[`frontends/folio/folio-in-context.md`](../frontends/folio/folio-in-context.md)
is the study it was built to be read against. The assistant-ui/CopilotKit
contrast is still the sharpest one, so it stays as written.*

The sharpest measured difference is what happens when a tool is called and you
haven't written any code for it. assistant-ui renders a collapsed `1 tool call ›`
row from `tool-fallback.tsx` — automatic, unnamed, you must expand it.
CopilotKit renders **nothing at all**: the answer text mentions the result and
there's no sign a tool ran. Registering the built-in `WildcardToolCallRender`
gets you a named, expandable card with a status badge, which I think is the
better artifact of the two.

So: lower floor, higher ceiling. My opinion is that the floor matters more than
it looks like it does, because "tool calls are invisible" is a bug you ship
without noticing — nothing errors, the answer is still correct, and you only
catch it by looking. I only caught it because I was screenshotting for a
comparison.

The other real difference is topology, and it's the one I'd weigh most heavily
for production. assistant-ui talks straight to the backend, so it's a static
site with a URL. CopilotKit needs a server-side runtime process in the path.
That hop is genuinely useful — it's the natural home for auth, rate limiting,
and header forwarding, none of which you want in the browser — but you now have
a Node service to run, deploy, and keep healthy for a frontend. If you already
have a BFF, this costs nothing and buys something. If you were hoping to deploy
a static frontend, it's a real change.

Two smaller things I'd want to know before choosing. CopilotKit's tree resolves
more than three times as many packages as assistant-ui's — 1,435 against 450
with `bun pm ls --all`, the metric the whole repo uses, measured across the
cells on 2026-09-08. Every absolute count here moves with the next dependency
update; the ratio is the durable part. `@copilotkit/runtime` also declares peer
deps on openai, groq, langchain, and the Anthropic SDK — optional in practice,
but heavy for something that only proxies AG-UI. And in dev it fetches product
announcements from a CDN and renders them over your app; I couldn't turn the
overlay off (`showDevConsole={false}` didn't do it), and it sat on top of my
header in every screenshot. Telemetry at least has a documented off switch.

Where I'd push back on my own take: I built the assistant-ui cell first, so it
got the benefit of me learning the problem on it. And I never exercised
CopilotKit's actual strengths — `useAgent`, shared state, generative UI — which
is where it's aimed. The comparison so far is "out of the box", and that flatters
the library that ships more defaults for the *frontend* while penalising the one
whose defaults are for *state*.

## On pydantic-ai

The standout is that serving a protocol is one line, and the two protocols
differ only by adapter class:

```python
await VercelAIAdapter.dispatch_request(request, agent=agent, sdk_version=7, …)
await AGUIAdapter.dispatch_request(request, agent=agent, …)
```

I set out expecting protocol to be a property of the backend and planned around
swapping backends to change it. It isn't, and that one fact reshaped the
architecture — protocol became its own axis, which is why adding CopilotKit
needed zero backend work. That's the single best thing that happened in this
build, and I can't take credit for it; the library was just built that way.

`on_complete` receiving an `AgentRunResult` is the other good seam — persistence
is one line, and storing `ModelMessage`s rather than a wire format means
`dump_messages` renders history into whichever protocol asks. Adding a third
protocol would add a rendering path, not a migration.

The one design decision I'd flag as load-bearing and unresolved: history is
client-authoritative during a turn and server-persisted after it, because that's
what the AI SDK transport wants. It works, but a backend that owns its own
sessions — `pi` — will want to be the source of truth, and I think that's a
genuine divergence in the contract rather than an implementation detail. I'd
expect to revisit it rather than paper over it. *(It went that way. Both pi
backends are session-authoritative, the contract names both models, and
`conformance.sh` holds each backend to the one its `/health` declares — see "On
the backend axis" below.)*

## On the backend axis

Three more backends landed after the section above was written, and this is what
their notes add up to. I built none of them in one sitting the way I built the
first two, so this is a synthesis of what each README recorded while its stack
was fresh rather than a recollection — I've said whose note each claim comes
from, and marked the opinions as opinions.

**What a backend costs is mostly whether its library already ships a wire
format.** That is the one number that moves. The pydantic-ai README records
serving a protocol as one line, `dispatch_request`, with the two endpoints
differing by an adapter class. The cloudflare-agents README records the AI SDK
doing the same work in one call — `toUIMessageStreamResponse()` — with AG-UI as
a forty-line `switch` over `fullStream`, "because the events map one-to-one".
The pi README records the other end of the range: pi has an event stream and no
wire format, so each protocol is roughly 130 lines plus a shared run loop, and
it names that as this backend's cost where pydantic-ai gets it from its library.
The totals follow: ~500 lines for pydantic-ai, ~800 for cloudflare-agents,
~1090 for pi, ~1310 for pi-rpc, each README apportioning its own difference. My
reading of that spread, and it is a reading: the framework you pick decides
almost nothing about the agent and almost everything about the translation layer
around it.

**The tell that a backend's event model is well-shaped is that its adapter is a
`switch`.** Both pi READMEs reach for that word independently, and neither was
looking for it — `toolcall_start/delta/end` maps to
`tool-input-start/delta/available`, `tool_execution_end` to
`tool-output-available`, and nothing needed buffering. The cloudflare-agents
README says the same of `fullStream`. The one place a state machine was needed
is the one place the wire is lossy, below.

**Where the history lives is the real axis, and it isn't the framework.**
`protocol/CONTRACT.md` now names two models rather than pretending there is one:
**client-authoritative**, where the AI SDK sends the full list each turn and the
server records the result, and **session-authoritative**, where the backend owns
a durable record and reads only the latest user message. pydantic-ai and
cloudflare-agents are the first; both pi backends are the second, because pi
already owns the session file and replaying the client's copy into it would mean
two sources of truth. The consequence the CONTRACT states plainly is the one I'd
want a reader to take away: on a client-authoritative backend the stored thread
mirrors the client's last view, so a client that sends fewer messages than the
server holds destroys the rest. `/health` declares which model a backend is, and
`conformance.sh` holds it to the declaration from both sides — a backend that
changes behaviour goes red until someone edits the word. That check is the part
I'd defend: a declaration nothing verifies is a comment.

**When persistence happens differs, and it shows up as a different failure.**
The pydantic-ai README records `on_complete` firing on stream completion, so a
client that disconnects mid-stream writes nothing. The contract records the
other shape and its consequence side by side: pi appends each entry as it
happens, once the first assistant message has landed, so the same disconnect
leaves the user message and a partial assistant message marked `aborted`.
Neither is wrong. They fail differently, and I'd want to know which before
building anything that reconnects.

**Two backends removed the store and one of them paid a tax for it.** The
cloudflare-agents README records the Durable Object per thread owning its own
SQLite, so persistence is fifteen lines and there is no store class — then
records the bill: Durable Objects don't enumerate, so `/threads` needs a
singleton `Registry` every thread reports to, sixty lines and a second hop that
"exists only because the contract has a list endpoint". The pi README reports
the same shape with pi's session files and a 90-line store module. Worth noticing
that both bills were for the list route, which is also the one route a published
deployment declines to serve.

**Inheriting a runtime means inheriting everything else in it.** This is the pi
notes' sharpest observation and it generalises. The pi README records
`DEMO_MODEL=anthropic/claude-haiku-4-5` working first try through an OAuth login
already on the machine — a convenience the Python backend can't offer — and in
the same breath that `DefaultResourceLoader` would just as happily load your
extensions, skills, prompt templates and `AGENTS.md` into a comparison harness,
which is why that backend passes five `no*` flags. The pi-rpc README finds the
other half out of process: the child reads `~/.pi/agent/settings.json` and warns
about patterns it can't match, and `PI_CODING_AGENT_DIR` is the isolation knob,
at the cost of the shared `auth.json` that made real models keyless. Free
credentials and ambient configuration are the same feature.

**The process boundary costs exactly one thing, and it's the thing a chat UI
wants most.** The pi-rpc README records that pi strips `partial` from
`message_update` to keep the stream linear in size — sound for a log — and that
this takes the tool call's id and name with it until `toolcall_end`, so an
out-of-process client can't stream arguments. The in-process adapters were a
`switch`; these are a `switch` plus a per-call buffer, under ten lines each. It
also costs 200 MB of resident memory per idle child, measured, for a scripted
model that calls none of the provider SDKs that memory is holding. That the same
agent runs at both distances at all is the more interesting half: the pi-rpc
README records the provider, the tools and the system prompt moving into a
single extension file unchanged.

**Golden is the reason any of this is comparable.** Four backends, five fixed
prompts, both protocols, reduced to a canonical form and diffed byte for byte
against fixtures captured from the reference, and
`protocol/golden/exceptions.json` holds exactly one entry: cloudflare-agents'
`finishReason`, which the AI SDK stamps unconditionally and no cell reads. I did
not expect four independent implementations to agree that closely, and I'd have
believed a hand-written comparison far less. What it can't see is pacing —
pi-rpc's burst at `toolcall_end` is identical bytes in a different rhythm — which
is a real limit of byte comparison rather than a gap in the check.

## On the monolith

`frontends/jinja` was meant to be a curiosity and turned into the clearest thing
in the repo about where state belongs. The CSS is bigger than everything else
put together — 834 lines against 673 of new Python and 62 of JavaScript — which
I read as the framework you skip moving into a stylesheet you own rather than
disappearing. What I didn't predict is that reload-resumes-the-thread and a
thread list, neither of which any of the four React cells does, came almost free
here: the history was already in the process, so the page route is two lines.
Where the history sits decides whether resume is a feature you build or a
consequence of the architecture, and that's a question I'd now ask before asking
which UI library to use.

The client stayed as ignorant as I wanted — five ops and some element ids — and
the one coupling that did show up, Stop's event delegation leaning on a CSS
rule, turned out to be removable rather than inherent. The cost landed somewhere
I didn't expect: with no client state machine, the browser's own form semantics
are the transport, and they bit exactly once and sharply — a suggestion button
and an empty textarea both posting `message`, last-wins in Starlette, fixed by
putting the composer first in the DOM and reordering it in CSS. I'd still take
that trade: rules that predate the app and aren't written down in one place,
against no state machine of my own to get wrong. The maintenance cost the plan
named, a copied agent held to the reference by a `diff`, fired on day one when
the reference grew a model picker, and was paid the same day.

The limit is the one it was built with. It can't be pointed at another backend
and it has one topology by construction, so it answers "what does a chat UI cost
when there is no chat framework" and not "which framework" — different
questions, which I'd been treating as one.

## On the harness itself

**The scripted model is the decision I'd defend hardest.** It looked like a
workaround for having no API key, and it isn't — it's what makes the comparison
mean anything. Two frontends given the same prompt get byte-identical work to
render, so any difference is the stack. With a real model I'd have spent the
whole session wondering whether a rendering difference was actually a different
answer. It also made the whole thing runnable with no credentials, which is a
side benefit I'd now design for deliberately.

The cost is real and I under-sold it in the README: keyword matching means the
model never chains tools, never reasons about which tool to use, and never
produces the messy multi-step traces that are exactly where frontends differ
most. It's the right default and the wrong thing to draw final conclusions from.

**Conformance earned its keep faster than expected.** It caught the `vars()` bug
on a slots dataclass — a 500 that was invisible until something called
`/threads` — and gave me a green signal to trust when adding the second cell.
The version that only checks "does it stream text" would have passed while
`tool-input-delta` was missing, which is precisely the event that lets a UI show
arguments arriving.

**One line in `stacks.sh` really was the whole registration — for a while.** I
was braced for that claim to be a lie when the second frontend landed. It
wasn't. It has since grown to three places: the line in `stacks.sh`, a row or
column in `index/index.html`, and an adapter in `probes/frontends.ts`. Each of
those arrived with something the harness gained — a hub that draws the grid,
flows that run against every cell — and each is a few lines, so I'd still call
the design right. But "one line" stopped being true two cells ago, and the
README's "Adding a stack" now lists what it actually costs.

**Making the model a runtime choice found a bug the whole design was hiding.**
The hub's per-backend picker was meant as a convenience — a dropdown instead of
`DEMO_MODEL` in front of `run.sh`. What it actually did was make a reasoning
model reachable, and the second turn under one 500'd on pydantic-ai over a
missing optional field. That was unreachable before, and it only shows up on
turn *two*, so neither the scripted default nor a single-shot probe would ever
have found it. The general version, which I'd now believe about any harness: a
control variable you can't change at runtime is a region of the space you have
never visited.

**Publishing a subset was cheaper than publishing everything, and more honest.**
Cloudflare runs one backend and the grid cells; a local clone runs all ten
stacks. What I didn't expect is that the constraint improved the code. The
public surface had to become a decision rather than a default, so the bulk
thread list and the model switch are now bound to vars whose default is the
locked one — the committed config ships the safe shape and the local run carries
the unlock — and the hub draws a fixed chip where it would otherwise draw a
control it couldn't honour. The version of this that goes wrong is the one where
the safe shape is something a publish has to remember.

## Mistakes worth recording

I nearly attributed the failing production build to CopilotKit. The error was
real — `next build` died prerendering `/_global-error` with a null `useContext` —
and it appeared right after adding the new frontend, in the new frontend. I
wrote most of a finding about it before running the control, and the control
showed **assistant-ui fails identically**. That would have been a materially
wrong conclusion in a document whose whole purpose is helping you choose between
the two, and the only thing that caught it was building the other one. Run the
control.

Then I stopped one level too early, and this is the more interesting half. The
control acquitted CopilotKit, and I wrote down "it's a Next 16 problem" — which
felt safe because two unrelated frontends failed the same way, and later felt
safer still when a third and a fourth did too. It was wrong. A
`NODE_ENV=development` leaks from the shell on this machine, and a production
build inheriting it resolves different React builds in the RSC and SSR layers;
unset it and all four compile clean and static. The evidence that should have
broken it was sitting in the error messages the whole time: the failing page and
hook kept moving — `/_global-error` here, `/` there, `useContext` one run,
`useRef` the next — and a genuine library bug does not wander like that.

Two lessons, and the second is the one I'd keep. A control tells you what
*isn't* the cause; it doesn't tell you what is, and the temptation is to accept
the first shared factor that all your failing cases have in common. Four
frontends had Next 16 in common. They also had one shell in common, and nothing
in the experiment could distinguish those two hypotheses. Second: by the end,
four READMEs asserted the Next 16 attribution independently, which read as
corroboration and was nothing of the kind — they were four copies of one
unverified claim, written by the same process. Agreement between documents is
not evidence when a single source wrote all of them.

Two smaller ones, both self-inflicted. `vars()` on a `slots=True` dataclass
raises, so `/threads` 500'd until conformance caught it. And `run.sh` hung when
piped, because backgrounded servers inherited the script's stdout — the services
were healthy and the script looked dead, which is a confusing five minutes.
`exec` plus redirecting every stream fixed it.

There's also a mistake I keep almost making: trusting docs over the installed
package. CopilotKit's published quickstart shows `copilotRuntimeNextJSAppRouterEndpoint`
(v1) when v2 is Hono-based, and a label key that doesn't exist. Reading the
shipped `.d.mts` files was faster and correct. Same lesson as pydantic-ai's
`sdk_version` defaulting to 5 while assistant-ui is on v7 — the failure there
would have been a client that can't parse the stream, with no server error.

## What I'd change

**~~Add a scorecard.~~ Done, and better than I proposed.** I wanted a hand-filled
table per axis per cell, and argued against automating it because the
observations are qualitative. `probes/` went the other way and was right to: the
axes are written as plain-sentence flows, run against every cell, and captured at
the same moments, so the qualitative comparison is a gallery of real screenshots
rather than my recollection of them. The bit I had backwards is that automating
the *driving* doesn't force you to automate the *judgement*.

**~~Capture screenshots as artifacts.~~ Done** — same harness. Every rendering
claim in this file can now be re-derived by running `./scripts/probe.sh` instead
of trusting that I looked carefully.

**Reconsider one-blob-per-thread sooner than planned.** Fine now, and I'd change
it the moment threads get long enough to reload slowly, which will be before it
becomes obviously wrong.

**Stop assigning ports by hand.** I wrote "two frontends is fine, six won't be".
There are six now, and it is still fine — `stacks.sh` holds ten `name:port`
pairs and the only thing that has actually bitten is having to keep the preview
offset clear of both ranges. So the prediction was wrong about where the pain
starts, and I'd still make the change, just no longer as the next one.

## What this still can't tell you

The backend axis is no longer the blank this section used to name. Four
backends implement the contract, `pi` shipped twice — in-process and as a child
process — and golden holds all four to the reference's bytes, so the section
above is a reading rather than the hypothesis this line used to be. What's left
is different.

**No real model, by default and on purpose.** The scripted model is what makes
the comparisons mean anything, and it means no tool chaining, no multi-step
traces, no failure modes, and none of the messy work that is exactly where
frontends differ most. You can switch a backend to a provider at the hub and see
all of it; what you can't do is compare two cells afterwards, because the thing
being rendered stopped being identical. That trade is the harness rather than a
defect in it, but it does mean every rendering conclusion here is drawn from
one-tool turns.

**No human-in-the-loop.** pydantic-ai supports deferred tool approval and it's
the sharpest test of the generative-UI axis — where AG-UI and the AI SDK
actually diverge rather than merely differing. It's still not in the reference
agent, so the protocol axis stays under-tested even though both protocols work.

**The day a cell rehydrates.** This is the one I'd watch.
`protocol/CONTRACT.md` names two history models and `conformance.sh` holds each
backend to the one it declares, but the two have never actually met: none of the
five grid cells rehydrates on reload, and the one frontend that does — the
monolith — reads its own store and has no backend to point elsewhere. So nothing
in the matrix has yet held a history a session-authoritative backend disagrees
with. The contract predicts what happens; nothing has run it.

If I could only do one more thing now, it would be a cell that rehydrates from
`/threads/{id}` — for the same reason `pi` was the answer last time. It's the
experiment most likely to tell me the contract is wrong, and that's worth more
than another surface confirming it's right.
