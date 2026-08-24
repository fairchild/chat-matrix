---
priority: 3
timeout: 14d
arc: publish
dependencies:
  hosted-pages-ship-plan: "publishing dead cards is worse than not publishing"
  hosted-exposure-decisions-plan: "the public surface should be a decision, not a default"
---

# Publish the cells

The last step of the hosting arc, and the only one that isn't work any more —
it's a sequence to run. [`docs/publishing.md`](../../docs/publishing.md) holds
it: seven numbered steps, each with the exact command, what it changes, how to
check it worked, and what the undo actually recovers. Everything below is the
state that document was written against.

**This is Michael's command to run, not an agent's** — it puts things on the
public internet under his account. An agent's job here was to get the
dependencies to done, keep the gate runnable, and hand over a sequence. That's
done.

## What is deployed today

Checked 2026-08-23 against `irons-in-the-fire8698.workers.dev`:

| worker | today |
|---|---|
| `chat-stack-backend-cloudflare-agents` | `/health` **200**, `model: scripted`, 31 threads |
| `chat-stack-index` | 404 |
| `chat-stack-assistant-ui` | 404 |
| `chat-stack-copilotkit` | 404 |
| `chat-stack-ai-elements` | 404 |
| `chat-stack-shadcn` | 404 |
| `chat-stack-folio` | 404 |

So publishing redeploys one live Worker and creates six. Seven deploys in all —
`hosted.sh`'s `HOSTED_CELLS` grew a fifth entry when the folio cell landed.

The live backend is worth a second look before running anything: it is a build
from before three landed changes. Its `/health` carries no `history` field, its
`/models` route answers `not found`, and `GET /threads` still returns the bulk
list with every thread's first user message as its title. The gate that closes
that list has been committed since `hosted-exposure-decisions-plan` and has
never been deployed. Publishing is therefore also the thing that closes it.

## The gate

Local, in `docs/publishing.md` step 0: `run.sh`, then `conformance.sh` per
backend, then `golden.sh`, then `probe.sh`, then `stop.sh`. The probe run is
35 tests — six cells × five flows in `probes/flows.yaml`, plus five in
`hub.spec.ts`.

CI is not a gate here and can't be one yet. The only workflow run there has ever
been (2026-08-20, `main`) came back with all seventeen jobs refused for Actions
billing on a private repository. Flipping the repo public is what makes CI run
at all, so it's a check on step 1 rather than a precondition for it.

## After

`./scripts/probe.sh --production` drives the deployed cells and the deployed hub
directly, reading each base URL from `hosted.sh`'s `production_url()` — the same
function `publish.sh` deploys against, so a run can't drift from what shipped.
The claim in an earlier draft of this file, that a probe run can't be pointed at
production, stopped being true when `--production` and `PROBE_BASES` landed.

A conformance run against the redeployed backend should end with exactly one
skip, the bulk thread list, printed with the backend's own reason. An empty list
with no reason still fails.

---
