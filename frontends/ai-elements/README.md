# Frontend: Vercel AI Elements

Next.js + [AI Elements](https://elements.ai-sdk.dev) 1.9.0, talking to a backend
over the Vercel AI data stream protocol (AI SDK v7). Same protocol as the
assistant-ui cell, same topology — the browser posts straight to Python — so the
only variable between those two is the UI library.

```sh
bun install
bun run dev          # :3003, or PORT=3004 bun run dev
```

`NEXT_PUBLIC_BACKEND_URL` in `.env.local` decides which backend it talks to.
There is no proxy route and no server-side glue to update.

## What's wired

AI Elements is a shadcn registry rather than a library: `bunx ai-elements@latest
add <name>` writes `.tsx` files into `components/ai-elements/` and you own them
from that point on. This cell was built with

```sh
bunx ai-elements@1.9.0 add conversation message prompt-input tool suggestion \
  shimmer reasoning sources inline-citation chain-of-thought code-block
```

which is 11 element files (~3,700 lines) plus 25 shadcn primitives (~1,670
lines) that they depend on.

| Component | What it does here |
|---|---|
| `Conversation` | scroll container, stick-to-bottom, empty state, scroll-to-latest button |
| `Message` / `MessageContent` | user bubble vs assistant column |
| `MessageResponse` | markdown via Streamdown — code highlighting, mermaid, math, incomplete-markdown repair |
| `MessageActions` / `MessageToolbar` | copy, and regenerate on the last turn |
| `PromptInput` | textarea, Enter-to-send, submit button that becomes a stop button mid-stream |
| `Tool` | named tool card with a status badge, parameters, and result |
| `Suggestions` | one prompt per comparison axis |
| `Shimmer` | the gap between "sent" and "first token" |
| `Reasoning`, `Sources` | wired, but this backend never feeds them — see below |

Client wiring is AI SDK v7 direct:

```tsx
const transport = new DefaultChatTransport({ api: `${BACKEND}/chat` });
const { messages, sendMessage, status, stop, regenerate } = useChat({ transport });
```

No Next.js API route, and no model-provider dependency — nothing here knows what
an OpenAI key is.

## Ergonomics notes

**The glue is a `switch` over message parts.** `app/page.tsx` is ~320 lines, and
about 200 of those are the render: iterate `message.parts`, map `text` →
`MessageResponse`, `reasoning` → `Reasoning`, `isToolUIPart(part)` → `Tool`,
`source-*` → `Sources`. AI Elements gives you presentational components and
hands you the AI SDK's data model unmediated; there is no runtime object in
between that knows how to render a message. That is more code than assistant-ui
(where `<Thread />` owns the loop) and it is also the reason the tool rendering
below was a two-line decision rather than a hunt for a config key.

**`Suggestions` and `Actions` are inert on their own.** They're buttons. You
supply `onClick={(text) => sendMessage({ text })}` and
`onClick={() => regenerate()}` yourself. assistant-ui's `Suggestions([...])` is
runtime-aware config; here the component knows nothing about the chat. Less
magic, more typing, and the wiring is obvious when you read it.

**Tool calls render better than either of the other two, once you pass one
prop.** `<Tool>` is a collapsible and the registry's own examples leave it
closed, which lands in the same place assistant-ui does. With `defaultOpen` you
get, inline: the tool name, a status badge that moves `Pending → Running →
Completed`, the arguments as syntax-highlighted JSON, and the result as
syntax-highlighted JSON. Compare that against assistant-ui's `1 tool call ›` —
which doesn't name the tool — and against CopilotKit, which renders nothing at
all until you register a renderer. The ceiling and the floor are both a single
prop apart.

**`ToolInput` crashes on a real stream.** Between `tool-input-start` and the
first `tool-input-delta` the part has no `input`, `ToolInput` calls
`JSON.stringify(undefined)`, and `CodeBlock` then calls `.split` on `undefined`.
Runtime `TypeError`, error overlay, page gone. It doesn't reproduce against the
registry's examples because those pass a finished object; it reproduces
immediately against any backend that emits `tool-input-start`, which
`protocol/CONTRACT.md` requires. Guarded at the call site in `ToolCall`, and the
guard is useful in its own right — a `Shimmer` reading "Streaming arguments…"
makes the delta phase legible instead of blank.

**Latency shows up in two places.** The `analyze` tool's ~3s sleep renders as a
`Running` badge with a pulsing clock on the tool card, with the arguments
already visible above it, plus a `Shimmer` line below for the message that
hasn't started. You can see what is being waited on, not just that something is.

**The CLI needs its arguments named.** `bunx ai-elements@1.9.0 --help` does not
print help — it installs all 73 components and pulls in `@xyflow/react`,
`@rive-app/react-webgl2`, `media-chrome`, `shiki`, `mermaid` and friends. That's
the documented no-argument behaviour applied to an unrecognised flag. Naming
components explicitly cut it to 29 files, and the difference in dependency
weight is not small.

**Two registries disagree about what exists.** The CLI resolves against
`elements.ai-sdk.dev/api/registry/`, the docs link `registry.ai-sdk.dev`, and
they aren't the same set: `loader` is a 200 on one and a 404 on the other, which
fails the whole `add` command rather than skipping the item. `shimmer` covers
the same need.

**Component names moved and the docs in circulation haven't.** `Response` and
`Actions` no longer exist as registry items; they're `MessageResponse` and
`MessageActions`/`MessageAction`, exported from `message.tsx`. Every example
importing `@/components/ai-elements/response` is stale. Reading the registry
JSON was faster than reading the docs.

**Version pinning bit here too, in the same shape CopilotKit did.**
`@streamdown/code` depends on `shiki@^3`, and the CLI added `shiki@^4` to the
app's own dependencies. Two copies, two different `BundledLanguage` unions, and
`tsc` refuses the plugin object that `message.tsx` and `reasoning.tsx` both pass
to Streamdown:

```
Type '"actionscript"' is not assignable to type 'BundledLanguage'.
```

Pinning the app to `shiki@^3.23.0` dedupes it. Expect this class of failure
whenever a registry writes source files that import a package the registry also
version-ranges independently.

**Dependency weight sits between the other two.** 477 resolved packages against
assistant-ui's 356 and CopilotKit's 1,325 (`bun pm ls --all`). Most of the
difference from assistant-ui is Streamdown's markdown stack — shiki, mermaid,
katex — which you get whether or not the model emits code.

**Wide tool results scroll rather than wrap.** `search_notes` returns note
bodies long enough to run off the right edge of the result block. The container
is `overflow-x-auto`, so it's usable, but a list of records is exactly the case
where the generative-UI axis wants a card component instead of a JSON dump —
which AI Elements supports (`ToolOutput` takes a `ReactNode`) and this cell
deliberately doesn't do, because the point is to compare defaults.

## Inert components

Three of the installed components have nothing to show, and the reason is the
backend, not the library. The default `scripted` model emits text and tool calls
and nothing else.

`Reasoning` and `Sources` are wired anyway, because there are real
`UIMessagePart` types behind them (`reasoning`, `source-url`,
`source-document`) and the mapping is the idiomatic one — they simply never
fire. Point this cell at `DEMO_MODEL=anthropic:claude-opus-5` and `Reasoning`
starts rendering.

`ChainOfThought` and `InlineCitation` are installed and not imported. Neither
has a `UIMessagePart` behind it; they're for agents that publish their own step
structure or citation spans, which means feeding them from this backend would
mean inventing data. They're on disk so the comparison can see what the registry
offers, and left unrendered rather than faked.

## Not an AI Elements problem

`bun run build` fails during prerender with `Cannot read properties of null
(reading 'useRef')` — the same null-React-internals failure the other two
frontends hit while prerendering `/_global-error`, surfacing here on `/`
instead. It's the Next 16 issue already in the root README's Known gaps. All
three run fine under `next dev`, which is all the harness uses.
