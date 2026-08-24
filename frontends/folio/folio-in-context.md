# Folio in context

*Written 2026-08-23, before this cell existed, as the brief for building it and
the questions to read its captures against. What the cell cost and what it
showed are in [README.md](README.md), in the Ergonomics notes like every other
stack.*

## What is being crafted

Folio is a conversation surface for working with an agent that reads, writes
and runs things, and its whole position is that the transcript should read as
a document rather than as a chat log. A turn — your message and everything the
agent did in reply — is one framed object. The agent's prose is set in a serif
at a reading measure. The tool calls it made are a ledger of quiet rows, each
a verb, a subject and a figure (`Read src/ledger.ts · 8 lines`, `Ran pnpm
vitest · 28 passed`), with the body folded away until asked for, and the turn
closes with a one-line receipt of what it cost. The masthead carries repo,
branch and title and no wordmark; the model lives in a status line that
collapses to a dot; there is no placeholder copy and no hint chrome, because
it is built for one person who knows the tool. Light and dark are designed
separately — warm paper, warm charcoal — rather than one inverted from the
other. The references are iA Writer for the page and Things for the moments
that need controls.

Two of its decisions matter more than the rest for what follows. The page
follows the turn: sending docks your message under the chrome, and a runway
after it gives back exactly the height the answer takes, so the page holds
still for the whole turn and carries you along only once the answer outgrows
it — one scroll call per turn instead of a per-token chase, and scrolling up
stops all of it. And authority stays with the host: Folio renders a control
because the host said it may, never by discovering one, so everything it draws
is a projection the host writes from its own events. The package is React 19
and AI SDK 7 as peers, two Radix primitives, one scoped stylesheet, and a
`FolioConversationPort` a host implements; hosts own identity, persistence,
transport and the agent. Folio's own `docs/design.md` holds the position and
its `README.md` the contract.

It has been refined against its own demo: nine scripted scenarios that replay
every rendering state on demand — tool bursts, a long answer, approvals,
failure, an interrupt — plus two live lanes, a model with tools the demo wrote
and a coding harness with Folio in front of it. Its best findings came from
there (the receipts *between* rows, not the rows, were what made an
eighteen-call turn dense; a test tally was being read out of any file that
happened to contain "28 passed"). It is also a host and a surface built by the
same hand, which is exactly the condition this repo's notes warn about:
agreement between things one process wrote is not evidence.

## What the matrix can show that the code can't

The matrix fixes the work and varies the surface. Three tools chosen to be
boring — a struct, a list, a three-second wait — a keyword-scripted model whose
streams are byte-identical every run and held to the reference by `golden`,
and four other chat UIs rendering the same bytes side by side. None of it was
written with Folio in mind, which is the point. The demo asks whether Folio
renders what it was designed around; the matrix asks what it does with work
that ignores its conventions, next to surfaces that made different choices
about the same bytes.

Reading `ledger.ts` tells you the rules; a probe capture tells you what the
rules produce.

**The ledger's grammar meets tools it doesn't know.** Folio's verbs are the
coding-agent vocabulary — Read, Edit, Ran, Searched — and a row's subject is
the first of eight keys a call names itself by (`file_path`, `command`,
`pattern`, `query`, …). The reference agent's tools are `get_weather(city)`,
`search_notes(query)` and `analyze(topic)`: one names a subject key, two do
not, so `search_notes` gets a subject and the other two stand as bare tool
names in the verb position. Its output convention is `{ content, summary?,
diff? }`, and a weather struct or a list of notes has no string `content`, so
by the package's own rule those rows render with no body at all. What the cell
has to write to make them say something — the projection from a typed result
into `content` — is the first measurement, and it is a number of lines as much
as an opinion.

**Streaming feel, with the other four in the same frame.** Between
`tool-input-start` and `tool-output-available` — three seconds for `analyze`,
captured mid-flight by the probe at the same moment in every cell — AI
Elements shows a card with a pulsing `Running` badge and the arguments already
in it, shadcn a spinner with the topic named, assistant-ui a collapsed
`1 tool call`, CopilotKit a status pill. Folio's answer is a row without a
figure and whatever activity line the host writes, and its principle — reveal
at the point of need — is the one most at risk of reading as *nothing is
happening* beside a pulsing badge. Whether calm reads as working or as blank
is not decidable from the source. Folio also doesn't render arguments as such;
a row's subject is the one key it reads from the input, so the delta pacing
that distinguishes `pi` from `pi-rpc` on AI Elements is invisible here by
design, which is worth seeing as a choice rather than a gap.

**Where the page looks.** Folio is the one of the four direct cells that
scrolls the document rather than a container, and its geometry assumes host
chrome (`--folio-chrome-top`) that a bare cell barely has. shadcn's
`MessageScroller` — where Folio's prop names came from — anchors per message
inside a nested viewport with follow off by default; AI Elements sticks to the
bottom; assistant-ui has its own viewport. Every probe flow records a video,
so the same stream arriving in four scroll models sits side by side. The
`weather` flow is also exactly the short-transcript case the design doc
already names as a gap: a one-line answer under a docked ask leaves most of
the page as runway with the composer parked mid-screen. And the known
ResizeObserver notice, one per streamed turn, is something a probe run can
count rather than take on faith.

**Density at the low end.** Folio's open question is what a run of forty rows
wants, measured so far at eighteen; the matrix's turns have one tool call
each, the opposite end. It can't answer the rollup question — the tool capsule
(`Read ×2 · Ran ×1`) has no work here to fold. What it can do is fix the
baseline: the same one-call turn in five cells at 1280×900, and how much of a
frame, a ledger row, a receipt and a runway one turn costs against a card. The
receipt is also a test of the "never a confident zero" rule — the wire carries
a tool count and the client can time the turn, nothing here prices tokens, so
the honest receipt is short.

**Two turns and a reload.** The `follow-up` flow frames two turns; the
`resume` flow reloads. Folio owns neither history nor transport, so the cell
holds the thread in `useChat` like the other three direct cells and comes back
empty on reload — the declaration the flow holds it to. Against the backend
axis this is the interesting seam: the two pi backends are
session-authoritative and the reference is client-authoritative, and a surface
that one day rehydrates through the port is where that divergence would show
first.

## The questions to read the captures against

For the interface being refined, the ones worth the look, in the order the
flows produce them:

1. *weather*, the tool-call capture — does the row say enough for a tool
   outside the coding vocabulary, and does the body, once projected, read as a
   result or as a JSON dump? The tool's own name in the verb position: fine,
   or a tell that the verb table wants a fallback style?
2. *analyze*, in flight — is three seconds of a bodiless row plus an activity
   line legible as work? Compare the AI Elements badge in the next column and
   decide whether calm needs one more signal.
3. *weather* and *notes*, answered — the short-transcript layout: where the
   composer sits, how much runway is empty, whether the receipt's brevity
   reads as honest or as unfinished.
4. Every flow's video — the dock on send, whether the page holds still, and
   whether a cell with almost no chrome makes the runway arithmetic look like
   dead space it never would under a host masthead.
5. *follow-up* — does the earlier frame recede as designed, and does the
   transcript read as a document at two turns the way it does at one?

Three things the matrix will not settle, said now so nobody reads the captures
for them: the tool capsule and rollups (no long run to fold), approvals (the
reference agent never asks), and reasoning (the scripted model emits none —
pick a real model at the hub and the disclosure appears, as it does in AI
Elements).

## The cell, in one paragraph

Same topology as assistant-ui, AI Elements and shadcn — the browser posts to
the backend over the Vercel AI data stream, AI SDK v7, `useChat` and
`DefaultChatTransport`, `?backend=` from the hub — so it is the fourth point
on the UI axis with everything else pinned. What it hand-writes is the host's
side of Folio's boundary: `useChat`'s typed `tool-<name>` parts become the
`dynamic-tool` parts the ledger reads, structured outputs become `content`,
`/health` fills the masthead and status line, and a turn timer fills the
receipt. That projection's size is recorded in the README beside the other
cells' numbers. Folio is consumed as the tarball its own release workflow
built from `d9bb824c` (0.4.1, sha256 `0d629b6a…`), vendored into this
directory without its sourcemaps — they embed the source, and that is Folio's
to publish — because no registry carries it while the source repository is
private. `vendor/PROVENANCE.md` has both hashes, and the swap to `^0.4.1`
from npmjs is one line when it publishes.
