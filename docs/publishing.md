# Publishing

Everything except running these commands is done. This is the order to run them
in, what each one changes, how to check it worked, and what the undo actually
recovers.

Two things are true of the whole sequence and worth reading once rather than at
every step. Nothing here is reversible in the sense that matters — a public repo
can be made private again, but not un-cloned, and a deleted Worker doesn't
un-serve what it already served — so each undo line says what it gets back
rather than claiming the step never happened. And the repo's present tense has
to stay true as it goes: the README is written to be true *before* the flip, and
step 4 is the one edit that makes it true after.

The order matters in one place only: the Cloudflare deploy is independent of the
GitHub flip, but the hub's link to the repo (step 2) has to be built into the
pages the deploy publishes, so it goes in first.

## 0. Pre-flight, on `main`

The gates all run locally and none of them needs an account anywhere. Run these
from the main checkout rather than a worktree — `main` is usually checked out
somewhere else, and `run.sh`'s ports are global to the machine either way.

```sh
git switch main && git pull
git status --porcelain                       # empty
```

Then the matrix, its two contract gates, and the probes:

```sh
./scripts/run.sh
./protocol/conformance.sh http://localhost:8001    # pydantic-ai, the reference
./protocol/conformance.sh http://localhost:8002    # cloudflare-agents
./protocol/conformance.sh http://localhost:8003    # pi
./protocol/conformance.sh http://localhost:8004    # pi-rpc
./scripts/golden.sh
./scripts/probe.sh
./scripts/stop.sh
```

What each one should say. Conformance ends `N passed, 0 failed` with **no skip
line** — a skip is right for a published backend that declines to serve its bulk
thread list and wrong for any backend running locally, which is why `ci.yml`
greps for the word and fails on it. Golden covers all four backends and prints
the one recorded exception, cloudflare-agents' `finishReason`
(`protocol/golden/exceptions.json`); anything else printed is a real drift.
`probe.sh` runs every flow in `probes/flows.yaml` against every frontend in
`scripts/stacks.sh`, plus five hub tests — six cells × five flows + five, so 35
collected and **34 passed, 1 skipped, 0 failed**. The skip is structural, not a
gap: `probes/hub.spec.ts` guards "a hosted build offers only what it can serve"
with `test.skip(!isPreview(), …)`, because a local run serves the whole matrix
and withholds nothing for that assertion to catch. It prints the gallery path at
the end.

Two things that can stop this before it starts. The `pi` backends build a model
runtime at module scope and exit non-zero without a `pi` login, so a machine
that has never run `pi auth login` gets two dead backends and two conformance
runs that can't connect — the other two still gate the thing being published.
And `probe.sh` refuses to start if any cell or the hub isn't answering, naming
the URL, which is almost always `run.sh` still coming up.

CI runs here. The first run — 2026-08-20, on `main` — had all seventeen jobs
refused before their first step for account-billing reasons, and that is the
only run it ever happened to. Every run since has executed its jobs, on `main`
and on pull requests alike, with the repository private throughout: green apart
from one push cancelled by the push that superseded it and one job that failed
in a dependency-cache step. So CI green is a gate you can hold this to before
step 1, not a check that waits on it.

**Undo:** nothing to undo. `./scripts/stop.sh` is the last line for a reason —
leaving the whole matrix up makes the next step's builds slower and nothing
else.

## 1. Flip the repository public

```sh
gh repo edit fairchild/chat-matrix --visibility public --accept-visibility-change-consequences
```

The consent flag is mandatory when `--visibility` is used, and the consequences
it wants acknowledged are real ones. Every commit in the history becomes
readable, so this is the moment the audit of what's in that history has to have
already happened rather than the moment to start it — and *history*, not the
working tree, which is the distinction that makes an audit worth running. One
known instance: the vendored Folio tarball must carry no `dist/*.map`, and
because a repack is a new commit rather than an edit to an old one, the check is
over every version of that blob, not the current one:

```sh
git rev-list --all --objects -- frontends/folio/vendor \
  | awk '$2 ~ /\.tgz$/ {print $1}' | sort -u \
  | while read -r obj; do
      printf '%s maps=%s\n' "${obj:0:8}" \
        "$(git cat-file blob "$obj" | tar tz 2>/dev/null | grep -c '\.map$')"
    done
```

Every line has to end `maps=0`; a line that doesn't is a commit to rewrite
before the branch reaches `main`, not a file to fix on top of it.

Actions history and logs become readable too, and Actions minutes become free.
Forks become possible, and stars and watchers are lost.

**Verify:**

```sh
gh repo view fairchild/chat-matrix --json visibility     # {"visibility":"PUBLIC"}
gh run list -L 5                                         # the next push actually runs
```

**Undo:** `gh repo edit fairchild/chat-matrix --visibility private
--accept-visibility-change-consequences` closes the door and nothing more.
Clones, forks and search-engine caches made while it was open stay made, and
public forks detach from the network rather than following it back.

## 2. Point the hub at the repo

`19c3d2b` reverted a one-line change for a stated reason — the repo existed but
was private, and the hub's nav plus its three doc references would have 404'd
for every visitor who wasn't the owner. Step 1 removes the reason, so this is
the revert of a revert:

```sh
git revert --no-edit 19c3d2b
```

It touches one line of `index/index.html`, `const REPO`, from `""` to
`"https://github.com/fairchild/chat-matrix"`. If the file has moved under it and
the revert conflicts, the edit is small enough to do by hand — that constant and
nothing else. Then:

```sh
git push
```

**Verify:** `grep -n 'const REPO' index/index.html` shows the URL, and after the
deploy in step 3 the hub's nav carries a "the repo" link where it previously
carried none. The three doc references in the footer switch from `<code>` spans
to links at the same time; they're driven by the same constant.

**Undo:** `git revert --no-edit HEAD` and push, which puts `REPO` back to empty
and returns the hub to plain-text doc references.

## 3. Deploy to Cloudflare

First, that wrangler is logged into the account the URLs assume:

```sh
bunx wrangler whoami
```

The subdomain it prints has to equal `WORKERS_SUBDOMAIN` in `scripts/hosted.sh`
(`irons-in-the-fire8698`), because `production_url()` builds every published URL
from it and `probe.sh --production` reads the same function. If the login has
lapsed, `bunx wrangler login` and re-run. Anyone running this from a fork sets
`WORKERS_SUBDOMAIN` to their own first; the committed default is Michael's
account and would otherwise deploy under names the hub points elsewhere.

One thing to know before the deploy, because it changes what this step is for.
The backend Worker that has been live since before this document is an old
build: checked 2026-08-23, its `/health` carries no `history` field, `/models`
answers `not found`, and `GET /threads` still returns the full list with every
thread's first user message as its title. The gate that closes that list, the
model routes, and the history declaration all exist in the committed source and
have never been deployed. So this step is not only "publish the cells" — it is
also the step that closes an exposure that is open on the public internet right
now, and has been open regardless of whether the repository was private.

```sh
./scripts/publish.sh
```

It runs `build_all production` — a static export per hosted cell with the
production backend and hub URLs baked in, then `index/dist/` with the hosted
topology substituted into `HOSTED`, every sibling page copied beside it and the
ergonomics notes generated — and then deploys seven Workers: the
cloudflare-agents backend, the five hosted cells, and the index. It prints a
`→ deploy <label>` line each, then a `published` block with every URL.
`./scripts/publish.sh --no-build` deploys what's already built, which is what
you want if one deploy failed and the rest are fine.

**Verify** — every URL answers, the flows still pass against what was actually
shipped, and the backend still meets the contract from the edge:

```sh
for u in index assistant-ui copilotkit ai-elements shadcn folio; do
  printf '%-14s ' "$u"
  curl -s -o /dev/null -w '%{http_code}\n' "https://chat-stack-$u.irons-in-the-fire8698.workers.dev/"
done
curl -s -o /dev/null -w 'backend %{http_code}\n' \
  https://chat-stack-backend-cloudflare-agents.irons-in-the-fire8698.workers.dev/health

./scripts/probe.sh --production
./protocol/conformance.sh https://chat-stack-backend-cloudflare-agents.irons-in-the-fire8698.workers.dev
```

Six `200`s and a `backend 200` — no `-f` on those curls on purpose, because a
`404` you can read beats a silent non-zero exit. The backend routes only its own
paths, so `/` 404s there and `/health` is its liveness probe.
`probe.sh --production` drives
the deployed cells and the deployed hub — the hosted-subset filter applies, so
`jinja` reports as a skip with the list that made the decision in its title, and
the captures key under `<backend>-deployed` so they land beside the local and
preview bands rather than on top of them. Expect **29 passed, 2 skipped, 0
failed**: five hosted cells × five flows, plus four of the five hub tests. The
second skip is one worth knowing about — `isPreview()` is `PROBE_PORT_OFFSET !==
0`, and `--production` sets base URLs rather than an offset, so the hub test that
checks a hosted build offers only what it can serve skips against the realest
hosted build there is. The preview run is what actually exercises it.
Conformance against the published
backend is the one run that *should* end with a skip: exactly one, the bulk
thread list, printed with the backend's own words for why it declines to serve
it. An empty list with no reason still fails, and everything else asserts.

**Undo:** `bunx wrangler delete <worker-name>` per Worker, from that Worker's
directory (`--dry-run` first if you want to see what it would take with it).
Deleting `chat-stack-backend-cloudflare-agents` destroys the Durable Objects
holding every stored thread, which is the one irreversible thing in this
document; the five cells and the index are static and cost nothing to rebuild.
Re-deploying is cheaper than deleting in almost every case.

## 4. Make the README true again

A paragraph in the README's hosting section describes the deployment as it is
before step 3 — a backend on a stale build, no cells, no hub. Every sentence of
it is true up to step 3 and false after it, and the paragraph after it leans on
the same tense, so both go together:

```diff
 # README.md, in "Hosting a subset", the two paragraphs under the backend URL
-That Worker is a build from before the model routes and the exposure decisions
-below — checked 2026-08-23: `/health` answers `200` with `model: scripted` and
-31 threads, `/models` answers `not found`, and `/threads` still serves the bulk
-list. The cells and the hub aren't published at all. Both of those are the same
-one command, `./scripts/publish.sh`, and
-[`docs/publishing.md`](docs/publishing.md) is the ordered sequence around it:
-what each command changes, how to check it worked, and what the undo actually
-recovers.
+The cells and the hub are published beside it, all one build — start at
+<https://chat-stack-index.irons-in-the-fire8698.workers.dev>.
+[`docs/publishing.md`](docs/publishing.md) is the sequence that put them there:
+what each command changes, how to check it worked, and what the undo actually
+recovers.
 
-What that command publishes is the shape described next, which is the committed
-one. A published deployment runs the same code as a local one and publishes less
-of it, and the difference is two vars whose default is the closed one, so the
+What is published is the shape described next, which is the committed one. A
+published deployment runs the same code as a local one and publishes less of
+it, and the difference is two vars whose default is the closed one, so the
 committed config is already the public shape and it's the local run that carries
```

```sh
git add README.md && git commit -m "docs: the cells are published" && git push
```

**Verify:** `rg -n "aren't published|not found" README.md` returns nothing. Both
strings live only in that first paragraph today, so an empty result is the whole
check.

**Undo:** revert the commit. Nothing downstream reads this sentence; it's prose
being held to the same standard as an assertion, which is this repo's rule
rather than a mechanism.

## 5. The repository's own front door

GitHub shows a description, topics and a homepage above the README, and the
homepage is the one that matters — it's where a visitor goes instead of reading
about the matrix:

```sh
gh repo edit fairchild/chat-matrix \
  --homepage https://chat-stack-index.irons-in-the-fire8698.workers.dev \
  --add-topic chat-ui --add-topic ai-sdk --add-topic ag-ui \
  --add-topic pydantic-ai --add-topic cloudflare-workers
```

The description is already set and still accurate. **Verify:**
`gh repo view fairchild/chat-matrix --json homepageUrl,repositoryTopics`.
**Undo:** `--remove-topic` takes the same list, and `--homepage ""` clears it.

Then one thing that isn't a command. `cell-naming` is still open in
`backlog/todo/`, and it's the only item there that a public repo makes more
expensive rather than less: every reader who arrives learns the word in whatever
sense the docs teach it, and the README now teaches one sense explicitly. The
decision is recorded in `docs/plans/cell-naming.md` when it's made.

## When Folio publishes

`frontends/folio` consumes `@fairchild/folio` as a vendored tarball, because no
registry carries it while Folio's own repository is private. The tarball is the
package Folio's release workflow built, so the code, the version and the exports
are the ones npm would serve. Two things change when it publishes, and only one
of them is the pin.

The pin first — one line plus a directory:

```diff
 # frontends/folio/package.json, under "dependencies"
-"@fairchild/folio": "file:./vendor/fairchild-folio-0.4.1.tgz"
+"@fairchild/folio": "^0.4.1"
```

```sh
rm -rf frontends/folio/vendor
cd frontends/folio && bun install
```

Commit `package.json`, `bun.lock` and the deleted directory together. The check
is that `bun run build` still emits `out/index.html` and the cell still renders
a turn — if the published package and the tarball differ, that's where it shows.

The other thing is the sourcemaps, and it is the half with a deadline on it. A
sourcemap's `sourcesContent` embeds the TypeScript it was built from, and
Folio's repository is private until it has its own flip, so the vendored copy
has to carry the compiled `dist/` without the seven `.map` files that would
normally sit beside it. `frontends/folio/vendor/PROVENANCE.md` is where the
derivation and the hashes on both sides belong. Check it rather than assume it:

```sh
tar tzf frontends/folio/vendor/fairchild-folio-0.4.1.tgz | grep -c '\.map$'   # 0
```

Repacking fixes the working tree and not the history, which is the trap worth
naming: if a tarball carrying maps was ever committed, the commit that carried
it is one of the commits step 1 publishes. That check belongs with step 1's
history audit, not here.

The registry pin restores the sourcemaps properly, because npm serves what
Folio's release workflow built. Until it lands, stepping into `@fairchild/folio`
in devtools arrives in compiled JS — a cost to debugging the cell and to nothing
else, since the code that runs is the same code either way.

## What is deliberately not done

Each of these is a decision, listed so the absence reads as one.

**No custom domain.** `workers.dev` subdomains are what `production_url()`
builds and what `probe.sh --production` drives, so a domain would mean both
learning a second source of truth for the same URLs. Worth doing if the demo
outlives the comparison; not worth doing to publish it.

**No identity, no per-visitor scoping.** The published backend declines to serve
its bulk thread list and its model switch rather than growing an account system
around them, which is the ROADMAP's non-goal stated as code: if a route can't be
public without identity, the route gets gated. `GET /threads/{id}` still serves
a thread whose id you hold, which is as much scoping as a demo without identity
can honestly claim.

**No probe run in CI.** The Playwright suite is the best evidence in the repo
and the most expensive — 35 tests needing six frontends, the hub and a backend
all up, plus a chromium download. `ci.yml` says so at the bottom, alongside the
cheapest useful slice to add first.

**`jinja` isn't hosted.** The hosted subset is static exports plus one Worker;
the monolith is a Python process with a SQLite file, and it's the one square the
published matrix can't offer. `index/monolith.html` says where it runs and why,
in plain text rather than a link that would die on a public URL.

**Nothing is announced anywhere.** Publishing a repository and telling people
about it are different acts, and only the first one is written down here.
