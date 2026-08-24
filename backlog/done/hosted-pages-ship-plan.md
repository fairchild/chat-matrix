---
priority: 1
arc: publish
---

# The hosted build ships every page it links

`build_index` in `scripts/hosted.sh` writes exactly one file into `index/dist/`,
and `index/wrangler.jsonc` publishes that directory. `index/index.html` links
`golden.html` and `monolith.html` from its `PAGES` list, and those embed
`golden-check.gif` and `jinja-cell.gif` — both of which are **symlinks** out of
`index/` into `docs/recordings/`. On the running preview all four are 404 while
`/` is 200. Publishing today puts two dead cards on the landing page.

Verified on `:4000` and re-read in `scripts/hosted.sh` on 2026-08-18.

## What to do

Copy the pages and dereference the gif symlinks in `build_index` (largest is
~4.0 MB, well inside the Worker asset budget). Gating the `PAGES` list on
`HOSTED` is the other option and it's worse — the two pages are the best writing
on the site, and hiding them from every hosted visitor to avoid a copy step
trades the wrong thing.

Then the second-order leaks, which a copy alone doesn't fix:

- `index/monolith.html` points at `http://localhost:3005` in two places
- `index/golden.html` mentions `localhost:8002`

Those read as instructions on a local clone and as broken promises on a public
URL. They need the same `HOSTED` treatment the hub's own links get, or wording
that is true in both shapes.

While in `index/index.html`: `REPO` is `""`, so the footer says "Docs live in
the repo" and renders the three doc paths as inert `<code>`, and the nav has no
repo link. There is no git remote on this clone yet and no LICENSE file. A
public site pointing at a repo that doesn't exist is worse than one that doesn't
mention it — so either set `REPO` as part of making the repo public, or say
plainly on the page that it isn't public yet.

## Acceptance

- `./scripts/preview.sh` then `curl -o /dev/null -w '%{http_code}'` on `/`,
  `/golden.html`, `/monolith.html`, `/golden-check.gif`, `/jinja-cell.gif` —
  all 200.
- No `localhost` string survives in a production-mode `index/dist/`.
- `REPO` decided either way, and the footer honest about it.
- Screenshot the hosted preview's three pages, light and dark.

---
- 2026-08-20T03:17:47Z advanced to=doing claimer=fairchild@blue branch=main
- 2026-08-20T04:40:12Z progress | Mostly landed. The copy half was already fixed generically in 7fce311 (build_index copies every sibling *.html and cp -L's every *.gif). This pass did the rest (24507f7): monolith.html's footer no longer LINKS localhost:3005; the other two localhost mentions stand with reasons recorded in publish-readiness.md; LICENSE (Apache-2.0); REPO set. Acceptance: /, /golden.html, /monolith.html, both gifs and /notes/* all 200 on the preview (wrangler's asset handler 307s .html -> extensionless, then 200). Three pages screenshotted light and dark, no console errors, no 4xx. The 'no localhost string in dist' criterion was replaced with a behavioural one — surviving strings are JS comments, alt text and a shell command; what matters is that no LINK resolves to localhost, which probes/hub.spec.ts now asserts. BLOCKER FOR PUBLISH: REPO now points at github.com/fairchild/chat-matrix, which does not exist yet. Create and push the repo before publish.sh, or the hub nav 404s.
- 2026-08-24T01:06:59Z advanced to=done
- 2026-08-24T01:07:18Z progress | Closed from the wrap-up session: the blocker above is resolved — fairchild/chat-matrix exists (private), REPO was reverted to "" in 19c3d2b for exactly that reason, and docs/publishing.md step 2 re-applies it at the public flip. The page-copy work itself landed in 7fce311 and 24507f7.
