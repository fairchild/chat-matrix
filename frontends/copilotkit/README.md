# Frontend: CopilotKit

Next.js + `@copilotkit/react-core/v2`, talking to the backend over **AG-UI**.

```sh
bun install
bun run dev          # :3002, or PORT=3003 bun run dev
```

| Env | |
|---|---|
| `BACKEND_URL` | server-side; where the runtime route sends AG-UI requests |
| `NEXT_PUBLIC_BACKEND_URL` | browser-side; only used by the header badge |
| `COPILOTKIT_TELEMETRY_DISABLED` | set to `true` here — see below |

## The shape is different, and that's the point

assistant-ui is a pure client: the browser posts straight to Python. CopilotKit
puts a **server-side runtime** in the middle.

```
browser → /api/copilotkit (CopilotRuntime) → AG-UI → :8001/ag-ui
```

That route is ~20 lines (`app/api/copilotkit/[[...slug]]/route.ts`) and the
AG-UI hop is one object:

```ts
new CopilotRuntime({ agents: { demo: new HttpAgent({ url: `${BACKEND}/ag-ui` }) } })
```

The tradeoff is real in both directions. The hop is somewhere to put auth,
rate limiting, and header forwarding without touching the agent — genuinely
useful in production. It also means this frontend can't be pointed at a
different backend purely from the browser, and there's a Node process in the
path that has to be running and healthy. For the matrix specifically it's a
small wrinkle: `BACKEND_URL` is read server-side, so switching backends is still
one env var, just not a client-side one.

### The hosted shape

The runtime hop is what keeps this cell from being a static site, so hosting
splits it in two: `STATIC_EXPORT=1 bun run build` writes the page to `out/`
with the API route left out (route files are `.ts`, pages `.tsx`; narrowing
`pageExtensions` is what drops it), and `worker/index.ts` answers
`/api/copilotkit` on the same origin, so `runtimeUrl="/api/copilotkit"` holds in
both shapes. Both build the runtime from `lib/runtime.ts`. `wrangler.jsonc` ties
them together — and carries two workarounds the runtime package needs on
Workers: `express` and `cors` aliased to a stub, because `@copilotkit/runtime/v2`
imports them eagerly and express does code generation at load, which workerd
forbids (this is also why OpenNext couldn't host the app whole); and
`import.meta.url` defined, because the package's module shim calls
`createRequire(import.meta.url)` at load and never uses the result.

## Ergonomics notes

**Tool calls render as nothing until you opt in.** This was the biggest
surprise. With a default setup the `get_weather` call produced no UI at all —
the answer text mentioned the result, but there was no indication a tool had
run. CopilotKit has no fallback renderer for unknown tools; you register them:

```tsx
<CopilotKit renderToolCalls={[WildcardToolCallRender]} …>
```

With the built-in wildcard renderer you get a named, expandable card with a
`complete` status badge — arguably clearer than assistant-ui's collapsed
`1 tool call ›`, which doesn't name the tool. So the ceiling here is higher and
the floor is lower. The philosophy is renderer-first: `defineToolCallRenderer`,
per-tool components, `useRenderToolCall`. If the generative-UI axis is what you
care about, this is the more direct model — assistant-ui gives you something for
free and you customise from there; CopilotKit gives you nothing and you build
exactly what you want.

**Styling is included.** No Tailwind, no generated components, no shadcn
registry — one CSS import and the chat looks finished. `app/globals.css` here is
~30 lines of page shell and badge, versus assistant-ui's ~3,300 lines of
components you own. Same tradeoff inverted: less to maintain, less to change.

**Dark mode is included too, and the seam is where you'd expect.** CopilotKit's
stylesheet scopes its dark palette to `.dark *`, the same class `next-themes`
writes on `<html>`, so the entire chat flipped for free. What didn't was the
~30 lines of shell and badge in `app/globals.css`, because those were literal
hex — five colours became `:root` custom properties with a `.dark` block, and
that is the whole cost. The tradeoff from the styling note holds in both
directions: the part the library owns needed nothing, the part you own needed
all of it.

**Dependency weight.** 777 packages against assistant-ui's 259. `@copilotkit/runtime`
declares peer deps on openai, groq, langchain, and `@anthropic-ai/sdk` — optional
in practice, but the install is heavy for a frontend that only proxies to AG-UI.

**Version pinning bit immediately.** `@ag-ui/client@^0.0.58` doesn't type-check
against CopilotKit, which pins `0.0.57` exactly:

```
Type 'HttpAgent' is not assignable to type 'AbstractAgent'.
  Types have separate declarations of a private property '_debug'.
```

Two copies of the same package, nominal private fields, unassignable. Pinning to
`0.0.57` (exact, no caret) dedupes it. Expect this whenever you install an AG-UI
package alongside CopilotKit.

**It calls home.** In dev the app fetches `https://cdn.copilotkit.ai/announcements.json`
and renders product announcements over the UI — the "Channels SDK is live" banner
in the screenshots — and posts to `https://telemetry.copilotkit.ai/ingest`.
`COPILOTKIT_TELEMETRY_DISABLED=true` stops the telemetry. The announcement
overlay persisted despite `showDevConsole={false}`; it comes from
`@copilotkit/web-inspector` and I didn't find the switch. Worth knowing before
demoing this to anyone.

**Docs lag the API.** The published quickstart shows
`copilotRuntimeNextJSAppRouterEndpoint`, which still exists but is the v1 path;
v2 is Hono-based (`createCopilotHonoHandler`, with `createCopilotEndpoint`
already deprecated in favour of it). The label key the docs imply
(`initialAssistantMessage`) isn't real either — it's `welcomeMessageText`.
Reading the shipped `.d.mts` files was faster than the docs.

## Not a CopilotKit problem

`bun run build` used to fail while prerendering `/_global-error` with a null
`useContext`. **The assistant-ui frontend failed identically**, which acquitted
CopilotKit — but the conclusion drawn from that, "it's a Next 16 issue", was
wrong. The real cause is a `NODE_ENV=development` leaking from the shell into a
production build. Each cell's `build` script now pins `NODE_ENV=production` and
this one compiles clean; `/api/copilotkit` stays dynamic, which is correct for a
route that proxies a stream. See the root README's Known gaps for the full
correction.
