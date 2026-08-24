# Frontend: FastAPI + Jinja

One process runs the reference agent, keeps the history, and renders every piece
of HTML the browser ever sees — Jinja templates streamed to the page as DOM
patches while a run is in flight, and rendered whole on reload. The browser holds
no state beyond the DOM.

This cell sits outside the matrix and doesn't pretend otherwise: the agent runs
here, in this process, so `?backend=` is ignored and there is nothing to point
somewhere else. It's here for a question the axes can't ask — *what does a good
chat UI cost when there is no chat framework at all, just FastAPI, Jinja, your
agent, and as little JavaScript as gets the job done?* The comparison still
holds where it matters: the agent, its three tools and the scripted model are
the reference ones, copied rather than reimplemented, so what's on screen
differs from the other four only by rendering approach.

```sh
uv sync
uv run uvicorn app.main:app --port 3005
```

| Env | Default | |
|---|---|---|
| `DEMO_MODEL` | `scripted` | any pydantic-ai model string, e.g. `anthropic:claude-opus-5` |
| `DEMO_DB` | `data/threads.db` | SQLite thread store |
| `INDEX_URL` | `http://localhost:3000` | where the "← matrix" link points |

## How it works

`POST /t/{id}` with `Accept: application/x-ndjson` answers with one JSON object
per line, flushed as produced, each one an instruction to change a single
element. Five ops cover the entire UI:

| op | effect in the page |
|---|---|
| `append` | `el.insertAdjacentHTML("beforeend", html)` — a new part joins the turn |
| `replace` | `el.outerHTML = html` — a part re-rendered whole because its state changed |
| `text` | `el.append(document.createTextNode(text))` — model tokens and tool-argument JSON, never markup |
| `done` | the run ended; the client re-enables and focuses the composer |
| `error` | append an error partial, then treat the stream as finished |

`html` is always a Jinja render of the same partial the full page uses, so there
is exactly one description of what a tool card looks like. NDJSON rather than SSE
framing because JSON escapes the newlines inside a text delta, which makes a line
break unambiguously a frame boundary.

Without JavaScript the same POST arrives without that header, the same generator
runs to completion with its patches discarded, and the response is a `303` back
to the thread. Post/redirect/get through identical templates and an identical
state machine — the no-JS path is `async for _ in self.patches(): pass`.

`GET /t/{id}` renders `VercelAIAdapter.dump_messages(store.history(id))` through
`views.from_ui_messages`, which merges consecutive assistant messages: the store
returns one turn as two of them, the tool part and then the text part. A reloaded
thread is one `Turn` per exchange, built from the same four dataclasses the live
stream fills in incrementally, so no template ever learns which path it came
from.

`/health`, `/chat`, `/ag-ui`, `/threads` and `/threads/{id}` are the reference
backend's routes, which is what makes `./protocol/conformance.sh
http://localhost:3005` a real gate on the embedded agent rather than a claim
about it. The agent came over as a verbatim copy, held to the original by a
`diff` rather than by good intentions:

```sh
diff <(cd backends/pydantic-ai && cat app/agent.py app/scripted.py app/store.py app/models.py) \
     <(cd frontends/jinja      && cat app/agent.py app/scripted.py app/store.py app/models.py)
```

That `diff` is this cell's standing maintenance cost, and it fired on day one:
between this cell's first commit and its next, the reference grew a model
picker — a new `app/models.py`, `current_model()` / `use_model()` on
`agent.py`, and `GET /models` + `POST /model` in `main.py` — so the copy was
re-synced (a fourth file now rides along) and the two routes are mirrored here,
which is what keeps `/health`'s `model` honest when someone switches it. The
plan named this cost when it chose copying over importing; the price is one
`diff` and a copy per reference change, and the payoff is that the agent under
this UI is provably the one under the other four.

## Layout

| File | |
|---|---|
| `pyproject.toml` | six direct dependencies; pydantic-ai pinned to the reference's version so the copies import unchanged |
| `app/agent.py` | the reference agent and its three tools — verbatim copy |
| `app/scripted.py` | the deterministic model — verbatim copy |
| `app/store.py` | thread persistence — verbatim copy |
| `app/main.py` | the HTTP surface: the chat routes, and the reference backend's protocol routes |
| `app/stream.py` | one turn as a stream of patches — the chunk → patch match, and the no-JS drain |
| `app/views.py` | what the templates see: `TextView`, `ReasoningView`, `ToolView`, `Turn`, and the rehydration merge |
| `app/html.py` | the Jinja environment, the markdown filter, and `patch()` — every byte of markup passes through here |
| `templates/base.html` | shell: header, badge, thread sidebar, `<script src="/app.js" defer>` |
| `templates/thread.html` | transcript, composer, empty state |
| `templates/app.js` | the whole client, 62 lines, no libraries |
| `templates/partials/message_user.html` | the user bubble |
| `templates/partials/message_assistant.html` | the assistant article and its `parts-{id}` container |
| `templates/partials/part_text.html` | model text: raw `<pre>` while streaming, rendered markdown when done |
| `templates/partials/part_reasoning.html` | a `<details>`, open while it streams |
| `templates/partials/part_tool.html` | the tool card and its header; dispatches the body by tool name |
| `templates/partials/tool_get_weather.html` | temperature, city, conditions, a humidity bar |
| `templates/partials/tool_search_notes.html` | note cards with tag chips |
| `templates/partials/tool_analyze.html` | spinner with the topic, then the analysis |
| `templates/partials/tool_generic.html` | the floor for a tool nobody wrote a card for: name, input, output |
| `templates/partials/composer.html` | idle and busy — the Stop button exists only in the busy render |
| `templates/partials/suggestions.html` | three prompts, one per comparison axis |
| `templates/partials/threads.html` | the sidebar, server-rendered from `store.list()` |
| `templates/partials/error.html` | one line, one `role="alert"` |
| `static/app.css` | hand-written, light/dark via `prefers-color-scheme`, no build step |
| `scripts/render_fixtures.py` | renders every partial in every state to `.fixtures/` and screenshots them, without the server |
| `data/` | the SQLite file, gitignored, same as the reference |

## Ergonomics notes

The axis this cell is being judged on, recorded while it was fresh.

**The weight is in the CSS, not the framework.** New Python is 673 lines —
`main.py` 251, `stream.py` 231, `views.py` 105, `html.py` 86 — on top of the 543
copied verbatim from the reference backend. Templates are 195 lines across 15
files, the client is 62, and `static/app.css` is 834 — more than the Python and
the client put together. That's what it costs to sit next to four React cells with no design
system underneath: the framework you skip is not the work you skip, it just moves
into a stylesheet you own. Six direct dependencies resolve to 106 packages
(`uv pip list`), against 356 for assistant-ui, 477 for AI Elements, 529 for
shadcn and 1,325 for CopilotKit — a Python venv's distributions and a bun
dependency tree aren't the same unit, so read the shape rather than the ratio.
Most of the 106 is pydantic-ai and its transitive pydantic/httpx world, which
this cell would need to run the agent anyway; Jinja, markdown-it-py and
python-multipart are three of them.

**What the 62 lines of JavaScript had to know turned out to be almost nothing.**
It knows the five ops, that `id`s address elements, and that the transcript
scrolls. The one thing it looked like it needed was the thread id, for the
composer fragment it fetches after Stop — and that was already in the DOM as
`document.getElementById("composer").action`, so `/app.js` is thread-agnostic and
could be a static file tomorrow. (It was written against a `{{ thread_id }}`
nothing passed, which rendered empty and sent the Stop-restore fetch to
`/t//fragments/composer`; deriving it from the form was the fix, and the better
one.) The single real coupling that did show up was the Stop button's event
delegation: matching `event.target.dataset.slot` only fires when the click lands
exactly on the button, so an icon-only Stop needed
`#composer button svg { pointer-events: none }` in someone else's file to work at
all. `closest('[data-slot="stop"]')` finds the button from any descendant and
that CSS rule stopped being load-bearing. Worth naming because it's the shape of
coupling this design invites: anything the client knows beyond ids and ops
surfaces as a rule in a file the client doesn't own. The two lines that took the
client from 60 to 62 came out of that same seam: Enter in the busy textarea
started a second `run()` that nulled the first one's controller, leaving Stop
inert, so `run()` now returns early while a controller exists and the `finally`
clears only its own (`if (controller === mine)`) — with `readonly` on the busy
textarea keeping Enter out of it in the first place.

**Reload resumes the thread and the sidebar lists every thread, and neither
needed much.** The page route is two lines, because the store is already in the
process and `dump_messages` already renders history into the same `UIMessage`s
the live stream produces; the sidebar is a 16-line partial over `store.list()`.
The real work is the back half of `views.py` — about fifty lines turning stored
messages into the view models the live path builds directly, the merge included.
None of the other four cells does either — not because it's hard there, but
because the history lives behind a fetch and the client would need a second code
path to mount it. Here there is only one path, and the live one is the special
case. This is the clearest thing the monolith buys, and it cost
nothing that wasn't already sitting in the process.

The thread list is server state too, so the turn patches it: the epilogue emits
`replace threads` — the whole `<aside>` re-rendered from `store.list()` — just
before the composer goes idle, which is late enough to see the turn the run just
saved. The tab that ran the turn watches its thread appear, or its message count
move, without a reload. A second tab on the same thread holds no open stream and
catches up only when you reload it: patches ride the POST response and there is
no push channel, which is a choice rather than an omission — a monolith could
grow one, and this cell is about what the simple version already covers.

**Stop is instant, and the turn is gone.** The client aborts the fetch and asks
for `/t/{id}/fragments/composer`, so the idle composer is a server render like
everything else and the client still writes no markup. Starlette closes the
generator, the agent run is cancelled with it, `on_complete` never fires, nothing
persists — same as the reference backend, verified with a `timeout 0.8 curl` mid
`analyze` and a 404 from `/threads/{id}` four seconds later. What you're left
looking at is a card frozen mid-state: a spinner that will never resolve, which
is an honest picture of what happened. A reload mid-stream is the same event
seen from the other side — the browser drops the connection, the generator
closes, and nothing is written — so afterwards neither the question nor the
answer is on the page. Reloading 500 ms into a run leaves an empty thread and a
404 from `/threads/{id}`.

**Streaming raw text and then swapping in rendered markdown is visible exactly
once, and only if you know to look.** Mid-stream you see the model's literal
markdown, asterisks and all — `**get_weather** returned:` — inside a
`<pre class="raw">` that resets padding, border and background and inherits the
body font, so at `TextEndChunk` the only thing that changes is the markup under
it. The first CSS draft let the markdown `pre` rule reach `.raw`, which put
streaming text in a code block that vanished when the rendered version replaced
it; that swap was jarring enough to see from across the room, and the fix was a
six-declaration reset. Server-side markdown also means no incomplete-markdown repair
and no streaming parser: a fence stays open on screen until the model closes it.

**The wire shape reaches the templates in three places.** A stored `ToolUIPart`
has no `tool_name` — the name lives in `part.type` as `tool-<name>`, and the
adapter itself does `type.removeprefix('tool-')`, so `views.py` does too. One
turn comes back from the store as two assistant `UIMessage`s, which is the merge
above. And `part.input` is `None` between `input-streaming` and
`input-available`, so every tool template guards with
`{% set city = part.input.city if part.input is mapping else none %}` —
truthiness isn't enough, since `part.input.city if part.input` still explodes on
a string. That's the same optional-input idiom the shadcn cell inherited from
its template as `part.input?.city` and the same point where AI Elements crashes
against a real stream; here it's that guard written out once per tool template,
which is the honest version of "no framework": the sharp edge is yours to
remember. A fourth leak isn't the wire but the store — the sidebar slices the
ISO string (`t.updated_at[5:10]`), because the Jinja environment has no date
filter.

**The generic tool floor is free, and it's a floor rather than a hole.** An
unknown tool renders its name in the card header and its input and output as
formatted JSON, because `part_tool.html` dispatches by name with
`tool_generic.html` as the fallback — twelve lines, written once. The shadcn
cell's floor is a `default: return null`, which renders nothing at all, and
about 150 lines to get off it. Nothing here is generative UI in the interesting
sense; it's just that when the dispatch is a dict lookup in a template, having a
default costs a line.

**The no-JS path needed no code, and cost four small concessions elsewhere.**
Same route, same generator, same templates, one `303` at the end. What it cost is
spread around: the suggestion buttons carry `formnovalidate`, because they're
external submitters for a form whose `<textarea required>` is empty and the
browser blocks the submit before any handler sees it (they were dead in *both*
paths until that landed); the busy textarea is `readonly` rather than `disabled`,
since a disabled control greys out and can't hold focus, and `readonly` is barred
from constraint validation so `required` stays honest; the composer sits before
the suggestions in the DOM with CSS `order` putting them back (see below); and
`<noscript><style>.hint-js { display: none }</style></noscript>` hides the "Enter
sends" hint, because the server can't detect JavaScript and the page has to tell
itself.

**Every route answers in whichever shape the caller asked for, including the
boring ones.** An empty or whitespace-only submission gets a single
`{"op":"done"}` line when the client asked for patches, and a `303` when it
didn't, because a client mid-`fetch` can do nothing useful with a redirect to an
HTML page. Thread ids get the same treatment from the other direction —
`urlencode` in every `action` and `href`, `quote()` in every redirect — since an
id arrives from the URL and goes straight back out into markup. Ids are
`token_urlsafe`, so only a crafted URL ever reaches that code.

**The one moment "most logic on the server" got awkward was the DOM order of the
composer.** With `formnovalidate` in place, a suggestion click posts `message`
twice — once from the button, once from the empty textarea — and Starlette's
`FormData` is last-wins (`self._dict = {k: v for k, v in _items}`), so the empty
value won and `Form(...)` returned a 422. Form-associated controls are ordered by
tree order rather than by where the `<form>` element sits, so the composer moved
*above* the suggestions in the markup and `order: 2` / `order: 3` put them back
visually. Button before textarea → 422; button after → 303, verified live. None
of that is Jinja's or FastAPI's doing. It's what you inherit when the browser's
own form semantics are the transport: rules that predate the app, aren't written
down in one place, and only bite where two mechanisms overlap. The trade is that
there is no client-side state machine to get wrong instead.

**Two turns on one thread used to race, and the store is where it showed.**
`on_complete` saves `result.all_messages()`, so a second run that read its
history before the first one saved wrote a history with no first turn in it —
the store kept whichever run finished last, three messages where there should
have been six. A per-thread `asyncio.Lock` in `main.py` serialises runs on one
thread now, and the queued turn's prologue still goes out immediately, so the
waiting tab shows its own user bubble and a busy composer while the run ahead of
it finishes. `store.py` is byte-identical to the reference's, which has the same
race and no lock; what differs is that two tabs on one thread are a first-class
case here — the thread has a URL, so of course someone opens it twice. The lock
dict holds one entry per thread id ever posted to and never evicts them, which
is nothing at demo scale and a slow leak if it ran for months.

**uvicorn and `StreamingResponse` flushed every yield with no tuning.** The
phase-A spike sent three patches half a second apart and they arrived half a
second apart on the first attempt; `x-accel-buffering: no` is set for proxies and
did nothing locally. Cancellation is the same mechanism from the other end — a
disconnected client closes the generator, which cancels the run, which means
there is no completion callback to write anything. Both behaviours were checked
before anything depended on them, which is the only reason they're a sentence
here instead of a section.

**Templates are checkable without a stream, which is the compensation for having
no component tests.** `scripts/render_fixtures.py` builds view models by hand,
renders every partial in every state to `.fixtures/*.html`, and screenshots them
through the Playwright already in `probes/` — `screenshot({ animations:
"disabled" })` parks the caret and the spinner at their first frame, so the
captures are deterministic. The cost is that a fixture opens over `file://`,
where `/static/app.css` and `/app.js` don't resolve: the script rewrites the
stylesheet href and drops the script tag, so a fixture is evidence about markup
and CSS and no evidence at all about anything the client touches.

## Probes

All five flows are green. `resume` was the exception for a while: the flow
asserted `expect 0 user messages` after a reload, written when nothing
rehydrated and meant to fail loudly the day something did, and this cell was
that day. It now asks each cell to match its own declaration — this adapter
says `resumes: true` in `probes/frontends.ts`, and `expect the history to
resume as the cell declares` holds it to that in both directions: a declaring
cell must put the thread back, a silent one must come back empty. The
`after-reload` capture exists as a result, so the gallery's `resume` row shows
the thread surviving here and an empty transcript everywhere else; the `/t/{id}`
page and the `follow-up` flow show the same thing from other angles.

Two framing notes for anyone reading the gallery. `capture` is a viewport
screenshot of an autoscrolled transcript, so on long transcripts it frames the
tail — `follow-up/two-turns--jinja.png` shows one user bubble because the second
turn is taller than the viewport, and shadcn's capture does the same thing;
that's the harness, not the cell. And the `analyze` in-flight capture can land in
either of two states, because "wait for the tool call" resolves the instant the
card appears: `input-streaming`, which lasts about 70ms and shows arguments
streaming under a spinner, or `input-available`, which lasts the full ~3s and
reads "Analyzing assistant-ui as a chat frontend…". Both were made to read as
work in progress for exactly this reason; the current artifact caught the second.

## Using it in another FastAPI app

The cell was built to be looked at, not imported, but four seams make it usable
from a host app without forking it. What follows is what works today, verified
against a second instance run from the same source.

```python
from app.main import ui, protocol, mount_static   # protocol optional
from app.stream import Turn                        # Turn(agent=your_agent, ...)

host = FastAPI()
host.include_router(ui)      # the chat: GET /t/{id}, POST /t/{id}, /app.js
mount_static(host)           # the stylesheet, from this package's static/
```

**The agent is a parameter.** `Turn` takes an `agent` field defaulting to the
packaged one, and it's the only place the agent is read, so a host app's agent
answers by passing it — no import rewiring.

**Templates are overridable by name.** `CHAT_TEMPLATES=/path/to/templates` is
searched before the packaged directory, so a host app replaces `base.html` for
its own chrome, or any partial, by putting a file with the same name there.
Everything it doesn't override still resolves to the packaged copy.

**Tool cards are found by convention.** `partials/tool_<tool name>.html` if it
exists, `partials/tool_generic.html` otherwise — so a host app's own tool gets
its own card by adding a file. This is why the three cards here are named
`tool_get_weather.html`, `tool_search_notes.html` and `tool_analyze.html`: the
filename is the tool name, and the mapping that used to be a dict in `part_tool.html` is gone.

**The client is already prefix-agnostic.** `app.js` derives every URL from the
composer form's `action`, so it doesn't hard-code where the chat lives.

### What's still in the way

These are the changes worth making if the goal shifts from "readable cell" to
"reusable component"; none is done here.

**Mounting under a prefix.** `include_router(ui)` works at the root only.
`base.html` hard-codes `/static/app.css`, `/app.js` and `/`, and
`composer.html`, `threads.html`, `_thread_url` and `Turn.url` hard-code `/t/`.
A `prefix` Jinja global plus the same value in those two Python helpers would
cover it — about eight edits, and the client needs nothing because it reads
`form.action`.

**The store and the agent are module globals.** `main.py` builds one
`ThreadStore` at import from `DEMO_DB`, and the routes close over it. A host app
with its own persistence has no seam. The shape that fixes it is a
`create_ui(store, agent, suggestions) -> APIRouter` factory, which is a real
refactor of `main.py` rather than an edit.

**It isn't a package.** `pyproject.toml` sets `package = false` because the cell
is run, not installed. Installing it means a build backend, and
`templates/`+`static/` declared as package data so `html.py`'s
`Path(__file__).parent.parent` still resolves from site-packages.

**The chrome is the demo's.** `base.html` carries the "← matrix" crumb, the cell
name and the model badge, and `SUGGESTIONS` in `main.py` is three prompts about
this repo. Overridable per above, but the defaults assume this harness.

## Not implemented

**`?backend=`.** The agent is in-process, so the hub's backend choice arrives as
a query parameter this cell ignores. The seam is real — an httpx client where the
adapter is now — and deliberately out of scope, since a cell that could be
pointed elsewhere would be answering the matrix's question rather than this one.

**Hosting.** Not in `scripts/hosted.sh`. The hosted subset is static exports plus
one Worker; this is a Python process with a SQLite file.

**Human-in-the-loop approval.** Not in the reference agent, so not here.

**Attachments.** The composer takes text.

**Reasoning is wired and has never rendered.** `part_reasoning.html` and the
three `Reasoning*Chunk` cases in `stream.py` exist and work against a fixture;
the scripted model emits no reasoning parts, so outside `.fixtures/` nothing has
ever shown one.
