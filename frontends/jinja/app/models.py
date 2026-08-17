"""What this backend can reach, and why — the data behind the hub's model picker.

Availability is a claim about credentials, so every candidate is listed either
way and carries its reason. A picker that silently drops a provider looks
exactly like one that never knew about it, and from the outside you can't tell
"no key" from "not wired for this backend".

pydantic-ai resolves credentials from the environment, so `via` here is always
the name of a variable that's set. The pi backends can also reach a login stored
by the `pi` CLI, and report that instead.
"""

from __future__ import annotations

import os
from dataclasses import dataclass
from typing import Any

from pydantic_ai.models import Model, infer_model

from .scripted import scripted_model

SCRIPTED = "scripted"
AUTO = "auto"
"""`DEMO_MODEL=auto` takes the first candidate whose credentials are present."""


@dataclass(frozen=True, slots=True)
class Candidate:
    id: str
    label: str
    spec: str
    """pydantic-ai's own spelling. The id is provider/model so every backend shares it."""
    env: tuple[str, ...]

    def credential(self) -> str | None:
        """The variable carrying this provider's key, if one of them is set."""
        return next((name for name in self.env if os.environ.get(name)), None)

    @property
    def missing(self) -> str:
        return f"no {' or '.join(self.env)}"


CANDIDATES: tuple[Candidate, ...] = (
    Candidate(
        id="openai/gpt-5.6-luna",
        label="OpenAI · gpt-5.6-luna",
        spec="openai:gpt-5.6-luna",
        env=("OPENAI_API_KEY",),
    ),
    Candidate(
        id="anthropic/claude-opus-5",
        label="Anthropic · claude-opus-5",
        spec="anthropic:claude-opus-5",
        env=("ANTHROPIC_API_KEY",),
    ),
    Candidate(
        id="google/gemini-3.1-pro-preview",
        label="Google · gemini-3.1-pro-preview",
        spec="google:gemini-3.1-pro-preview",
        env=("GOOGLE_API_KEY", "GEMINI_API_KEY"),
    ),
)
"""Ordered, and the order is what `auto` walks: OpenAI, then Anthropic, then Google."""

BY_ID = {candidate.id: candidate for candidate in CANDIDATES}


def entry(id: str, label: str, available: bool, via: str | None, why: str | None) -> dict[str, Any]:
    return {"id": id, "label": label, "available": available, "via": via, "why": why}


def catalogue(current: str) -> list[dict[str, Any]]:
    """Every candidate, available or not, plus whatever `DEMO_MODEL` set if it's off-list."""
    entries = [entry(SCRIPTED, "scripted", True, "built in", None)]
    for candidate in CANDIDATES:
        via = candidate.credential()
        entries.append(
            entry(candidate.id, candidate.label, via is not None, via, None if via else candidate.missing)
        )
    if current != SCRIPTED and current not in BY_ID:
        entries.append(entry(current, f"{current} · from DEMO_MODEL", True, "DEMO_MODEL", None))
    return entries


def build(model_id: str) -> Model:
    """The model behind an id. Off-list ids are pydantic-ai model strings, so `DEMO_MODEL` stays an escape hatch."""
    if model_id == SCRIPTED:
        return scripted_model()
    candidate = BY_ID.get(model_id)
    return infer_model(candidate.spec if candidate else model_id)


def unavailable(model_id: str) -> str | None:
    """Why this id can't be selected, or None if it can. The picker is a closed set; `DEMO_MODEL` isn't."""
    if model_id == SCRIPTED:
        return None
    candidate = BY_ID.get(model_id)
    if candidate is None:
        return f"unknown model {model_id!r} — GET /models lists what this backend offers"
    if candidate.credential() is None:
        return f"no credentials for {model_id} — set {' or '.join(candidate.env)}"
    return None


def initial(spec: str) -> str:
    """`DEMO_MODEL` as given, except `auto`, which resolves against what's actually configured."""
    if spec != AUTO:
        return spec
    return next((candidate.id for candidate in CANDIDATES if candidate.credential()), SCRIPTED)
