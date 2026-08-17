"""What the templates see: a turn is a role and a list of parts.

The same four dataclasses back both paths — the live stream builds them
incrementally as chunks arrive, and a reload rebuilds them whole from the
store — so every template renders one shape and never learns which path it
came from.
"""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass, field
from typing import Any, ClassVar, Literal

from pydantic_ai.ui.vercel_ai.request_types import (
    ReasoningUIPart,
    TextUIPart,
    UIMessage,
)

ToolState = Literal["input-streaming", "input-available", "output-available", "output-error"]


@dataclass(slots=True)
class TextView:
    kind: ClassVar[str] = "text"
    id: str
    text: str = ""
    done: bool = False


@dataclass(slots=True)
class ReasoningView:
    kind: ClassVar[str] = "reasoning"
    id: str
    text: str = ""
    done: bool = False


@dataclass(slots=True)
class ToolView:
    kind: ClassVar[str] = "tool"
    call_id: str
    name: str
    state: ToolState = "input-streaming"
    args_text: str = ""
    input: Any = None
    output: Any = None
    error: str | None = None


Part = TextView | ReasoningView | ToolView


@dataclass(slots=True)
class Turn:
    id: str
    role: Literal["user", "assistant"]
    parts: list[Part] = field(default_factory=list)


def _tool_view(part: Any) -> ToolView:
    name = getattr(part, "tool_name", None) or part.type.removeprefix("tool-")
    state = part.state
    view = ToolView(call_id=part.tool_call_id, name=name, input=part.input)
    if state == "output-available":
        view.state, view.output = "output-available", part.output
    elif state == "output-error":
        view.state, view.error = "output-error", part.error_text
    elif state == "input-available":
        view.state = "input-available"
    else:
        # `input-streaming` and the approval/denied family never reach the
        # store from this agent; whatever does show up renders as its arguments.
        view.state = "input-available" if part.input is not None else "input-streaming"
    return view


def _parts(message: UIMessage) -> list[Part]:
    parts: list[Part] = []
    for index, part in enumerate(message.parts):
        pid = f"{message.id}-{index}"
        if isinstance(part, TextUIPart):
            parts.append(TextView(id=pid, text=part.text, done=True))
        elif isinstance(part, ReasoningUIPart):
            parts.append(ReasoningView(id=pid, text=part.text, done=True))
        elif part.type == "dynamic-tool" or part.type.startswith("tool-"):
            parts.append(_tool_view(part))
        # step-start, source-*, file, data-*: nothing to show
    return parts


def from_ui_messages(messages: Sequence[UIMessage]) -> list[Turn]:
    """Merge consecutive assistant UIMessages into one Turn — /threads/{id} returns
    the tool part and the text part of one turn as two assistant messages."""
    turns: list[Turn] = []
    for message in messages:
        if message.role == "system":
            continue
        parts = _parts(message)
        if message.role == "assistant" and turns and turns[-1].role == "assistant":
            turns[-1].parts.extend(parts)
            continue
        turns.append(Turn(id=message.id, role=message.role, parts=parts))
    return turns
