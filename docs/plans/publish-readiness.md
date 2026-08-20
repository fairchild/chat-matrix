# Publish readiness

Item 7 of [`open-work.md`](open-work.md) is one command away from public, and the
command is not mine to run. This is what a `./scripts/publish.sh` today would do,
what the gate says about it, and the two things that are true about the hosted
build that aren't true locally. Decide from this page — the two caveats and the
third exposure below them have since been decided, and what was chosen is under
[Decided](#decided--2026-08-20); the caveat sections are kept as the reasoning
that led there.

Gate ran on **`10105b8`** (branch `demo`), against the preview built by
`scripts/preview.sh` on `:4000`–`:4004` with `PREVIEW_BACKEND=http://localhost:8002`.

## What would go out

Six workers on the `irons-in-the-fire8698` subdomain, names from each
`wrangler.jsonc`, URLs from `production_url()` in `scripts/hosted.sh`. Status
re-checked 2026-08-18 — the backend routes only its own paths, so `/` 404s there
and `/health` is the liveness probe:

| worker | URL | today |
|---|---|---|
| `chat-stack-backend-cloudflare-agents` | `…workers.dev/health` | **200**, `model: scripted`, 31 threads |
| `chat-stack-index` | `…workers.dev/` | 404 — never deployed |
| `chat-stack-assistant-ui` | `…workers.dev/` | 404 |
| `chat-stack-copilotkit` | `…workers.dev/` | 404 |
| `chat-stack-ai-elements` | `…workers.dev/` | 404 |
| `chat-stack-shadcn` | `…workers.dev/` | 404 |

So publishing redeploys one live worker (the backend, Durable Objects `Thread` +
`Registry`, whose stored threads survive) and creates five.

## The gate

`PROBE_PORT_OFFSET=1000 ./scripts/probe.sh` — 20 flows across the four hosted
cells against the preview, exit 0:

```
  backend cloudflare-agents → http://localhost:8002
  -   1 matrix.spec.ts:21:10 › jinja · not in HOSTED_CELLS (scripts/hosted.sh)
  1 skipped
  20 passed (50.1s)
```

The skip is the design: `jinja` is a Python process, not a static export, so it
is outside `HOSTED_CELLS` and there is nothing at `:4005` to photograph. This
run predates `528aa3a`: it was keyed by the backend's `/health` name alone, so
it overwrote the local matrix's `cloudflare-agents` captures. A preview run now
lands under `cloudflare-agents-preview` with `preview: true` in its manifest and
a captioned band in the gallery, so the two builds sit side by side and the
gallery says which is which.

## Caveat 1 — hosted CopilotKit ignores `?backend=`

`safeBackend` (`frontends/copilotkit/lib/runtime.ts:12`) returns the fallback
unless the requested URL is `http:` on `localhost`/`127.0.0.1`. The browser sends
the hub's choice as `x-demo-backend` (`app/providers.tsx:23`) and the runtime
reads it per request, so locally the picker works. In production the fallback is
`--var BACKEND_URL:<production backend>` from `publish.sh`, every header value is
a public `https:` URL, and the choice is silently dropped. The preview can't show
this — its backend is `http://localhost:8002`, which passes.

Given the hosted subset ships exactly one backend, the behaviour is right, and
the hub already agrees with it: under `HOSTED` a non-hosted backend is never
probed and its square renders as an inert `local` span with no link
(`localOnly` and the square renderer in `index/index.html`), so nothing the hub
offers is silently dropped. What remains is a hand-edited `?backend=` on the
hosted CopilotKit page, which `safeBackend` ignores without saying so.
Recommendation: accept it — the root README already states it. Alternative if
the choice should be real in production: allow the header when its origin is in
an allowlist built from `HOSTED`.

## Caveat 2 — `/threads` is public and unscoped

`GET /threads` (`backends/cloudflare-agents/src/index.ts:69`) returns
`registry.list()`, which is `select id, title, created_at, updated_at,
message_count from threads order by updated_at desc`
(`src/registry.ts:66`) — no scoping of any kind, `access-control-allow-origin: *`,
and `title` is the thread's first user message. `GET /threads/{id}` then renders
the full history. Verified live against the deployed backend today: 200, all 31
summaries, first row `"What's the weather in Tokyo?"`. Those 31 are ours, which
is why it looks harmless right now.

Publishing the cells turns that into every visitor reading every other visitor's
prompts. Recommendation: keep the demo honest and cheap — have the hub label the
thread list as shared and public, and gate the bulk route behind an env flag
(`if (env.PUBLIC_THREAD_LIST !== "1") return json({threads: []}, 200)` at
`index.ts:69`, set for local, unset in production) so `/threads/{id}` still
resumes a thread you already hold the id for. Scoping properly means an identity
the demo doesn't have.

## Also, before it's public

The hub ships two dead cards. `build_index` (`scripts/hosted.sh`) writes exactly
one file into `index/dist/`, but `index.html` links `golden.html` and
`monolith.html` and those embed `golden-check.gif` / `jinja-cell.gif`. On the
running preview all four are 404 while `/` is 200. Either copy them in
`build_index` (dereference the two gif symlinks; 4.0 MB largest) or gate the
`PAGES` list on `HOSTED`. Second-order: `index/monolith.html:337,345` points at
`http://localhost:3005` and `index/golden.html:179` mentions `localhost:8002`.
As of the evening of 2026-08-18 the copy is being taken inside the
ergonomics-notes task (`backlog/doing/surface-ergonomics-notes-plan.md`), whose
`build_index` change also generates the notes pages — re-run the gate once that
lands, since it changes what `index/dist/` holds.

Landed in `7fce311`, and generically: `build_index` copies every `*.html` beside
`index.html` and `cp -L`s every `*.gif`, so a fifth page needs nothing here. Of
the second-order leaks, one was real and is fixed — `monolith.html`'s footer
linked `http://localhost:3005`, a live anchor that dies on a public URL, and now
reads as plain text saying where the cell runs and why it's the one square the
hosted matrix can't publish. The other two stand: `monolith.html:337` is alt
text *describing* a recording made at `:3005`, which is what the recording is;
`golden.html:179` is a shell command inside a "Run it" block, which is an
instruction for a local clone on either host.

## Decided — 2026-08-20

All three exposures are now closed in code, and closed the same way: bound to a
var whose default is the locked one, so `wrangler deploy` reading the committed
config ships the safe shape and the unlock is something a local run carries
rather than something a publish has to remember. `bun run dev` passes
`--var PUBLIC_THREAD_LIST:1 --var PUBLIC_MODEL_SWITCH:1`; the deployed Worker
gets neither.

**`GET /threads`** returns `{"threads": [], "detail": …}` in the published
shape — empty *and* saying why, because "no threads yet" and "this deployment
doesn't publish them" are different facts and a bare `[]` can't tell them apart.
`GET /threads/{id}` still serves a thread whose id you hold, which is as much
scoping as a demo without identity can honestly do, and `/health` still reports
the count: it's the titles that are the exposure, not the number.

**`POST /model`** is `403` with the same kind of reason, and `GET /models`
carries `locked: true` and a `why` alongside the full catalogue. The hub reads
that and renders the column's control as a fixed chip — same text, no arrow, no
dimming, the reason on hover and in its `aria-label`. This is the honest version
of Caveat 1 too: the published grid now states the one model it runs instead of
drawing a control that would be dropped.

**The token question.** Worth being exact, since it's the reason to care: the
deployed Worker has no provider secret (`wrangler secret list` → `[]`), and
`unavailable()` in `src/models.ts` refuses any model whose binding is absent. So
a stranger could not have spent a provider token even before this change — the
switch was already gated on credentials that aren't there. What the lock adds is
that a key arriving later, for whatever reason, doesn't silently turn the public
grid into a spend surface. Cloudflare request volume is the remaining meter, and
it's the free tier's to cap.

**What this costs.** A conformance run against the published backend can no
longer see its own thread in the list. `protocol/conformance.sh` now skips that
one assertion — but only when the backend states a reason, and it prints the
backend's words when it does; an unexplained empty list still fails. Verified
both ways against a locked and an unlocked `wrangler dev`, and against the
reference backend, which is untouched at 21/21. The thread having persisted is
still proven either way by the two rehydrate checks right after it, which fetch
it by id.

## The command, and after

```sh
./scripts/publish.sh          # build_all production, then six wrangler deploys
```

It prints a `→ deploy <label>` line per worker with wrangler's output filtered to
upload/deploy/error lines, then a `published` block listing the backend, the four
cells and the index URL. `wrangler whoami` is already an OAuth token on the right
account; it is missing the `challenge-widgets.write` scope, which nothing here
uses — if a deploy stops on auth, `bunx wrangler login` and re-run.

Afterwards, the checks are the five URLs in the table returning 200 (plus
`/health` on the backend), and the hub loading with all four squares live. A
probe run can't be pointed at production — `probe.sh` resolves cells by
`localhost:PORT+offset`, so there is no offset that reaches `workers.dev`. What
can be checked without new tooling: `curl` each URL, and a Playwright pass over
the five production pages like `docs/recordings/` already does — same flows, but
that would need `frontends.ts` to take a base URL per cell, which is a change,
not a run.
