# Open work

What's left after the build sessions closed on 2026-08-17. There is no GitHub
remote on this repo, so this file is the tracker: one section per item, written
to be picked up cold by someone who wasn't there.

Every claim below was re-checked against the running tree on 2026-08-17, not
recalled — where a line number appears, that's where it was. Items are ordered
by how ready they are, not by how much they matter.

---

## 1. `assistant-ui · notes` asserts the tool name before expanding

**Bug · one line · ready to fix**

`probes/flows.yaml:43` asserts `expect the reply to mention "search_notes"`, and
`:44` then says `expand the tool call`. assistant-ui renders the collapsed group
as "1 tool call" and puts the tool name in the DOM only on expand, so the
assertion fails 30 seconds before the step that would make it true. Checked
directly against `:3001`: the transcript does not contain `search_notes` before
the click and does after.

Swap the two lines. Expanding earlier is a no-op for the three cells that
don't collapse, so nothing else moves.

Two things worth knowing before you call it a flake. It fails identically on the
local matrix and on the hosted preview, so it isn't a hosting artifact. And
nothing in the repo changed to cause it: the cell pins `latest` for
`@assistant-ui/*`, and `bun.lock` moved to `0.15.14` at `f66694e` — after the
"8/8 green" run that `probes/README.md` still cites. The failure dates the
install, not the code, which is an argument for pinning those four
`"latest"` entries in `frontends/assistant-ui/package.json` while you're there.

`README.md:150` already describes this cell as "a disclosure that doesn't name
the tool", so the rendering is a known property of the stack — the flow just
asserts against it in the wrong order.

---

## 2. `probe.sh`'s `set -e` skips the gallery on a red flow

**Bug · one line · ready to fix**

`scripts/probe.sh:5` is `set -euo pipefail`; `:57` runs `bunx playwright test`;
`:58` captures `status=$?` and `:62` builds the gallery with the comment "build
it even when a flow failed — a broken cell is exactly the thing you want to look
at". Under `set -e` the script never reaches either line: a red flow exits at
`:57`. The comment describes an intent the shell overrides. Reproduced today —
the full preview run ended on the failure with no gallery line printed.

`bunx playwright test "$@" || status=$?` (with `status=0` initialised) restores
the stated behaviour.

---

## 3. `resume` needs a per-adapter capability, not a global assumption

**Design · small**

`probes/flows.yaml:80` asserts `expect 0 user messages` after a reload, and the
`about` at `:85` explains why: "Currently nothing rehydrates". The jinja cell
rehydrates — it holds the thread in the same process that renders it — so that
flow is red for jinja by design, and only for jinja. Verified today: the four
React cells pass it, `jinja · resume` fails.

The suggestion on the table is an adapter capability — `resumes: true` in
`probes/frontends.ts`, with the flow asserting 0 or 1 user messages accordingly
— so the harness records the difference instead of one cell carrying a
permanent red. Whatever shape it takes, `flows.yaml:85`'s "Currently nothing
rehydrates" is now false and should move with it.

This one is a real fork: a capability flag makes the suite green and honest, but
it also makes it possible to hide a regression behind a flag someone set once.
The alternative — leave the red and document it — keeps the signal loud and
makes "all green" impossible. Pick deliberately.

---

## 4. Probe artifacts are keyed by flow, so a second backend overwrites the first

**Design · small**

`probes/matrix.spec.ts` writes captures to `artifacts/<flow>/…` and manifest
entries to `artifacts/manifest/<flow>--<frontend>.json`. Neither key includes
the backend. `PROBE_BACKEND=…` runs the same flows against a different backend
and lands on the same paths, so the gallery shows whichever backend ran last and
says so nowhere — `probes/README.md` admits this in passing.

Adding the backend to the key would make the gallery a real cross-backend diff,
which is most of what the matrix is for. The cost is that every existing
artifact path changes.

---

## 5. "cell" names two things now

**Naming decision · needs Michael · touches ~24 files**

"Cell" has meant one frontend app since the first version, when the demo was a
strip of frontends against one backend. The hub is a 4×4 table now, where a cell
is naturally a square — a frontend × backend pair. Both senses are live in one
file: `index/index.html:295` reads `HOSTED.cells[f.id]`, keyed by frontend,
while `:533` reads `const cell = el?.closest("td, th")`. `scripts/hosted.sh:14`
is `HOSTED_CELLS=(assistant-ui copilotkit ai-elements shadcn)` — four frontends.

Two defensible answers: rename the code to "frontend" and let "cell" mean a grid
square, or keep "cell" for frontends and call the square a "pair". Either is a
sweep across roughly two dozen files, which is why nobody's lane took it — it
needs the decision first.

---

## 6. The hub's default backend and the cells' default agree by convention

**Hardening · small**

`index/index.html:306` omits `?backend=` when the chosen backend is
`BACKENDS[0]`, and all four cells default to `http://localhost:8001`
(`frontends/*/lib/backend.ts:6`). Those two facts agree only because
`BACKENDS[0]` is pydantic-ai on `:8001`. Reorder the array in the hub and every
unparameterised link quietly points at the wrong backend, with nothing failing.

Always sending `?backend=` removes the joint. It costs a slightly uglier URL for
the default case.

---

## 7. Publish the cells

**The hosting arc's last step**

The backend is live —
`https://chat-stack-backend-cloudflare-agents.irons-in-the-fire8698.workers.dev/health`
returns 200. The four cells and the hub are not: `chat-stack-assistant-ui`,
`chat-stack-shadcn` and `chat-stack-index` all 404 as of today. `./scripts/publish.sh`
is the step, and `PROBE_PORT_OFFSET=1000 ./scripts/probe.sh` against
`./scripts/preview.sh` is the gate that now drives exactly the subset that would
deploy (`9ecb68a`).

Two known caveats to decide about before it's public, both already in
`README.md`: hosted CopilotKit can't be moved off its configured backend
(`safeBackend` forwards localhost only), and `/threads` on a public backend
lists every visitor's threads.

---

## 8. Two tool calls in a thread can share one `tool_call_id`

**Bug · reference agent, so every backend · small**

`backends/pydantic-ai/app/scripted.py:103` assigns
`tool_call_id=f"call_{plan.tool}_{index}"`, where `index` counts calls *within
one run*. Ask a thread for the weather in Tokyo and then in Paris, and both
stored calls are `call_get_weather_0`. Reproduced today against the scripted
model on `:3005`: `/threads/{id}?protocol=vercel-ai` comes back with two tool
parts carrying the identical `toolCallId`.

That id is the AI SDK's identity for a tool part, so any client keyed on it —
which is all of them — merges the two into one on rehydration, and the second
call's result renders against the first call's card. It shows on reload, not
during the live stream, which is why four green cells never caught it.

Seeding the counter from the thread's existing call count, or just making the id
unique per call, fixes it. The scripted file is copied verbatim into
`frontends/jinja`, so that copy moves in the same commit (the `diff` gate in
`frontends/jinja/README.md` will say so if it doesn't).

Found while recording `docs/recordings/jinja-cell.mjs`, whose header documents
the prompt chosen to steer around it rather than showcase it unlabelled.
