<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Folio is vendored, not published

`@fairchild/folio` resolves to `vendor/fairchild-folio-0.4.1.tgz`, checksummed in
`vendor/SHA256SUMS`. Don't reach for a registry and don't edit anything under
`~/code/folio` — that's the package's source repository, and this cell is only
allowed to consume its released artifact. See README.md for the swap to npmjs.
