# Frontend: shadcn chatbot-template

Next.js + [shadcn/ui](https://ui.shadcn.com), [shadcn/react](https://ui.shadcn.com/docs/react/message-scroller)
and [shadcn/typeset](https://ui.shadcn.com/docs/typeset), adapted from
[shadcn-ui/chatbot-template](https://github.com/shadcn-ui/chatbot-template) and
talking to a backend over the Vercel AI data stream protocol (AI SDK v7).

Third cell on that protocol with that topology — the browser posts straight to
Python — so against assistant-ui and AI Elements the only variable is the UI.

```sh
bun install
bun run dev          # :3004, or PORT=3005 bun run dev
```

`NEXT_PUBLIC_BACKEND_URL` in `.env.local` decides which backend it talks to.

## What came out of the template

The template is a whole app that owns its model: an `/api/chat` route calling
`streamText` through the Vercel AI Gateway, a model picker in the composer, and
three tools defined in TypeScript. Every one of those is a variable the harness
pins somewhere else, so onboarding was mostly deletion.

| Removed | Because |
|---|---|
| `app/api/chat/route.ts` | a frontend that owns a model client can't be compared against one that doesn't |
| `lib/models.ts`, `components/model-select.tsx` | the model is the control variable — `DEMO_MODEL` on the backend, not a per-request field |
| `tools/` | tools live in the backend; `lib/messages.ts` declares their wire shape instead |
| `@ai-sdk/gateway`, `@ai-sdk/anthropic`, `@ai-sdk/openai` | nothing here should know what an API key is |
| `AI_GATEWAY_API_KEY` | ditto — this cell needs no credentials |

What replaced all of it is one transport:

```tsx
const transport = new DefaultChatTransport<ChatUIMessage>({ api: `${BACKEND}/chat` })
const { messages, sendMessage, status, stop, error } = useChat<ChatUIMessage>({ transport })
```

The template's own structure survived intact — `Chat`, `ChatMessage`,
`PromptForm`, `Suggestions`, `MessageScroller` are unchanged in shape. What was
Gateway-specific stayed confined to the route, the models file and the picker,
which is the useful signal for anyone else starting from this template.

## What's wired

| Component | What it does here |
|---|---|
| `MessageScroller` | scroll container with per-message anchoring, stick-to-bottom, scroll-down button |
| `Message` / `Bubble` | assistant column vs user bubble |
| `TextPart` | markdown via react-markdown + remark-gfm, styled by shadcn/typeset |
| `PromptForm` | `InputGroup` textarea, Enter-to-send, send button that becomes stop mid-stream |
| `WeatherPart`, `NotesPart`, `AnalyzePart` | one component per reference tool — see below |
| `Suggestions` | one prompt per comparison axis |
| `SourcesPart` | wired, but this backend never feeds it |

## Ergonomics notes

**A component per tool is the whole tool-call story.** `chat-message.tsx` is a
switch over part types ending in `default: return null`, so a tool with no case
renders *nothing* — no name, no spinner, no result. That is the same floor
CopilotKit has, and getting off it costs about 150 lines here. But the template
makes the ceiling the default path rather than an upgrade: all three components
it ships are per-tool cards, so writing one per reference tool follows the grain
instead of opting into extra work. Set against AI Elements — where a single
`<Tool defaultOpen>` renders any tool as syntax-highlighted JSON — this is the
generative-UI axis with both ends visible. The generic renderer costs one prop
and shows you a JSON blob. The specific renderer costs a component and shows you
a card, and can't show you anything at all about a tool you didn't anticipate.

**The card drops the tool's name, and that cost only showed up under a probe.**
The weather card reads "Tokyo · crisp and sunny" and never says `get_weather`
anywhere on screen. That's the right call for a reader — the answer is the
point, not the machinery — but it means this is the one cell where you cannot
tell which tool produced a result by looking at it. assistant-ui hides the name
behind a disclosure; AI Elements puts it in the card header; here it exists only
as the `data-tool` attribute. `probes/` found this the hard way: its flow
sentence *"expect a tool call for get_weather"* resolved by matching the tool
name as visible text, which works on the other three and cannot work here, so
adapters grew a `toolNamed` override. A grammar written against three UIs
turning out to encode an assumption about all of them is the kind of thing only
a fourth stack surfaces, which is most of the argument for the matrix.

**The optional-input idiom is already in the template.** `part.input?.city`,
not `part.input.city`, because between `tool-input-start` and the first
`tool-input-delta` the part has no input yet. AI Elements crashes at exactly
this point against exactly this backend. Nothing here documents why the `?.` is
load-bearing — it's just how the shipped components are written — so copying
their shape got it right without knowing there was something to get right. That
is worth more than it sounds: the failure is invisible against a mock and
immediate against a real stream.

**Losing the API route loses the type inference with it.** The template gets its
message type from `InferUITools<typeof tools>`, which needs the tool definitions
in the same process. With the tools in Python there is nothing to infer from, so
`lib/messages.ts` hand-declares `{ get_weather, search_notes, analyze }` and
their input/output shapes. The switch stays exhaustively typed and the cards get
real field types, but the frontend now holds a copy of the contract that nothing
checks against `protocol/CONTRACT.md`. That's the honest price of the
frontend-as-pure-client rule, and the first thing to generate rather than write
if this pattern spreads.

**Markdown is react-markdown, not a streaming renderer.** No incomplete-markdown
repair, no code highlighting, no mermaid or math — shadcn/typeset styles the
output, it doesn't parse it. Against the scripted model, which emits a paragraph
and a bullet list, the difference from AI Elements' Streamdown is invisible.
Against a real model mid-code-block you see the raw fence until it closes. It's
also most of why this cell resolves 529 packages to AI Elements' 477.

**The card makes the prose redundant, which is the argument for cards.** The
scripted reply restates each tool result in text — `search_notes returned:
[Note(title='Streaming protocols', body=…)]` — and that shows up in every cell.
Next to three rendered note cards it reads as duplication rather than as the
answer, which is the clearest in-situ case for backend-driven UI the matrix has
produced so far. It's an argument about where the rendering should happen, and
you can only see it once something else is rendering it properly.

**Latency has somewhere to go.** `analyze` sleeps ~3s and `AnalyzePart` spends
it showing "Analyzing assistant-ui as a chat frontend" against a spinner — the
topic is on screen because the arguments arrived before the result did. The
template's own `status === "submitted"` shimmer covers the earlier gap, before
any part exists. Two different waits, two different components, neither of them
a bare spinner.

**The tool cards carry `data-tool`, and that attribute is mine.** shadcn/ui
ships `data-slot` on every primitive — `input-group-control`, `message`,
`bubble`, `item` — which is as much as `probes/` needs for the composer and the
transcript. It can't tell one tool card from another, though, because the cards
aren't primitives; they're the three components in `components/parts/`. So each
one tags its root with `data-tool="<name>"` in every state. Reading that
attribute as evidence about shadcn would be reading my own handwriting.

**Base UI, not Radix.** `@base-ui/react` underneath, which means `render={<a />}`
where the other cells write `asChild`, and `nativeButton={false}` on a button
that renders as a link. Same visual vocabulary as any other shadcn/ui app, a
different composition idiom — worth knowing before moving a component between
this cell and the AI Elements one, which ships Radix primitives.

**529 resolved packages** (`bun pm ls --all`), against assistant-ui's 356, AI
Elements' 477 and CopilotKit's 1,325. eslint and its config were dropped on the
way in — no other cell has them and the harness has no lint step — so that
number is comparable to the others rather than to the upstream template.

**Same Next 16 build failure as everything else here.** `bun run build` dies
prerendering `/_global-error` with `Cannot read properties of null (reading
'useContext')`. Identical to the assistant-ui and CopilotKit cells, unrelated to
anything shadcn. `next dev` is fine, which is all the harness runs.

## Inert components

`components/ui/questionnaire.tsx` is on disk and unimported. The template's
headline feature is a human-in-the-loop `ask_user` tool that streams a question
to the client and resumes once the user answers a rendered form — genuinely the
most interesting thing in the template, and it needs a backend tool that asks.
The reference agent has three tools and none of them ask anything, so wiring it
would mean inventing data. Left in place so the comparison can see what the
template offers, rather than faked. `SourcesPart` is in the same position with a
better excuse: `source-url` is a real `UIMessagePart` type, so it's wired and
simply never fires.

## Not implemented

No thread rehydration. `useChat` mints a fresh id per mount and this cell never
reads `GET /threads/{id}`, so a reload starts over — same as the assistant-ui
and AI Elements cells. "New Chat" is a link to `/`, which is the template's
answer and happens to be the right one here.
