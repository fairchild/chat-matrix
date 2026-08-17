# Backend: cloudflare-agents

The reference agent on the [Cloudflare Agents SDK](https://developers.cloudflare.com/agents/),
serving both the Vercel AI data stream protocol and AG-UI. See
`protocol/CONTRACT.md` for what it has to implement and why.

This is the backend the matrix publishes. A local clone runs every backend;
Cloudflare runs this one, because it deploys as a single Worker with no server
to keep up, and the scripted model means a public endpoint costs nothing to
leave open.

```sh
bun install
bun run types          # generates worker-configuration.d.ts (gitignored)
bun run dev            # wrangler dev on :8002
bun run deploy         # publish the Worker
```

| Env / var | Default | |
|---|---|---|
| `DEMO_MODEL` | `scripted` | only `scripted` is wired here so far |

Deployed at `https://chat-stack-backend-cloudflare-agents.irons-in-the-fire8698.workers.dev` — conformance passes against it from the edge.

## Layout

| File | |
|---|---|
| `src/agent.ts` | the reference agent and its three tools, on the AI SDK |
| `src/scripted.ts` | deterministic model — a `LanguageModelV4` that follows the same script as `scripted.py` |
| `src/thread.ts` | one Agent (Durable Object) per thread: runs stream from inside it, its SQLite is the store |
| `src/registry.ts` | singleton Agent that indexes threads, because Durable Objects can't enumerate themselves |
| `src/agui.ts` | AG-UI over SSE, from the AI SDK's `fullStream` |
| `src/messages.ts` | stored `ModelMessage`s rendered as either protocol's messages, and AG-UI input parsed back |
| `src/index.ts` | the Worker: routes only |

## How it maps to the contract

The wire formats are byte-compatible with the pydantic-ai backend on everything
a frontend keys off — event sequence, tool-call ids, the two argument halves,
token pacing, and the summary text: it prints tool results the way
pydantic-ai's script does, `Weather(city='Tokyo', …)`, a Python dataclass
`repr` reproduced by `src/pyrepr.ts` (the same trick `backends/pi`'s
`pyrepr.ts` uses) so a diff between the two backends' `/chat` streams for the
weather probe is empty. The one remaining difference is AI SDK 7 stamping a
`finishReason` on `finish`, which pydantic-ai's adapter never sends; the golden
check (`protocol/golden.ts`) records it as an explicit exception rather than
stripping information no cell reads. `/ag-ui` differs only in JSON key order.

Persistence follows the contract's shape: client-authoritative during a turn,
server-persisted after it, in a neutral format (AI SDK `ModelMessage`s) that
each protocol renders on the way out.

## Ergonomics notes

The axis this backend is being judged on, recorded while it was fresh.

**An Agent per thread is the natural unit, and it removes the store.** The
thread's Durable Object owns its history in its own SQLite (`this.sql`), and
the run streams from inside `onRequest`, so persistence is fifteen lines and
there is no store class. `getAgentByName(env.Thread, threadId)` is the whole
addressing scheme.

**Listing is the tax.** Durable Objects don't enumerate, so `/threads` needs a
singleton `Registry` Agent that every thread reports to after a run. Sixty lines,
but it's a second class and a second hop, and it exists only because the
contract has a list endpoint. This is the shape of the model showing through.

**The AI SDK did the protocol work.** `toUIMessageStreamResponse()` is the
Vercel side; AG-UI is a forty-line `switch` over `fullStream`, because the
events map one-to-one. pydantic-ai ships both as `dispatch_request` adapters;
here the equivalent is one library call and one small function.

**Writing a `LanguageModelV4` by hand was fine.** The scripted model is an
async generator of stream parts behind `doStream`. Provider spec v4 (AI SDK 7)
was legible enough to write against from the `.d.ts` alone. `convertToModelMessages`
is async in 7 — a one-`await` surprise.

**The Agents SDK's chat conveniences went unused.** `AIChatAgent` and
`useAgentChat` assume WebSockets and the SDK's own client hook. Keeping the HTTP
contract meant plain `Agent` + `onRequest`, so the "Cloudflare-ideal" client
story — resumable streams, state sync — isn't exercised by this cell. A frontend
built on `useAgentChat` would be a different cell, on a different protocol.

**Papercut:** `DurableObjectStub<Thread>` over the full `Agent` class is too
deep for tsc ("type instantiation is excessively deep"). Hand-typed stubs
(`ThreadStub`, `RegistryStub`) are the workaround, and they're arguably clearer.

**Line count.** ~800 lines total; ~190 are the scripted model and ~150 the
message conversions, neither of which is the SDK's fault or credit. Agent, thread,
registry, and worker are about 380 lines.
