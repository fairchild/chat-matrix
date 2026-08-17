// Builds artifacts/index.html: every capture, one row per moment, one column per
// frontend. The point of the harness is the side-by-side, and a directory of PNGs
// isn't one.
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { loadFlows } from "./flow.ts";
import { frontends, ROOT } from "./frontends.ts";
import type { Shot } from "./runner.ts";

type Entry = { flow: string; axis: string; frontend: string; shots: Shot[] };

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
const names = frontends().supported.map((f) => f.name);

const escape = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const sections = flows
  .map((flow) => {
    const entries = manifest.filter((m) => m.flow === flow.flow);
    if (entries.length === 0) return "";

    // Capture order comes from the flow, not from whichever cell finished first.
    const labels: string[] = [];
    for (const step of flow.steps) {
      if (step.kind === "capture" && !labels.includes(step.label)) labels.push(step.label);
    }

    const rows = labels
      .map((label) => {
        const cells = names
          .map((name) => {
            const shot = entries.find((e) => e.frontend === name)?.shots.find((s) => s.label === label);
            const body = shot
              ? `<a href="${flow.flow}/${basename(shot.path)}" target="_blank">
                   <img loading="lazy" src="${flow.flow}/${basename(shot.path)}" alt="${escape(name)} — ${escape(label)}">
                 </a>`
              : `<div class="missing">not captured</div>`;
            return `<figure><figcaption>${escape(name)}</figcaption>${body}</figure>`;
          })
          .join("");
        const step = entries[0]?.shots.find((s) => s.label === label)?.step ?? label;
        return `<section class="moment">
          <h3>${escape(label)} <code>${escape(step)}</code></h3>
          <div class="row">${cells}</div>
        </section>`;
      })
      .join("");

    const videos = names
      .map(
        (name) =>
          `<figure><figcaption>${escape(name)}</figcaption>
             <video controls preload="metadata" src="${flow.flow}/video/${name}.webm"></video></figure>`,
      )
      .join("");

    return `<article>
      <header>
        <h2>${escape(flow.flow)}</h2>
        <p class="axis">${escape(flow.axis)}</p>
        <p class="about">${escape(flow.about)}</p>
        <details><summary>steps</summary><pre>${escape(flow.source.join("\n"))}</pre></details>
      </header>
      ${rows}
      <section class="moment"><h3>recordings</h3><div class="row">${videos}</div></section>
    </article>`;
  })
  .join("");

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
  .row { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 1rem; align-items: start; }
  figure { margin: 0; }
  figcaption { font-size: .78rem; opacity: .6; margin-bottom: .35rem; }
  img, video { width: 100%; border: 1px solid var(--line); border-radius: 8px; display: block; background: #fff; }
  .missing { border: 1px dashed var(--line); border-radius: 8px; padding: 2rem; text-align: center; font-size: .8rem; opacity: .5; }
</style></head>
<body>
  <h1>probes</h1>
  <p class="lede">Every flow in <code>probes/flows.yaml</code>, run against every frontend in
  <code>scripts/stacks.sh</code>, captured at the same moments. The scripted model makes the work
  identical across cells, so any difference below is the stack.</p>
  ${sections}
</body></html>`;

writeFileSync(join(ARTIFACTS, "index.html"), html);
console.log(`gallery → ${join(ARTIFACTS, "index.html")}`);
