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
// a tool already used in the thread reuses the first call's id. Confirmed live:
// asking "What's the weather in Paris?" here stores a second get_weather with
// tool_call_id `call_get_weather_0` — identical to Tokyo's — and the merged
// view then shows Paris's card text glued to Tokyo's reply. That's a real,
// reference-agent-level bug (present in every backend, not jinja-specific),
// not a driver bug; it's out of scope for this recording to fix, so the beat
// picks a prompt that doesn't retrigger it instead of showcasing it unlabeled.
import playwright from "file:///Users/fairchild/orca/workspaces/pydantic-chat/demo/probes/node_modules/playwright/index.js";
import { mkdirSync, readFileSync, writeFileSync, statSync, unlinkSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";

const { chromium } = playwright;

const BASE = "http://localhost:3005";
const OUT_DIR = "/Users/fairchild/orca/workspaces/pydantic-chat/demo/docs/recordings";
const SCRATCH = "/private/tmp/claude-501/-Users-fairchild-orca-workspaces-pydantic-chat-demo/e2e372ec-ad5d-4945-87a2-02917c774f51/scratchpad/rec";
mkdirSync(SCRATCH, { recursive: true });

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
const listPath = join(SCRATCH, "list.txt");
writeFileSync(listPath, `file '${path1}'\nfile '${path2}'\n`);

const ffmpeg = "/opt/homebrew/bin/ffmpeg";
const gifPath = join(OUT_DIR, "jinja-cell.gif");

execFileSync(ffmpeg, [
  "-y",
  "-f", "concat", "-safe", "0", "-i", listPath,
  "-vf", "fps=12,scale=900:-1:flags=lanczos,split[s0][s1];[s0]palettegen=max_colors=160[p];[s1][p]paletteuse=dither=bayer:bayer_scale=4",
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
