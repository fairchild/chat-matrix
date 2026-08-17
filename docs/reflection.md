# Notes from building this

Opinions, written down while the work is fresh. These are mine, not conclusions
the repo proves — where something is measured I say so, and where I'm
extrapolating from one build I say that too. Treat the strong claims as
hypotheses you now have a harness to test.

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

*Written when there were two. There are four now — AI Elements and shadcn each
carry their own ergonomics notes in their READMEs, and `probes/` can re-derive
any rendering claim below on demand. The assistant-ui/CopilotKit contrast is
still the sharpest one, so it stays as written.*

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

Two smaller things I'd want to know before choosing. CopilotKit installs 777
packages to assistant-ui's 259, and `@copilotkit/runtime` declares peer deps on
openai, groq, langchain, and the Anthropic SDK — optional in practice, but heavy
for something that only proxies AG-UI. And in dev it fetches product
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
expect to revisit it rather than paper over it.

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

**One line in `stacks.sh` really was the whole registration.** I was braced for
that claim to be a lie when the second frontend landed. It wasn't.

## Mistakes worth recording

I nearly attributed the failing production build to CopilotKit. The error is
real — `next build` dies prerendering `/_global-error` with a null `useContext` —
and it appeared right after adding the new frontend, in the new frontend. I
wrote most of a finding about it before running the control, and the control
showed **assistant-ui fails identically**. It's a Next 16 problem. That would
have been a materially wrong conclusion in a document whose whole purpose is
helping you choose between the two, and the only thing that caught it was
building the other one. Run the control.

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

**Stop assigning ports by hand.** Two frontends is fine. Six won't be.

## What this still can't tell you

One backend. The backend axis is entirely untested — every conclusion here is
about frontends and protocols, and `pi` is the first thing that will stress the
contract, because a subprocess-driven agent that owns its own sessions is a
genuinely different shape than a library you import.

No real model. No tool chaining, no multi-step traces, no failure modes.

No human-in-the-loop. pydantic-ai supports deferred tool approval and it's the
sharpest test of the generative-UI axis — where AG-UI and the AI SDK actually
diverge rather than merely differing. Skipping it means the protocol axis is
currently under-tested even though both protocols work.

If I could only do one more thing, it would be the `pi` backend, because it's
the experiment most likely to tell me the architecture is wrong — and that's
worth more right now than another frontend confirming it's right.
