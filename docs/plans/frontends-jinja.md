# Plan: `frontends/jinja` — a server-rendered monolith cell

*Written 2026-08-17 for a workflow of agents to execute. Every contract in §3
is fixed on purpose so that parallel lanes build against the same thing; change
a contract here first, then in code.*

## 1. What this cell is for

The four existing cells are React apps that receive an event stream in the
browser and render it there. This cell inverts that: **one FastAPI process runs
the agent, keeps the history, and renders every piece of HTML the browser ever
shows** — Jinja templates, streamed to the page as DOM patches while a run is in
flight, and rendered whole on reload. The browser holds no state beyond the DOM.

It deliberately does not fit the matrix. The agent is in-process, so it can't be
pointed at another backend and `?backend=` is ignored. What it's for is a
different question than the other cells answer: *what does a good chat UI cost
when there is no chat framework at all — just FastAPI, Jinja, your agent, and as
little JavaScript as gets the job done?* The comparison is still meaningful
because the agent, the tools, and the scripted model are byte-for-byte the
reference ones, so what's on screen differs only by rendering approach.

Things it should demonstrate that the other four don't:

- **Reload resumes the thread.** `GET /t/{id}` renders the stored history. Free
  here; no other cell does it.
- **A thread list.** Server-rendered from the store. Free here; nowhere else.
- **Works with JavaScript off.** The composer is a real form; without the
  ~40 lines of JS a POST runs to completion and redirects — same templates.
- **The generic-tool floor is visible.** Unknown tools render as name + JSON, not
  nothing.

## 2. Decisions (locked)

| Decision | Choice | Why |
|---|---|---|
| Location / port | `frontends/jinja`, `:3005`, in `FRONTENDS` | the frontend approach is what's being compared; run.sh/setup.sh grow a 4-line uv branch mirroring the backends loop |
| Agent | verbatim copy of `backends/pydantic-ai/app/{agent,scripted,store}.py` | same work as every other cell; a `diff` proves it (pi tracks `scripted.py` the same way, in TS) |
| Also serves | `/health`, `/chat`, `/ag-ui`, `/threads`, `/threads/{id}`, `DELETE` — one-liners copied from `backends/pydantic-ai/app/main.py` | `conformance.sh :3005` becomes the correctness gate for the embedded agent; `/chat` diff vs `:8001` proves identity |
| Event source | `VercelAIAdapter(agent, run_input, sdk_version=7).run_stream(message_history=store.history(id), on_complete=persist)` | in-process, no socket; same `*Chunk` vocabulary every other cell renders; leaves an httpx `?backend=` seam for later (out of scope) |
| History | server-authoritative: the request carries only the new user message; the store supplies the rest | the pi model, arrived at naturally — the browser has no history to send |
| Persistence | `on_complete → store.save(id, result.all_messages())`; nothing saved on stop/disconnect | identical to the reference backend |
| Client mechanism | `fetch(POST)` → NDJSON DOM patches (§3.2); ~40 lines JS in `templates/app.js` served by `GET /app.js` (Jinja-rendered) | client is a dumb patcher; server owns all markup and state transitions |
| No-JS path | POST without `Accept: application/x-ndjson` → run to completion → `303 → /t/{id}` | classic PRG, same templates, zero extra rendering code |
| Markdown | `markdown-it-py`, server-side, `html=False` (default) | untrusted model text; safe by default |
| Styling | hand-written `static/app.css`, light/dark via `prefers-color-scheme`, the hub's idiom | no build step; must screenshot well next to the other four |
| Rehydration | `VercelAIAdapter.dump_messages(store.history(id))` → merge consecutive assistant `UIMessage`s → same templates | one template path for live and stored |
| Deps | `fastapi`, `uvicorn[standard]`, `jinja2`, `python-multipart`, `markdown-it-py`, `pydantic-ai[ui,ag-ui]==2.31.0` | pin pydantic-ai to the reference's version so the copied files import unchanged |
| Not doing | `?backend=` support, hosting, HITL approval, attachments, single-file packaging | scope; single-file is a packaging choice that can be made at the end if wanted, not an architecture |

## 3. Contracts

### 3.1 Files

```
frontends/jinja/
  pyproject.toml            name "frontend-jinja"; [tool.uv] package = false
  README.md                 what it is, how to run, Layout table, Ergonomics notes (§7)
  NOTES.md                  scratch: every agent appends friction notes here; distilled into README then deleted
  app/__init__.py
  app/agent.py              ← byte-identical to backends/pydantic-ai/app/agent.py
  app/scripted.py           ← byte-identical
  app/store.py              ← byte-identical
  app/main.py               FastAPI app, routes (§3.4), Jinja env, static mount
  app/views.py              view models (§3.3) + from_ui_messages()
  app/stream.py             one turn: build run_input, run_stream, chunk → patches (§3.5); the no-JS drain
  app/html.py               render(name, **ctx) -> str, patch(...) -> bytes, markdown(text) -> Markup
  templates/base.html       shell: head, header/badge, sidebar, {% block main %}, <script src="/app.js">
  templates/thread.html     transcript (turns → partials), suggestions when empty, composer
  templates/app.js          the client (§3.6) — a Jinja template served as text/javascript
  templates/partials/message_user.html
  templates/partials/message_assistant.html
  templates/partials/part_text.html
  templates/partials/part_reasoning.html
  templates/partials/part_tool.html          dispatch by name → one of:
  templates/partials/tool_get_weather.html   (named for the tool: `tool_<name>.html`)
  templates/partials/tool_search_notes.html
  templates/partials/tool_analyze.html
  templates/partials/tool_generic.html       the fallback when no file matches
  templates/partials/composer.html           state idle | busy
  templates/partials/suggestions.html
  templates/partials/threads.html            sidebar
  static/app.css
  data/                      SQLite (gitignored, same as the reference)
```

Ownership during the parallel phase (§5): B1 owns `app/stream.py`, `app/views.py`
and the POST/fragment routes in `app/main.py`; B2 owns `templates/**/*.html` and
`static/app.css`; B3 owns `templates/app.js`. Phase A creates every file so
imports resolve.

### 3.2 The patch protocol (server → page)

`POST /t/{id}` with `Accept: application/x-ndjson` responds `200`,
`content-type: application/x-ndjson; charset=utf-8`, `cache-control: no-store`,
`x-accel-buffering: no`, body = one JSON object per line, flushed as produced:

| line | effect in the page |
|---|---|
| `{"op":"append","target":ID,"html":HTML}` | `el.insertAdjacentHTML("beforeend", HTML)` |
| `{"op":"replace","target":ID,"html":HTML}` | `el.outerHTML = HTML` — HTML's root must carry the same `id` |
| `{"op":"text","target":ID,"text":TEXT}` | `el.append(document.createTextNode(TEXT))` — for model text and tool-arg deltas; never HTML |
| `{"op":"done","url":"/t/ID"}` | run finished; client re-enables, focuses composer |
| `{"op":"error","target":ID,"html":HTML}` | same as `append`, then the client treats the stream as done |

`HTML` is always a Jinja render. Unknown `target` → the client logs and ignores.
NDJSON rather than SSE framing because JSON escapes the newlines inside text
deltas, so framing can never be ambiguous; switching to SSE later is ten lines.

### 3.3 The DOM contract (templates ⇄ JS ⇄ probes)

Every id below is stable and load-bearing. `M` = turn id, `C` = toolCallId,
`T` = text part id (all from the stream, or minted server-side for the turn).

```html
<body data-cell="jinja">
  <header data-slot="header">
    <span data-slot="badge">pydantic-ai · scripted · agent in-process</span>   <!-- from local health data, no fetch -->
    <a href="/">New chat</a> <a href="{{ index_url }}">← matrix</a>
  </header>
  <aside data-slot="threads" id="threads">   <!-- partials/threads.html; re-rendered whole by the epilogue (§3.5) -->
    <a href="/t/ID" aria-current="page|false">title <small>n</small></a> …
  </aside>
  <main>
    <section id="transcript" data-slot="transcript" role="log" aria-live="polite">
      <article class="msg" data-role="user" id="m-M"><div class="bubble">…</div></article>
      <article class="msg" data-role="assistant" id="m-M">
        <div class="parts" id="parts-M">
          <!-- streaming text -->
          <div class="text" data-part="text" id="tx-T" data-state="streaming"><pre class="raw" id="tx-T-raw"></pre></div>
          <!-- final text (replaces the above) -->
          <div class="text" data-part="text" id="tx-T" data-state="done"><p>…markdown…</p></div>
          <!-- a tool call, re-rendered whole at each state -->
          <section class="tool" data-part="tool" data-tool="get_weather" data-state="input-streaming|input-available|output-available|output-error" id="tc-C">
            <header><span class="name">get_weather</span><span class="state"></span></header>
            <pre class="args" id="args-C">…raw json as it streams…</pre>   <!-- input-streaming only -->
            …state-specific body…
          </section>
          <details class="reasoning" data-part="reasoning" id="rs-T"><summary>Reasoning</summary><pre id="rs-T-raw"></pre></details>
        </div>
      </article>
    </section>
    <div id="suggestions" data-slot="suggestions">     <!-- only when the transcript is empty -->
      <button form="composer" name="message" value="What's the weather in Tokyo?">…</button> ×3
    </div>
    <form id="composer" data-slot="composer" data-state="idle|busy" method="post" action="/t/ID">
      <textarea name="message" data-slot="input" aria-label="Message input" required></textarea>
      <button type="submit" data-slot="send" aria-label="Send">…</button>              <!-- idle only -->
      <button type="button" data-slot="stop" aria-label="Stop generating">…</button>   <!-- busy only -->
    </form>
  </main>
</body>
```

Rules: the tool's **name is visible** in the card header (the shadcn cell showed
what it costs to hide it); the Stop button exists **only** while busy (that
presence is the probes' busy tell); user text and model text reach the DOM only
via Jinja autoescape or `op:text`.

The probes adapter this contract implies (goes in `probes/frontends.ts`, phase C):

```ts
jinja: {
  composer: (p) => p.locator('textarea[data-slot="input"]'),
  stop: (p) => p.locator('button[aria-label="Stop generating"]'),
  userMessages: (p) => p.locator('[data-role="user"]'),
  assistantMessages: (p) => p.locator('[data-role="assistant"]'),
  toolCalls: (p) => p.locator('[data-part="tool"]'),
  transcript: (p) => p.locator('[data-slot="transcript"]'),
  // nothing collapses; the tool name is visible text, so toolNamed's default works
},
```

### 3.4 Routes

| Method | Path | Behaviour |
|---|---|---|
| `GET` | `/` | mint a thread id → `303 → /t/{id}` (a new-chat link is just `/`) |
| `GET` | `/t/{id}` | full page: sidebar from `store.list()`, transcript from `views.from_ui_messages(dump_messages(store.history(id)))` (unknown id → empty transcript, still valid), suggestions if empty, composer idle |
| `POST` | `/t/{id}` | form field `message`. `Accept` has `application/x-ndjson` → patch stream (§3.5). Otherwise → drain the run to completion → `303 → /t/{id}` |
| `GET` | `/t/{id}/fragments/composer` | `partials/composer.html` in idle state — the client fetches this after Stop instead of rendering anything itself |
| `GET` | `/app.js` | `templates/app.js` rendered by Jinja, `content-type: text/javascript` |
| `GET` | `/static/*` | `static/` |
| `GET` | `/health` | as reference, plus `"ui": "server-rendered"` and `"protocols"` unchanged |
| `POST` | `/chat`, `/ag-ui` | as reference — `dispatch_request` one-liners |
| `GET`/`DELETE` | `/threads`, `/threads/{id}` | as reference |

`index_url` comes from `INDEX_URL` (default `http://localhost:3000`). `PORT` is
whatever `run.sh` passes; `uv run uvicorn app.main:app --port 3005` runs it by hand.

### 3.5 Chunk → patch mapping (the live turn)

Order of operations for `POST /t/{id}` in streaming mode:

1. Immediately (before the run starts): `append transcript` ← user article;
   `replace composer` ← busy; `append transcript` ← empty assistant article
   with `parts-M`. Mint `M`.
2. Build `run_input = VercelAIAdapter.build_run_input(json.dumps({"id": id, "trigger": "submit-message", "messages": [{"id": uuid, "role": "user", "parts": [{"type": "text", "text": message}]}]}).encode())`, then
   `adapter = VercelAIAdapter(agent=agent, run_input=run_input, sdk_version=7)` and
   iterate `adapter.run_stream(message_history=store.history(id), on_complete=persist(id))`.
3. Per chunk (`from pydantic_ai.ui.vercel_ai.response_types import *`):

| chunk | patch |
|---|---|
| `StartChunk`, `StartStepChunk`, `FinishStepChunk`, `MessageMetadataChunk` | none |
| `ToolInputStartChunk(toolCallId, toolName)` | `append parts-M` ← `part_tool.html` state `input-streaming`, empty args |
| `ToolInputDeltaChunk(toolCallId, inputTextDelta)` | `text args-C` ← delta; server accumulates `args_text[C]` |
| `ToolInputAvailableChunk(toolCallId, toolName, input)` | `replace tc-C` ← state `input-available` (weather: "Looking up Tokyo…"; analyze: spinner + topic; notes: "Searching…") |
| `ToolOutputAvailableChunk(toolCallId, output)` | `replace tc-C` ← state `output-available` (the card) |
| `ToolOutputErrorChunk` / `ToolInputErrorChunk` | `replace tc-C` ← state `output-error` |
| `TextStartChunk(id)` | `append parts-M` ← `part_text.html` state `streaming` |
| `TextDeltaChunk(id, delta)` | `text tx-T-raw` ← delta; server accumulates `text[T]` |
| `TextEndChunk(id)` | `replace tx-T` ← state `done`, `markdown(text[T])` |
| `ReasoningStart/Delta/EndChunk` | mirror text into `part_reasoning.html` (`rs-T`, `rs-T-raw`) |
| `ErrorChunk(errorText)` | `error parts-M` ← error partial; then composer idle + `done` |
| `FinishChunk` / `DoneChunk` | `replace threads` ← sidebar from `store.list()` (the thread now exists / its count moved); `replace composer` ← idle; `done` |
| anything else (`Source*`, `File`, `Data`, `Abort`, approvals) | ignore, log at debug |

4. Any exception in the generator → same as `ErrorChunk`. Client disconnect →
   the generator is closed; nothing is persisted (matches the reference).
5. Multi-tool turns just append more cards; the scripted model emits two calls
   for prompts matching two plans.

The no-JS drain runs the same generator, discards patches, and redirects when it
ends — the templates and the state machine are exercised identically.

### 3.6 The client (`templates/app.js`, ~40 lines, no libraries)

- On submit of `#composer` (and Enter in the textarea; Shift+Enter newlines):
  `preventDefault`, `fetch(form.action, {method: "POST", body: new FormData(form), headers: {Accept: "application/x-ndjson"}, signal})`.
- Read `response.body` with `TextDecoder("utf-8", {stream: true})`, split on
  `\n`, `JSON.parse` each complete line, apply per §3.2. Autoscroll the
  transcript when the user was already near the bottom.
- Stop button (`[data-slot="stop"]`, present only while busy — bind by event
  delegation on the form since it's swapped in): `controller.abort()`, then
  `fetch("/t/ID/fragments/composer")` → `replace` the composer. No markup is
  written by the client.
- Suggestion buttons submit the form natively (`form=` + `name/value`), so they
  work with and without JS.
- Jinja-parameterized: nothing, as built — the fragment URL is derived from the
  current composer's `action` (`form.action + "/fragments/composer"`), so the
  file is thread-agnostic; it is still a Jinja template served by `GET /app.js`. Served
  with `cache-control: no-store` in dev.

### 3.7 View models (`app/views.py`)

```python
@dataclass class TextView:  id: str; text: str; done: bool                # html = markdown(text) when done
@dataclass class ToolView:  call_id: str; name: str; state: str; args_text: str = ""; input: dict | None = None; output: Any = None; error: str | None = None
@dataclass class ReasoningView: id: str; text: str; done: bool
@dataclass class Turn:      id: str; role: Literal["user","assistant"]; parts: list[TextView | ToolView | ReasoningView]

def from_ui_messages(messages: Sequence[UIMessage]) -> list[Turn]:
    """Merge consecutive assistant UIMessages into one Turn — /threads/{id} returns
    the tool part and the text part of one turn as two assistant messages."""
```

`ToolUIPart.state` values are already `input-streaming | input-available |
output-available | output-error`; a stored thread only ever holds the last two.
Templates take a `part` view and dispatch on `part.state`; the live path builds
the same views incrementally and renders the same templates.

## 4. Verification — what "done" means

Run these before calling any phase done; report the output, not a summary.

```sh
cd frontends/jinja && uv sync && uv run uvicorn app.main:app --port 3005          # starts
./protocol/conformance.sh http://localhost:3005                                   # green, same count as :8001
diff <(cd backends/pydantic-ai && cat app/agent.py app/scripted.py app/store.py app/models.py) \
     <(cd frontends/jinja      && cat app/agent.py app/scripted.py app/store.py app/models.py)  # empty
# stream identity, ids aside:
for p in 8001 3005; do curl -sN -X POST localhost:$p/chat -H 'content-type: application/json' \
  -d '{"id":"diff-'$p'","trigger":"submit-message","messages":[{"id":"m1","role":"user","parts":[{"type":"text","text":"What is the weather in Tokyo?"}]}]}' \
  | sed -E 's/"id":"[^"]+"//g; s/"timestamp":"[^"]+"//g' > /tmp/s$p; done; diff /tmp/s8001 /tmp/s3005      # empty
# streaming actually streams (patches arrive progressively, not at the end):
curl -sN -X POST localhost:3005/t/probe -H 'accept: application/x-ndjson' -d 'message=Analyze assistant-ui' | while read -r l; do date +%T.%N | cut -c1-12; done | uniq -c
# no-JS path:
curl -si -X POST localhost:3005/t/nojs -d 'message=What is the weather in Tokyo?' | head -3     # 303 → /t/nojs
curl -s localhost:3005/t/nojs | grep -c 'data-role="user"'                                       # 1
# probes (after the adapter exists; matrix must be up):
./scripts/probe.sh --grep jinja                       # weather, notes, analyze, follow-up green; resume: see §6
```

Then **look at the rendered result** — screenshots from the probe run under
`probes/artifacts/**/*--jinja.png` are read as images by the reviewing agent and
by Michael; a passing build is not evidence the UI is right. Check specifically:
the in-flight `analyze` capture shows a spinner and a Stop button (with the
topic once `input-available` has arrived — the harness captures ~13 ms in, so
either in-flight state is acceptable); the `notes` capture shows note cards not JSON; the `weather` capture
shows the tool name; the after-reload state shows the thread intact (the `resume` flow fails before
its own capture, so this one is taken by hand).

## 5. Work breakdown for the workflow

Phases run in order; lanes inside B run in parallel against §3. Every agent
appends friction to `frontends/jinja/NOTES.md` as it goes (one line per thing,
with the file it touched) — that file becomes the Ergonomics notes.

| Phase | Agent / model | Does | Done when |
|---|---|---|---|
| **A** skeleton | 1 × Opus | project + deps; verbatim copies; protocol routes + `/health`; Jinja env, static mount, `/app.js` route serving an empty template; every file in §3.1 exists (templates as stubs that render); `GET /` → 303 → `/t/{id}` renders base+thread with the sidebar; **spike**: `POST /t/{id}` streams three hard-coded patches with `asyncio.sleep(0.5)` between them, verified with `curl -N` to arrive progressively (this proves uvicorn flushes and settles the response headers before B starts); `views.py` dataclasses + `from_ui_messages` complete with the merge | conformance green on `:3005`; diff empty; spike shows 3 timestamps ≥0.5s apart |
| **B1** stream engine | 1 × Opus | `stream.py` per §3.5, both modes of `POST /t/{id}`, `fragments/composer`, persistence, error paths, `done` | `curl -N` on the weather prompt yields the exact sequence in §3.5 (targets/ops), progressively; no-JS POST → 303 and the thread renders; multi-tool prompt works; a thrown exception mid-run yields `error` + idle composer |
| **B2** templates + CSS | 1 × Opus (load the `frontend-design` skill first) | all partials in all states per §3.3, `base.html`, `thread.html`, `app.css`, light/dark, sidebar, suggestions, composer states, streaming caret on raw text, spinner for analyze, note cards with tag chips, generic tool card; **fixture-driven**: writes `scripts/render_fixtures.py` that renders every partial in every state to `.fixtures/*.html` from hand-built view models, and screenshots them with Playwright (probes has it) so template work is checkable without the stream | fixtures render without Jinja errors; screenshots reviewed by the agent and attached to NOTES.md; visual quality on par with the hub and the shadcn cell |
| **B3** client | 1 × Sonnet | `templates/app.js` per §3.6; a tiny standalone HTML page in `.fixtures/` that fakes a patch stream (`ReadableStream` from an array with delays) to test apply/abort/autoscroll without the server | apply/abort/autoscroll verified on the fake stream; ≤ 60 lines; no library |
| **C** integrate + verify | 1 × Opus | wire B1–B3, run the cell, add the `jinja` adapter to `probes/frontends.ts` (**and** the `"jinja:3005"` line to `scripts/stacks.sh` in the same change — an entry without an adapter fails the whole probe run, and vice versa an adapter without an entry is inert), run §4 in full, read the screenshots, fix until green | §4 passes; four flows green; resume divergence recorded (§6); screenshots checked as images |
| **D** harness | 1 × Sonnet | `run.sh` + `setup.sh` uv branch for frontends; `index/index.html` CELLS card (`id:"jinja", name:"FastAPI + Jinja", port:3005, protocol:"none — agent in-process", topology:"browser → Python (monolith)"`); `.gitignore` for `frontends/jinja/data/` and `.fixtures/` if not already covered | `./scripts/run.sh` starts and health-checks it; the hub card goes green; `./scripts/stop.sh` stops it |
| **E** docs | 1 × Opus | `frontends/jinja/README.md` (what/why, run, Layout table, **Ergonomics notes** distilled from NOTES.md then delete NOTES.md); README.md cell-table row + a short paragraph in "What's here" saying plainly this cell is outside the matrix and why it's here; `docs/architecture.md` a paragraph after "Adding to the matrix" — the monolith as the shape the axes were designed to avoid, included on purpose | prose in the repo's register; every claim in the notes is something the agent actually hit |
| **F** independent review | 1 × Opus, fresh context | read this plan and only this plan; run §4 from scratch; try: Stop mid-`analyze` then reload; JS disabled in Playwright (`javaScriptEnabled: false`) send a message; two tabs on one thread; a prompt matching two tools; a 2 KB message; report every discrepancy from §3 with file:line | a findings list; C's agent (or the coordinator) fixes and re-verifies |

Sequencing: A → (B1 ‖ B2 ‖ B3) → C → (D ‖ E) → F → fix round. Nine agents plus
fix rounds, under the size guideline. B lanes never edit each other's files;
anything cross-cutting is a contract change here first.

Model notes: A, B1, C, F carry the subtle parts (streaming, cancellation, the
merge, verification honesty) — Opus. B2 is a design lane where quality is the
point — Opus with the design skill. B3 and D are mechanical against a precise
spec — Sonnet is adequate.

## 6. Coordination — this tree is shared

Other sessions are active in this worktree (hosting: `chat-demo-hosting`;
pi-rpc; see `git status` — uncommitted edits in `scripts/`, `index/`, `README.md`,
`docs/`, `protocol/`). Rules for this work:

- Everything in `frontends/jinja/` is ours and conflict-free. Build there first.
- Shared files we touch, each once, as late as possible, after re-reading the
  file on disk: `scripts/stacks.sh`, `scripts/run.sh`, `scripts/setup.sh`,
  `index/index.html`, `probes/frontends.ts`, `README.md`, `docs/architecture.md`,
  `.gitignore`. Message the owning session before editing; stage only our hunks
  (`git add -p`); never `git add -A`.
- **`probes/flows.yaml` is not ours to change.** The `resume` flow asserts
  `expect 0 user messages`; this cell resumes, so it will fail that flow — the
  README says to read that failure as the feature landing. Message the flows
  owner with the finding and two candidate encodings: (a) an adapter capability
  `resumes: true` plus a grammar sentence that resolves against it, or (b) a
  gated flow variant. Until decided, report resume as "fails by design, screenshots
  show the thread intact".
- The hosting session's `PROBE_PORT_OFFSET` maps every `FRONTENDS` entry by
  offset; this cell isn't in the hosted subset, so their preview run will look
  for `:4005` and miss. Tell them; the fix (skip cells absent from `hosted.sh`)
  is theirs.
- Ports: backends are `8001–8004`, frontends `3001–3004`, hosted preview
  `4000–4004`. `3005` is free as of writing; re-check `stacks.sh` before D.
- Commits: conventional, our paths only — `feat(frontend): jinja — the reference
  agent server-rendered from one FastAPI process`, then `docs:` / `feat(probes):`
  as separate commits so lanes stay separable.

## 7. Ergonomics notes to capture (prompts, not answers)

Written while it's fresh, in the cell's README, same section title as the others.
Things to be honest about, whichever way they fall:

- Lines and packages: `wc -l` of new Python / templates / CSS / JS, and `uv pip
  list | wc -l`, next to the other cells' numbers.
- What the 40 lines of JS actually had to know. Was there anything the client
  couldn't stay ignorant of?
- The two-messages-per-turn merge, and where else the wire shape leaked into
  templates.
- Streaming raw text then swapping rendered markdown: how it looked mid-stream;
  whether the swap is visible.
- What Stop feels like when the server owns state — and that nothing persists,
  same as the reference.
- Reload/resume and the thread list: how much code, versus what the other four
  didn't do.
- The no-JS path: did it just work, and what did it cost.
- Anything uvicorn/StreamingResponse did with buffering or cancellation that
  surprised.
- The moment, if it came, when "most logic on the server" got awkward.

## 8. Risks

| Risk | Mitigation |
|---|---|
| uvicorn/Starlette buffers or delays chunks | phase A spike with `curl -N` before anything depends on it |
| Multibyte characters split across chunks | `TextDecoder(…,{stream:true})` on the client; server encodes whole JSON lines |
| A patch targets an id that doesn't exist yet (ordering) | the assistant shell is appended before the run starts; tool/text parts append to `parts-M`; ids come from the chunks |
| Two assistant `UIMessage`s per turn double the count on reload | `from_ui_messages` merges consecutive assistant messages — verified by `follow-up`-then-reload counts |
| Model text or tool args injected as HTML | only `op:text` and Jinja autoescape ever carry them; `markdown-it-py` with `html=False` |
| Enter-to-send needs JS | acceptable — no-JS users click Send; document it |
| Copied agent drifts from the reference | the diff in §4 runs in phase C and F, and is named in the README as the maintenance cost |
| `resume` probe fails | by design; §6 |
| Cancellation leaves a card mid-state | acceptable and honest; the composer is restored via the fragment route |
