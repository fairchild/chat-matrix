// Builds artifacts/index.html: every capture, one row per moment, one column per
// frontend. The point of the harness is the side-by-side, and a directory of PNGs
// isn't one.
//
// Captures are keyed by backend, so the gallery accumulates: run the flows
// against cloudflare-agents and then against pi, and each moment gets one band
// per backend, captioned. Nothing is overwritten and nothing is anonymous —
// which is the whole reason to key the artifacts, since a cross-backend
// rendering diff is most of what the matrix is for.
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { loadFlows } from "./flow.ts";
import { matrixOrder, outsideGrid, ROOT } from "./frontends.ts";
import type { Shot } from "./runner.ts";

type Entry = { backend: string; flow: string; axis: string; frontend: string; shots: Shot[] };

const ARTIFACTS = join(ROOT, "probes", "artifacts");
const MANIFEST = join(ARTIFACTS, "manifest");

if (!existsSync(MANIFEST)) {
  console.error("probes: no captures yet — run ./scripts/probe.sh first");
  process.exit(1);
}

const manifest: Entry[] = readdirSync(MANIFEST)
  .filter((f) => f.endsWith(".json"))
  .map((f) => JSON.parse(readFileSync(join(MANIFEST, f), "utf8")) as Entry);
const flows = loadFlows(join(ROOT, "probes", "flows.yaml"));
const order = matrixOrder();

const escape = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** stacks.sh order first, then anything it doesn't list, alphabetically. */
const by = (list: string[]) => (a: string, b: string) => {
  const rank = (n: string) => (list.indexOf(n) === -1 ? list.length : list.indexOf(n));
  return rank(a) - rank(b) || a.localeCompare(b);
};

const band = (heading: string, note: string, figures: string) => `<div class="band">
  <h4>${escape(heading)}${note ? `<span class="note">${escape(note)}</span>` : ""}</h4>
  <div class="row">${figures}</div>
</div>`;

const OUTSIDE_NOTE =
  "one process, its own agent — it ignores ?backend=, so this is the same capture whichever backend a run drives";

const sections = flows
  .map((flow) => {
    const entries = manifest.filter((m) => m.flow === flow.flow);
    if (entries.length === 0) return "";

    // A cell that runs its own agent is filed under its own name rather than a
    // backend's, and shown once per moment: putting it in a per-backend band
    // would claim it varies by backend, which is exactly what it doesn't do.
    const grid = entries.filter((e) => !outsideGrid(e.frontend));
    const outside = entries.filter((e) => outsideGrid(e.frontend));

    const columns = order.cells.filter((n) => grid.some((e) => e.frontend === n));
    const backends = [...new Set(grid.map((e) => e.backend))].sort(by(order.backends));

    // Capture order comes from the flow, not from whichever cell finished first.
    const labels: string[] = [];
    for (const step of flow.steps) {
      if (step.kind === "capture" && !labels.includes(step.label)) labels.push(step.label);
    }

    const figure = (caption: string, entry: Entry | undefined, label: string) => {
      const shot = entry?.shots.find((s) => s.label === label);
      const src = shot ? `${entry!.backend}/${flow.flow}/${basename(shot.path)}` : "";
      const body = shot
        ? `<a href="${src}" target="_blank">
             <img loading="lazy" src="${src}" alt="${escape(caption)} — ${escape(label)}">
           </a>`
        : `<div class="missing">not captured</div>`;
      return `<figure><figcaption>${escape(caption)}</figcaption>${body}</figure>`;
    };

    const rows = labels
      .map((label) => {
        const bands = [
          ...backends.map((backend) =>
            band(
              backend,
              "",
              columns
                .map((name) =>
                  figure(
                    name,
                    grid.find((e) => e.backend === backend && e.frontend === name),
                    label,
                  ),
                )
                .join(""),
            ),
          ),
          ...(outside.length
            ? [
                band(
                  "outside the grid",
                  OUTSIDE_NOTE,
                  outside.map((e) => figure(e.frontend, e, label)).join(""),
                ),
              ]
            : []),
        ].join("");
        const step = entries[0]?.shots.find((s) => s.label === label)?.step ?? label;
        return `<section class="moment">
          <h3>${escape(label)} <code>${escape(step)}</code></h3>
          ${bands}
        </section>`;
      })
      .join("");

    const video = (name: string, backend: string) =>
      `<figure><figcaption>${escape(name)}</figcaption>
         <video controls preload="metadata" src="${backend}/${flow.flow}/video/${name}.webm"></video></figure>`;

    const recordings = [
      ...backends.map((backend) =>
        band(
          backend,
          "",
          columns
            .filter((name) => grid.some((e) => e.backend === backend && e.frontend === name))
            .map((name) => video(name, backend))
            .join(""),
        ),
      ),
      ...(outside.length
        ? [
            band(
              "outside the grid",
              OUTSIDE_NOTE,
              outside.map((e) => video(e.frontend, e.backend)).join(""),
            ),
          ]
        : []),
    ].join("");

    return `<article>
      <header>
        <h2>${escape(flow.flow)}</h2>
        <p class="axis">${escape(flow.axis)}</p>
        <p class="about">${escape(flow.about)}</p>
        <details><summary>steps</summary><pre>${escape(flow.source.join("\n"))}</pre></details>
      </header>
      ${rows}
      <section class="moment"><h3>recordings</h3>${recordings}</section>
    </article>`;
  })
  .join("");

const drivenBackends = [...new Set(manifest.filter((m) => !outsideGrid(m.frontend)).map((m) => m.backend))]
  .sort(by(order.backends));
const drivenLine = drivenBackends.length
  ? `Backends in this gallery: ${drivenBackends.map((b) => `<code>${escape(b)}</code>`).join(", ")}.`
  : "";

const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>probes — chat-stack matrix</title>
<style>
  :root { color-scheme: light dark; --line: color-mix(in oklab, currentColor 15%, transparent); }
  body { font: 15px/1.55 ui-sans-serif, system-ui, sans-serif; margin: 0 auto; padding: 2rem 1.5rem 5rem; max-width: 1600px; }
  h1 { font-size: 1.4rem; margin: 0 0 .25rem; }
  .lede { opacity: .7; max-width: 62ch; margin: 0 0 2.5rem; }
  article { border-top: 1px solid var(--line); padding-top: 1.5rem; margin-top: 2.5rem; }
  article > header h2 { font-size: 1.15rem; margin: 0; }
  .axis { margin: .15rem 0 .5rem; font-size: .82rem; text-transform: uppercase; letter-spacing: .04em; opacity: .6; }
  .about { margin: 0 0 .75rem; max-width: 70ch; opacity: .85; }
  details { margin-bottom: 1rem; } summary { cursor: pointer; font-size: .85rem; opacity: .7; }
  pre { background: color-mix(in oklab, currentColor 6%, transparent); padding: .75rem 1rem; border-radius: 8px; overflow-x: auto; font-size: .8rem; }
  .moment h3 { font-size: .9rem; font-weight: 600; margin: 1.5rem 0 .6rem; display: flex; gap: .6rem; align-items: baseline; flex-wrap: wrap; }
  .moment h3 code { font-weight: 400; font-size: .78rem; opacity: .55; }
  .band { border-left: 2px solid var(--line); padding-left: .9rem; margin: 0 0 1.2rem; }
  .band h4 { font-size: .8rem; margin: 0 0 .45rem; display: flex; gap: .6rem; align-items: baseline; flex-wrap: wrap; }
  .band h4 .note { font-weight: 400; font-size: .75rem; opacity: .55; max-width: 60ch; }
  /* auto-fill, not auto-fit: the outside-the-grid band holds a single figure, and
     an empty track keeps it the same width as the cells above it rather than
     blowing it up to the full row. */
  .row { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 1rem; align-items: start; }
  figure { margin: 0; }
  figcaption { font-size: .78rem; opacity: .6; margin-bottom: .35rem; }
  img, video { width: 100%; border: 1px solid var(--line); border-radius: 8px; display: block; background: #fff; }
  .missing { border: 1px dashed var(--line); border-radius: 8px; padding: 2rem; text-align: center; font-size: .8rem; opacity: .5; }
</style></head>
<body>
  <h1>probes</h1>
  <p class="lede">Every flow in <code>probes/flows.yaml</code>, run against every frontend in
  <code>scripts/stacks.sh</code>, captured at the same moments. The scripted model makes the work
  identical across cells, so any difference within a band is the stack — and any difference between
  bands is the backend. ${drivenLine}</p>
  ${sections}
</body></html>`;

writeFileSync(join(ARTIFACTS, "index.html"), html);
console.log(`gallery → ${join(ARTIFACTS, "index.html")}`);
