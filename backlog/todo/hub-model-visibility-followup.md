---
priority: 4
arc: honest-axes
---

# The hub is the one surface that doesn't say when the axes stop being comparable

The hub's lede promises "Every square runs the same agent, so the differences
you see are the stack rather than the answer" — and its own per-backend model
picker can make that false. `scripts/probe.sh` warns when a backend is off
`scripted`; `protocol/golden.ts` refuses outright. The hub says nothing.

Observed on 2026-08-17 with `:8001` on `openai/gpt-5.6-luna` while the other
three sat on `scripted`: the grid read "16 of 16 squares live" under that lede,
with nothing to suggest two squares in the same row were no longer doing the
same work.

A line in the readout when the backends disagree closes it. The data is already
in hand — `refresh()` holds every backend's `/health`, and `modelVia` already
tracks how each is reached.

## The narrow layout has no picker at all

`index/index.html`'s `@media (max-width: 700px)` block sets
`table.matrix thead { display: none }`, and the four model selects live in that
header row. On a phone there is no way to pick a model and no way to see which
one a backend is on. For a page about to be linked publicly that is the common
viewport, not the edge case.

The stacked layout already re-labels each square with its backend name
(`td .sq .on`), so the natural fix is to give each backend block its model the
same way rather than to restore the header.

## Acceptance

- With one backend switched off `scripted`, the hub says so without a reload.
- At 390px wide, every backend's current model is visible and selectable.
- Screenshots at 1280 and 390, light and dark.

---
