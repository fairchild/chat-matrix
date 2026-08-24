# Frontend: Folio

Next.js + [`@fairchild/folio`](https://github.com/fairchild/folio), a
document-first conversation surface, talking to a backend over the Vercel AI
data stream protocol (AI SDK v7).

[`folio-in-context.md`](folio-in-context.md) is the study this cell was built to
answer — written before it existed, naming the design questions and the
projection the cell would have to write. What it cost and what it showed are the
Ergonomics notes at the bottom, like every other stack.

Fourth cell on that protocol with that topology — the browser posts straight to
Python — so against assistant-ui, AI Elements and shadcn the only variable is
the UI.

```sh
bun install
bun run dev          # :3006, or PORT=3007 bun run dev
```

`NEXT_PUBLIC_BACKEND_URL` in `.env.local` decides which backend it talks to, and
the hub's `?backend=` overrides it per visit.

## What's wired

Folio renders a projection the host writes; it never discovers state. So the
table below is really two: what the package draws, and what this cell had to
hand it.

| Folio | Fed from |
|---|---|
| `SessionMasthead` — repo · branch, title, agent · state, ◐ | `GET /health`: backend name, model, `history` |
| transcript — one framed turn per exchange, serif prose | `useChat`'s message list |
| ledger rows — verb · subject · meta, body folded away | typed `tool-<name>` parts, projected to `dynamic-tool` |
| `ActivityLine` — one breathing line while a turn runs | `status`, read off the newest part |
| `TurnStatsReceipt` — "1 tool · 3.2s" | a tool count and a client-side timer |
| `ComposeField` — Enter sends, ■ beside Send | `sendMessage`, `stop` |
| `StatusLine` — model, dismissible to a dot | `/health`'s model |
| empty note — title and hint | the three probe prompts, as text |
| `themeInitScript` + `ThemeToggle` | a blocking script in the layout head |

Nothing else. There is no thread list, no model picker, no suggestion chips, and
no header full of figures — see [Not implemented](#not-implemented) for which of
those are Folio's absence and which are this cell's decision.

## The projection

`lib/folio-projection.ts` — **177 lines, 115 without comments and blanks.** That
number is the measurement the study asked for: what it costs to put Folio in
front of a stream it was not designed around.

Most of it is a rename. Folio's ledger reads `dynamic-tool` parts and nothing
else, while `useChat` against these backends produces typed `tool-<name>` parts;
the two carry the same fields, so the projection spreads one into the other and
overwrites `type` and `toolName`.

The part that isn't a rename is the output, and it is four lines with an opinion
in them:

```ts
function asLedgerBody(output: unknown): unknown {
  return typeof output === "string"
    ? output
    : { content: JSON.stringify(output, null, 2) };
}
```

Folio's rule is that a string output is the row's body, an object needs a string
`content`, and anything else renders no body at all. `analyze` returns a string
and lands as written. `get_weather` returns a struct and `search_notes` a list,
so without those four lines two of the three reference tools would expand to
nothing — a verb, a subject, and an empty disclosure.

Stringifying is the deliberate floor. The alternative is a sentence per tool —
`Tokyo · crisp and sunny, 18°C` — which is exactly what shadcn does, and it
reads better. It is also a hand-written summary for work the cell already knows
the shape of, and a cell that wrote one would be measuring its author rather
than the surface's defaults. AI Elements dumps JSON into a generic card for the
same reason. Both numbers are therefore comparable: this is what the two stacks
do with a result nobody anticipated, and shadcn's cards are what a stack does
when someone did.

The rest of the file is the host's side of the boundary: `/health` into the
masthead and status line, a turn timer into the receipt, `metadata.author` on
every message, and the activity line's sentence.

## Folio is vendored

`vendor/fairchild-folio-0.4.1.tgz` — sha256
`0d629b6ae4e52946f10f518b133171be8492966de6c7ef21b1678f529e321c51`, 119505
bytes, built by Folio's own release workflow from commit `d9bb824c` on a clean
tree. `vendor/SHA256SUMS` and `vendor/manifest.json` are that build's own
receipts, including a per-file digest.

It is vendored because no registry carries it: Folio's source repository is
private, npmjs and GitHub Packages both 404, and there is no GitHub Release. The
tarball exists only as an Actions artifact, which needs a token and expires.
`bun install --frozen-lockfile` has to work on a fresh clone with no credentials
— CI does exactly that — so the artifact lives in the tree.

When Folio publishes, the swap is one line in `package.json`:

```diff
-    "@fairchild/folio": "file:./vendor/fairchild-folio-0.4.1.tgz",
+    "@fairchild/folio": "^0.4.1",
```

and `vendor/` goes with it.

## Ergonomics notes

**Folio's conventions are a vocabulary, and the reference agent doesn't speak
it.** The ledger's verbs are the coding-agent set — Read, Edit, Ran, Searched —
and a row's subject is the first of eight keys a call names itself by. Of the
three tools here, `search_notes(query)` hits `query` and gets a subject; the
other two name nothing on that list, so `get_weather` and `analyze` render as a
bare tool name in the verb position with an empty subject beside it. That is the
package behaving exactly as documented, and the result is legible — a row that
says `get_weather` and nothing else is still a row that says a tool ran — but it
is a different kind of legible from `Read src/ledger.ts · 8 lines`. The verb
table's fallback is the tool's own name, and that fallback is doing all the work
in this cell.

**A figure the host doesn't know is a figure the receipt doesn't show, and here
that leaves two.** `TurnStatsData` has slots for tokens, files, line deltas,
tests and cost. This stream carries a tool count and nothing else: pydantic-ai's
`/chat` emits no `message-metadata` chunk and no usage at all — checked against
the golden fixtures, not assumed — so `tokenCount` stays absent. The turn's
duration is the one figure the client can honestly produce, by timing itself
from send to finish. So every receipt in every capture reads `1 tool · N.Ns`,
which is the rule working: the alternative was a confident `0 tokens`.

**The `d` hotkey costs six lines because the hook behind the toggle is
internal.** The package exports `ThemeToggle` (the ◐ in the masthead, already
wired) and, from `/theme`, `themeInitScript`, `THEME_STORAGE_KEY` and
`resolveTheme`. It does not export `useThemeToggle`, which is the three lines
that flip `data-theme` and persist the choice. A host that wants the same flip
from a keypress rather than a click reimplements them against the two constants
that *are* exported. That is a small gap and an easy one to close; it is also the
only place in this cell where the package's public surface came up short of what
the host needed. The four React cells reach the OS scheme through `next-themes`,
which writes `.dark` on `<html>`; Folio writes `data-theme` from its own
blocking script and stores the override under `folio-theme`, so this cell has no
`next-themes` and no `ThemeProvider` — one dependency fewer and one convention
different.

**An absent callback is an absent capability, and that is worth honouring
literally.** Folio renders the ■ whenever the host passes `stopTurn`. Pass it
unconditionally and the button is permanent furniture that means nothing; a cell
doing that would also have handed `probes/` a busy tell that is never false.
This cell passes `stopTurn` only while a turn is in flight, because stopping an
idle turn is not a capability, and the button's presence is then a real signal.
The same rule is why `decideApproval`, `changeModel`, `changeTitle` and the
queue callbacks are simply absent: the reference agent never asks for approval,
the model is the harness's control variable chosen once per backend at the hub,
and there is no title and no queue. Folio draws none of them, without being told
not to.

**The masthead wants two facts this cell only has one of.** `repo` and
`agentName` are separate fields because Folio's home case is an agent working in
a repository — two different names. Here the backend is both the thing serving
the work and the thing the reply is attributed to, so both slots say
`pydantic-ai` and the masthead reads a little redundantly at wide widths. It is
the right kind of mismatch to record: the field names are a design position
about what a session *is*, and a cell that isn't a coding session pays a small
tax on it. `branch` took the model, which is the field that genuinely varies
across a column of this matrix.

**Two Radix primitives and a scoped stylesheet is a very small dependency
footprint.** `bun pm ls --all | wc -l` — the metric the other cells use:

| cell | packages |
|---|---|
| folio | **177** |
| assistant-ui | 442 |
| ai-elements | 563 |
| shadcn | 614 |
| copilotkit | 1436 |

Folio brings no Tailwind build, no markdown pipeline, no icon set and no theme
library: `styles.css` ships pre-compiled and scoped to `[data-folio-root]`, and
the host's own CSS is 91 lines including the bar. The cost is on the other side
of the ledger — no syntax highlighting, no streaming-markdown repair, no code
themes — and against the scripted model, which emits a paragraph and a list,
that difference is invisible. Against a real model mid-code-block it would not
be.

**Host chrome is two CSS variables and both are load-bearing.**
`--folio-chrome-top` is what Folio's masthead sticks below, and turn follow
measures the stack rather than assuming the masthead is the top; `--folio-min-height`
is what stops the surface asking for a whole viewport underneath a bar that
already took 34 pixels. Set the first and not the second and every page
overflows by exactly the bar. Both are documented, both are one line, and
finding them was reading the package's stylesheet rather than guessing — which
is the good version of this problem.

**`@ai-sdk/react` pins `ai` to an exact version, and a caret in the cell breaks
the build.** `@ai-sdk/react@4.0.69` depends on `ai@7.0.66` exactly. Writing
`"ai": "^7.0.56"` in this cell resolved the top level to 7.0.77 and left
`@ai-sdk/react` with a nested 7.0.66, so `DefaultChatTransport` from one copy
was not assignable to the `ChatTransport` the hook wanted from the other — a
type error whose message is four screens of structurally identical types. The
fix is `"ai": "7.0.66"`, pinned. The sibling cells don't hit it because their
lockfiles were resolved when 7.0.66 was the newest thing the caret reached; a
fresh install of any of them today would.

**Folio doesn't render arguments, and that is a choice the matrix makes
visible.** A row's subject is the one key it reads from the input, so there is
nowhere for `{"city": "Tokyo"}` to appear as arguments arriving. The delta
pacing that separates `pi` from `pi-rpc` in AI Elements — where the argument
JSON fills in character by character — is invisible here by construction, not
by omission. Worth reading as a position on what a transcript is for rather than
as a gap.

## Not implemented

Absent because the package has no slot for it:

- **Suggestion chips.** The hub gives the three probe prompts copy buttons;
  Folio has no suggestions component and deliberately no hint chrome, so they
  arrive as text in the empty note's hint. Writing chips would mean building
  furniture the design explicitly rejects.
- **A thread list, and resume on reload.** Folio owns neither history nor
  transport. The thread lives in `useChat` and a reload starts a fresh one, the
  same as the other three direct cells, which is what `probes/frontends.ts`
  holds this cell to by *not* declaring `resumes`.

Absent because the harness decided it elsewhere:

- **The model picker.** `StatusLine` grows a native `<select>` the moment a host
  supplies `models` and `onModelChange`. The model is the control variable here,
  chosen once per backend at the hub, so the status line stays the static text
  it is on Folio's own fixtures.

## Inert

- **`activeTurn.details`.** The activity line takes a hover-revealed step list.
  The ledger row directly below already says which tool is running, so filling
  it would say the same thing twice.
- **Approvals, `config-receipt`, diffs, the tool capsule.** Folio renders all
  four; nothing in the reference agent produces them. The capsule
  (`Read ×2 · Ran ×1`) needs a run long enough to fold, and every turn here has
  exactly one tool call.
- **Reasoning.** Passed through the projection, so it renders — but the scripted
  model emits none. Pick a real model at the hub and the disclosure appears.
