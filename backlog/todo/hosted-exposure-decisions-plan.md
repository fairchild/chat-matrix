---
priority: 1
arc: publish
---

# The two things a public backend exposes

Both are documented in `docs/plans/publish-readiness.md` with a recommendation
each; both need a call before the cells go public, and neither is a bug — they
are demo-scale choices that stop being free once strangers can reach them.

## `/threads` is public and unscoped

`GET /threads` (`backends/cloudflare-agents/src/index.ts`) returns
`registry.list()` with no scoping and `access-control-allow-origin: *`, and
`title` is the thread's first user message. Verified live against the deployed
backend: 200, all summaries, first row `"What's the weather in Tokyo?"`. Those
threads are ours today, which is the only reason it looks harmless.

Recommended in the readiness page: gate the bulk route behind an env flag
(`if (env.PUBLIC_THREAD_LIST !== "1") return json({threads: []}, 200)`), set
locally and unset in production, so `/threads/{id}` still resumes a thread whose
id you already hold. Scoping properly needs an identity the demo doesn't have,
and inventing one is out of scope.

## The hosted picker offers a choice it can't honour

`safeBackend` (`frontends/copilotkit/lib/runtime.ts`) returns the configured
fallback unless the requested URL is `http:` on `localhost`/`127.0.0.1`. In
production every candidate is a public `https:` URL, so the hub's choice is
silently dropped for that cell. The behaviour is right — the hosted subset ships
one backend — and the UI is the lie.

The readiness page recommends accepting it and stopping the offer: when `HOSTED`
is set, the hub shows the backend as a fixed label rather than a control. Note
that recommendation predates the matrix redesign — the hub is a 4×4 table now,
where unhosted backends already stay on the grid marked `local`, so the
equivalent move is making the hosted column read as the only live one rather
than removing a radio group that no longer exists.

There is a third exposure worth deciding here while the same file is open:
`POST /model` is unauthenticated with CORS `*`, so anyone reaching the public URL
can switch the running model for every visitor. It costs nothing while the
deployment has no key binding — `scripted` is the only available entry — but the
published hub now draws a control that mutates shared state, and the root
README's hosting caveats don't mention it.

## Acceptance

- Each of the three has a decision written down in
  `docs/plans/publish-readiness.md`, applied or explicitly deferred with a reason.
- The root README's hosting section names whatever the public surface ends up
  being, so the page and the prose agree.

---
