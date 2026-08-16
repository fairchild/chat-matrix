"""The reference agent. Every backend in the matrix implements this same shape.

Three tools, one per thing worth comparing: `get_weather` returns a small
structured value, `search_notes` returns a list worth rendering as cards, and
`analyze` takes long enough that you can watch a frontend handle a slow call.
"""

from __future__ import annotations

import asyncio
import os
from dataclasses import dataclass

from pydantic_ai import Agent
from pydantic_ai.models import Model

from .scripted import scripted_model

BACKEND_NAME = "pydantic-ai"
MODEL_SPEC = os.getenv("DEMO_MODEL", "scripted")

INSTRUCTIONS = """
You are the demo agent for a chat-UI comparison harness. Use the tools when they
fit the question, and keep answers short — the point is to show the frontend
rendering, not to write essays.
""".strip()


@dataclass(frozen=True, slots=True)
class Weather:
    city: str
    conditions: str
    temperature_c: int
    humidity_pct: int


@dataclass(frozen=True, slots=True)
class Note:
    title: str
    body: str
    tags: tuple[str, ...]


NOTES: tuple[Note, ...] = (
    Note(
        title="Streaming protocols",
        body="The Vercel AI data stream and AG-UI both ride SSE, but AG-UI carries "
        "explicit state-delta events where the AI SDK stream carries UI message parts.",
        tags=("protocol", "streaming"),
    ),
    Note(
        title="Tool-call rendering",
        body="Frontends differ most in the gap between a tool being called and its "
        "result arriving — some show args streaming in, some show only a spinner.",
        tags=("ui", "tools"),
    ),
    Note(
        title="Thread persistence",
        body="Client-authoritative history is the AI SDK default; the server keeps its "
        "own copy so a reload can rehydrate.",
        tags=("state", "persistence"),
    ),
    Note(
        title="Generative UI",
        body="Backend-driven components are where protocols diverge: AG-UI models it "
        "natively, the AI SDK route leans on typed tool results the client maps to components.",
        tags=("ui", "protocol"),
    ),
)

_CONDITIONS = ("clear", "overcast", "drizzle", "windy", "crisp and sunny")


def build_model(spec: str) -> Model | str:
    """`scripted` gives deterministic runs; anything else is a pydantic-ai model string."""
    return scripted_model() if spec == "scripted" else spec


agent = Agent(build_model(MODEL_SPEC), instructions=INSTRUCTIONS)


@agent.tool_plain
async def get_weather(city: str) -> Weather:
    """Current conditions for a city. Fast, small, structured."""
    await asyncio.sleep(0.2)
    seed = sum(ord(character) for character in city)
    return Weather(
        city=city,
        conditions=_CONDITIONS[seed % len(_CONDITIONS)],
        temperature_c=4 + seed % 26,
        humidity_pct=35 + seed % 50,
    )


@agent.tool_plain
async def search_notes(query: str) -> list[Note]:
    """Search the demo note corpus. Returns a list, so frontends can render cards."""
    await asyncio.sleep(0.4)
    terms = [term for term in query.lower().split() if len(term) > 2]
    hits = [
        note
        for note in NOTES
        if any(term in note.title.lower() or term in note.body.lower() for term in terms)
    ]
    return hits or list(NOTES[:2])


@agent.tool_plain
async def analyze(topic: str) -> str:
    """A deliberately slow analysis, for watching how a frontend handles latency."""
    await asyncio.sleep(3.0)
    return (
        f"Analysis of {topic!r}: three factors dominate — how the protocol frames "
        f"streaming, how much glue the frontend needs, and whether state survives a "
        f"reload. This backend took ~3s on purpose."
    )


TOOL_NAMES = ("get_weather", "search_notes", "analyze")
