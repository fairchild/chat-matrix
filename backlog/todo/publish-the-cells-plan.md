---
priority: 3
timeout: 14d
arc: publish
dependencies:
  hosted-pages-ship-plan: "publishing dead cards is worse than not publishing"
  hosted-exposure-decisions-plan: "the public surface should be a decision, not a default"
---

# Publish the cells

The last step of the hosting arc. The backend is live —
`https://chat-stack-backend-cloudflare-agents.irons-in-the-fire8698.workers.dev/health`
returns 200, `model: scripted`. The four cells and the hub have never been
deployed: all five 404 as of 2026-08-18.

The gate is already green: `PROBE_PORT_OFFSET=1000 ./scripts/probe.sh` against
`./scripts/preview.sh` ran 20 flows across the four hosted cells, exit 0, with
`jinja` skipped by design (a Python process, not a static export, so it is
outside `HOSTED_CELLS`). `docs/plans/publish-readiness.md` holds the full gate
output and what each worker would become.

```sh
./scripts/publish.sh          # build_all production, then six wrangler deploys
```

**This is Michael's command to run, not an agent's** — it puts things on the
public internet under his account. An agent's job here is to get the two
dependencies to done, re-run the gate, and hand over a go/no-go.

## After

The checks are the five URLs returning 200 plus `/health` on the backend, and
the hub loading with its four hosted squares live. A probe run can't be pointed
at production — `probe.sh` resolves cells by `localhost:PORT+offset`, so no
offset reaches `workers.dev`. Checking the deployed pages for real would mean
`probes/frontends.ts` taking a base URL per cell, which is a change rather than
a run, and belongs in its own task if it's wanted.

---
