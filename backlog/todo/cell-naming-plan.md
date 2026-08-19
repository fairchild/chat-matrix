---
priority: 3
arc: prose
---

# Decide what "cell" names

**Needs Michael. Nothing should be renamed until it's answered.**

"Cell" has meant one frontend app since the demo was a strip of frontends
against one backend. The hub is a 4×4 table now, where a cell is naturally a
square — a frontend × backend pair. Both senses live in one file:
`index/index.html` reads `HOSTED.cells[f.id]` keyed by frontend, and
`el?.closest("td, th")` for a grid square. `scripts/hosted.sh` has
`HOSTED_CELLS=(assistant-ui copilotkit ai-elements shadcn)` — four frontends.

`docs/plans/cell-naming.md` is the worked proposal: 254 lines across 64 files,
almost all meaning *one frontend app*; the square sense appears in prose once
(`README.md`, "the first cell was assistant-ui × pydantic-ai", which slides from
pair to frontend mid-sentence). The hub itself never says "cell" — its visible
copy says *square*.

Two options, both costed in that document:

- **A** — code says "frontend"; "cell" becomes the square. A 57-file meaning
  flip to free a word nothing then needs.
- **B, narrow** — "cell" stays a frontend; the square is a "pair" or stays
  "square". Eight files at most, no identifiers, no public key. The README then
  has to define the term in its first paragraph.

The document recommends **B, narrow**, on the grounds that usage runs ~170 lines
to 1 and the hub already named the square without the word.

## What done looks like

The decision recorded at the top of `docs/plans/cell-naming.md`, then the sweep
it implies — in one commit, not spread across lanes, because a half-renamed
vocabulary is worse than either name.

---
