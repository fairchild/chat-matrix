import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: ".",
  testMatch: /(matrix|hub)\.spec\.ts$/,
  outputDir: "artifacts/.playwright",
  // The three frontends are independent processes, so they run concurrently;
  // one worker per cell keeps a slow flow in one stack from serialising the
  // others without making the shared backend's thread store the bottleneck.
  fullyParallel: true,
  workers: 3,
  timeout: 120_000,
  expect: { timeout: 15_000 },
  reporter: [["list"], ["html", { outputFolder: "artifacts/report", open: "never" }]],
  use: {
    // Drive an installed browser instead of Playwright's bundled chromium.
    // Unset, nothing changes. It exists because an outbound firewall knows
    // browsers by binary: a machine running Little Snitch has a rule for Chrome
    // and none for the downloaded chromium, and the shape that takes is every
    // navigation timing out with no request having reached the network — which
    // reads as the site being down rather than the browser being unable to ask.
    //   PROBE_BROWSER_CHANNEL=chrome ./scripts/probe.sh --production
    ...(process.env.PROBE_BROWSER_CHANNEL ? { channel: process.env.PROBE_BROWSER_CHANNEL } : {}),
    viewport: { width: 1280, height: 900 },
    trace: "retain-on-failure",
    // Video is configured per-test in matrix.spec.ts so each recording can be
    // named for the cell it belongs to rather than a hash.
  },
});
