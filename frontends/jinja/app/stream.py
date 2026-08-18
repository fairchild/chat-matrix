"""One turn of the conversation, as a stream of DOM patches.

The adapter yields the same `*Chunk` objects every other cell renders in the
browser; here they update view models on the server and each update is sent
as a Jinja render of the same partial the full page uses. Two rules keep this
small: a part's card is re-rendered *whole* whenever its state changes, and
raw text (model tokens, tool-argument JSON) travels as `op:text` and never as
markup. The no-JS path runs the same generator and just doesn't send it.
"""

from __future__ import annotations

import asyncio
import json
import logging
import secrets
from collections.abc import AsyncIterator, Awaitable, Callable, Sequence
from contextlib import nullcontext
from dataclasses import dataclass, field
from typing import Any
from urllib.parse import quote

from pydantic_ai import Agent
from pydantic_ai.messages import ModelMessage
from pydantic_ai.ui.vercel_ai import VercelAIAdapter
from pydantic_ai.ui.vercel_ai.response_types import (
    BaseChunk,
    DoneChunk,
    ErrorChunk,
    FinishChunk,
    ReasoningDeltaChunk,
    ReasoningEndChunk,
    ReasoningStartChunk,
    TextDeltaChunk,
    TextEndChunk,
    TextStartChunk,
    ToolInputAvailableChunk,
    ToolInputDeltaChunk,
    ToolInputErrorChunk,
    ToolInputStartChunk,
    ToolOutputAvailableChunk,
    ToolOutputErrorChunk,
)

from .agent import agent as default_agent
from .html import patch, render
from .views import ReasoningView, TextView, ToolView, Turn as TurnView

log = logging.getLogger(__name__)

SDK_VERSION = 7


def _mint() -> str:
    return secrets.token_urlsafe(8)


@dataclass
class Turn:
    thread_id: str
    message: str
    #: Called *after* the lock is held — a turn that waited must read the
    #: history the turn ahead of it wrote, not the one it saw on arrival.
    history: Callable[[], Sequence[ModelMessage]]
    on_complete: Callable[[Any], Awaitable[None]]
    #: Renders the sidebar at epilogue time; None outside the page routes.
    sidebar: Callable[[], str] | None = None
    #: Serialises runs on one thread. None means "don't serialise".
    lock: asyncio.Lock | None = None
    #: Whose turn this is. A host app passes its own; the cell's is the default.
    agent: Agent[Any, Any] = field(default_factory=lambda: default_agent)
    turn_id: str = field(default_factory=_mint)
    parts: dict[str, TextView | ReasoningView | ToolView] = field(default_factory=dict)

    @property
    def url(self) -> str:
        return f"/t/{quote(self.thread_id, safe='')}"

    # ---- the three renders every turn needs -------------------------------

    def _composer(self, state: str) -> bytes:
        html = render("partials/composer.html", thread_id=self.thread_id, state=state)
        return patch("replace", "composer", html=html)

    def _prologue(self) -> list[bytes]:
        user = TurnView(id=_mint(), role="user", parts=[TextView(id="u", text=self.message, done=True)])
        assistant = TurnView(id=self.turn_id, role="assistant")
        return [
            patch("append", "transcript", html=render("partials/message_user.html", turn=user)),
            self._composer("busy"),
            patch("append", "transcript", html=render("partials/message_assistant.html", turn=assistant)),
        ]

    def _sidebar(self) -> list[bytes]:
        """The thread list is server state too, and the run just changed it."""
        if self.sidebar is None:
            return []
        return [patch("replace", "threads", html=self.sidebar())]

    def _epilogue(self, error: str | None = None) -> list[bytes]:
        out: list[bytes] = []
        if error is not None:
            html = render("partials/error.html", error=error)
            out.append(patch("error", f"parts-{self.turn_id}", html=html))
        out.extend(self._sidebar())
        out.append(self._composer("idle"))
        out.append(patch("done", url=self.url))
        return out

    # ---- chunk → patch ------------------------------------------------------

    def _part(self, kind: str, view: Any) -> bytes:
        return patch("append", f"parts-{self.turn_id}", html=render(f"partials/part_{kind}.html", part=view))

    def _tool(self, view: ToolView) -> bytes:
        return patch("replace", f"tc-{view.call_id}", html=render("partials/part_tool.html", part=view))

    def _apply(self, chunk: BaseChunk) -> list[bytes]:
        match chunk:
            case ToolInputStartChunk(tool_call_id=cid, tool_name=name):
                view = self.parts[cid] = ToolView(call_id=cid, name=name)
                return [self._part("tool", view)]
            case ToolInputDeltaChunk(tool_call_id=cid, input_text_delta=delta):
                view = self.parts[cid]
                if isinstance(view, ToolView):
                    view.args_text += delta
                return [patch("text", f"args-{cid}", text=delta)]
            case ToolInputAvailableChunk(tool_call_id=cid, tool_name=name, input=args):
                view = self.parts.get(cid) or ToolView(call_id=cid, name=name)
                if isinstance(view, ToolView):
                    view.state, view.input = "input-available", args
                    if cid not in self.parts:
                        self.parts[cid] = view
                        return [self._part("tool", view)]
                    return [self._tool(view)]
                return []
            case ToolOutputAvailableChunk(tool_call_id=cid, output=output):
                view = self.parts[cid]
                if isinstance(view, ToolView):
                    view.state, view.output = "output-available", output
                    return [self._tool(view)]
                return []
            case ToolOutputErrorChunk(tool_call_id=cid, error_text=text) | ToolInputErrorChunk(
                tool_call_id=cid, error_text=text
            ):
                view = self.parts[cid]
                if isinstance(view, ToolView):
                    view.state, view.error = "output-error", text
                    return [self._tool(view)]
                return []
            case TextStartChunk(id=tid):
                view = self.parts[tid] = TextView(id=tid)
                return [self._part("text", view)]
            case TextDeltaChunk(id=tid, delta=delta):
                view = self.parts[tid]
                if isinstance(view, TextView):
                    view.text += delta
                return [patch("text", f"tx-{tid}-raw", text=delta)]
            case TextEndChunk(id=tid):
                view = self.parts[tid]
                if isinstance(view, TextView):
                    view.done = True
                    html = render("partials/part_text.html", part=view)
                    return [patch("replace", f"tx-{tid}", html=html)]
                return []
            case ReasoningStartChunk(id=rid):
                view = self.parts[rid] = ReasoningView(id=rid)
                return [self._part("reasoning", view)]
            case ReasoningDeltaChunk(id=rid, delta=delta):
                view = self.parts[rid]
                if isinstance(view, ReasoningView):
                    view.text += delta
                return [patch("text", f"rs-{rid}-raw", text=delta)]
            case ReasoningEndChunk(id=rid):
                view = self.parts[rid]
                if isinstance(view, ReasoningView):
                    view.done = True
                    html = render("partials/part_reasoning.html", part=view)
                    return [patch("replace", f"rs-{rid}", html=html)]
                return []
            case ErrorChunk(error_text=text):
                html = render("partials/error.html", error=text)
                return [patch("error", f"parts-{self.turn_id}", html=html)]
            case FinishChunk():
                return [*self._sidebar(), self._composer("idle")]
            case DoneChunk():
                return [patch("done", url=self.url)]
            case _:
                log.debug("ignored chunk %s", chunk.type)
                return []

    # ---- the run ------------------------------------------------------------

    def _chunks(self) -> AsyncIterator[BaseChunk]:
        body = {
            "id": self.thread_id,
            "trigger": "submit-message",
            "messages": [
                {"id": _mint(), "role": "user", "parts": [{"type": "text", "text": self.message}]}
            ],
        }
        run_input = VercelAIAdapter.build_run_input(json.dumps(body).encode())
        adapter = VercelAIAdapter(agent=self.agent, run_input=run_input, sdk_version=SDK_VERSION)
        return adapter.run_stream(message_history=self.history(), on_complete=self.on_complete)

    async def patches(self) -> AsyncIterator[bytes]:
        # The prologue goes out before the wait: a queued turn should still show
        # the user their own message and a busy composer immediately.
        for line in self._prologue():
            yield line
        async with (self.lock if self.lock is not None else nullcontext()):
            finished = False
            try:
                async for chunk in self._chunks():
                    for line in self._apply(chunk):
                        yield line
                    if isinstance(chunk, DoneChunk):
                        finished = True
            except Exception as exc:  # noqa: BLE001 — anything at all ends the turn visibly
                log.exception("turn %s failed", self.turn_id)
                for line in self._epilogue(error=f"{type(exc).__name__}: {exc}"):
                    yield line
                return
            if not finished:
                for line in self._epilogue():
                    yield line

    async def drain(self) -> None:
        """The no-JS path: same generator, nothing sent."""
        async for _ in self.patches():
            pass
