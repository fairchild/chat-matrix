"""A deterministic model, so the frontend is the only thing under comparison.

Real providers make every run different, which is exactly what you don't want
when the question is "does this UI render tool calls well?". This model picks
tools by keyword and streams a canned answer at a visible pace. The tools
themselves still execute for real — only the model's choices are scripted.
"""

from __future__ import annotations

import asyncio
import json
import re
from collections import Counter
from collections.abc import AsyncIterator, Callable, Sequence
from dataclasses import dataclass

from pydantic_ai.messages import (
    ModelMessage,
    ModelRequest,
    ModelResponse,
    ToolCallPart,
    ToolReturnPart,
    UserPromptPart,
)
from pydantic_ai.models.function import AgentInfo, DeltaToolCall, FunctionModel

TOKEN_DELAY = 0.035
"""Slow enough to see tokens arrive, fast enough not to be annoying."""


@dataclass(frozen=True, slots=True)
class Plan:
    tool: str
    keywords: tuple[str, ...]
    build_args: Callable[[str], dict[str, str]]


def _city(text: str) -> str:
    match = re.search(r"\bin ([A-Z][\w'-]*(?: [A-Z][\w'-]*)*)", text)
    return match.group(1) if match else "San Francisco"


def _topic(text: str) -> str:
    stripped = re.sub(
        r"^\s*(please\s+)?(analyze|analyse|research|compare|dig into)\s+", "", text, flags=re.I
    )
    return stripped.strip(" ?.!") or text.strip(" ?.!")


PLANS: tuple[Plan, ...] = (
    Plan(
        tool="get_weather",
        keywords=("weather", "forecast", "temperature", "rain", "sunny", "cold"),
        build_args=lambda text: {"city": _city(text)},
    ),
    Plan(
        tool="search_notes",
        keywords=("note", "notes", "search", "find", "look up", "remember"),
        build_args=lambda text: {"query": _topic(text)},
    ),
    Plan(
        tool="analyze",
        keywords=("analyze", "analyse", "research", "compare", "deep dive", "investigate"),
        build_args=lambda text: {"topic": _topic(text)},
    ),
)


def _latest_user_text(messages: Sequence[ModelMessage]) -> str:
    # Attachments make `content` a list of `str | BinaryContent`, so matching on
    # `str` alone reads an empty prompt the moment a file rides along — every
    # keyword misses and the model falls through to its canned intro.
    for message in reversed(messages):
        if not isinstance(message, ModelRequest):
            continue
        for part in message.parts:
            if isinstance(part, UserPromptPart):
                if isinstance(part.content, str):
                    return part.content
                return " ".join(c for c in part.content if isinstance(c, str))
    return ""


def _pending_tool_returns(messages: Sequence[ModelMessage]) -> list[ToolReturnPart]:
    last = messages[-1] if messages else None
    if not isinstance(last, ModelRequest):
        return []
    return [part for part in last.parts if isinstance(part, ToolReturnPart)]


def _matching_plans(text: str) -> list[Plan]:
    lowered = text.lower()
    return [plan for plan in PLANS if any(word in lowered for word in plan.keywords)]


async def _emit_text(text: str) -> AsyncIterator[str]:
    for token in re.findall(r"\S+\s*", text):
        await asyncio.sleep(TOKEN_DELAY)
        yield token


def _calls_so_far(messages: Sequence[ModelMessage]) -> Counter[str]:
    """How many times each tool has already been called in this thread.

    The id has to be unique across the thread, not the run: a client keyed on
    `tool_call_id` — which is every AI SDK client — treats one id as one call,
    so a second `get_weather` numbered from zero again merges into the first
    and renders its result against the first call's card on reload.
    """
    return Counter(
        part.tool_name
        for message in messages
        if isinstance(message, ModelResponse)
        for part in message.parts
        if isinstance(part, ToolCallPart)
    )


async def _emit_tool_calls(
    plans: Sequence[Plan], user_text: str, history: Sequence[ModelMessage]
) -> AsyncIterator[dict[int, DeltaToolCall]]:
    seen = _calls_so_far(history)
    for index, plan in enumerate(plans):
        args = json.dumps(plan.build_args(user_text))
        call_id = f"call_{plan.tool}_{seen[plan.tool]}"
        seen[plan.tool] += 1
        yield {index: DeltaToolCall(name=plan.tool, tool_call_id=call_id)}
        # Split the arguments so the UI has a chance to show them streaming in.
        midpoint = len(args) // 2
        for chunk in (args[:midpoint], args[midpoint:]):
            await asyncio.sleep(TOKEN_DELAY)
            yield {index: DeltaToolCall(json_args=chunk)}


def _summary(returns: Sequence[ToolReturnPart]) -> str:
    named = ", ".join(sorted({part.tool_name for part in returns}))
    lines = [f"Here's what I found (via {named}).", ""]
    for part in returns:
        lines.append(f"- **{part.tool_name}** returned: {part.content}")
    lines.append("")
    lines.append("Ask a follow-up and I'll keep going.")
    return "\n".join(lines)


async def _stream(
    messages: list[ModelMessage], info: AgentInfo
) -> AsyncIterator[str | dict[int, DeltaToolCall]]:
    returns = _pending_tool_returns(messages)
    if returns:
        async for token in _emit_text(_summary(returns)):
            yield token
        return

    user_text = _latest_user_text(messages)
    available = {tool.name for tool in info.function_tools}
    plans = [plan for plan in _matching_plans(user_text) if plan.tool in available]

    if plans:
        async for call in _emit_tool_calls(plans, user_text, messages):
            yield call
        return

    async for token in _emit_text(
        "I'm the scripted demo model, so I answer from a fixed script rather than a "
        "provider. Try asking about **the weather in Tokyo**, telling me to "
        "**search notes for streaming**, or asking me to **analyze assistant-ui** — "
        "each one exercises a different tool so you can see how this frontend renders it."
    ):
        yield token


def scripted_model() -> FunctionModel:
    return FunctionModel(stream_function=_stream, model_name="scripted")
