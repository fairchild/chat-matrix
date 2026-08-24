<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# Folio is vendored, not published

`@fairchild/folio` resolves to `vendor/fairchild-folio-0.4.1.tgz`, checksummed in
`vendor/SHA256SUMS` and described in `vendor/PROVENANCE.md`. Don't reach for a
registry, and don't edit Folio's own repository from here — this cell is only
allowed to consume its released artifact. See README.md for the swap to npmjs.
