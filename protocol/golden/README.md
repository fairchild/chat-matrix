# Golden fixtures

One canonical line per SSE frame, for five prompts across both protocols — the
work a frontend receives, with ids renamed and timestamps erased so only content
and order remain.

They are captured from `backends/pydantic-ai`, the reference, by
`bun protocol/golden.ts --update`; every other backend is diffed against them.
Don't hand-edit them: a diff here is a change in what every frontend renders,
and a reviewer has to read it.
