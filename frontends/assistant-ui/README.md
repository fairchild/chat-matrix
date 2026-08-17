# Frontend: assistant-ui

Next.js + `@assistant-ui/react`, talking to a backend over the Vercel AI data
stream protocol (AI SDK v7).

```sh
bun install
bun run dev          # :3001, or PORT=3002 bun run dev
```

`NEXT_PUBLIC_BACKEND_URL` in `.env.local` decides which backend it talks to.
That single URL is the backend axis — there is no proxy route and no
server-side glue to update.

## Ergonomics notes

**No Next.js API route.** The scaffold ships one (`app/api/chat/route.ts`,
calling OpenAI directly), and deleting it is what makes the frontend a pure
client:

```tsx
const transport = new AssistantChatTransport({ api: `${BACKEND}/chat` });
const runtime = useChatRuntime({ transport });
```

The frontend has no model provider dependency at all — `@ai-sdk/openai` came out
with the route. Worth doing in any stack here: a frontend that owns a model
client can't be compared cleanly against one that doesn't.

**Hand-written glue is ~110 lines**, and most of that is the backend badge.
Wiring the runtime is three lines. The `Thread` UI is ~3,300 lines of generated
shadcn-style components pulled from the registry — you own them, which is either
the appeal or the cost depending on your taste. They aren't counted as glue,
but they are the thing you'd be maintaining.

**Dark mode was already paid for.** The registry components read the shadcn
tokens, and the scaffold's `globals.css` ships a `.dark` block for all of them,
so following the OS is `next-themes` in the layout and nothing else —
`components/theme-provider.tsx` is the whole change. Every generated component
flipped without being touched, which is the upside of owning 3,300 lines that
were written against one token set.

**Tool calls collapse by default.** Streamed arguments and results render behind
a `1 tool call ›` disclosure rather than inline. During the slow `analyze` call
you get a spinner on that row and nothing else. This is a genuine design
position, not a gap — but it's the first thing to compare against a frontend
that shows tool I/O inline, and the reason the contract insists backends emit
`tool-input-delta` at all.

## Setup papercuts

Two things the scaffold left broken, both fixed here — expect them on any
assistant-ui project:

- **`lib/utils.ts` was missing.** Registry components import `cn` from
  `@/lib/utils`, which `create` doesn't generate. Symptom is a module-resolution
  failure at first render.
- **Next 16 blocked its own dev chunks.** Loading the page from `127.0.0.1`
  while the dev server expects `localhost` returns 403 on every
  `/_next/static/*` request, so React never hydrates and the page looks alive but
  inert. `allowedDevOrigins` in `next.config.js` fixes it. This one is nasty
  because the HTML is a clean 200 — only the browser console shows it.
