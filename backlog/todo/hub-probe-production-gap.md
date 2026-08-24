# The hosted-build probe never runs in production mode

`probes/hub.spec.ts`'s "hosted build offers only what it can serve" assertion
is guarded by `isPreview()`, so a `--production` run never exercises it — the
one mode the claim is about is the one mode that skips the check. Either lift
the guard so the probe runs against the production build, or record why the
production shape can't be probed and delete the false comfort.

(Found during the going-public wrap-up, 2026-08-24; filed post-merge.)
