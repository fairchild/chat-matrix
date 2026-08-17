# Backend: pydantic-ai

Serves the reference agent over both the Vercel AI data stream protocol and
AG-UI. See `protocol/CONTRACT.md` for what it has to implement and why.

```sh
uv sync
uv run uvicorn app.main:app --port 8001
```

| Env | Default | |
|---|---|---|
| `DEMO_MODEL` | `scripted` | boot default: a shared id, `auto`, or any pydantic-ai model string (`anthropic:claude-opus-5`) |
| `DEMO_DB` | `data/threads.db` | SQLite thread store |
| `OPENAI_API_KEY` / `ANTHROPIC_API_KEY` / `GOOGLE_API_KEY` | — | make the matching model selectable |

`GET /models` lists what this backend can reach and `POST /model {"id": …}`
switches it while it runs — the hub's dropdown is those two. Credentials come
from the environment and nowhere else here, so an entry is unavailable exactly
when its variable is unset, and `/models` says which one.

## Layout

| File | |
|---|---|
| `app/agent.py` | the reference agent and its three tools |
| `app/models.py` | what this backend can reach, and why — the picker's data |
| `app/scripted.py` | deterministic model, so frontends are the only variable |
| `app/store.py` | thread persistence, in pydantic-ai's own message format |
| `app/main.py` | the HTTP surface |

## Ergonomics notes

The axis this backend is being judged on, recorded while it was fresh.

**Serving a protocol is one line.** `dispatch_request` handles content
negotiation, streaming, and encoding:

```python
return await VercelAIAdapter.dispatch_request(request, agent=agent, sdk_version=7)
```

Swapping `VercelAIAdapter` for `AGUIAdapter` is the entire difference between the
two endpoints. That's the strongest thing about this library for the matrix —
it makes protocol a variable rather than a rewrite.

**Version alignment was the one real risk, and it's handled.** assistant-ui's
`react-ai-sdk` depends on `ai@^7`, while `dispatch_request` defaults to
`sdk_version=5` for backwards compatibility. The parameter accepts `Literal[5, 6, 7]`,
so this is a one-token fix — but the default is wrong for this pairing and the
failure would show up as a client that can't parse the stream, not as an error
on the server. Worth checking first on any new frontend.

**Persistence has a real seam.** `on_complete` receives an `AgentRunResult`, so
storing `result.all_messages()` is the whole implementation. The catch is that it
fires on stream completion — a client that disconnects mid-stream writes nothing.

**Storing `ModelMessage` rather than a wire format paid off immediately.**
`dump_messages` renders stored history into whichever protocol asked for it, so
`GET /threads/{id}?protocol=ag-ui` works without a second store or a translation
layer.

**Line count.** ~500 lines total, and roughly 250 of those are the scripted model
and the SQLite store — neither of which is pydantic-ai's fault or credit. The
actual agent-and-serving glue is about 230 lines, most of it tool definitions.

**Papercut:** `ThreadSummary` is a `slots=True` dataclass, so `vars()` raises and
FastAPI can't serialise it. `dataclasses.asdict` is the fix. Cost a 500 that was
invisible until the endpoint was actually called — the kind of thing the
conformance script now catches.
