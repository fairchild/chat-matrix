// The folio cell, one thread from empty to reload, against the live matrix.
//
//   cd probes && bun run ../docs/recordings/folio-cell.mjs   # with scripts/run.sh up
//
// Seven beats, chosen for the things a still can't carry. The page follows the
// turn: sending docks the ask under the chrome and a runway gives back exactly
// the height the answer takes, so the frame holds still for the whole turn —
// that is motion, and it is most of what separates this cell from the other
// four. The rest are the ledger's own moments: a row that says a tool's name
// because the tool is outside Folio's verb table, a body that only exists
// because the host projects a struct into `content`, three seconds of `analyze`
// with nothing but a bodiless row and one breathing line to say work is
// happening, an older turn receding behind the newest, and `d` flipping to a
// dark palette that was designed rather than inverted.
//
// It ends on a reload, which comes back empty. This cell holds its thread in
// useChat like the other three direct cells, and `probes/frontends.ts` holds it
// to that by not declaring `resumes` — so the last beat is the declaration,
// filmed.
import { chromium, scratch, toGif } from "./rec.mjs";

const BASE = process.env.CELL_URL ?? "http://localhost:3006";
const SCRATCH = scratch();
const TIMEOUT = 30_000;

const browser = await chromium.launch();
const ctx = await browser.newContext({
  viewport: { width: 1280, height: 900 },
  colorScheme: "light",
  recordVideo: { dir: SCRATCH, size: { width: 1280, height: 900 } },
});
const page = await ctx.newPage();

const composer = page.locator("[data-compose-boundary] textarea").first();
const stop = page.locator('button[aria-label="Stop"]');

/** The turn is over when the interrupt is gone — this cell hands Folio a
 *  stopTurn callback only while one is running, so the ■ is the busy tell. */
const idle = () => stop.waitFor({ state: "detached", timeout: TIMEOUT });

async function ask(text) {
  await composer.click();
  await page.keyboard.type(text, { delay: 28 });
  await page.keyboard.press("Enter");
}

// Beat 1: the empty note. No placeholder, no hint chips — the three probe
// prompts as one line of text, because Folio has no suggestions component.
await page.goto(BASE + "/", { waitUntil: "networkidle" });
await page.locator('[data-testid="empty-transcript"]').waitFor({ timeout: TIMEOUT });
await page.waitForTimeout(1800);

// Beat 2: weather. The ask docks, a row appears reading `get_weather` — the
// verb table's fallback, since this tool is nothing a coding agent calls — and
// the turn closes with "1 tool · N.Ns", every figure of which the host knew.
await ask("What's the weather in Tokyo?");
await page.locator('[data-testid="tool-row"]').first().waitFor({ timeout: TIMEOUT });
await idle();
await page.waitForTimeout(2200);

// Beat 3: notes, and the body opened by hand. `search_notes` is the one
// reference tool naming a key the ledger reads for a subject, so this row has
// one. Its body is the projection: a list of notes has no string `content`, so
// without lib/folio-projection.ts the disclosure would open onto nothing.
await ask("Search notes for streaming protocols.");
await idle();
await page.waitForTimeout(1200);
const notesRow = page.locator('[data-testid="tool-row"] button').last();
await notesRow.click();
await page.waitForTimeout(2600);
// Folded away again, because that is the row's resting state and the next two
// beats are about the shape of a turn rather than the contents of one.
await notesRow.click();
await page.waitForTimeout(900);

// Beat 4: analyze, held mid-flight. Three seconds of a row with no figure and
// one breathing line. Whether that reads as working or as blank is the question
// this beat exists to let someone answer for themselves.
await ask("Analyze assistant-ui as a chat frontend.");
await page.locator('[data-testid="activity-line"]').waitFor({ timeout: TIMEOUT });
await page.waitForTimeout(2600);
await idle();
await page.waitForTimeout(1800);

// Beat 5: two frames. Scrolling up puts the newest turn's filled frame beside
// an older one's quiet outline, which is the transcript arguing it is a
// document rather than a log.
await page.mouse.move(640, 450);
for (let i = 0; i < 6; i++) {
  await page.mouse.wheel(0, -170);
  await page.waitForTimeout(90);
}
await page.waitForTimeout(2400);

// Beat 6: `d`. Folio writes data-theme from its own pre-paint script and keeps
// the choice under `folio-theme`; the host bar follows the same attribute. The
// composer autofocuses, so the key has to be pressed with focus off it — which
// is a real property of this cell, not a quirk of driving it.
await page.mouse.click(640, 16);
await page.keyboard.press("d");
await page.waitForTimeout(2600);

// Beat 7: reload, and the thread is gone. The backend still holds it; nothing
// here asks for it.
await page.reload({ waitUntil: "networkidle" });
await page.locator('[data-testid="empty-transcript"]').waitFor({ timeout: TIMEOUT });
await page.waitForTimeout(2200);

const video = page.video();
await ctx.close();
const path = await video.path();
await browser.close();

console.log(`video: ${path}`);

// Warm paper and warm charcoal, serif prose, no syntax colour and no cards —
// this palette is narrower than the jinja cell's, so it quantizes further
// without visible banding. The palette is the lever that holds the file under
// 4 MB, not the frame rate: dropping to 9 fps made it *bigger*, because the
// inter-frame deltas a scroll produces cost more than the frames it saved.
toGif([path], "folio-cell", { fps: 11, colors: 96, width: 900 });
