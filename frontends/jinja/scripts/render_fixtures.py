#!/usr/bin/env python
"""Every partial, in every state, without the stream.

Template work is otherwise only checkable by driving a live run and catching the
right millisecond. This builds the view models by hand instead, renders whole
pages through the real Jinja env, and shoots each one light and dark. Output
lands in `.fixtures/`: one `.html` you can open, one `.png` per colour scheme.

    uv run python scripts/render_fixtures.py            # render + screenshot
    uv run python scripts/render_fixtures.py --no-shots # render only

Playwright comes from `probes/node_modules` — the Python package isn't installed
here, and there's no reason to install a second copy of Chromium.
"""

from __future__ import annotations

import json
import subprocess
import sys
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from app.html import render  # noqa: E402
from app.store import ThreadSummary  # noqa: E402
from app.views import ReasoningView, TextView, ToolView, Turn  # noqa: E402

OUT = ROOT / ".fixtures"
PLAYWRIGHT = ROOT.parent.parent / "probes" / "node_modules" / "playwright" / "index.js"

BADGE = "pydantic-ai · scripted · agent in-process"
SUGGESTIONS = (
    ("What's the weather in Tokyo?", "fast structured tool"),
    ("Search notes for streaming protocols.", "a list to render"),
    ("Analyze assistant-ui as a chat frontend.", "slow (~3s) call"),
)
THREADS = [
    ThreadSummary("t-weather", "What's the weather in Tokyo?", "2026-08-16T09:12:00+00:00", "2026-08-16T09:12:04+00:00", 4),
    ThreadSummary("t-notes", "Search notes for streaming protocols.", "2026-08-16T08:40:00+00:00", "2026-08-16T08:41:10+00:00", 4),
    ThreadSummary("t-analyze", "Analyze assistant-ui as a chat frontend.", "2026-08-15T22:05:00+00:00", "2026-08-15T22:05:09+00:00", 4),
    ThreadSummary("t-long", "Compare AG-UI and the Vercel AI data stream for tool rendering", "2026-08-15T19:30:00+00:00", "2026-08-15T19:33:00+00:00", 12),
    ThreadSummary("t-hello", "Hello", "2026-08-14T11:02:00+00:00", "2026-08-14T11:02:03+00:00", 2),
]

WEATHER_OUT = {
    "city": "Tokyo",
    "conditions": "crisp and sunny",
    "temperature_c": 18,
    "humidity_pct": 69,
}
NOTES_OUT = [
    {
        "title": "Streaming protocols",
        "body": "The Vercel AI data stream and AG-UI both ride SSE, but AG-UI carries "
        "explicit state-delta events where the AI SDK stream carries UI message parts.",
        "tags": ["protocol", "streaming"],
    },
    {
        "title": "Tool-call rendering",
        "body": "Frontends differ most in the gap between a tool being called and its "
        "result arriving — some show args streaming in, some show only a spinner.",
        "tags": ["ui", "tools"],
    },
    {
        "title": "Generative UI",
        "body": "Backend-driven components are where protocols diverge: AG-UI models it "
        "natively, the AI SDK route leans on typed tool results the client maps to components.",
        "tags": ["ui", "protocol"],
    },
]
ANALYSIS_OUT = (
    "Analysis of 'assistant-ui as a chat frontend': three factors dominate — how the "
    "protocol frames streaming, how much glue the frontend needs, and whether state "
    "survives a reload. This backend took ~3s on purpose."
)

# The scripted model's real answer shape, so the fixtures match what the probes see.
WEATHER_ANSWER = """Here's what I found (via get_weather).

- **get_weather** returned: Weather(city='Tokyo', conditions='crisp and sunny', temperature_c=18, humidity_pct=69)

Ask a follow-up and I'll keep going."""

NOTES_ANSWER = """Here's what I found (via search_notes).

- **search_notes** returned: 3 notes on streaming, tool rendering and generative UI.

Ask a follow-up and I'll keep going."""

MARKDOWN_KITCHEN = """Rendered server-side by `markdown-it-py`, with `html=False`, so a
literal <script> in model text stays literal.

### What the stream carries

1. `TextStartChunk` opens a part and the raw text streams into a `<pre>`.
2. `TextDeltaChunk` appends text nodes — never HTML.
3. `TextEndChunk` swaps the whole part for this.

- **strong** and *emphasis* and `inline code`
- a [link](https://example.com) that stays in the flow
- a nested list:
  - one
  - two

```python
async for chunk in adapter.run_stream(message_history=history):
    yield patch(*translate(chunk))
```

> The browser holds no state beyond the DOM.
"""


def user(mid: str, text: str) -> Turn:
    return Turn(id=mid, role="user", parts=[TextView(id=f"{mid}-0", text=text, done=True)])


def assistant(mid: str, *parts: Any) -> Turn:
    return Turn(id=mid, role="assistant", parts=list(parts))


def tool(call_id: str, name: str, state: str, **kw: Any) -> ToolView:
    return ToolView(call_id=call_id, name=name, state=state, **kw)


@dataclass(slots=True)
class Scene:
    name: str
    turns: list[Turn]
    thread_id: str = "t-weather"
    state: str = "idle"
    threads: list[ThreadSummary] = field(default_factory=lambda: THREADS)
    width: int = 1280
    height: int = 900
    scroll: bool = False
    inject: tuple[str, str] | None = None  # (parts id, rendered fragment)


SCENES: list[Scene] = [
    Scene("empty", [], thread_id="t-new"),
    Scene("empty--first-run", [], thread_id="t-new", threads=[]),
    Scene(
        "weather",
        [
            user("m1", "What's the weather in Tokyo?"),
            assistant(
                "m2",
                tool("c1", "get_weather", "output-available", input={"city": "Tokyo"}, output=WEATHER_OUT),
                TextView(id="m2-1", text=WEATHER_ANSWER, done=True),
            ),
        ],
    ),
    Scene(
        "notes",
        [
            user("m1", "Search notes for streaming protocols."),
            assistant(
                "m2",
                tool("c1", "search_notes", "output-available", input={"query": "streaming protocols"}, output=NOTES_OUT),
                TextView(id="m2-1", text=NOTES_ANSWER, done=True),
            ),
        ],
        thread_id="t-notes",
    ),
    Scene(
        "analyze--in-flight",
        [
            user("m1", "Analyze assistant-ui as a chat frontend."),
            assistant("m2", tool("c1", "analyze", "input-available", input={"topic": "assistant-ui as a chat frontend"})),
        ],
        thread_id="t-analyze",
        state="busy",
    ),
    Scene(
        "analyze--done",
        [
            user("m1", "Analyze assistant-ui as a chat frontend."),
            assistant(
                "m2",
                tool("c1", "analyze", "output-available", input={"topic": "assistant-ui as a chat frontend"}, output=ANALYSIS_OUT),
                TextView(id="m2-1", text="Here's what I found (via analyze).\n\nAsk a follow-up and I'll keep going.", done=True),
            ),
        ],
        thread_id="t-analyze",
    ),
    Scene(
        "tool--input-streaming",
        [
            user("m1", "What's the weather in Tokyo?"),
            assistant("m2", tool("c1", "get_weather", "input-streaming", args_text='{"city": "Tok')),
        ],
        state="busy",
    ),
    Scene(
        "text--streaming",
        [
            user("m1", "What's the weather in Tokyo?"),
            assistant(
                "m2",
                tool("c1", "get_weather", "output-available", input={"city": "Tokyo"}, output=WEATHER_OUT),
                TextView(id="m2-1", text="Here's what I found (via get_weather).\n\n- **get_weather** returned: Weather(city='Tokyo', condi", done=False),
            ),
        ],
        state="busy",
    ),
    Scene(
        "markdown",
        [
            user("m1", "Show me everything the renderer handles."),
            assistant("m2", TextView(id="m2-0", text=MARKDOWN_KITCHEN, done=True)),
        ],
        scroll=True,
    ),
    Scene(
        "reasoning",
        [
            user("m1", "Think it through, then answer."),
            assistant(
                "m2",
                ReasoningView(id="m2-0", text="The prompt matches two plans, so both tools run before any text.\nOrder matters only for the transcript.", done=True),
                ReasoningView(id="m2-1", text="Still deciding whether the notes search is worth", done=False),
                TextView(id="m2-2", text="Both tools ran. Ask a follow-up and I'll keep going.", done=True),
            ),
        ],
    ),
    Scene(
        "tool--generic",
        [
            user("m1", "Run the tool nobody wrote a card for."),
            assistant(
                "m2",
                tool("c1", "unregistered_tool", "output-available", input={"query": "streaming", "limit": 3},
                     output={"rows": [{"id": 7, "score": 0.91}], "elapsed_ms": 42}),
                tool("c2", "another_unknown", "input-available", input={"mode": "dry-run"}),
            ),
        ],
    ),
    Scene(
        "tool--errors",
        [
            user("m1", "Break every tool."),
            assistant(
                "m2",
                tool("c1", "get_weather", "output-error", input={"city": "Atlantis"}, error="Unknown city 'Atlantis'."),
                tool("c2", "search_notes", "output-error", input={"query": "x"}, error="The note corpus is unavailable."),
                tool("c3", "analyze", "output-error", input={"topic": "x"}, error="Timed out after 30s."),
                tool("c4", "unregistered_tool", "output-error", input={"mode": "dry-run"}, error="No such tool."),
            ),
        ],
        scroll=True,
    ),
    Scene(
        "error",
        [
            user("m1", "What's the weather in Tokyo?"),
            assistant("m2", tool("c1", "get_weather", "output-available", input={"city": "Tokyo"}, output=WEATHER_OUT)),
        ],
        inject=("parts-m2", "error"),
    ),
    Scene(
        "thread--long",
        [
            user("m1", "What's the weather in Tokyo?"),
            assistant(
                "m2",
                tool("c1", "get_weather", "output-available", input={"city": "Tokyo"}, output=WEATHER_OUT),
                TextView(id="m2-1", text=WEATHER_ANSWER, done=True),
            ),
            user("m3", "Now search notes for streaming protocols and analyze the result."),
            assistant(
                "m4",
                tool("c2", "search_notes", "output-available", input={"query": "streaming protocols"}, output=NOTES_OUT),
                tool("c3", "analyze", "output-available", input={"topic": "the result"}, output=ANALYSIS_OUT),
                TextView(id="m4-2", text="Here's what I found (via analyze, search_notes).\n\nAsk a follow-up and I'll keep going.", done=True),
            ),
        ],
        thread_id="t-long",
        scroll=True,
    ),
    Scene(
        "narrow",
        [
            user("m1", "What's the weather in Tokyo?"),
            assistant(
                "m2",
                tool("c1", "get_weather", "output-available", input={"city": "Tokyo"}, output=WEATHER_OUT),
                TextView(id="m2-1", text=WEATHER_ANSWER, done=True),
            ),
        ],
        width=420,
        height=880,
        scroll=True,
    ),
]


def page(scene: Scene) -> str:
    html = render(
        "thread.html",
        turns=scene.turns,
        thread_id=scene.thread_id,
        threads=scene.threads,
        badge=BADGE,
        suggestions=SUGGESTIONS,
        state=scene.state,
    )
    if scene.inject:
        target, kind = scene.inject
        anchor = f'<div class="parts" id="{target}">'
        fragment = render("partials/error.html", error="get_weather raised ConnectionError: the tool host went away mid-run.")
        assert anchor in html, f"{scene.name}: no anchor {anchor!r} to inject {kind} into"
        html = html.replace(anchor, anchor + "\n" + fragment)
    # A fixture is opened over file://, where /static and /app.js don't exist.
    return html.replace('href="/static/app.css"', 'href="../static/app.css"').replace(
        '<script src="/app.js" defer></script>', ""
    )


SHOOTER = """
import playwright from "file://{playwright}";
import {{ readFileSync }} from "node:fs";

const {{ chromium }} = playwright;

const dir = new URL(".", import.meta.url).pathname;
const shots = JSON.parse(readFileSync(dir + "shots.json", "utf8"));
const browser = await chromium.launch();
for (const scheme of ["light", "dark"]) {{
  const context = await browser.newContext({{ colorScheme: scheme }});
  const page = await context.newPage();
  for (const shot of shots) {{
    await page.setViewportSize({{ width: shot.width, height: shot.height }});
    await page.goto("file://" + dir + shot.name + ".html");
    if (shot.scroll) {{
      await page.evaluate(() => {{
        const t = document.getElementById("transcript");
        if (t) t.scrollTop = t.scrollHeight;
      }});
    }}
    const suffix = scheme === "dark" ? "--dark" : "";
    await page.screenshot({{ path: dir + shot.name + suffix + ".png", animations: "disabled" }});
  }}
  await context.close();
}}
await browser.close();
console.log(`shot ${{shots.length * 2}} screenshots`);
"""


def main() -> int:
    OUT.mkdir(exist_ok=True)
    for scene in SCENES:
        (OUT / f"{scene.name}.html").write_text(page(scene), encoding="utf-8")
    print(f"rendered {len(SCENES)} fixtures → {OUT.relative_to(ROOT)}/")

    if "--no-shots" in sys.argv:
        return 0
    if not PLAYWRIGHT.exists():
        print(f"no playwright at {PLAYWRIGHT}; run `bun install` in probes/", file=sys.stderr)
        return 1

    (OUT / "shots.json").write_text(
        json.dumps(
            [
                {"name": s.name, "width": s.width, "height": s.height, "scroll": s.scroll}
                for s in SCENES
            ]
        ),
        encoding="utf-8",
    )
    (OUT / "shoot.mjs").write_text(SHOOTER.format(playwright=PLAYWRIGHT), encoding="utf-8")
    return subprocess.run(["node", str(OUT / "shoot.mjs")], check=False).returncode


if __name__ == "__main__":
    raise SystemExit(main())
