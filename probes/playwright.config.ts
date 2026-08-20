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
    viewport: { width: 1280, height: 900 },
    trace: "retain-on-failure",
    // Video is configured per-test in matrix.spec.ts so each recording can be
    // named for the cell it belongs to rather than a hash.
  },
});
