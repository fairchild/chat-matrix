"""One process: the reference agent, its protocol routes, and every pixel of the UI.

`/chat`, `/ag-ui`, `/threads*` and `/health` are the reference backend's routes,
copied so `conformance.sh :3005` gates the embedded agent. Everything under
`/t/` is the server-rendered chat: whole pages on GET, DOM patches on POST.
"""

from __future__ import annotations

import asyncio
import os
import secrets
from collections import defaultdict
from collections.abc import AsyncIterator, Callable
from dataclasses import asdict
from pathlib import Path
from typing import Any
from urllib.parse import quote

from fastapi import APIRouter, FastAPI, Form, HTTPException
from pydantic import BaseModel
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic_ai.run import AgentRunResult
from pydantic_ai.ui.ag_ui import AGUIAdapter
from pydantic_ai.ui.vercel_ai import VercelAIAdapter
from starlette.requests import Request
from starlette.responses import HTMLResponse, RedirectResponse, Response, StreamingResponse

from . import stream
from .agent import BACKEND_NAME, TOOL_NAMES, agent, current_model, use_model
from .html import STATIC, patch, render
from .models import catalogue, unavailable
from .store import ThreadStore
from .views import from_ui_messages

SDK_VERSION = 7

store = ThreadStore(Path(os.getenv("DEMO_DB", "data/threads.db")))

ui = APIRouter()
"""The server-rendered chat: whole pages on GET, DOM patches on POST. This is
the half a host app wants — `include_router(ui)` and `mount_static(app)` and it
has the UI, with `Turn(agent=...)` deciding whose agent answers."""

protocol = APIRouter()
"""The reference backend's own routes. Included here so `conformance.sh :3005`
gates the embedded agent; a host app that already speaks a protocol can leave
this one out."""


def mount_static(host: FastAPI, path: str = "/static") -> None:
    """The stylesheet lives in this package, so the host app mounts it from here."""
    host.mount(path, StaticFiles(directory=STATIC), name="static")


app = FastAPI(title="chat-stack frontend · jinja")
app.add_middleware(
    CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"]
)
mount_static(app)

SUGGESTIONS = (
    ("What's the weather in Tokyo?", "fast structured tool"),
    ("Search notes for streaming protocols.", "a list to render"),
    ("Analyze assistant-ui as a chat frontend.", "slow (~3s) call"),
)
NDJSON = "application/x-ndjson"

# One run at a time per thread. Without this the second of two overlapping turns
# reads the history the first one hasn't finished writing, and `on_complete`'s
# `all_messages()` overwrites the other turn out of the store entirely.
_locks: defaultdict[str, asyncio.Lock] = defaultdict(asyncio.Lock)


def _thread_url(thread_id: str) -> str:
    """Thread ids come from the URL, so they are only safe once re-quoted."""
    return f"/t/{quote(thread_id, safe='')}"


def _sidebar(thread_id: str) -> Callable[[], str]:
    """Rendered late, in the epilogue, so it sees the turn the run just saved."""
    return lambda: render("partials/threads.html", threads=store.list(), thread_id=thread_id)


async def _done_only(thread_id: str) -> AsyncIterator[bytes]:
    """Nothing to run, but the client asked for patches — answer in that protocol."""
    yield patch("done", url=_thread_url(thread_id))


def _ndjson(body: AsyncIterator[bytes]) -> StreamingResponse:
    return StreamingResponse(
        body,
        media_type=f"{NDJSON}; charset=utf-8",
        headers={"cache-control": "no-store", "x-accel-buffering": "no"},
    )


def _persist(thread_id: str):
    async def on_complete(result: AgentRunResult[Any]) -> None:
        store.save(thread_id, result.all_messages())

    return on_complete


def _page_context(thread_id: str) -> dict[str, Any]:
    return {
        "thread_id": thread_id,
        "threads": store.list(),
        "badge": f"{BACKEND_NAME} · {current_model()} · agent in-process",
        "suggestions": SUGGESTIONS,
    }


# ---- the chat ---------------------------------------------------------------


@ui.get("/")
async def new_thread() -> RedirectResponse:
    return RedirectResponse(_thread_url(secrets.token_urlsafe(12)), status_code=303)


@ui.get("/t/{thread_id}", response_class=HTMLResponse)
async def thread_page(thread_id: str) -> HTMLResponse:
    turns = from_ui_messages(VercelAIAdapter.dump_messages(store.history(thread_id)))
    return HTMLResponse(render("thread.html", turns=turns, **_page_context(thread_id)))


@ui.post("/t/{thread_id}")
async def send(request: Request, thread_id: str, message: str = Form("")) -> Response:
    wants_patches = NDJSON in request.headers.get("accept", "")
    message = message.strip()
    if not message:
        if wants_patches:
            return _ndjson(_done_only(thread_id))
        return RedirectResponse(_thread_url(thread_id), status_code=303)
    turn = stream.Turn(
        thread_id=thread_id,
        message=message,
        history=lambda: store.history(thread_id),
        on_complete=_persist(thread_id),
        sidebar=_sidebar(thread_id),
        lock=_locks[thread_id],
    )
    if wants_patches:
        return _ndjson(turn.patches())
    await turn.drain()
    return RedirectResponse(_thread_url(thread_id), status_code=303)


@ui.get("/t/{thread_id}/fragments/composer", response_class=HTMLResponse)
async def composer_fragment(thread_id: str) -> HTMLResponse:
    return HTMLResponse(render("partials/composer.html", thread_id=thread_id, state="idle"))


@ui.get("/app.js")
async def app_js(request: Request) -> Response:
    return Response(
        render("app.js"),
        media_type="text/javascript; charset=utf-8",
        headers={"cache-control": "no-store"},
    )


# ---- the reference backend's routes, verbatim in spirit ---------------------


@protocol.get("/health")
async def health() -> dict[str, Any]:
    return {
        "backend": BACKEND_NAME,
        "model": current_model(),
        "protocols": {"vercel-ai": f"/chat (sdk v{SDK_VERSION})", "ag-ui": "/ag-ui"},
        "tools": list(TOOL_NAMES),
        "threads": len(store.list()),
        "history": "client",
        "ui": "server-rendered",
    }


class ModelChoice(BaseModel):
    id: str


@protocol.get("/models")
async def list_models() -> dict[str, Any]:
    """Every model this backend knows about, available or not, each with its reason."""
    return {"current": current_model(), "models": catalogue()}


@protocol.post("/model")
async def select_model(choice: ModelChoice) -> dict[str, str]:
    """Switch the running model. Process-wide on purpose: the model is the control variable."""
    if reason := unavailable(choice.id):
        raise HTTPException(status_code=400, detail=reason)
    use_model(choice.id)
    return {"model": current_model()}


@protocol.post("/chat")
async def chat(request: Request) -> Response:
    run_input = VercelAIAdapter.build_run_input(await request.body())
    return await VercelAIAdapter.dispatch_request(
        request,
        agent=agent,
        sdk_version=SDK_VERSION,
        conversation_id=run_input.id,
        on_complete=_persist(run_input.id),
    )


@protocol.post("/ag-ui")
async def ag_ui(request: Request) -> Response:
    run_input = AGUIAdapter.build_run_input(await request.body())
    return await AGUIAdapter.dispatch_request(
        request,
        agent=agent,
        conversation_id=run_input.thread_id,
        on_complete=_persist(run_input.thread_id),
    )


@protocol.get("/threads")
async def list_threads() -> dict[str, Any]:
    return {"threads": [asdict(summary) for summary in store.list()]}


@protocol.get("/threads/{thread_id}")
async def get_thread(thread_id: str, protocol: str = "vercel-ai") -> dict[str, Any]:
    if not store.exists(thread_id):
        raise HTTPException(status_code=404, detail=f"no thread {thread_id!r}")
    adapters = {"vercel-ai": VercelAIAdapter, "ag-ui": AGUIAdapter}
    adapter = adapters.get(protocol)
    if adapter is None:
        raise HTTPException(status_code=400, detail=f"protocol must be one of {sorted(adapters)}")
    messages = adapter.dump_messages(store.history(thread_id))
    return {
        "id": thread_id,
        "protocol": protocol,
        "messages": [m.model_dump(by_alias=True, mode="json") for m in messages],
    }


@protocol.delete("/threads/{thread_id}")
async def delete_thread(thread_id: str) -> dict[str, bool]:
    if not store.delete(thread_id):
        raise HTTPException(status_code=404, detail=f"no thread {thread_id!r}")
    return {"deleted": True}


app.include_router(ui)
app.include_router(protocol)
