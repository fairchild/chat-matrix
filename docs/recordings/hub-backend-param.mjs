// The hub, every square explicit: item 6 of docs/plans/open-work.md.
//
//   cd probes && bun run ../docs/recordings/hub-backend-param.mjs   # with scripts/run.sh up
//
// One beat: open the hub, click the assistant-ui × pydantic-ai square (the
// first backend column — the one case that used to omit `?backend=` because
// BACKENDS[0] happened to match the cells' own default), and land on the cell
// with `?backend=http://localhost:8001` in the address bar and the badge
// confirming it actually talked to that backend. Proves `href(f, b)` no
// longer special-cases the first column.
import playwright from "file:///Users/fairchild/orca/workspaces/pydantic-chat/demo/probes/node_modules/playwright/index.js";
import { mkdirSync, statSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";

const { chromium } = playwright;

const OUT_DIR = "/Users/fairchild/orca/workspaces/pydantic-chat/demo/docs/recordings";
const SCRATCH = "/private/tmp/claude-501/-Users-fairchild-orca-workspaces-pydantic-chat-demo/e46d4776-cb6d-4b02-8cbe-b87b9a58d1e2/scratchpad/beta/rec";
mkdirSync(SCRATCH, { recursive: true });

const TIMEOUT = 30_000;

const browser = await chromium.launch();
const ctx = await browser.newContext({
  viewport: { width: 1000, height: 620 },
  colorScheme: "light",
  recordVideo: { dir: SCRATCH, size: { width: 1000, height: 620 } },
});
const page = await ctx.newPage();

// Beat: the hub, grid resolved.
await page.goto("http://localhost:3000/", { waitUntil: "networkidle" });
await page.waitForSelector("#sq-assistant-ui-pydantic-ai a", { timeout: TIMEOUT });
await page.waitForTimeout(900);

// Hover first so the square's own readout (stack, path) is on screen briefly
// before the click — otherwise the click reads as blind.
await page.locator("#sq-assistant-ui-pydantic-ai a").hover();
await page.waitForTimeout(700);

const href = await page.locator("#sq-assistant-ui-pydantic-ai a").getAttribute("href");
console.log(`square href: ${href}`);
if (!href || !href.includes("backend=")) {
  throw new Error(`expected the square's href to carry ?backend=, got: ${href}`);
}

await page.click("#sq-assistant-ui-pydantic-ai a");
await page.waitForURL(/localhost:3001/, { timeout: TIMEOUT });
await page.waitForLoadState("networkidle", { timeout: TIMEOUT });
// Let the badge's own /health fetch resolve so it shows the live backend name.
await page.waitForFunction(
  () => document.querySelector("header")?.textContent?.includes("pydantic-ai"),
  { timeout: TIMEOUT },
);
await page.waitForTimeout(1200);

const finalUrl = page.url();
console.log(`landed on: ${finalUrl}`);
if (!finalUrl.includes("backend=http")) {
  throw new Error(`expected the cell URL to carry ?backend=http..., got: ${finalUrl}`);
}

const video = page.video();
await ctx.close();
const videoPath = await video.path();
await browser.close();

console.log(`video: ${videoPath}`);

// --- Convert to GIF, small and short on purpose -----------------------------
const ffmpeg = "/opt/homebrew/bin/ffmpeg";
const gifPath = join(OUT_DIR, "hub-backend-param.gif");

execFileSync(ffmpeg, [
  "-y",
  "-i", videoPath,
  "-vf", "fps=10,scale=900:-1:flags=lanczos,split[s0][s1];[s0]palettegen=max_colors=96[p];[s1][p]paletteuse=dither=bayer:bayer_scale=4",
  gifPath,
], { stdio: "inherit" });

const size = statSync(gifPath).size;
console.log(`gif: ${gifPath} (${(size / 1024 / 1024).toFixed(2)} MB)`);

const probe = execFileSync("/opt/homebrew/bin/ffprobe", [
  "-v", "error", "-select_streams", "v:0",
  "-show_entries", "stream=duration",
  "-of", "default=noprint_wrappers=1:nokey=1",
  gifPath,
]).toString().trim();
console.log(`duration: ${probe}s`);
