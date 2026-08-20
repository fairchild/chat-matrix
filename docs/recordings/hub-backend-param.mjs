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
import { chromium, scratch, toGif } from "./rec.mjs";

const HUB = process.env.HUB_URL ?? "http://localhost:3000";
const SCRATCH = scratch();

const TIMEOUT = 30_000;

const browser = await chromium.launch();
const ctx = await browser.newContext({
  viewport: { width: 1000, height: 620 },
  colorScheme: "light",
  recordVideo: { dir: SCRATCH, size: { width: 1000, height: 620 } },
});
const page = await ctx.newPage();

// Beat: the hub, grid resolved.
await page.goto(`${HUB}/`, { waitUntil: "networkidle" });
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
// Two greys and a green dot: fewer colours than a cell recording needs.
toGif([videoPath], "hub-backend-param", { fps: 10, colors: 96 });
