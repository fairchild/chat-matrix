#!/usr/bin/env -S uv run --with markdown-it-py
"""Render each stack's Ergonomics notes (and a few named neighbours) as pages.

The notes stay authored as markdown in the directory they describe —
backends/<name>/README.md, frontends/<name>/README.md — because that's the
copy someone actually edits while working in that stack. This script is the
only thing that reads them for the site; it never writes them, and its own
output is never committed (see .gitignore) so there is exactly one source of
truth and one staleness clock.

    uv run index/generate_notes.py --out DIR --backend NAME [--backend NAME ...] --frontend NAME [...]

DIR gets one file per stack (<name>.html) plus an index.html grouped by axis.
Callers (scripts/run.sh, scripts/hosted.sh's build_index) already have the
stack list from scripts/stacks.sh — this script takes it as arguments rather
than a second copy of it.
"""

from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path

from markdown_it import MarkdownIt

ROOT = Path(__file__).resolve().parent.parent
MD = MarkdownIt("commonmark")

# The floor is "Ergonomics notes" — every stack has one, and a stack that
# doesn't fails the build (see extract()). Everything else is optional: named
# explicitly, in the order it reads best, so a new "## " heading in a README
# doesn't silently appear on the site and a missing one is just absent rather
# than broken.
HEADINGS = [
    "Ergonomics notes",
    "How it maps to the contract",
    "Why this style",
    "Setup papercuts",
    "Not implemented",
    "Inert components",
    "Not an AI Elements problem",
    "Not a CopilotKit problem",
]
FLOOR = HEADINGS[0]

# A relative link only resolves inside a clone; index/index.html's own footer
# already drops these to plain text while REPO is unset rather than link to
# nowhere, and generated pages follow the same rule.
RELATIVE_LINK = re.compile(r"\[([^\]]+)\]\(((?!https?://|#)[^)]+)\)")


class Stack:
    def __init__(self, kind: str, name: str):
        self.kind = kind  # "backend" | "frontend"
        self.name = name
        self.readme = ROOT / f"{kind}s" / name / "README.md"


def sections_of(stack: Stack) -> dict[str, str]:
    if not stack.readme.exists():
        sys.exit(f"generate_notes: {stack.readme} does not exist")
    lines = stack.readme.read_text().split("\n")
    headings = [(i, line[3:].strip()) for i, line in enumerate(lines) if line.startswith("## ")]
    bounds = [start for start, _ in headings] + [len(lines)]
    found = {}
    for idx, (start, title) in enumerate(headings):
        if title not in HEADINGS:
            continue
        body = "\n".join(lines[start + 1 : bounds[idx + 1]]).strip("\n")
        found[title] = body
    if FLOOR not in found:
        sys.exit(
            f"generate_notes: {stack.readme} has no '## {FLOOR}' section — "
            "every stack README ends with one; add it before this can build."
        )
    return found


def render(body: str) -> str:
    delinked = RELATIVE_LINK.sub(lambda m: f"{m.group(1)} (`{m.group(2)}`)", body)
    return MD.render(delinked)


STYLE = """
  :root {
    --bg: #fbfbfa; --panel: #fff; --ink: #18181b; --dim: #71717a; --faint: #a1a1aa;
    --line: #e4e4e7; --accent: #18181b; --up: #16a34a; --down: #d4d4d8; --chip: #f4f4f5;
  }
  @media (prefers-color-scheme: dark) {
    :root {
      --bg: #0c0c0d; --panel: #151517; --ink: #ededee; --dim: #8b8b93; --faint: #6b6b73;
      --line: #27272a; --accent: #ededee; --up: #4ade80; --down: #3f3f46; --chip: #1f1f23;
    }
  }
  * { box-sizing: border-box; }
  body {
    margin: 0; padding: 48px 24px 80px; background: var(--bg); color: var(--ink);
    font: 15px/1.6 ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
  }
  .wrap { max-width: 760px; margin: 0 auto; }
  .crumb { margin: 0 0 18px; font-size: 12.5px; display: flex; gap: 14px; }
  .crumb a { color: var(--dim); text-decoration: none; border-bottom: 1px solid var(--line); padding-bottom: 1px; }
  .crumb a:hover { color: var(--ink); border-color: var(--accent); }
  h1 { font-size: 26px; margin: 0 0 6px; letter-spacing: -0.02em; }
  .lede { color: var(--dim); margin: 0 0 10px; max-width: 66ch; }
  h2 { font-size: 13px; text-transform: uppercase; letter-spacing: 0.08em; color: var(--dim);
       margin: 40px 0 12px; font-weight: 600; }
  h3 { font-size: 16px; margin: 30px 0 8px; letter-spacing: -0.01em; }
  h3 a { text-decoration: none; }
  h3 a:hover { text-decoration: underline; }
  p, ul, ol { max-width: 68ch; }
  ul, ol { padding-left: 20px; margin: 10px 0; }
  li { margin: 3px 0; }
  blockquote { margin: 10px 0; padding-left: 14px; border-left: 2px solid var(--line); color: var(--dim); }
  a { color: inherit; }
  code, .mono { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
  code { background: var(--chip); padding: 1px 5px; border-radius: 4px; font-size: 12.5px; }
  pre {
    margin: 10px 0; padding: 13px 15px; border: 1px solid var(--line); border-radius: 8px;
    background: var(--panel); overflow-x: auto; font-size: 12.5px; line-height: 1.6;
  }
  pre code { background: none; padding: 0; }

  .stacks { display: grid; gap: 8px; margin-top: 4px; }
  .stack {
    display: flex; flex-wrap: wrap; align-items: baseline; gap: 4px 12px;
    padding: 13px 15px; border: 1px solid var(--line); border-radius: 8px;
    background: var(--panel); text-decoration: none; color: inherit;
  }
  .stack:hover { border-color: var(--accent); }
  .stack .name { font-weight: 600; font-size: 13.5px; flex: none; }
  .stack .why { margin: 0; padding: 0; color: var(--dim); font-size: 12.5px; }
  .stack .go { margin-left: auto; font-size: 12.5px; color: var(--dim); flex: none; }
  .stack:hover .go { color: var(--ink); }

  footer { margin-top: 48px; color: var(--dim); font-size: 12.5px; }
  footer a { text-decoration: none; border-bottom: 1px solid var(--line); }
  footer a:hover { color: var(--ink); border-color: var(--accent); }
"""


def page(title: str, crumb: str, body: str) -> str:
    return f"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>{title} · chat-stack matrix</title>
<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'%3E%3Cg fill='%2371717a'%3E%3Crect x='1' y='1' width='6' height='6' rx='1.5'/%3E%3Crect x='9' y='1' width='6' height='6' rx='1.5'/%3E%3Crect x='1' y='9' width='6' height='6' rx='1.5'/%3E%3C/g%3E%3Crect x='9' y='9' width='6' height='6' rx='1.5' fill='%234ade80'/%3E%3C/svg%3E" />
<style>{STYLE}</style>
</head>
<body>
<div class="wrap">
  <p class="crumb">{crumb}</p>
{body}
</div>
</body>
</html>
"""


def stack_page(stack: Stack, found: dict[str, str]) -> str:
    body = [f"<h1>{stack.name}</h1>", f'<p class="lede">Ergonomics notes from <code>{stack.kind}s/{stack.name}/README.md</code>.</p>']
    for heading in HEADINGS:
        if heading not in found:
            continue
        body.append(f"<h2>{heading}</h2>")
        body.append(render(found[heading]))
    body.append(f'<footer>Source: <code>{stack.kind}s/{stack.name}/README.md</code>. <a href="index.html">← all notes</a></footer>')
    crumb = '<a href="../">← matrix</a><a href="index.html">← all notes</a>'
    return page(stack.name, crumb, "\n".join(body))


def index_page(stacks: list[Stack], found_by_stack: dict[str, dict[str, str]]) -> str:
    body = [
        "<h1>Ergonomics notes</h1>",
        '<p class="lede">Every stack ends its README with what building it actually cost — '
        "what surprised us, what we’d pick again. Grouped the way the matrix is: backends "
        "across, frontends down.</p>",
    ]
    for kind, label in (("backend", "Backends"), ("frontend", "Frontends")):
        body.append(f"<h2>{label}</h2>")
        for stack in stacks:
            if stack.kind != kind:
                continue
            found = found_by_stack[stack.name]
            body.append(f'<h3><a href="{stack.name}.html">{stack.name}</a></h3>')
            if FLOOR in found:
                body.append(render(found[FLOOR]))
            more = [h for h in HEADINGS[1:] if h in found]
            if more:
                body.append(
                    f'<p class="lede">Also on its page: {", ".join(more)}. '
                    f'<a href="{stack.name}.html">full notes →</a></p>'
                )
    body.append('<footer><a href="../">← matrix</a></footer>')
    return page("ergonomics notes", '<a href="../">← matrix</a>', "\n".join(body))


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--out", required=True, type=Path)
    parser.add_argument("--backend", action="append", default=[], dest="backends")
    parser.add_argument("--frontend", action="append", default=[], dest="frontends")
    args = parser.parse_args()

    stacks = [Stack("backend", name) for name in args.backends] + [Stack("frontend", name) for name in args.frontends]
    if not stacks:
        sys.exit("generate_notes: no --backend or --frontend given")

    found_by_stack = {stack.name: sections_of(stack) for stack in stacks}

    args.out.mkdir(parents=True, exist_ok=True)
    for stack in stacks:
        (args.out / f"{stack.name}.html").write_text(stack_page(stack, found_by_stack[stack.name]))
    (args.out / "index.html").write_text(index_page(stacks, found_by_stack))
    print(f"generate_notes: {len(stacks)} stacks → {args.out}/")


if __name__ == "__main__":
    main()
