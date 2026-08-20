// The jinja cell, start to finish, against the live server.
//
//   cd probes && bun run ../docs/recordings/jinja-cell.mjs   # with scripts/run.sh up
//
// Six beats, one thread throughout: an empty thread; the weather suggestion
// streaming a tool card and markdown text; a typed "search notes" turn; a
// third turn stopped mid-`analyze`, whose card is left frozen and whose turn
// never persists; a reload that proves it — the stopped turn is gone, the
// first two are back; and the same thread with JavaScript off, where a
// fourth turn runs entirely server-side through the no-JS post/redirect/get
// path. Two Playwright contexts (JS on, then JS off) each write a .webm,
// concatenated and palette-quantized into jinja-cell.gif.
//
// The no-JS turn asks something no keyword plan matches ("What can this demo
// do?"), which lands the scripted model's fixed fallback reply — deliberately
// not a second call to get_weather or search_notes. Both tools already ran
// once earlier in this same thread, and scripted.py assigns tool_call_id as
// `call_{tool}_{index-within-that-run}` (backends/pydantic-ai/app/scripted.py
// and this cell's verbatim copy, both `_emit_tool_calls`), so a second call to
// a tool already used in the thread reused the first call's id — asking "What's
// the weather in Paris?" here stored a second get_weather with tool_call_id
// `call_get_weather_0`, identical to Tokyo's, and the merged view then showed
// Paris's card text glued to Tokyo's reply.
//
// That was fixed in 51c0d5d, in all four backends, and protocol/conformance.sh
// now has a "tool call ids" section that drives exactly this two-turn case so
// it can't come back. The beat keeps its fallback prompt anyway: it's the one
// that shows the scripted model's third shape, which is what it was for.
import { readFileSync, writeFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { chromium, scratch, toGif } from "./rec.mjs";

const BASE = process.env.CELL_URL ?? "http://localhost:3005";
const SCRATCH = scratch();

const TIMEOUT = 30_000;

async function waitState(page, state) {
  await page.waitForSelector(`#composer[data-state="${state}"]`, { timeout: TIMEOUT }).catch(async (e) => {
    const dataState = await page.getAttribute("#composer", "data-state").catch(() => "?");
    const userCount = await page.locator('[data-role="user"]').count().catch(() => -1);
    console.error(`timed out waiting for composer state="${state}"`);
    console.error(`  composer data-state now: ${dataState}`);
    console.error(`  [data-role=user] count: ${userCount}`);
    throw e;
  });
}

const browser = await chromium.launch();

// --- Context 1: JavaScript on ---------------------------------------------
const ctx1 = await browser.newContext({
  viewport: { width: 1280, height: 900 },
  colorScheme: "light",
  recordVideo: { dir: SCRATCH, size: { width: 1280, height: 900 } },
});
const page1 = await ctx1.newPage();

// Beat 1: empty thread.
await page1.goto(BASE + "/", { waitUntil: "networkidle" });
const threadUrl = page1.url();
await page1.waitForSelector("#suggestions button", { timeout: TIMEOUT });
await page1.waitForTimeout(1500);

// Beat 2: weather via a suggestion.
const weatherBtn = page1.locator("#suggestions button", { hasText: "What's the weather" }).first();
await weatherBtn.click();
await waitState(page1, "busy");
await waitState(page1, "idle");
await page1.waitForTimeout(2000);

// Beat 3: notes, typed.
await page1.click('textarea[data-slot="input"]');
await page1.keyboard.type("Search notes for streaming protocols.", { delay: 28 });
await page1.keyboard.press("Enter");
await waitState(page1, "busy");
await waitState(page1, "idle");
await page1.waitForTimeout(2000);

// Beat 4: analyze, then Stop mid-flight.
await page1.click('textarea[data-slot="input"]');
await page1.keyboard.type("Analyze assistant-ui as a chat frontend.", { delay: 28 });
await page1.keyboard.press("Enter");
await page1.waitForSelector('[data-part="tool"][data-tool="analyze"]', { timeout: TIMEOUT });
await page1.waitForTimeout(1200);
await page1.click('button[data-slot="stop"]');
await waitState(page1, "idle");
await page1.waitForTimeout(2000);

// Beat 5: reload resumes.
await page1.reload({ waitUntil: "networkidle" });
await page1.waitForTimeout(2500);

const video1 = page1.video();
await ctx1.close();
const path1 = await video1.path();

// --- Context 2: JavaScript off, same thread --------------------------------
const ctx2 = await browser.newContext({
  viewport: { width: 1280, height: 900 },
  colorScheme: "light",
  javaScriptEnabled: false,
  recordVideo: { dir: SCRATCH, size: { width: 1280, height: 900 } },
});
const page2 = await ctx2.newPage();

// Beat 6: JS off, same thread. The prompt is deliberately one no keyword plan
// matches (see header comment) — it lands the scripted model's fixed fallback
// text reply rather than re-triggering get_weather or search_notes, both of
// which already ran once earlier in this thread.
await page2.goto(threadUrl, { waitUntil: "networkidle" });
await page2.waitForTimeout(1000);
await page2.click('textarea[data-slot="input"]');
await page2.keyboard.type("What can this demo do?", { delay: 28 });
await page2.click('button[data-slot="send"]');
await page2.waitForLoadState("networkidle", { timeout: TIMEOUT });
// No JS means no auto-scroll-to-bottom on load, so the new turn sits below
// the fold. A wheel event is native input, not a script, so it still works
// with javaScriptEnabled: false — but it scrolls whatever's under the mouse,
// so hover the transcript (its own overflow-y:auto pane on desktop) first;
// the mouse otherwise starts at (0,0), over the thread sidebar.
await page2.locator("#transcript").hover();
await page2.mouse.wheel(0, 5000);
await page2.waitForTimeout(2500);

const video2 = page2.video();
await ctx2.close();
const path2 = await video2.path();

await browser.close();

console.log(`video 1 (JS on):  ${path1}`);
console.log(`video 2 (JS off): ${path2}`);

// --- Concatenate and convert to GIF -----------------------------------------
// Two contexts, JS on then JS off, joined into one recording. Tool cards and
// markdown need a wider palette than the hub does.
toGif([path1, path2], "jinja-cell", { fps: 12, colors: 160 });
