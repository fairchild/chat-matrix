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
  shimmer reasoning sources inline-citation chain-of-thought code-block attachments
```

which is 12 element files plus 25 shadcn primitives that they depend on.

| Component | What it does here |
|---|---|
| `Conversation` | scroll container, stick-to-bottom, empty state, scroll-to-latest button |
| `Message` / `MessageContent` | user bubble vs assistant column |
| `MessageResponse` | markdown via Streamdown — code highlighting, mermaid, math, incomplete-markdown repair |
| `MessageActions` / `MessageToolbar` | copy, and regenerate on the last turn |
| `PromptInput` | textarea, Enter-to-send, submit button that becomes a stop button mid-stream |
| `Attachments` | staged files in the composer, sent files in the transcript |
| `Tool` | named tool card with a status badge, parameters, and result |
| `Suggestions` | one prompt per comparison axis |
| `Shimmer` | the gap between "sent" and "first token" |
| `Reasoning` | collapsible thought trace — renders whenever the stream carries one |
| `Sources` | wired, but this backend never feeds it — see below |

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

**Attachments are the one place the library does real work for you.**
`PromptInput` owns the whole staging lifecycle — file dialog, drag-and-drop
anywhere on the page (`globalDrop`), clipboard paste, `accept` / `maxFiles` /
`maxFileSize` validation, blob URLs revoked on unmount, and blob→data-URL
conversion on submit so what reaches the wire is self-contained. The composer
strip is ~15 lines against `usePromptInputAttachments()`, and `sendMessage({
text, files })` does the rest. Verified on the wire: a message with two files
posts `['file', 'file', 'text']` with both `url`s as `data:` URIs.

Watch the version here. AI Elements 1.9.0 removed the `PromptInputAttachments` /
`PromptInputAttachment` wrappers that the published chatbot example still
imports from `prompt-input`; they're now the separate `attachments` registry
item plus the hook. Importing what the docs show fails to resolve.

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

## Reasoning

`Reasoning` is wired to the `reasoning` part type and works: given a stream
carrying `reasoning-start` / `reasoning-delta` / `reasoning-end`, it renders a
`Thought for N seconds` disclosure that auto-opens while the trace streams,
auto-closes a second after it ends, and expands on click to the full text above
the answer. Verified against a stream carrying those chunks, not inferred from
the wiring.

What it does **not** get is data from this repo's default backend. The
`scripted` model emits text and tool calls only, so on `./scripts/run.sh` the
disclosure never appears. Two ways to see it:

```sh
DEMO_MODEL=anthropic:claude-opus-5 ./scripts/run.sh   # a model that actually reasons
```

or teach `scripted` to emit a `ThinkingPart` before it picks a tool — which
would light `Reasoning` up in every cell at once and give the matrix a
reasoning-rendering axis it currently has no probe for. That's a backend change
and it isn't made here.

## Inert components

`Sources` is wired to `source-url` / `source-document` for the same reason
`Reasoning` is — real part types, idiomatic mapping, no data behind them from
this backend.

`ChainOfThought` and `InlineCitation` are installed and not imported. Neither
has a `UIMessagePart` behind it; they're for agents that publish their own step
structure or citation spans, which means feeding them from this backend would
mean inventing data. They're on disk so the comparison can see what the registry
offers, and left unrendered rather than faked.

## A backend gap attachments expose

Files reach the backend intact — `/chat` accepts them and answers — but
**attaching a file turns off the scripted model's tool selection**.
`backends/pydantic-ai/app/scripted.py` reads the prompt with

```python
if isinstance(part, UserPromptPart) and isinstance(part.content, str):
    return part.content
```

and attachments make `content` a list of `str | BinaryContent`, so the guard
fails, the keyword match sees `""`, and every prompt falls through to the canned
intro. "What's the weather in Tokyo?" calls `get_weather` on its own and doesn't
once a file rides along. Nothing about it is specific to this frontend — any
cell that grows attachments will hit it — and the fix is in `backends/`.

## Not an AI Elements problem

`bun run build` used to fail during prerender with `Cannot read properties of
null (reading 'useRef')` — the same null-React-internals failure the other cells
hit, surfacing here on `/` rather than `/_global-error`. That the failing page
and hook moved around was the clue nobody followed: it isn't a component, it's
the RSC and SSR layers resolving different React builds, caused by a
`NODE_ENV=development` leaking from the shell into a production build. The
`build` script now pins `NODE_ENV=production` and this cell compiles clean,
fully static. See the root README's Known gaps.
