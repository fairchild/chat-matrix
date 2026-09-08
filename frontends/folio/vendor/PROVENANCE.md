# Provenance

`fairchild-folio-0.4.1.tgz` here is derived from the tarball Folio's own Release
workflow built — a `workflow_dispatch` dry run on `fairchild/folio` at commit
`d9bb824c96d7756bda180169589977ce636fa048`, clean tree — and uploaded as the
Actions artifact `folio-release-0.4.1`.

| file | sha256 | bytes |
|---|---|---|
| the CI artifact, as `SHA256SUMS.upstream` and `manifest.json` describe it | `0d629b6ae4e52946f10f518b133171be8492966de6c7ef21b1678f529e321c51` | 119505 |
| this file | `d2feb981af61cefe382ab6236bf4ad121d4629c034f7580eb7a1305809a2db51` | 58550 |

The difference is the seven `package/dist/*.map` files, removed. Everything
else — every JavaScript entry, the stylesheet, `package.json`, `LICENSE`,
`README.md`, `CHANGELOG.md` — is byte-identical to the artifact, which is why
`manifest.json`'s per-file `fileSha256` map still describes what is here.

Why: a sourcemap carries `sourcesContent`, the TypeScript it was compiled from.
Folio's repository is private until its own public flip and this repository
goes public first, so the maps would have published Folio's source from the
wrong repository. The registry pin — `^0.4.1`, once Folio publishes — brings
them back; until then devtools step into compiled JavaScript, which is the whole
cost.

To reproduce the derivation from the artifact:

    tar -xzf fairchild-folio-0.4.1.tgz            # the CI artifact
    rm package/dist/*.map
    COPYFILE_DISABLE=1 tar -czf fairchild-folio-0.4.1.tgz package

and to check this file against it, extract both and `diff -r`: the only
differences are the seven absent maps. The `//# sourceMappingURL=` trailer in
each JavaScript file is left as it was so the code stays byte-identical.

For a future audit: repository scanners treat a `.tgz` as an opaque blob
(`gitleaks --max-archive-depth` defaults to 0). Extract it to scan it.
