"""Every byte of markup the browser sees comes through here.

`render` is Jinja with autoescape on; `markdown` runs markdown-it with HTML
disabled, so model text can't smuggle tags; `patch` is one NDJSON line — the
whole server→page protocol is these five ops (see the plan, §3.2).
"""

from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any, Literal

from jinja2 import ChoiceLoader, Environment, FileSystemLoader, TemplateNotFound, select_autoescape
from markdown_it import MarkdownIt
from markupsafe import Markup

ROOT = Path(__file__).resolve().parent.parent
TEMPLATES = ROOT / "templates"
STATIC = ROOT / "static"

INDEX_URL = os.getenv("INDEX_URL", "http://localhost:3000")

OVERRIDES = os.getenv("CHAT_TEMPLATES")
"""A directory searched before the packaged one, so a host app can replace any
template by name — `base.html` for its own chrome, `partials/tool_<name>.html`
for its own tools — without forking the rest."""

_loaders = [FileSystemLoader(TEMPLATES)]
if OVERRIDES:
    _loaders.insert(0, FileSystemLoader(OVERRIDES))

env = Environment(
    loader=ChoiceLoader(_loaders),
    autoescape=select_autoescape(default=True, default_for_string=True),
    trim_blocks=True,
    lstrip_blocks=True,
    auto_reload=True,
)

_md = MarkdownIt("commonmark", {"html": False, "linkify": False, "typographer": True})


def markdown(text: str) -> Markup:
    """Model text → HTML. `html=False` means literal tags in the text stay literal."""
    return Markup(_md.render(text))


def pretty_json(value: Any) -> str:
    return json.dumps(value, indent=2, ensure_ascii=False, default=str)


def tool_partial(name: str) -> str:
    """The card for a tool, by convention: `partials/tool_<name>.html` if it
    exists, the generic renderer otherwise. A host app's own tool gets a card
    by adding a file, not by editing a map here."""
    candidate = f"partials/tool_{name}.html"
    try:
        env.get_template(candidate)
    except TemplateNotFound:
        return "partials/tool_generic.html"
    return candidate


env.filters["markdown"] = markdown
env.filters["json"] = pretty_json
env.globals["index_url"] = INDEX_URL
env.globals["tool_partial"] = tool_partial


def render(name: str, **context: Any) -> str:
    return env.get_template(name).render(**context)


Op = Literal["append", "replace", "text", "done", "error"]


def patch(op: Op, target: str | None = None, **payload: Any) -> bytes:
    """One line of the patch stream. JSON escapes every newline in `text` and
    `html`, so a line break is only ever a frame boundary."""
    line: dict[str, Any] = {"op": op}
    if target is not None:
        line["target"] = target
    line.update(payload)
    return (json.dumps(line, ensure_ascii=False) + "\n").encode()
