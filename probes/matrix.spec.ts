// Every flow against every frontend. The pairs are generated, not written, so a
// new cell in scripts/stacks.sh or a new flow in flows.yaml is picked up with no
// edit here.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "@playwright/test";
import { loadFlows } from "./flow.ts";
import { captureKey, frontends, isPreview, ROOT } from "./frontends.ts";
import { Runner, type Shot } from "./runner.ts";

const ARTIFACTS = join(ROOT, "probes", "artifacts");
const flows = loadFlows(join(ROOT, "probes", "flows.yaml"));
const { supported, unsupported } = frontends();

// A frontend listed in stacks.sh with no adapter is a gap worth seeing, not a
// silent skip — it fails one obvious test rather than quietly testing nothing.
// A cell the hosted preview doesn't serve is the opposite: the subset is a
// decision, so it skips, and the title says which list made the decision.
for (const { name, why } of unsupported) {
  if (why === "not-hosted") {
    test.skip(`${name} · not in HOSTED_CELLS (scripts/hosted.sh)`, () => {});
    continue;
  }
  test(`${name} · no adapter`, () => {
    throw new Error(
      `${name} is listed in scripts/stacks.sh but has no adapter in probes/frontends.ts, ` +
        `so none of the flows ran against it. Add its selectors there.`,
    );
  });
}

// One file per cell rather than one shared manifest: Playwright runs workers as
// separate processes, so a module-level array here is per-worker and the last
// process to write would silently drop every other worker's captures.
const MANIFEST = join(ARTIFACTS, "manifest");

// The backend is the first thing in every artifact path and the first thing in
// every manifest name, so a run against a second backend lands beside the first
// instead of on top of it — which is what makes the gallery a rendering diff
// rather than a picture of whoever ran last. captureKey() is where a cell that
// runs its own agent (jinja) opts out of being labelled with a backend it never
// talked to.
for (const frontend of supported) {
  const key = captureKey(frontend);
  test.describe(frontend.name, () => {
    for (const flow of flows) {
      test(`${flow.flow} · ${flow.axis}`, async ({ browser }, testInfo) => {
        const flowDir = join(ARTIFACTS, key, flow.flow);
        const videoDir = join(flowDir, "video");
        mkdirSync(videoDir, { recursive: true });

        const context = await browser.newContext({
          viewport: { width: 1280, height: 900 },
          recordVideo: { dir: videoDir, size: { width: 1280, height: 900 } },
        });
        const page = await context.newPage();
        const runner = new Runner(page, frontend, flow, flowDir);

        try {
          await runner.run();
        } finally {
          const video = page.video();
          await context.close(); // video is only finalised once the context closes
          if (video) {
            await video.saveAs(join(videoDir, `${frontend.name}.webm`)).catch(() => {});
            await video.delete().catch(() => {});
          }
          mkdirSync(MANIFEST, { recursive: true });
          writeFileSync(
            join(MANIFEST, `${key}--${flow.flow}--${frontend.name}.json`),
            JSON.stringify(
              {
                backend: key,
                flow: flow.flow,
                axis: flow.axis,
                frontend: frontend.name,
                shots: runner.shots,
                ...(isPreview() ? { preview: true } : {}),
              },
              null,
              2,
            ),
          );
          for (const shot of runner.shots) {
            await testInfo.attach(shot.label, { path: shot.path, contentType: "image/png" });
          }
        }
      });
    }
  });
}
