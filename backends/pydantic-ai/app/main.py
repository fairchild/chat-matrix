"""HTTP surface: the same agent served over two protocols, plus thread management.

`/chat` and `/ag-ui` differ by one adapter class. That symmetry is the point —
it makes the wire protocol an axis you can vary without touching the agent.
"""

from __future__ import annotations

import json
import os
from dataclasses import asdict
from pathlib import Path
from typing import Any

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from pydantic_ai.run import AgentRunResult
from pydantic_ai.ui.ag_ui import AGUIAdapter
from pydantic_ai.ui.vercel_ai import VercelAIAdapter
from starlette.requests import Request
from starlette.responses import Response

from .agent import BACKEND_NAME, TOOL_NAMES, agent, current_model, use_model
from .models import catalogue, unavailable
from .store import ThreadStore

SDK_VERSION = 7
"""assistant-ui's react-ai-sdk adapter is built on AI SDK v7."""

store = ThreadStore(Path(os.getenv("DEMO_DB", "data/threads.db")))


def _drop_reasoning_ids(body: bytes) -> bytes:
    """Strip `id` from reasoning parts a client sends back.

    The AI SDK's `ReasoningUIPart` has an optional `id`; pydantic-ai 2.31's
    request model has no such field and every UI part forbids extras, so one
    echoed id fails the whole request. It costs nothing to drop: the id names a
    block in *our own* outgoing stream, and nothing on the way in reads it.

    Only a reasoning model makes this reachable, which is why the scripted
    default never saw it — the first turn streams reasoning parts, the client
    stores them, and the second turn sends them back and 500s.
    """
    try:
        payload = json.loads(body)
        messages = payload["messages"]
    except (ValueError, TypeError, KeyError):
        return body
    dropped = False
    for message in messages if isinstance(messages, list) else []:
        parts = message.get("parts") if isinstance(message, dict) else None
        for part in parts if isinstance(parts, list) else []:
            if isinstance(part, dict) and part.get("type") == "reasoning":
                dropped = part.pop("id", None) is not None or dropped
    return json.dumps(payload).encode() if dropped else body


class VercelAdapter(VercelAIAdapter):
    """The reference adapter, plus the one thing it can't yet take on the way in."""

    @classmethod
    def build_run_input(cls, body: bytes):
        return super().build_run_input(_drop_reasoning_ids(body))

app = FastAPI(title=f"chat-stack backend · {BACKEND_NAME}")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


def _persist(thread_id: str):
    async def on_complete(result: AgentRunResult[Any]) -> None:
        store.save(thread_id, result.all_messages())

    return on_complete


@app.get("/health")
async def health() -> dict[str, Any]:
    return {
        "backend": BACKEND_NAME,
        "model": current_model(),
        "protocols": {"vercel-ai": f"/chat (sdk v{SDK_VERSION})", "ag-ui": "/ag-ui"},
        "tools": list(TOOL_NAMES),
        "threads": len(store.list()),
    }


class ModelChoice(BaseModel):
    id: str


@app.get("/models")
async def list_models() -> dict[str, Any]:
    """Every model this backend knows about, available or not, each with its reason."""
    return {"current": current_model(), "models": catalogue()}


@app.post("/model")
async def select_model(choice: ModelChoice) -> dict[str, str]:
    """Switch the running model. Process-wide on purpose: the model is the control variable."""
    if reason := unavailable(choice.id):
        raise HTTPException(status_code=400, detail=reason)
    use_model(choice.id)
    return {"model": current_model()}


@app.post("/chat")
async def chat(request: Request) -> Response:
    """Vercel AI data stream protocol — what assistant-ui's useChat speaks."""
    run_input = VercelAdapter.build_run_input(await request.body())
    return await VercelAdapter.dispatch_request(
        request,
        agent=agent,
        sdk_version=SDK_VERSION,
        conversation_id=run_input.id,
        on_complete=_persist(run_input.id),
    )


@app.post("/ag-ui")
async def ag_ui(request: Request) -> Response:
    """AG-UI protocol — the same agent, a different wire format."""
    run_input = AGUIAdapter.build_run_input(await request.body())
    return await AGUIAdapter.dispatch_request(
        request,
        agent=agent,
        conversation_id=run_input.thread_id,
        on_complete=_persist(run_input.thread_id),
    )


@app.get("/threads")
async def list_threads() -> dict[str, Any]:
    return {"threads": [asdict(summary) for summary in store.list()]}


@app.get("/threads/{thread_id}")
async def get_thread(thread_id: str, protocol: str = "vercel-ai") -> dict[str, Any]:
    """Rehydration: stored messages rendered into the caller's wire format."""
    if not store.exists(thread_id):
        raise HTTPException(status_code=404, detail=f"no thread {thread_id!r}")

    adapters = {"vercel-ai": VercelAdapter, "ag-ui": AGUIAdapter}
    adapter = adapters.get(protocol)
    if adapter is None:
        raise HTTPException(
            status_code=400, detail=f"protocol must be one of {sorted(adapters)}"
        )

    messages = adapter.dump_messages(store.history(thread_id))
    return {
        "id": thread_id,
        "protocol": protocol,
        "messages": [message.model_dump(by_alias=True, mode="json") for message in messages],
    }


@app.delete("/threads/{thread_id}")
async def delete_thread(thread_id: str) -> dict[str, bool]:
    if not store.delete(thread_id):
        raise HTTPException(status_code=404, detail=f"no thread {thread_id!r}")
    return {"deleted": True}
